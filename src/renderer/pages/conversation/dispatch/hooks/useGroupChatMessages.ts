/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupChatMessageData, GroupChatTimelineMessage } from '../types';

/** Convert a backend GroupChatMessage to a renderer timeline message */
const toTimelineMessage = (gcm: GroupChatMessageData, msgId?: string): GroupChatTimelineMessage => ({
  id: msgId || `${gcm.sourceSessionId}-${gcm.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
  sourceSessionId: gcm.sourceSessionId,
  sourceRole: gcm.sourceRole,
  displayName: gcm.displayName,
  content: gcm.content,
  messageType: gcm.messageType,
  timestamp: gcm.timestamp,
  childTaskId: gcm.childTaskId,
  avatar: gcm.avatar,
  progressSummary: gcm.progressSummary,
});

/** Parse a DB message into a timeline message */
const parseDbMessage = (
  msg: TMessage,
  conversationId: string,
  index: number,
  t: (key: string) => string
): GroupChatTimelineMessage | null => {
  // CF-1 Fix Part B: Parse dispatch_event messages from DB
  if ((msg.type as string) === 'dispatch_event' && msg.content) {
    try {
      const eventData =
        typeof msg.content === 'string'
          ? (JSON.parse(msg.content) as Record<string, unknown>)
          : (msg.content as Record<string, unknown>);
      return {
        id: msg.id || `db-dispatch-${index}`,
        sourceSessionId: String(eventData.sourceSessionId || conversationId),
        sourceRole: (eventData.sourceRole as GroupChatTimelineMessage['sourceRole']) || 'child',
        displayName: String(eventData.displayName || ''),
        content: String(eventData.content || ''),
        messageType: (eventData.messageType as GroupChatTimelineMessage['messageType']) || 'system',
        timestamp: msg.createdAt || Number(eventData.timestamp) || Date.now(),
        childTaskId: eventData.childTaskId ? String(eventData.childTaskId) : undefined,
        avatar: eventData.avatar ? String(eventData.avatar) : undefined,
        progressSummary: eventData.progressSummary ? String(eventData.progressSummary) : undefined,
      };
    } catch {
      // Malformed dispatch event in DB, skip
      return null;
    }
  }

  const content =
    typeof msg.content === 'object' && msg.content !== null
      ? ((msg.content as { content?: string }).content ?? '')
      : '';

  // User messages (right-aligned)
  if (msg.position === 'right') {
    return {
      id: msg.id || `db-${index}`,
      sourceSessionId: conversationId,
      sourceRole: 'user',
      displayName: t('dispatch.timeline.userDisplayName'),
      content,
      messageType: 'text',
      timestamp: msg.createdAt || Date.now(),
    };
  }

  // Assistant/dispatcher messages (left-aligned)
  if (msg.type === 'text' && content) {
    return {
      id: msg.id || `db-${index}`,
      sourceSessionId: conversationId,
      sourceRole: 'dispatcher',
      displayName: t('dispatch.timeline.dispatcherDisplayName'),
      content,
      messageType: 'text',
      timestamp: msg.createdAt || Date.now(),
    };
  }

  return null;
};

/**
 * Hook that subscribes to the dispatch conversation's responseStream
 * and manages the timeline message state.
 *
 * On mount: loads existing messages from DB.
 * On stream: filters by conversation_id and type === 'dispatch_event'.
 * Status card updates (task_progress/task_completed/task_failed/task_cancelled)
 * modify existing cards in-place by childTaskId match.
 *
 * CF-1: dispatch_event messages are now persisted to DB and parsed on reload.
 * CF-2: progressSummary is preserved separately from content.
 */
export function useGroupChatMessages(conversationId: string) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<GroupChatTimelineMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load historical messages from DB on mount
  useEffect(() => {
    setIsLoading(true);
    setMessages([]);

    ipcBridge.database.getConversationMessages
      .invoke({ conversation_id: conversationId })
      .then((dbMessages) => {
        if (!dbMessages || !Array.isArray(dbMessages)) {
          setIsLoading(false);
          return;
        }

        const parsed: GroupChatTimelineMessage[] = [];
        // CF-1: Deduplicate dispatch_event messages by childTaskId.
        // For task status messages (non-started), keep only the latest per childTaskId.
        const childTaskLatest = new Map<string, number>();
        for (let i = 0; i < dbMessages.length; i++) {
          const result = parseDbMessage(dbMessages[i], conversationId, i, t);
          if (result) {
            if (result.childTaskId && result.messageType !== 'task_started') {
              const existingIdx = childTaskLatest.get(result.childTaskId);
              if (existingIdx !== undefined) {
                // Replace older status with newer one (in-place update)
                parsed[existingIdx] = result;
                continue;
              }
              childTaskLatest.set(result.childTaskId, parsed.length);
            }
            parsed.push(result);
          }
        }

        setMessages(parsed);
        setIsLoading(false);
      })
      .catch((err) => {
        console.warn('[useGroupChatMessages] Failed to load from DB:', err);
        setIsLoading(false);
      });
  }, [conversationId, t]);

  // Subscribe to live stream
  useEffect(() => {
    const unsub = ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversationId) return;

      // The responseStream type field is typed as string at the IPC level.
      // dispatch_event messages come through with type='dispatch_event'.
      if (message.type === 'dispatch_event') {
        try {
          const gcm = message.data as GroupChatMessageData;
          const timelineMsg = toTimelineMessage(gcm, String(message.msg_id || ''));

          setMessages((prev) => {
            // CF-1 dedup: skip if msg_id already exists in the array
            if (message.msg_id && prev.some((m) => m.id === String(message.msg_id))) {
              return prev;
            }

            // Non-started events update the existing card in-place by childTaskId
            if (gcm.childTaskId && gcm.messageType !== 'task_started') {
              const idx = prev.findIndex((m) => m.childTaskId === gcm.childTaskId);
              if (idx >= 0) {
                const next = [...prev];
                // CF-2: For task_progress, preserve content (title) and update progressSummary
                if (gcm.messageType === 'task_progress') {
                  next[idx] = {
                    ...next[idx],
                    progressSummary: gcm.progressSummary || gcm.content,
                    messageType: gcm.messageType,
                    timestamp: gcm.timestamp,
                  };
                } else {
                  next[idx] = { ...next[idx], ...timelineMsg, id: next[idx].id };
                }
                return next;
              }
            }
            return [...prev, timelineMsg];
          });
        } catch {
          // Skip malformed dispatch events to prevent breaking the subscription
        }
        return;
      }

      // Handle regular text messages (dispatcher responses)
      if (message.type === 'text') {
        const data = message.data as { content?: string; msg_id?: string } | string;
        const content = typeof data === 'string' ? data : (data?.content ?? '');
        if (!content) return;

        setMessages((prev) => [
          ...prev,
          {
            id: `${conversationId}-${message.msg_id || Date.now()}`,
            sourceSessionId: conversationId,
            sourceRole: 'dispatcher',
            displayName: t('dispatch.timeline.dispatcherDisplayName'),
            content,
            messageType: 'text',
            timestamp: Date.now(),
          },
        ]);
      }
    });

    return unsub;
  }, [conversationId, t]);

  /** Optimistic insert of a user message (renders immediately before IPC roundtrip) */
  const appendUserMessage = useCallback(
    (msgId: string, content: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          sourceSessionId: conversationId,
          sourceRole: 'user',
          displayName: t('dispatch.timeline.userDisplayName'),
          content,
          messageType: 'text',
          timestamp: Date.now(),
        },
      ]);
    },
    [conversationId, t]
  );

  return { messages, isLoading, appendUserMessage };
}
