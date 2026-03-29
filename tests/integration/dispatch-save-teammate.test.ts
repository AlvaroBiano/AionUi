/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for dispatch save-teammate IPC handlers.
 * Tests save-teammate and get-teammate-config in dispatchBridge.
 * Test IDs: INT-ST-001 through INT-ST-006.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

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
  uuid: vi.fn(() => 'test-uuid-' + Date.now()),
}));

vi.mock('@/common/config/storage', () => ({}));

let mockCustomAgents: Array<Record<string, unknown>> = [];

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => {
      if (key === 'acp.customAgents') return mockCustomAgents;
      if (key === 'model.config') return [];
      if (key === 'gemini.defaultModel') return null;
      return null;
    }),
    set: vi.fn(async (_key: string, value: unknown) => {
      // Simulate persisting customAgents
      if (Array.isArray(value)) {
        mockCustomAgents = value as Array<Record<string, unknown>>;
      }
    }),
  },
  ProcessEnv: {
    get: vi.fn(async () => ({ workDir: '/tmp' })),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
}));

import { initDispatchBridge } from '@process/bridge/dispatchBridge';
import { ProcessConfig } from '@process/utils/initStorage';

// ---- Helpers ----

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

// ---- Tests ----

describe('Dispatch Save Teammate — Phase 3 Integration', () => {
  let conversationService: ReturnType<typeof makeConversationService>;
  let conversationRepo: ReturnType<typeof makeConversationRepo>;
  let workerTaskManager: ReturnType<typeof makeWorkerTaskManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomAgents = [];
    for (const key of Object.keys(providerHandlers)) {
      delete providerHandlers[key];
    }
    conversationService = makeConversationService();
    conversationRepo = makeConversationRepo();
    workerTaskManager = makeWorkerTaskManager();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initDispatchBridge(workerTaskManager as any, conversationService as any, conversationRepo as any);
  });

  // INT-ST-001: save-teammate handler saves to acp.customAgents
  describe('INT-ST-001: save-teammate creates a new custom agent', () => {
    it('saves a new agent to ProcessConfig', async () => {
      const result = (await providerHandlers['saveTeammate']({
        name: 'New Agent',
        avatar: 'star',
        presetRules: 'You are a coding assistant.',
      })) as { success: boolean; data: { assistantId: string } };

      expect(result.success).toBe(true);
      expect(result.data.assistantId).toBeDefined();
      expect(ProcessConfig.set).toHaveBeenCalledWith(
        'acp.customAgents',
        expect.arrayContaining([
          expect.objectContaining({
            name: 'New Agent',
            avatar: 'star',
            context: 'You are a coding assistant.',
            enabled: true,
            source: 'dispatch_teammate',
          }),
        ]),
      );
    });
  });

  // INT-ST-002: Duplicate name returns error
  describe('INT-ST-002: duplicate name is rejected', () => {
    it('returns success=false with already exists message', async () => {
      mockCustomAgents = [{ id: 'existing-1', name: 'Duplicate Agent', enabled: true }];

      const result = (await providerHandlers['saveTeammate']({
        name: 'Duplicate Agent',
      })) as { success: boolean; msg: string };

      expect(result.success).toBe(false);
      expect(result.msg).toContain('already exists');
    });
  });

  // INT-ST-003: get-teammate-config returns correct data
  describe('INT-ST-003: get-teammate-config returns child config', () => {
    it('returns teammate name, avatar, and presetRules', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'child-session-1',
        name: 'Fallback Name',
        extra: {
          teammateConfig: { name: 'Agent Alpha', avatar: 'robot' },
          presetRules: 'You are an expert researcher.',
        },
      });

      const result = (await providerHandlers['getTeammateConfig']({
        childSessionId: 'child-session-1',
      })) as {
        success: boolean;
        data: { name: string; avatar: string; presetRules: string };
      };

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Agent Alpha');
      expect(result.data.avatar).toBe('robot');
      expect(result.data.presetRules).toBe('You are an expert researcher.');
    });

    it('falls back to conversation name when no teammateConfig', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'child-session-2',
        name: 'Conversation Name',
        extra: {},
      });

      const result = (await providerHandlers['getTeammateConfig']({
        childSessionId: 'child-session-2',
      })) as { success: boolean; data: { name: string } };

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Conversation Name');
    });
  });

  // INT-ST-004: Saved agent increases customAgents array length
  describe('INT-ST-004: customAgents array grows after save', () => {
    it('array length increases from 1 to 2 after save', async () => {
      mockCustomAgents = [{ id: 'existing-1', name: 'Existing Agent', enabled: true }];

      const result = (await providerHandlers['saveTeammate']({
        name: 'Brand New Agent',
        avatar: 'sparkles',
        presetRules: 'Test rules',
      })) as { success: boolean };

      expect(result.success).toBe(true);
      // ProcessConfig.set should have been called with array of length 2
      expect(ProcessConfig.set).toHaveBeenCalledWith(
        'acp.customAgents',
        expect.arrayContaining([
          expect.objectContaining({ name: 'Existing Agent' }),
          expect.objectContaining({ name: 'Brand New Agent' }),
        ]),
      );
    });
  });

  // INT-ST-005: get-teammate-config returns error for missing child
  describe('INT-ST-005: get-teammate-config for missing child', () => {
    it('returns success=false when child session not found', async () => {
      conversationService.getConversation.mockResolvedValue(null);

      const result = (await providerHandlers['getTeammateConfig']({
        childSessionId: 'nonexistent',
      })) as { success: boolean; msg: string };

      expect(result.success).toBe(false);
      expect(result.msg).toContain('not found');
    });
  });

  // INT-ST-006: Saved agent has correct metadata fields
  describe('INT-ST-006: saved agent metadata', () => {
    it('includes isPreset, presetAgentType, and source fields', async () => {
      await providerHandlers['saveTeammate']({
        name: 'Metadata Agent',
      });

      expect(ProcessConfig.set).toHaveBeenCalledWith(
        'acp.customAgents',
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Metadata Agent',
            isPreset: true,
            presetAgentType: 'gemini',
            source: 'dispatch_teammate',
          }),
        ]),
      );
    });
  });
});
