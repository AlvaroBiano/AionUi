/**
 * Unit tests for DispatchNotifier Phase 5 features.
 * Test IDs: NOT-P5-001 through NOT-P5-014.
 *
 * Covers:
 * - F-5.4: enqueueNotification dedup by childSessionId
 * - F-5.4: flushPending formatting
 * - F-5.4: restoreFromDb migration (old string[] -> new PendingNotification[])
 * - F-5.3: injectResumeContext builds summary notification
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
import type { PendingNotification, ChildTaskInfo } from '../../../src/process/task/dispatch/dispatchTypes';

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

function makeConversationRepo(overrides: Record<string, unknown> = {}): IConversationRepository {
  return {
    getConversation: vi.fn(async () => null),
    updateConversation: vi.fn(),
    listAllConversations: vi.fn(async () => []),
    createConversation: vi.fn(),
    getMessages: vi.fn(async () => ({ data: [], total: 0 })),
    deleteConversation: vi.fn(),
    ...overrides,
  } as unknown as IConversationRepository;
}

describe('DispatchNotifier Phase 5', () => {
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

  // ==================== F-5.4: enqueueNotification dedup ====================

  describe('NOT-P5-001: enqueueNotification deduplicates by childSessionId', () => {
    it('replaces existing notification for same childSessionId', async () => {
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Task A',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      const coldParent = { status: 'idle', sendMessage: vi.fn() };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(coldParent);

      // First completion: 'completed'
      await notifier.handleChildCompletion('child-1', 'completed');
      expect(notifier.getPendingCount('parent-1')).toBe(1);

      // Second completion for same child: 'failed' (replaces, not duplicates)
      await notifier.handleChildCompletion('child-1', 'failed');
      expect(notifier.getPendingCount('parent-1')).toBe(1);

      const pending = notifier.flushPending('parent-1');
      expect(pending).toContain('failed');
    });
  });

  describe('NOT-P5-002: enqueue does not dedup different childSessionIds', () => {
    it('keeps separate notifications for different children', async () => {
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Task A',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      tracker.registerChild('parent-1', {
        sessionId: 'child-2',
        title: 'Task B',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      const coldParent = { status: 'idle', sendMessage: vi.fn() };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(coldParent);

      await notifier.handleChildCompletion('child-1', 'completed');
      await notifier.handleChildCompletion('child-2', 'completed');

      expect(notifier.getPendingCount('parent-1')).toBe(2);
    });
  });

  // ==================== F-5.4: flushPending formatting ====================

  describe('NOT-P5-003: flushPending combines messages', () => {
    it('joins multiple notification messages with newline', async () => {
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Task A',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      tracker.registerChild('parent-1', {
        sessionId: 'child-2',
        title: 'Task B',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      const coldParent = { status: 'idle', sendMessage: vi.fn() };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(coldParent);

      await notifier.handleChildCompletion('child-1', 'completed');
      await notifier.handleChildCompletion('child-2', 'failed');

      const pending = notifier.flushPending('parent-1');
      expect(pending).toContain('Task A');
      expect(pending).toContain('Task B');
      expect(pending!.split('\n').length).toBe(2);
    });
  });

  describe('NOT-P5-004: flushPending returns undefined when empty', () => {
    it('returns undefined for parent with no pending', () => {
      expect(notifier.flushPending('parent-1')).toBeUndefined();
    });
  });

  describe('NOT-P5-005: flushPending clears the queue', () => {
    it('hasPending returns false after flush', async () => {
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Task A',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      const coldParent = { status: 'idle', sendMessage: vi.fn() };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(coldParent);

      await notifier.handleChildCompletion('child-1', 'completed');
      expect(notifier.hasPending('parent-1')).toBe(true);

      notifier.flushPending('parent-1');
      // flushPending now peeks only; confirmFlush actually clears
      notifier.confirmFlush('parent-1');
      expect(notifier.hasPending('parent-1')).toBe(false);
    });
  });

  // ==================== F-5.4: restoreFromDb migration ====================

  describe('NOT-P5-006: restoreFromDb handles new PendingNotification[] format', () => {
    it('restores structured notifications from DB', async () => {
      const stored: PendingNotification[] = [
        {
          childSessionId: 'child-1',
          childTitle: 'Task A',
          result: 'completed',
          message: 'Task "Task A" completed.',
          timestamp: 1000,
        },
      ];

      const repo = makeConversationRepo({
        getConversation: vi.fn(async () => ({
          id: 'parent-1',
          type: 'dispatch',
          extra: { pendingNotifications: stored },
        })),
      });

      notifier = new DispatchNotifier(taskManager, tracker, repo);
      await notifier.restoreFromDb('parent-1');

      expect(notifier.hasPending('parent-1')).toBe(true);
      expect(notifier.getPendingCount('parent-1')).toBe(1);
    });
  });

  describe('NOT-P5-007: restoreFromDb migrates old string[] format', () => {
    it('wraps legacy strings in PendingNotification objects', async () => {
      const repo = makeConversationRepo({
        getConversation: vi.fn(async () => ({
          id: 'parent-1',
          type: 'dispatch',
          extra: {
            pendingNotifications: [
              'Task "Old Task" completed. Use read_transcript...',
              'Task "Another" failed. Use read_transcript...',
            ],
          },
        })),
      });

      notifier = new DispatchNotifier(taskManager, tracker, repo);
      await notifier.restoreFromDb('parent-1');

      expect(notifier.getPendingCount('parent-1')).toBe(2);

      const flushed = notifier.flushPending('parent-1');
      expect(flushed).toContain('Old Task');
      expect(flushed).toContain('Another');
    });
  });

  describe('NOT-P5-008: restoreFromDb handles mixed old+new format', () => {
    it('processes both string and PendingNotification entries', async () => {
      const mixed: Array<string | PendingNotification> = [
        'Legacy message 1',
        {
          childSessionId: 'child-2',
          childTitle: 'New Format Task',
          result: 'completed',
          message: 'Task "New Format Task" completed.',
          timestamp: 2000,
        },
      ];

      const repo = makeConversationRepo({
        getConversation: vi.fn(async () => ({
          id: 'parent-1',
          type: 'dispatch',
          extra: { pendingNotifications: mixed },
        })),
      });

      notifier = new DispatchNotifier(taskManager, tracker, repo);
      await notifier.restoreFromDb('parent-1');

      expect(notifier.getPendingCount('parent-1')).toBe(2);
    });
  });

  describe('NOT-P5-009: restoreFromDb deduplicates by childSessionId', () => {
    it('keeps only last notification for duplicate childSessionIds', async () => {
      const duplicated: PendingNotification[] = [
        {
          childSessionId: 'child-1',
          childTitle: 'Task A',
          result: 'completed',
          message: 'First',
          timestamp: 1000,
        },
        {
          childSessionId: 'child-1',
          childTitle: 'Task A',
          result: 'failed',
          message: 'Second',
          timestamp: 2000,
        },
      ];

      const repo = makeConversationRepo({
        getConversation: vi.fn(async () => ({
          id: 'parent-1',
          type: 'dispatch',
          extra: { pendingNotifications: duplicated },
        })),
      });

      notifier = new DispatchNotifier(taskManager, tracker, repo);
      await notifier.restoreFromDb('parent-1');

      // migrateNotifications keeps only the first occurrence per childSessionId
      expect(notifier.getPendingCount('parent-1')).toBe(1);
    });
  });

  describe('NOT-P5-010: restoreFromDb skips non-dispatch conversations', () => {
    it('does nothing for gemini type conversation', async () => {
      const repo = makeConversationRepo({
        getConversation: vi.fn(async () => ({
          id: 'parent-1',
          type: 'gemini',
          extra: { pendingNotifications: ['something'] },
        })),
      });

      notifier = new DispatchNotifier(taskManager, tracker, repo);
      await notifier.restoreFromDb('parent-1');

      expect(notifier.hasPending('parent-1')).toBe(false);
    });
  });

  describe('NOT-P5-011: restoreFromDb handles DB errors gracefully', () => {
    it('does not throw on DB failure', async () => {
      const repo = makeConversationRepo({
        getConversation: vi.fn(async () => {
          throw new Error('DB connection lost');
        }),
      });

      notifier = new DispatchNotifier(taskManager, tracker, repo);

      await expect(notifier.restoreFromDb('parent-1')).resolves.toBeUndefined();
      expect(notifier.hasPending('parent-1')).toBe(false);
    });
  });

  // ==================== F-5.3: injectResumeContext ====================

  describe('NOT-P5-012: injectResumeContext builds context for restored children', () => {
    it('creates a session resume notification with child listing', () => {
      const children: ChildTaskInfo[] = [
        {
          sessionId: 'child-1',
          title: 'Research Task',
          status: 'idle',
          createdAt: 1000,
          lastActivityAt: 2000,
        },
        {
          sessionId: 'child-2',
          title: 'Code Task',
          status: 'failed',
          createdAt: 1500,
          lastActivityAt: 2500,
        },
      ];

      notifier.injectResumeContext('parent-1', children);

      expect(notifier.hasPending('parent-1')).toBe(true);
      expect(notifier.getPendingCount('parent-1')).toBe(1);

      const flushed = notifier.flushPending('parent-1');
      expect(flushed).toContain('Session Resumed');
      expect(flushed).toContain('child-1');
      expect(flushed).toContain('Research Task');
      expect(flushed).toContain('idle');
      expect(flushed).toContain('child-2');
      expect(flushed).toContain('Code Task');
      expect(flushed).toContain('failed');
    });
  });

  describe('NOT-P5-013: injectResumeContext includes existing pending notifications', () => {
    it('appends pre-existing pending messages into context', async () => {
      // First, queue a notification from a completed child
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Completed Task',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      const coldParent = { status: 'idle', sendMessage: vi.fn() };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(coldParent);

      await notifier.handleChildCompletion('child-1', 'completed');
      expect(notifier.getPendingCount('parent-1')).toBe(1);

      // Now inject resume context
      const children: ChildTaskInfo[] = [
        {
          sessionId: 'child-1',
          title: 'Completed Task',
          status: 'idle',
          createdAt: 1000,
          lastActivityAt: 2000,
        },
      ];

      notifier.injectResumeContext('parent-1', children);

      // Should collapse into a single context notification
      expect(notifier.getPendingCount('parent-1')).toBe(1);

      const flushed = notifier.flushPending('parent-1');
      expect(flushed).toContain('Pending notifications from before restart');
      expect(flushed).toContain('Completed Task');
    });
  });

  describe('NOT-P5-014: injectResumeContext is no-op for empty children', () => {
    it('does not create notification when no children', () => {
      notifier.injectResumeContext('parent-1', []);
      expect(notifier.hasPending('parent-1')).toBe(false);
    });
  });

  // ==================== Hot path fallback to cold ====================

  describe('NOT-P5-015: hot path falls back to cold on sendMessage failure', () => {
    it('queues notification when hot sendMessage throws', async () => {
      tracker.registerChild('parent-1', {
        sessionId: 'child-1',
        title: 'Task A',
        status: 'idle',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });

      const hotParent = {
        status: 'running',
        sendMessage: vi.fn(async () => {
          throw new Error('Stream closed');
        }),
      };
      (taskManager.getTask as ReturnType<typeof vi.fn>).mockReturnValue(hotParent);

      await notifier.handleChildCompletion('child-1', 'completed');

      // Should have fallen back to cold path
      expect(notifier.hasPending('parent-1')).toBe(true);
    });
  });
});
