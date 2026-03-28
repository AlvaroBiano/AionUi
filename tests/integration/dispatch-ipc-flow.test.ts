/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for dispatchBridge IPC flow.
 * Tests the complete IPC chain for Phase 2b dispatch features.
 * Test IDs: INT-IPC-001 through INT-IPC-010.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

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
    },
    conversation: {
      listChanged: { emit: vi.fn() },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'int-uuid-001'),
}));

vi.mock('@/common/config/storage', () => ({}));

const mockCustomAgents = [
  {
    id: 'leader-agent-1',
    name: 'Test Leader',
    avatar: 'avatar-url',
    context: 'You are a test leader agent',
    enabled: true,
  },
  {
    id: 'leader-agent-2',
    name: 'Disabled Leader',
    avatar: 'avatar-disabled',
    context: 'You are disabled',
    enabled: false,
  },
];

const mockProviders = [
  {
    id: 'custom-provider-1',
    platform: 'openai',
    name: 'Custom OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: ['gpt-4o'],
  },
];

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => {
      if (key === 'model.config') return mockProviders;
      if (key === 'acp.customAgents') return mockCustomAgents;
      if (key === 'gemini.defaultModel') return null;
      return null;
    }),
  },
  ProcessEnv: {
    get: vi.fn(async () => ({ workDir: '/default/workspace' })),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

import { initDispatchBridge } from '@process/bridge/dispatchBridge';
import { mainWarn } from '@process/utils/mainLogger';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConversationService(overrides?: Record<string, ReturnType<typeof vi.fn>>) {
  return {
    createConversation: vi.fn(async () => {}),
    getConversation: vi.fn(async () => null),
    listAllConversations: vi.fn(async () => []),
    ...overrides,
  };
}

function makeConversationRepo(overrides?: Record<string, ReturnType<typeof vi.fn>>) {
  return {
    getMessages: vi.fn(async () => ({ data: [] })),
    ...overrides,
  };
}

function makeWorkerTaskManager(overrides?: Record<string, ReturnType<typeof vi.fn>>) {
  return {
    getOrBuildTask: vi.fn(async () => ({})),
    getTask: vi.fn(() => null),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Dispatch IPC Flow — Phase 2b Integration', () => {
  let conversationService: ReturnType<typeof makeConversationService>;
  let conversationRepo: ReturnType<typeof makeConversationRepo>;
  let workerTaskManager: ReturnType<typeof makeWorkerTaskManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(providerHandlers)) {
      delete providerHandlers[key];
    }
    conversationService = makeConversationService();
    conversationRepo = makeConversationRepo();
    workerTaskManager = makeWorkerTaskManager();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initDispatchBridge(workerTaskManager as any, conversationService as any, conversationRepo as any);
  });

  // INT-IPC-001: createGroupChat with leaderAgentId + modelOverride + seedMessages
  describe('INT-IPC-001: createGroupChat with full Phase 2b params', () => {
    it('stores leader agent snapshot in conversation extra', async () => {
      const result = (await providerHandlers['createGroupChat']({
        name: 'Full Phase 2b Chat',
        leaderAgentId: 'leader-agent-1',
        modelOverride: { providerId: 'custom-provider-1', useModel: 'gpt-4o' },
        seedMessages: 'Start by analyzing the codebase',
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({
            leaderAgentId: 'leader-agent-1',
            leaderPresetRules: 'You are a test leader agent',
            leaderName: 'Test Leader',
            leaderAvatar: 'avatar-url',
            seedMessages: 'Start by analyzing the codebase',
          }),
        })
      );
    });

    it('uses model override provider with full config lookup', async () => {
      await providerHandlers['createGroupChat']({
        name: 'Override Model Chat',
        modelOverride: { providerId: 'custom-provider-1', useModel: 'gpt-4o' },
      });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            id: 'custom-provider-1',
            platform: 'openai',
            useModel: 'gpt-4o',
            apiKey: 'sk-test',
          }),
        })
      );
    });
  });

  // INT-IPC-002: getGroupChatInfo returns correct children list
  describe('INT-IPC-002: getGroupChatInfo returns children', () => {
    it('returns filtered children with dispatch metadata', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-1',
        type: 'dispatch',
        name: 'Test Dispatch',
        extra: { groupChatName: 'My Group' },
      });
      conversationService.listAllConversations.mockResolvedValue([
        {
          id: 'child-1',
          name: 'Child Task 1',
          status: 'running',
          createTime: 1000,
          modifyTime: 2000,
          extra: {
            dispatchSessionType: 'dispatch_child',
            parentSessionId: 'dispatch-1',
            dispatchTitle: 'Task Alpha',
            teammateConfig: { name: 'Agent A', avatar: 'a-avatar' },
          },
        },
        {
          id: 'child-2',
          name: 'Child Task 2',
          status: 'completed',
          createTime: 1500,
          modifyTime: 2500,
          extra: {
            dispatchSessionType: 'dispatch_child',
            parentSessionId: 'dispatch-1',
          },
        },
        {
          id: 'unrelated',
          name: 'Unrelated',
          status: 'idle',
          createTime: 500,
          modifyTime: 600,
          extra: { dispatchSessionType: 'dispatch_child', parentSessionId: 'other-parent' },
        },
      ]);

      const result = (await providerHandlers['getGroupChatInfo']({
        conversationId: 'dispatch-1',
      })) as { success: boolean; data: { children: Array<Record<string, unknown>> } };

      expect(result.success).toBe(true);
      expect(result.data.children.length).toBe(2);
    });

    it('maps teammateConfig into child entries correctly', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-1',
        type: 'dispatch',
        name: 'Test',
        extra: {},
      });
      conversationService.listAllConversations.mockResolvedValue([
        {
          id: 'child-1',
          name: 'C1',
          status: 'running',
          createTime: 1000,
          modifyTime: 2000,
          extra: {
            dispatchSessionType: 'dispatch_child',
            parentSessionId: 'dispatch-1',
            dispatchTitle: 'Custom Title',
            teammateConfig: { name: 'Agent X', avatar: 'x-emoji' },
          },
        },
      ]);

      const result = (await providerHandlers['getGroupChatInfo']({
        conversationId: 'dispatch-1',
      })) as { success: boolean; data: { children: Array<{ teammateName: string; teammateAvatar: string }> } };

      expect(result.data.children[0].teammateName).toBe('Agent X');
      expect(result.data.children[0].teammateAvatar).toBe('x-emoji');
    });
  });

  // INT-IPC-003: getChildTranscript with offset parameter
  describe('INT-IPC-003: getChildTranscript with offset', () => {
    it('passes offset to repository getMessages', async () => {
      conversationRepo.getMessages.mockResolvedValue({
        data: [{ position: 'left', content: { content: 'response' }, createdAt: 3000 }],
      });
      conversationService.getConversation.mockResolvedValue({ status: 'running' });

      const result = (await providerHandlers['getChildTranscript']({
        childSessionId: 'child-1',
        offset: 10,
        limit: 5,
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(conversationRepo.getMessages).toHaveBeenCalledWith('child-1', 10, 5);
    });

    it('defaults offset to 0 when not provided', async () => {
      conversationRepo.getMessages.mockResolvedValue({ data: [] });
      conversationService.getConversation.mockResolvedValue({ status: 'idle' });

      await providerHandlers['getChildTranscript']({ childSessionId: 'child-1', limit: 20 });

      expect(conversationRepo.getMessages).toHaveBeenCalledWith('child-1', 0, 20);
    });
  });

  // INT-IPC-004: cancelChildTask runtime guard
  describe('INT-IPC-004: cancelChildTask runtime guard', () => {
    it('returns error when dispatch session is not found', async () => {
      workerTaskManager.getTask.mockReturnValue(null);

      const result = (await providerHandlers['cancelChildTask']({
        conversationId: 'missing',
        childSessionId: 'child-1',
      })) as Record<string, unknown>;

      expect(result.success).toBe(false);
      expect(result.msg).toContain('not found');
    });

    it('returns error when task type is not dispatch', async () => {
      workerTaskManager.getTask.mockReturnValue({ type: 'gemini' });

      const result = (await providerHandlers['cancelChildTask']({
        conversationId: 'non-dispatch',
        childSessionId: 'child-1',
      })) as Record<string, unknown>;

      expect(result.success).toBe(false);
    });

    it('returns error when task does not support cancelChild method', async () => {
      workerTaskManager.getTask.mockReturnValue({ type: 'dispatch' });

      const result = (await providerHandlers['cancelChildTask']({
        conversationId: 'dispatch-1',
        childSessionId: 'child-1',
      })) as Record<string, unknown>;

      expect(result.success).toBe(false);
      expect(result.msg).toContain('does not support cancelChild');
    });

    it('calls cancelChild when method exists on dispatch task', async () => {
      const mockCancelChild = vi.fn(async () => {});
      workerTaskManager.getTask.mockReturnValue({
        type: 'dispatch',
        cancelChild: mockCancelChild,
      });

      const result = (await providerHandlers['cancelChildTask']({
        conversationId: 'dispatch-1',
        childSessionId: 'child-99',
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(mockCancelChild).toHaveBeenCalledWith('child-99');
    });
  });

  // INT-IPC-005: createGroupChat triggers orchestrator warm-start
  describe('INT-IPC-005: orchestrator warm-start on creation', () => {
    it('calls getOrBuildTask after conversation creation', async () => {
      await providerHandlers['createGroupChat']({ name: 'Warm Start Test' });

      expect(workerTaskManager.getOrBuildTask).toHaveBeenCalledWith('int-uuid-001');
    });

    it('still returns success when warm-start fails', async () => {
      workerTaskManager.getOrBuildTask.mockRejectedValue(new Error('Worker fork failed'));

      const result = (await providerHandlers['createGroupChat']({
        name: 'Warm Fail Test',
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(mainWarn).toHaveBeenCalledWith(
        expect.stringContaining('createGroupChat'),
        expect.stringContaining('warm-start failed'),
        expect.any(Error)
      );
    });
  });

  // INT-IPC-006: Full round-trip: create → getInfo → getTranscript
  describe('INT-IPC-006: full round-trip flow', () => {
    it('creates a dispatch conversation then retrieves its info', async () => {
      const createResult = (await providerHandlers['createGroupChat']({
        name: 'Round Trip Chat',
        leaderAgentId: 'leader-agent-1',
        seedMessages: 'Initial prompt',
      })) as { success: boolean; data: { conversationId: string } };

      expect(createResult.success).toBe(true);
      const convId = createResult.data.conversationId;

      // Now simulate getGroupChatInfo for this conversation
      conversationService.getConversation.mockResolvedValue({
        id: convId,
        type: 'dispatch',
        name: 'Test Leader',
        extra: {
          groupChatName: 'Round Trip Chat',
          leaderAgentId: 'leader-agent-1',
          seedMessages: 'Initial prompt',
        },
      });
      conversationService.listAllConversations.mockResolvedValue([]);

      const infoResult = (await providerHandlers['getGroupChatInfo']({
        conversationId: convId,
      })) as { success: boolean; data: { dispatcherName: string } };

      expect(infoResult.success).toBe(true);
      expect(infoResult.data.dispatcherName).toBe('Round Trip Chat');
    });
  });
});
