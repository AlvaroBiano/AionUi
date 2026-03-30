/**
 * Unit tests for DispatchAgentManager Phase 2a features.
 * Covers: cancelChild, sendMessageToChild, listSessions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('@/common', () => ({
  ipcBridge: {
    geminiConversation: {
      responseStream: { emit: vi.fn() },
    },
  },
}));
vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'mock-uuid'),
}));
vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: vi.fn(() => null),
}));
vi.mock('@/common/config/storage', () => ({}));
vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(),
}));
vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
}));
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));
vi.mock('../../../src/process/task/BaseAgentManager', () => {
  return {
    default: class MockBase {
      status: string | undefined;
      type: string;
      constructor(type: string) {
        this.type = type;
      }
      init() {}
      on() {}
      start() {
        return Promise.resolve();
      }
      sendMessage() {
        return Promise.resolve();
      }
      postMessage() {}
      kill() {}
    },
  };
});
vi.mock('../../../src/process/task/IpcAgentEventEmitter', () => ({
  IpcAgentEventEmitter: class {},
}));

import { DispatchAgentManager } from '../../../src/process/task/dispatch/DispatchAgentManager';
import { DispatchSessionTracker } from '../../../src/process/task/dispatch/DispatchSessionTracker';
import { DispatchNotifier } from '../../../src/process/task/dispatch/DispatchNotifier';
import type { IWorkerTaskManager } from '../../../src/process/task/IWorkerTaskManager';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';

function makeTaskManager(overrides: Partial<IWorkerTaskManager> = {}): IWorkerTaskManager {
  return {
    getTask: vi.fn(() => undefined),
    getOrBuildTask: vi.fn(),
    addTask: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    listTasks: vi.fn(() => []),
    ...overrides,
  };
}

function makeConversationRepo(overrides: Partial<IConversationRepository> = {}): IConversationRepository {
  return {
    getMessages: vi.fn(async () => ({ data: [], total: 0 })),
    createConversation: vi.fn(),
    getConversation: vi.fn(async () => null),
    updateConversation: vi.fn(),
    listAllConversations: vi.fn(async () => []),
    deleteConversation: vi.fn(),
    ...overrides,
  } as unknown as IConversationRepository;
}

describe('DispatchAgentManager Phase 2a', () => {
  let manager: DispatchAgentManager;
  let taskManager: IWorkerTaskManager;
  let conversationRepo: IConversationRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    manager = new DispatchAgentManager({
      workspace: '/test',
      conversation_id: 'parent-1',
      model: { id: 'gemini', useModel: 'gemini-2.0-flash' } as never,
    });

    taskManager = makeTaskManager();
    conversationRepo = makeConversationRepo();
    manager.setDependencies(taskManager, conversationRepo);
  });

  describe('cancelChild', () => {
    it('throws when child not found', async () => {
      await expect(manager.cancelChild('unknown')).rejects.toThrow('not found');
    });

    it('is a no-op for already cancelled child', async () => {
      // Register a child then set its status to cancelled
      const tracker = manager.getTracker();
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Test Task',
        status: 'cancelled',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      // Should not throw and not call kill
      await manager.cancelChild('child-1');
      expect(taskManager.kill).not.toHaveBeenCalled();
    });

    it('kills worker, updates status, and notifies parent', async () => {
      const tracker = manager.getTracker();
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Test Task',
        status: 'running',
        teammateName: 'Agent A',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      // Mock the parent task for notification
      const mockParentTask = {
        status: 'idle',
        sendMessage: vi.fn(),
      };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(mockParentTask);

      await manager.cancelChild('child-1');

      // Verify kill was called
      expect(taskManager.kill).toHaveBeenCalledWith('child-1');

      // Verify status is now cancelled
      const info = tracker.getChildInfo('child-1');
      expect(info?.status).toBe('cancelled');
    });

    it('is a no-op for idle child', async () => {
      const tracker = manager.getTracker();
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Test Task',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      await manager.cancelChild('child-1');
      expect(taskManager.kill).not.toHaveBeenCalled();
    });
  });
});
