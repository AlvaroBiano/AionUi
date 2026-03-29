/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for dispatchBridge IPC flow.
 * Tests the complete IPC chain for Phase 2b and Phase 4 dispatch features.
 * Test IDs: INT-IPC-001 through INT-IPC-012.
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

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
}));

import { initDispatchBridge } from '@process/bridge/dispatchBridge';
import { mainWarn } from '@process/utils/mainLogger';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConversationService(overrides?: Record<string, ReturnType<typeof vi.fn>>) {
  return {
    createConversation: vi.fn(async () => {}),
    getConversation: vi.fn(async () => null),
    listAllConversations: vi.fn(async () => []),
    updateConversation: vi.fn(async () => {}),
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

  // ========== Phase 4 IPC Tests ==========

  // INT-IPC-007: notifyParent persists notification and emits to renderer
  describe('INT-IPC-007: notifyParent handler (F-4.1)', () => {
    it('persists notification message and emits dispatch_event', async () => {
      const { addMessage: mockAddMessage } = await import('@process/utils/message');
      const { ipcBridge: mockIpcBridge } = await import('@/common');

      const result = (await providerHandlers['notifyParent']({
        parentConversationId: 'parent-conv-1',
        childSessionId: 'child-1',
        childName: 'Agent Alpha',
        userMessage: 'Hello from user',
      })) as { success: boolean };

      expect(result.success).toBe(true);

      // Verify message was persisted
      expect(mockAddMessage).toHaveBeenCalledWith(
        'parent-conv-1',
        expect.objectContaining({
          type: 'dispatch_event',
          position: 'left',
          conversation_id: 'parent-conv-1',
        }),
      );

      // Verify emit to renderer
      expect(mockIpcBridge.geminiConversation.responseStream.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dispatch_event',
          conversation_id: 'parent-conv-1',
        }),
      );
    });

    it('truncates long user messages to 200 chars', async () => {
      const { addMessage: mockAddMessage } = await import('@process/utils/message');
      const longMessage = 'x'.repeat(300);

      await providerHandlers['notifyParent']({
        parentConversationId: 'parent-conv-1',
        childSessionId: 'child-1',
        childName: 'Agent Beta',
        userMessage: longMessage,
      });

      // The notification content should contain the truncated message
      const call = (mockAddMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = call[1].content as { content: string };
      expect(content.content).toContain('...');
    });
  });

  // INT-IPC-008: updateGroupChatSettings updates conversation extra
  describe('INT-IPC-008: updateGroupChatSettings handler (F-4.3)', () => {
    it('updates group chat name in conversation', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-1',
        type: 'dispatch',
        name: 'Old Name',
        extra: { groupChatName: 'Old Name' },
      });
      const updateConversation = vi.fn(async () => {});
      conversationService.updateConversation = updateConversation;

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-1',
        groupChatName: 'New Name',
      })) as { success: boolean };

      expect(result.success).toBe(true);
      expect(updateConversation).toHaveBeenCalledWith(
        'dispatch-1',
        expect.objectContaining({
          name: 'New Name',
          extra: expect.objectContaining({ groupChatName: 'New Name' }),
        }),
      );
    });

    it('updates leader agent with full snapshot', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-2',
        type: 'dispatch',
        name: 'Test Chat',
        extra: {},
      });
      const updateConversation = vi.fn(async () => {});
      conversationService.updateConversation = updateConversation;

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-2',
        leaderAgentId: 'leader-agent-1',
      })) as { success: boolean };

      expect(result.success).toBe(true);
      expect(updateConversation).toHaveBeenCalledWith(
        'dispatch-2',
        expect.objectContaining({
          extra: expect.objectContaining({
            leaderAgentId: 'leader-agent-1',
            leaderPresetRules: 'You are a test leader agent',
            leaderName: 'Test Leader',
            leaderAvatar: 'avatar-url',
          }),
        }),
      );
    });

    it('clears leader agent when empty string is passed', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-3',
        type: 'dispatch',
        name: 'Test Chat',
        extra: {
          leaderAgentId: 'old-leader',
          leaderPresetRules: 'old rules',
          leaderName: 'Old Leader',
          leaderAvatar: 'old-avatar',
        },
      });
      const updateConversation = vi.fn(async () => {});
      conversationService.updateConversation = updateConversation;

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-3',
        leaderAgentId: '',
      })) as { success: boolean };

      expect(result.success).toBe(true);
      expect(updateConversation).toHaveBeenCalledWith(
        'dispatch-3',
        expect.objectContaining({
          extra: expect.objectContaining({
            leaderAgentId: undefined,
            leaderPresetRules: undefined,
            leaderName: undefined,
            leaderAvatar: undefined,
          }),
        }),
      );
    });

    it('returns error for non-dispatch conversation', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'gemini-1',
        type: 'gemini',
        name: 'Not Dispatch',
        extra: {},
      });

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'gemini-1',
        groupChatName: 'Test',
      })) as { success: boolean; msg: string };

      expect(result.success).toBe(false);
      expect(result.msg).toContain('not a dispatch');
    });

    it('returns error when leader agent not found', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-4',
        type: 'dispatch',
        name: 'Test',
        extra: {},
      });

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-4',
        leaderAgentId: 'nonexistent-leader',
      })) as { success: boolean; msg: string };

      expect(result.success).toBe(false);
      expect(result.msg).toContain('not found');
    });

    it('updates seed messages', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-5',
        type: 'dispatch',
        name: 'Test Chat',
        extra: {},
      });
      const updateConversation = vi.fn(async () => {});
      conversationService.updateConversation = updateConversation;

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-5',
        seedMessages: 'New seed instructions',
      })) as { success: boolean };

      expect(result.success).toBe(true);
      expect(updateConversation).toHaveBeenCalledWith(
        'dispatch-5',
        expect.objectContaining({
          extra: expect.objectContaining({
            seedMessages: 'New seed instructions',
          }),
        }),
      );
    });

    it('emits listChanged after successful update', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-6',
        type: 'dispatch',
        name: 'Test Chat',
        extra: {},
      });
      conversationService.updateConversation = vi.fn(async () => {});

      const { ipcBridge: mockIpcBridge } = await import('@/common');

      await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-6',
        groupChatName: 'Updated Name',
      });

      expect(mockIpcBridge.conversation.listChanged.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'dispatch-6',
          action: 'updated',
          source: 'dispatch',
        }),
      );
    });
  });

  // INT-IPC-009: notifyParent handles errors gracefully
  describe('INT-IPC-009: notifyParent error handling', () => {
    it('returns success=false on exception', async () => {
      // Force addMessage to throw
      const messageMod = await import('@process/utils/message');
      (messageMod.addMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB write failed');
      });

      const result = (await providerHandlers['notifyParent']({
        parentConversationId: 'parent-conv-1',
        childSessionId: 'child-1',
        childName: 'Agent Alpha',
        userMessage: 'Test',
      })) as { success: boolean; msg: string };

      expect(result.success).toBe(false);
      expect(result.msg).toContain('DB write failed');
    });
  });

  // ========== Phase 6 IPC Tests ==========

  // INT-IPC-010: F-6.2 updateGroupChatSettings stores maxConcurrentChildren
  describe('INT-IPC-010: updateGroupChatSettings with maxConcurrentChildren (F-6.2)', () => {
    it('persists maxConcurrentChildren in conversation extra', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-mc-1',
        type: 'dispatch',
        name: 'Concurrent Test',
        extra: { groupChatName: 'Concurrent Test' },
      });

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-mc-1',
        maxConcurrentChildren: 7,
      })) as { success: boolean };

      expect(result.success).toBe(true);
      expect(conversationService.updateConversation).toHaveBeenCalledWith(
        'dispatch-mc-1',
        expect.objectContaining({
          extra: expect.objectContaining({
            maxConcurrentChildren: 7,
          }),
        }),
      );
    });

    it('can set maxConcurrentChildren alongside other settings', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-mc-2',
        type: 'dispatch',
        name: 'Multi Update',
        extra: {},
      });

      const result = (await providerHandlers['updateGroupChatSettings']({
        conversationId: 'dispatch-mc-2',
        groupChatName: 'Updated Name',
        maxConcurrentChildren: 5,
        seedMessages: 'New seed',
      })) as { success: boolean };

      expect(result.success).toBe(true);
      expect(conversationService.updateConversation).toHaveBeenCalledWith(
        'dispatch-mc-2',
        expect.objectContaining({
          name: 'Updated Name',
          extra: expect.objectContaining({
            groupChatName: 'Updated Name',
            maxConcurrentChildren: 5,
            seedMessages: 'New seed',
          }),
        }),
      );
    });
  });

  // INT-IPC-011: F-6.2 getGroupChatInfo returns maxConcurrentChildren
  describe('INT-IPC-011: getGroupChatInfo returns maxConcurrentChildren (F-6.2)', () => {
    it('includes maxConcurrentChildren in response data', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-mc-3',
        type: 'dispatch',
        name: 'Limit Chat',
        extra: { groupChatName: 'Limit Chat', maxConcurrentChildren: 8 },
      });
      conversationService.listAllConversations.mockResolvedValue([]);

      const result = (await providerHandlers['getGroupChatInfo']({
        conversationId: 'dispatch-mc-3',
      })) as { success: boolean; data: { maxConcurrentChildren: number } };

      expect(result.success).toBe(true);
      expect(result.data.maxConcurrentChildren).toBe(8);
    });

    it('returns undefined maxConcurrentChildren when not set', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-mc-4',
        type: 'dispatch',
        name: 'No Limit',
        extra: { groupChatName: 'No Limit' },
      });
      conversationService.listAllConversations.mockResolvedValue([]);

      const result = (await providerHandlers['getGroupChatInfo']({
        conversationId: 'dispatch-mc-4',
      })) as { success: boolean; data: { maxConcurrentChildren?: number } };

      expect(result.success).toBe(true);
      expect(result.data.maxConcurrentChildren).toBeUndefined();
    });
  });

  // INT-IPC-012: F-6.3 forkToDispatch — source conversation read and dispatch creation
  describe('INT-IPC-012: forkToDispatch handler (F-6.3)', () => {
    it('creates dispatch conversation from source with seed context', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-1',
        type: 'gemini',
        name: 'My Research',
        extra: { workspace: '/home/user/research' },
        model: { id: 'custom-provider-1', useModel: 'gpt-4o' },
      });
      conversationRepo.getMessages.mockResolvedValue({
        data: [
          { position: 'right', content: { content: 'What is TypeScript?' } },
          { position: 'left', content: { content: 'TypeScript is a typed superset of JavaScript.' } },
        ],
      });

      const result = (await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-1',
      })) as { success: boolean; data: { conversationId: string } };

      expect(result.success).toBe(true);
      expect(result.data.conversationId).toBe('int-uuid-001');

      // Verify conversation was created with seed context
      expect(conversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dispatch',
          name: expect.stringContaining('Fork:'),
          extra: expect.objectContaining({
            workspace: '/home/user/research',
            dispatchSessionType: 'dispatcher',
            seedMessages: expect.stringContaining('Imported Context'),
          }),
        }),
      );
    });

    it('extracts text messages and formats as [user]/[assistant]', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-2',
        type: 'gemini',
        name: 'Code Review',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({
        data: [
          { position: 'right', content: { content: 'Review this function' } },
          { position: 'left', content: { content: 'The function looks good' } },
        ],
      });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-2',
      });

      const createCall = conversationService.createConversation.mock.calls[0][0];
      const seedMessages = createCall.extra.seedMessages as string;
      expect(seedMessages).toContain('[user] Review this function');
      expect(seedMessages).toContain('[assistant] The function looks good');
    });

    it('includes source conversation title in seed context header', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-3',
        type: 'gemini',
        name: 'Architecture Discussion',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({
        data: [{ position: 'right', content: { content: 'Hello' } }],
      });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-3',
      });

      const createCall = conversationService.createConversation.mock.calls[0][0];
      const seedMessages = createCall.extra.seedMessages as string;
      expect(seedMessages).toContain('Architecture Discussion');
    });

    it('returns error when source conversation not found', async () => {
      conversationService.getConversation.mockResolvedValue(null);

      const result = (await providerHandlers['forkToDispatch']({
        sourceConversationId: 'nonexistent',
      })) as { success: boolean; msg: string };

      expect(result.success).toBe(false);
      expect(result.msg).toContain('Source conversation not found');
    });

    it('returns error when source is a dispatch conversation', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'dispatch-source',
        type: 'dispatch',
        name: 'Existing Dispatch',
        extra: {},
      });

      const result = (await providerHandlers['forkToDispatch']({
        sourceConversationId: 'dispatch-source',
      })) as { success: boolean; msg: string };

      expect(result.success).toBe(false);
      expect(result.msg).toContain('Cannot fork a dispatch conversation');
    });

    it('respects maxMessages parameter', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-4',
        type: 'gemini',
        name: 'Long Chat',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({
        data: [
          { position: 'right', content: { content: 'Message 1' } },
          { position: 'left', content: { content: 'Response 1' } },
        ],
      });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-4',
        maxMessages: 5,
      });

      // Verify getMessages was called with the custom limit
      expect(conversationRepo.getMessages).toHaveBeenCalledWith('source-conv-4', 0, 5);
    });

    it('defaults maxMessages to 20', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-5',
        type: 'gemini',
        name: 'Default Limit',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({ data: [] });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-5',
      });

      expect(conversationRepo.getMessages).toHaveBeenCalledWith('source-conv-5', 0, 20);
    });

    it('skips messages with empty content', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-6',
        type: 'gemini',
        name: 'Sparse Chat',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({
        data: [
          { position: 'right', content: { content: '' } },
          { position: 'right', content: { content: '  ' } },
          { position: 'left', content: { content: 'Valid response' } },
        ],
      });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-6',
      });

      const createCall = conversationService.createConversation.mock.calls[0][0];
      const seedMessages = createCall.extra.seedMessages as string;
      // Only the valid message should appear
      expect(seedMessages).toContain('Valid response');
      expect(seedMessages).toContain('last 1 messages');
    });

    it('creates dispatch with no seedMessages when source has no text messages', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-7',
        type: 'gemini',
        name: 'Empty Chat',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({ data: [] });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-7',
      });

      const createCall = conversationService.createConversation.mock.calls[0][0];
      expect(createCall.extra.seedMessages).toBeUndefined();
    });

    it('triggers orchestrator warm-start after creation', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-8',
        type: 'gemini',
        name: 'Warm Start Fork',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({ data: [] });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-8',
      });

      expect(workerTaskManager.getOrBuildTask).toHaveBeenCalledWith('int-uuid-001');
    });

    it('emits listChanged after successful fork', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-9',
        type: 'gemini',
        name: 'Emit Test',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({ data: [] });

      const { ipcBridge: mockIpcBridge } = await import('@/common');

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-9',
      });

      expect(mockIpcBridge.conversation.listChanged.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'int-uuid-001',
          action: 'created',
          source: 'dispatch',
        }),
      );
    });

    it('applies char cap by dropping oldest messages when context exceeds 8000 chars', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-10',
        type: 'gemini',
        name: 'Large Chat',
        extra: {},
      });
      // Create messages that exceed the 8000 char cap
      const longMessage = 'x'.repeat(4000);
      conversationRepo.getMessages.mockResolvedValue({
        data: [
          { position: 'right', content: { content: longMessage } },
          { position: 'left', content: { content: longMessage } },
          { position: 'right', content: { content: 'Recent short message' } },
        ],
      });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-10',
      });

      const createCall = conversationService.createConversation.mock.calls[0][0];
      const seedMessages = createCall.extra.seedMessages as string;
      // The total should be under 8000 chars
      expect(seedMessages.length).toBeLessThanOrEqual(8000);
      // Recent message should be preserved (oldest dropped first)
      expect(seedMessages).toContain('Recent short message');
    });

    it('inherits source workspace when available', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-11',
        type: 'gemini',
        name: 'Workspace Fork',
        extra: { workspace: '/projects/my-app' },
      });
      conversationRepo.getMessages.mockResolvedValue({ data: [] });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-11',
      });

      const createCall = conversationService.createConversation.mock.calls[0][0];
      expect(createCall.extra.workspace).toBe('/projects/my-app');
    });

    it('falls back to default workspace when source has none', async () => {
      conversationService.getConversation.mockResolvedValue({
        id: 'source-conv-12',
        type: 'gemini',
        name: 'No Workspace',
        extra: {},
      });
      conversationRepo.getMessages.mockResolvedValue({ data: [] });

      await providerHandlers['forkToDispatch']({
        sourceConversationId: 'source-conv-12',
      });

      const createCall = conversationService.createConversation.mock.calls[0][0];
      expect(createCall.extra.workspace).toBe('/default/workspace');
    });
  });
});
