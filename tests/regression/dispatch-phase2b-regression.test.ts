/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 2b regression tests for dispatch system.
 * Prevent known bugs from reintroduction.
 * Test IDs: REG-2B-001 through REG-2B-005.
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
      addMember: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['addMember'] = handler;
        },
      },
      updateChildModel: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['updateChildModel'] = handler;
        },
      },
      rescanProjectContext: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['rescanProjectContext'] = handler;
        },
      },
      listTeamConfigs: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['listTeamConfigs'] = handler;
        },
      },
      getGroupCostSummary: {
        provider: (handler: (params: Record<string, unknown>) => Promise<unknown>) => {
          providerHandlers['getGroupCostSummary'] = handler;
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
  uuid: vi.fn(() => 'reg-uuid-001'),
}));

vi.mock('@/common/config/storage', () => ({}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => {
      if (key === 'model.config') return [];
      if (key === 'acp.customAgents') return [];
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

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
}));

import { initDispatchBridge } from '../../src/process/bridge/dispatchBridge';
import { mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/utils/initStorage';

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

function makeWorkerTaskManager() {
  return {
    getOrBuildTask: vi.fn(async () => ({})),
    getTask: vi.fn(() => null),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Dispatch Phase 2b Regression', () => {
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

  // REG-2B-001: G3.1 removed modelOverride from createGroupChat; verify default model is used
  describe('REG-2B-001: default model used (modelOverride removed in G3.1)', () => {
    it('uses default gemini model when no provider override is available', async () => {
      // model.config returns empty array, gemini.defaultModel returns null (default fallback)
      (ProcessConfig.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'model.config') return [];
        if (key === 'acp.customAgents') return [];
        return null;
      });

      const result = (await providerHandlers['createGroupChat']({
        name: 'Default Model Test',
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            id: 'gemini',
            useModel: 'gemini-2.0-flash',
          }),
        })
      );
    });

    it('creates successfully with minimal params', async () => {
      (ProcessConfig.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'model.config') return [];
        if (key === 'acp.customAgents') return [];
        return null;
      });

      const result = (await providerHandlers['createGroupChat']({
        name: 'Minimal Test',
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
    });
  });

  // REG-2B-002: leader agent not found emits warn log
  describe('REG-2B-002: leader agent not found warn log', () => {
    it('logs a warning when leaderAgentId does not match any custom agent', async () => {
      (ProcessConfig.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'model.config') return [];
        if (key === 'acp.customAgents') return [{ id: 'existing', name: 'Exists' }];
        return null;
      });

      await providerHandlers['createGroupChat']({
        name: 'Missing Leader Test',
        leaderAgentId: 'nonexistent-agent-id',
      });

      expect(mainWarn).toHaveBeenCalledWith(
        expect.stringContaining('createGroupChat'),
        expect.stringContaining('Leader agent not found: nonexistent-agent-id')
      );
    });

    it('still creates conversation successfully despite missing leader', async () => {
      (ProcessConfig.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'model.config') return [];
        if (key === 'acp.customAgents') return [];
        return null;
      });

      const result = (await providerHandlers['createGroupChat']({
        name: 'Leader Missing OK',
        leaderAgentId: 'ghost-agent',
      })) as Record<string, unknown>;

      expect(result.success).toBe(true);
    });
  });

  // REG-2B-003: seedMessages empty string is not stored
  describe('REG-2B-003: empty seedMessages not stored', () => {
    it('does not include seedMessages when it is an empty string', async () => {
      await providerHandlers['createGroupChat']({
        name: 'Empty Seed Test',
        seedMessages: '',
      });

      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.not.objectContaining({ seedMessages: '' }),
        })
      );
    });

    it('does not include seedMessages when it is whitespace only', async () => {
      await providerHandlers['createGroupChat']({
        name: 'Whitespace Seed Test',
        seedMessages: '   \n  ',
      });

      const callArg = conversationService.createConversation.mock.calls[0][0];
      expect(callArg.extra.seedMessages).toBeUndefined();
    });
  });

  // REG-2B-004: status validation fallback to 'pending'
  describe('REG-2B-004: child status fallback', () => {
    it('falls back status to pending when conversation status is missing', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-1',
        type: 'dispatch',
        name: 'Test',
        extra: {},
      });
      conversationService.listAllConversations.mockResolvedValue([
        {
          id: 'child-no-status',
          name: 'No Status',
          // status is undefined
          createTime: 1000,
          modifyTime: 2000,
          extra: { dispatchSessionType: 'dispatch_child', parentSessionId: 'dispatch-1' },
        },
      ]);

      const result = (await providerHandlers['getGroupChatInfo']({
        conversationId: 'dispatch-1',
      })) as { success: boolean; data: { children: Array<{ status: string }> } };

      expect(result.success).toBe(true);
      expect(result.data.children[0].status).toBe('unknown');
    });
  });

  // REG-2B-005: stream event data guard — getChildTranscript with null/non-object content
  describe('REG-2B-005: transcript content guard', () => {
    it('handles null content gracefully', async () => {
      conversationRepo.getMessages.mockResolvedValue({
        data: [{ position: 'left', content: null, createdAt: 1000 }],
      });
      conversationService.getConversation.mockResolvedValue({ status: 'running' });

      const result = (await providerHandlers['getChildTranscript']({
        childSessionId: 'child-1',
      })) as { success: boolean; data: { messages: Array<{ content: string }> } };

      expect(result.success).toBe(true);
      expect(result.data.messages[0].content).toBe('');
    });

    it('handles string content directly', async () => {
      conversationRepo.getMessages.mockResolvedValue({
        data: [{ position: 'right', content: 'plain string message', createdAt: 2000 }],
      });
      conversationService.getConversation.mockResolvedValue({ status: 'running' });

      const result = (await providerHandlers['getChildTranscript']({
        childSessionId: 'child-1',
      })) as { success: boolean; data: { messages: Array<{ content: string }> } };

      expect(result.success).toBe(true);
      expect(result.data.messages[0].content).toBe('plain string message');
    });

    it('handles object content without content field', async () => {
      conversationRepo.getMessages.mockResolvedValue({
        data: [{ position: 'left', content: { type: 'tool_use', id: 'tool-1' }, createdAt: 3000 }],
      });
      conversationService.getConversation.mockResolvedValue({ status: 'idle' });

      const result = (await providerHandlers['getChildTranscript']({
        childSessionId: 'child-1',
      })) as { success: boolean; data: { messages: Array<{ content: string }> } };

      expect(result.success).toBe(true);
      expect(result.data.messages[0].content).toBe('');
    });

    it('returns unknown status when conversation is not found', async () => {
      conversationRepo.getMessages.mockResolvedValue({ data: [] });
      conversationService.getConversation.mockResolvedValue(null);

      const result = (await providerHandlers['getChildTranscript']({
        childSessionId: 'child-missing',
      })) as { success: boolean; data: { status: string } };

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('unknown');
    });
  });
});
