/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchNotifier.ts

import type { IWorkerTaskManager } from '../IWorkerTaskManager';
import type { DispatchSessionTracker } from './DispatchSessionTracker';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import type { TChatConversation } from '@/common/config/storage';
import type { PendingNotification, ChildTaskInfo } from './dispatchTypes';
import { uuid } from '@/common/utils';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Handles child task completion notifications to parent dispatcher.
 * - Hot parent (running): inject notification via sendMessage
 * - Cold parent (not running): queue for consumption on next user message
 *
 * F-5.4: Uses structured PendingNotification objects with childSessionId-based
 * deduplication. Backward-compatible with old string[] format in DB.
 */
export class DispatchNotifier {
  /** In-memory pending notification queues (parentId -> structured notifications) */
  private pendingQueues = new Map<string, PendingNotification[]>();

  constructor(
    private readonly taskManager: IWorkerTaskManager,
    private readonly tracker: DispatchSessionTracker,
    private readonly conversationRepo: IConversationRepository
  ) {}

  /**
   * Called when a child task completes or fails.
   * Determines hot/cold parent path and dispatches notification.
   */
  async handleChildCompletion(childId: string, result: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    const parentId = this.tracker.getParent(childId);
    if (!parentId) return;

    const childInfo = this.tracker.getChildInfo(childId);
    const title = childInfo?.title ?? childId;
    const message =
      result === 'cancelled'
        ? `Task "${title}" cancelled by user. Use read_transcript with session_id "${childId}" to see partial results.`
        : `Task "${title}" ${result}. Use read_transcript with session_id "${childId}" to see the outcome.`;

    const notification: PendingNotification = {
      childSessionId: childId,
      childTitle: title,
      result,
      message,
      timestamp: Date.now(),
    };

    const parentTask = this.taskManager.getTask(parentId);
    if (!parentTask) {
      mainWarn('[DispatchNotifier]', `Parent task not found: ${parentId}`);
      return;
    }

    if (parentTask.status === 'running') {
      // Hot parent: inject notification directly
      mainLog('[DispatchNotifier]', `Hot parent notification: ${parentId} <- ${childId}`);
      try {
        await parentTask.sendMessage({
          input: `[System Notification] ${message}`,
          msg_id: uuid(),
          isSystemNotification: true,
        });
      } catch (err) {
        mainWarn('[DispatchNotifier]', `Failed to send hot notification to ${parentId}`, err);
        // Fall back to cold path
        this.enqueueNotification(parentId, notification);
      }
    } else {
      // Cold parent: queue for later consumption
      mainLog('[DispatchNotifier]', `Cold parent notification queued: ${parentId} <- ${childId}`);
      this.enqueueNotification(parentId, notification);
    }
  }

  /**
   * Check if parent has pending notifications.
   */
  hasPending(parentId: string): boolean {
    const queue = this.pendingQueues.get(parentId);
    return queue !== undefined && queue.length > 0;
  }

  /**
   * Get count of pending notifications (for UI hint).
   */
  getPendingCount(parentId: string): number {
    return this.pendingQueues.get(parentId)?.length ?? 0;
  }

  /**
   * Peek at pending notifications without removing them.
   * Returns combined notification text, or undefined if none.
   */
  flushPending(parentId: string): string | undefined {
    const queue = this.pendingQueues.get(parentId);
    if (!queue || queue.length === 0) return undefined;
    return queue.map((n) => n.message).join('\n');
  }

  /**
   * Confirm that flushed notifications were delivered successfully.
   * Actually removes the queue and persists the empty state.
   */
  confirmFlush(parentId: string): void {
    this.pendingQueues.delete(parentId);
    void this.persistPendingQueue(parentId);
  }

  /**
   * Restore pending queues from database (on app restart).
   * F-5.4: Handles both old string[] format and new PendingNotification[] format
   * for backward compatibility.
   */
  async restoreFromDb(parentId: string): Promise<void> {
    try {
      const conversation = await this.conversationRepo.getConversation(parentId);
      if (!conversation || conversation.type !== 'dispatch') return;
      const extra = conversation.extra as { pendingNotifications?: Array<string | PendingNotification> };
      if (extra.pendingNotifications && extra.pendingNotifications.length > 0) {
        const notifications = this.migrateNotifications(extra.pendingNotifications);
        if (notifications.length > 0) {
          this.pendingQueues.set(parentId, notifications);
        }
      }
    } catch (err) {
      mainWarn('[DispatchNotifier]', `Failed to restore pending queue for ${parentId}`, err);
    }
  }

  /**
   * F-5.3: Inject resume context as a pending notification on bootstrap.
   * Called after restoreFromDb when previously dispatched children exist.
   */
  injectResumeContext(parentId: string, children: ChildTaskInfo[]): void {
    if (children.length === 0) return;

    const statusLabel = (status: string): string => {
      if (status === 'running' || status === 'pending') return 'running';
      if (status === 'cancelled') return 'cancelled';
      if (status === 'failed') return 'failed';
      return 'idle';
    };

    const sessionLines = children
      .map((c) => `  - ${c.sessionId} "${c.title}" (${statusLabel(c.status)}, is_child: true)`)
      .join('\n');

    let contextMessage = `[System Context — Session Resumed]
This dispatch session has been resumed after a restart. Here is the current state of your child tasks:

Sessions (${children.length}):
${sessionLines}

Previously running tasks have been paused. See statuses above. You can:
- Use read_transcript to review their results
- Use send_message to resume an idle task with new instructions
- Use start_task to create new tasks`;

    // Append existing pending notifications if any
    const existingQueue = this.pendingQueues.get(parentId);
    if (existingQueue && existingQueue.length > 0) {
      const pendingMessages = existingQueue.map((n) => `- ${n.message}`).join('\n');
      contextMessage += `\n\nPending notifications from before restart:\n${pendingMessages}`;
    }

    const notification: PendingNotification = {
      childSessionId: `context_resume_${parentId}`,
      childTitle: 'Session Resume',
      result: 'context_resume',
      message: contextMessage,
      timestamp: Date.now(),
    };

    // Replace the entire queue with just the context notification
    // (existing pending notifications are already included in the context message)
    this.pendingQueues.set(parentId, [notification]);
    void this.persistPendingQueue(parentId);

    mainLog('[DispatchNotifier]', `Injected resume context for ${parentId} (${children.length} children)`);
  }

  /**
   * Enqueue a structured notification, deduplicating by childSessionId.
   */
  private enqueueNotification(parentId: string, notification: PendingNotification): void {
    if (!this.pendingQueues.has(parentId)) {
      this.pendingQueues.set(parentId, []);
    }
    const queue = this.pendingQueues.get(parentId)!;

    // F-5.4: Deduplicate by childSessionId — replace existing if present
    const existingIndex = queue.findIndex((n) => n.childSessionId === notification.childSessionId);
    if (existingIndex !== -1) {
      queue[existingIndex] = notification;
    } else {
      queue.push(notification);
    }

    void this.persistPendingQueue(parentId);
  }

  /**
   * Persist pending queue to conversation extra for crash recovery.
   */
  private async persistPendingQueue(parentId: string): Promise<void> {
    try {
      const queue = this.pendingQueues.get(parentId) ?? [];
      // Read existing conversation to merge extra (updateConversation does shallow merge)
      const conversation = await this.conversationRepo.getConversation(parentId);
      const existingExtra = (conversation?.extra as Record<string, unknown>) ?? {};
      await this.conversationRepo.updateConversation(parentId, {
        extra: { ...existingExtra, pendingNotifications: queue },
      } as Partial<TChatConversation>);
    } catch (err) {
      mainWarn('[DispatchNotifier]', `Failed to persist pending queue for ${parentId}`, err);
    }
  }

  /**
   * F-5.4: Migrate notification entries from old string format to PendingNotification.
   * Handles both old string[] and new PendingNotification[] for backward compatibility.
   */
  private migrateNotifications(entries: Array<string | PendingNotification>): PendingNotification[] {
    const notifications: PendingNotification[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (typeof entry === 'object' && entry !== null && 'childSessionId' in entry) {
        // Already structured PendingNotification
        if (!seenIds.has(entry.childSessionId)) {
          seenIds.add(entry.childSessionId);
          notifications.push(entry);
        }
      } else if (typeof entry === 'string') {
        // Legacy plain string format — wrap in a synthetic PendingNotification
        const legacyId = `legacy_${i}`;
        notifications.push({
          childSessionId: legacyId,
          childTitle: 'Legacy',
          result: 'completed',
          message: entry,
          timestamp: Date.now(),
        });
      }
    }

    return notifications;
  }
}
