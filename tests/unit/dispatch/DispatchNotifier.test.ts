/**
 * Unit tests for DispatchNotifier Phase 2a: cancelled result type.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'mock-uuid'),
}));
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

import { DispatchNotifier } from '../../../src/process/task/dispatch/DispatchNotifier';
import { DispatchSessionTracker } from '../../../src/process/task/dispatch/DispatchSessionTracker';
import type { IWorkerTaskManager } from '../../../src/process/task/IWorkerTaskManager';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';

function makeTaskManager(): IWorkerTaskManager {
  return {
    getTask: vi.fn(() => undefined),
    getOrBuildTask: vi.fn(),
    addTask: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    listTasks: vi.fn(() => []),
  };
}

function makeConversationRepo(): IConversationRepository {
  return {
    getConversation: vi.fn(async () => null),
    updateConversation: vi.fn(),
    listAllConversations: vi.fn(async () => []),
    createConversation: vi.fn(),
    getMessages: vi.fn(async () => ({ data: [], total: 0 })),
    deleteConversation: vi.fn(),
  } as unknown as IConversationRepository;
}

describe('DispatchNotifier Phase 2a', () => {
  let notifier: DispatchNotifier;
  let tracker: DispatchSessionTracker;
  let taskManager: IWorkerTaskManager;
  let conversationRepo: IConversationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new DispatchSessionTracker();
    taskManager = makeTaskManager();
    conversationRepo = makeConversationRepo();
    notifier = new DispatchNotifier(taskManager, tracker, conversationRepo);
  });

  describe('handleChildCompletion with cancelled', () => {
    it('queues cancellation message for cold parent', async () => {
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Research Task',
        status: 'cancelled',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      // Parent task exists but is not running (cold)
      const mockParent = { status: 'idle', sendMessage: vi.fn() };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(mockParent);

      await notifier.handleChildCompletion('child-1', 'cancelled');

      expect(notifier.hasPending('parent-1')).toBe(true);
      const pending = notifier.flushPending('parent-1');
      expect(pending).toContain('cancelled by user');
      expect(pending).toContain('Research Task');
    });

    it('sends hot notification for running parent', async () => {
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Research Task',
        status: 'cancelled',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      const mockParent = { status: 'running', sendMessage: vi.fn() };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(mockParent);

      await notifier.handleChildCompletion('child-1', 'cancelled');

      expect(mockParent.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.stringContaining('cancelled by user'),
          isSystemNotification: true,
        })
      );
    });

    it('does nothing when parent not found in tracker', async () => {
      // Child not registered
      await notifier.handleChildCompletion('unknown-child', 'cancelled');

      expect(taskManager.getTask).not.toHaveBeenCalled();
    });
  });
});
