/**
 * White-box unit tests for initDispatchBridge.
 * Test IDs: IPC-DB-001 through IPC-DB-011.
 *
 * Node environment (not DOM) — tests the main-process bridge handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Capture provider callbacks registered by initDispatchBridge
const providerHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      createGroupChat: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['createGroupChat'] = handler;
        },
      },
      getGroupChatInfo: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['getGroupChatInfo'] = handler;
        },
      },
      getChildTranscript: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['getChildTranscript'] = handler;
        },
      },
      cancelChildTask: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['cancelChildTask'] = handler;
        },
      },
      getTeammateConfig: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['getTeammateConfig'] = handler;
        },
      },
      saveTeammate: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['saveTeammate'] = handler;
        },
      },
      notifyParent: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['notifyParent'] = handler;
        },
      },
      updateGroupChatSettings: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['updateGroupChatSettings'] = handler;
        },
      },
      forkToDispatch: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['forkToDispatch'] = handler;
        },
      },
    },
    conversation: {
      listChanged: { emit: vi.fn() },
    },
    geminiConversation: {
      responseStream: { emit: vi.fn() },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'mock-uuid-1'),
}));

vi.mock('@/common/config/storage', () => ({}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async () => null),
  },
  ProcessEnv: {
    get: vi.fn(async () => ({ workDir: '/default/workspace' })),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
}));

import { initDispatchBridge } from '../../../src/process/bridge/dispatchBridge';
import { ipcBridge } from '@/common';
import { ProcessConfig, ProcessEnv } from '@process/utils/initStorage';

// ── Helpers ────────────────────────────────────────────────────────────────

type MockConversationService = {
  createConversation: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
  listAllConversations: ReturnType<typeof vi.fn>;
};

type MockConversationRepo = {
  getMessages: ReturnType<typeof vi.fn>;
};

function makeConversationService(overrides?: Partial<MockConversationService>): MockConversationService {
  return {
    createConversation: vi.fn(async () => {}),
    getConversation: vi.fn(async () => null),
    listAllConversations: vi.fn(async () => []),
    ...overrides,
  };
}

function makeConversationRepo(overrides?: Partial<MockConversationRepo>): MockConversationRepo {
  return {
    getMessages: vi.fn(async () => ({ data: [] })),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('initDispatchBridge', () => {
  let conversationService: MockConversationService;
  let conversationRepo: MockConversationRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear captured handlers
    for (const key of Object.keys(providerHandlers)) {
      delete providerHandlers[key];
    }
    conversationService = makeConversationService();
    conversationRepo = makeConversationRepo();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initDispatchBridge({} as any, conversationService as any, conversationRepo as any);
  });

  // IPC-DB-001: Registers all three provider handlers
  describe('IPC-DB-001: registers handlers', () => {
    it('registers createGroupChat, getGroupChatInfo, and getChildTranscript', () => {
      expect(providerHandlers['createGroupChat']).toBeInstanceOf(Function);
      expect(providerHandlers['getGroupChatInfo']).toBeInstanceOf(Function);
      expect(providerHandlers['getChildTranscript']).toBeInstanceOf(Function);
    });
  });

  // IPC-DB-002: createGroupChat creates conversation and emits listChanged
  describe('IPC-DB-002: createGroupChat success', () => {
    it('creates a dispatch conversation and returns success', async () => {
      const result = await providerHandlers['createGroupChat']({ name: 'Test Chat' });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'mock-uuid-1',
          type: 'dispatch',
          name: 'Test Chat',
        })
      );

      expect(result).toEqual({ success: true, data: { conversationId: 'mock-uuid-1' } });
    });

    it('emits listChanged event after creation', async () => {
      await providerHandlers['createGroupChat']({ name: 'Test' });

      expect(ipcBridge.conversation.listChanged.emit).toHaveBeenCalledWith({
        conversationId: 'mock-uuid-1',
        action: 'created',
        source: 'dispatch',
      });
    });
  });

  // IPC-DB-003: createGroupChat uses default name when not provided
  describe('IPC-DB-003: createGroupChat default name', () => {
    it('uses "Group Chat" as default name', async () => {
      await providerHandlers['createGroupChat']({});

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Group Chat' })
      );
    });
  });

  // IPC-DB-004: createGroupChat uses workspace from params
  describe('IPC-DB-004: createGroupChat workspace from params', () => {
    it('uses provided workspace over default', async () => {
      await providerHandlers['createGroupChat']({ workspace: '/custom/workspace' });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ workspace: '/custom/workspace' }),
        })
      );
    });
  });

  // IPC-DB-005: createGroupChat failure returns error
  describe('IPC-DB-005: createGroupChat failure', () => {
    it('returns error response when createConversation throws', async () => {
      conversationService.createConversation.mockRejectedValue(new Error('DB failure'));

      const result = await providerHandlers['createGroupChat']({ name: 'Fail' });

      expect(result).toEqual({ success: false, msg: expect.stringContaining('DB failure') });
    });
  });

  // IPC-DB-006: getGroupChatInfo returns info for dispatch conversation
  describe('IPC-DB-006: getGroupChatInfo success', () => {
    it('returns conversation info with children', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'conv-1',
        type: 'dispatch',
        name: 'My Group',
        extra: { groupChatName: 'Custom Name', pendingNotifications: ['n1', 'n2'] },
      });

      conversationService.listAllConversations.mockResolvedValue([
        {
          id: 'child-1',
          name: 'Child Task',
          status: 'running',
          createTime: 1000,
          modifyTime: 2000,
          extra: {
            dispatchSessionType: 'dispatch_child',
            parentSessionId: 'conv-1',
            dispatchTitle: 'Custom Title',
            teammateConfig: { name: 'Agent A', avatar: '🤖' },
          },
        },
      ]);

      const result = (await providerHandlers['getGroupChatInfo']({ conversationId: 'conv-1' })) as Record<
        string,
        unknown
      >;

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.dispatcherName).toBe('Custom Name');
      expect(data.pendingNotificationCount).toBe(2);
    });
  });

  // IPC-DB-007: getGroupChatInfo filters by dispatchSessionType and parentSessionId
  describe('IPC-DB-007: child filtering logic', () => {
    it('only includes children with matching parentSessionId', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'conv-1',
        type: 'dispatch',
        name: 'Group',
        extra: {},
      });

      conversationService.listAllConversations.mockResolvedValue([
        {
          id: 'child-match',
          name: 'Match',
          status: 'running',
          createTime: 1000,
          modifyTime: 2000,
          extra: { dispatchSessionType: 'dispatch_child', parentSessionId: 'conv-1' },
        },
        {
          id: 'child-other',
          name: 'Other',
          status: 'idle',
          createTime: 1000,
          modifyTime: 2000,
          extra: { dispatchSessionType: 'dispatch_child', parentSessionId: 'conv-OTHER' },
        },
        {
          id: 'regular',
          name: 'Regular',
          status: 'idle',
          createTime: 1000,
          modifyTime: 2000,
          extra: {},
        },
      ]);

      const result = (await providerHandlers['getGroupChatInfo']({ conversationId: 'conv-1' })) as Record<
        string,
        unknown
      >;
      const data = result.data as { children: unknown[] };

      expect(data.children.length).toBe(1);
    });
  });

  // IPC-DB-008: getGroupChatInfo returns error for non-dispatch conversation
  describe('IPC-DB-008: non-dispatch conversation', () => {
    it('returns error when conversation type is not dispatch', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'conv-1',
        type: 'gemini',
        name: 'Regular',
        extra: {},
      });

      const result = (await providerHandlers['getGroupChatInfo']({ conversationId: 'conv-1' })) as Record<
        string,
        unknown
      >;

      expect(result.success).toBe(false);
    });

    it('returns error when conversation is not found', async () => {
      conversationService.getConversation.mockResolvedValue(null);

      const result = (await providerHandlers['getGroupChatInfo']({ conversationId: 'missing' })) as Record<
        string,
        unknown
      >;

      expect(result.success).toBe(false);
    });
  });

  // IPC-DB-009: getChildTranscript returns messages
  // OBS-01: Split into two tests to stay within 3 expects per it()
  describe('IPC-DB-009: getChildTranscript success', () => {
    it('returns success with correct message count', async () => {
      conversationRepo.getMessages.mockResolvedValue({
        data: [
          { position: 'right', content: { content: 'user msg' }, createdAt: 1000 },
          { position: 'left', content: { content: 'assistant msg' }, createdAt: 2000 },
        ],
      });
      conversationService.getConversation.mockResolvedValue({ status: 'running' });

      const result = (await providerHandlers['getChildTranscript']({
        childSessionId: 'child-1',
        limit: 10,
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      const data = result.data as { messages: unknown[] };
      expect(data.messages.length).toBe(2);
    });

    it('maps position to role correctly', async () => {
      conversationRepo.getMessages.mockResolvedValue({
        data: [
          { position: 'right', content: { content: 'user msg' }, createdAt: 1000 },
          { position: 'left', content: { content: 'assistant msg' }, createdAt: 2000 },
        ],
      });
      conversationService.getConversation.mockResolvedValue({ status: 'running' });

      const result = (await providerHandlers['getChildTranscript']({
        childSessionId: 'child-1',
        limit: 10,
      })) as Record<string, unknown>;
      const data = result.data as { messages: Array<{ role: string }> };

      expect(data.messages[0].role).toBe('user');
      expect(data.messages[1].role).toBe('assistant');
    });
  });

  // IPC-DB-010: getChildTranscript uses default limit of 50
  describe('IPC-DB-010: getChildTranscript default limit', () => {
    it('uses limit=50 when not specified', async () => {
      conversationRepo.getMessages.mockResolvedValue({ data: [] });
      conversationService.getConversation.mockResolvedValue({ status: 'idle' });

      await providerHandlers['getChildTranscript']({ childSessionId: 'child-1' });

      expect(conversationRepo.getMessages).toHaveBeenCalledWith('child-1', 0, 50);
    });
  });

  // IPC-DB-011: getChildTranscript handles errors
  describe('IPC-DB-011: getChildTranscript failure', () => {
    it('returns error response when repository throws', async () => {
      conversationRepo.getMessages.mockRejectedValue(new Error('DB read error'));

      const result = (await providerHandlers['getChildTranscript']({ childSessionId: 'child-1' })) as Record<
        string,
        unknown
      >;

      expect(result.success).toBe(false);
      expect(result.msg).toContain('DB read error');
    });
  });

  // ISSUE-05: getChildTranscript with no conversationRepo returns empty messages
  describe('IPC-DB-012: getChildTranscript without conversationRepo', () => {
    it('returns empty messages when conversationRepo is not provided', async () => {
      // Re-init without conversationRepo
      for (const key of Object.keys(providerHandlers)) delete providerHandlers[key];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initDispatchBridge({} as any, conversationService as any, undefined);
      conversationService.getConversation.mockResolvedValue({ status: 'idle' });

      const result = (await providerHandlers['getChildTranscript']({ childSessionId: 'child-1' })) as Record<
        string,
        unknown
      >;
      const data = result.data as { messages: unknown[] };

      expect(result.success).toBe(true);
      expect(data.messages).toEqual([]);
    });
  });

  // ISSUE-06: createGroupChat workspace fallback to ProcessEnv
  describe('IPC-DB-013: createGroupChat workspace fallback', () => {
    it('falls back to ProcessEnv workspace when params.workspace is not provided', async () => {
      await providerHandlers['createGroupChat']({ name: 'Test' });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ workspace: '/default/workspace' }),
        })
      );
    });

    it('uses empty string when both params.workspace and envDirs.workDir are absent', async () => {
      (ProcessEnv.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await providerHandlers['createGroupChat']({ name: 'Test' });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ workspace: '' }),
        })
      );
    });
  });

  // ISSUE-07: createGroupChat model extraction from ProcessConfig
  describe('IPC-DB-014: createGroupChat model from ProcessConfig', () => {
    it('uses ProcessConfig model when available as object', async () => {
      // First call is model.config (providers list) — return empty array
      (ProcessConfig.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // Second call is gemini.defaultModel — return the custom provider reference
      (ProcessConfig.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'custom-provider',
        useModel: 'gemini-2.5-pro',
      });

      await providerHandlers['createGroupChat']({ name: 'Test' });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ id: 'custom-provider', useModel: 'gemini-2.5-pro' }),
        })
      );
    });

    it('falls back to default gemini model when ProcessConfig returns null', async () => {
      await providerHandlers['createGroupChat']({ name: 'Test' });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ id: 'gemini', useModel: 'gemini-2.0-flash' }),
        })
      );
    });
  });
});
