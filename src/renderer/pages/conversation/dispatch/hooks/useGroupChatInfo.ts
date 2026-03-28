/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GroupChatInfoVO } from '../types';

/**
 * Hook to fetch group chat info (dispatcher identity, children list, pending count).
 * Fetches on mount and provides a refresh callback.
 * CF-3: Exposes error state and retry mechanism.
 * F-3.2: Optional auto-refresh interval (skips when all children are in terminal states).
 */
export function useGroupChatInfo(conversationId: string, options?: { autoRefreshInterval?: number }) {
  const [info, setInfo] = useState<GroupChatInfoVO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    ipcBridge.dispatch.getGroupChatInfo
      .invoke({ conversationId })
      .then((response) => {
        if (response.success && response.data) {
          setInfo({
            dispatcherId: response.data.dispatcherId,
            dispatcherName: response.data.dispatcherName,
            children: response.data.children.map((child) => ({
              sessionId: child.sessionId,
              title: child.title,
              status: child.status as 'pending' | 'running' | 'idle' | 'completed' | 'failed' | 'cancelled',
              teammateName: child.teammateName,
              teammateAvatar: child.teammateAvatar,
              createdAt: child.createdAt,
              lastActivityAt: child.lastActivityAt,
            })),
            pendingNotificationCount: response.data.pendingNotificationCount,
          });
          setError(null);
        } else {
          setError(response.msg || 'Failed to load group chat info');
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        setError(String(err));
        setIsLoading(false);
      });
  }, [conversationId]);

  const retry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    setIsLoading(true);
    refresh();
  }, [refresh]);

  // F-3.2: Auto-refresh interval with terminal-state skip
  const infoRef = useRef(info);
  infoRef.current = info;

  useEffect(() => {
    if (!options?.autoRefreshInterval) return;

    const timer = setInterval(() => {
      // Skip refresh if all children are in terminal states
      const children = infoRef.current?.children;
      if (children && children.length > 0) {
        const hasActive = children.some((c) => c.status === 'running' || c.status === 'pending');
        if (!hasActive) return;
      }
      refresh();
    }, options.autoRefreshInterval);

    return () => clearInterval(timer);
  }, [options?.autoRefreshInterval, refresh]);

  return { info, isLoading, error, retry, refresh };
}
