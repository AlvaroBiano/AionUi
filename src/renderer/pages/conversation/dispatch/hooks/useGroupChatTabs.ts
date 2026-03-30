/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChildTaskInfoVO, GroupChatInfoVO, GroupChatMemberBarItem, TeammateTab } from '../types';

/**
 * Derive MemberBar + TeammateTabBar state from useGroupChatInfo data.
 * G3.3: Core state management hook for group chat tabs.
 */
export function useGroupChatTabs(
  conversationId: string,
  info: GroupChatInfoVO | null,
  dispatcher: { name: string; avatar?: string }
) {
  const { t } = useTranslation();
  const [activeTabKey, setActiveTabKey] = useState<string>('group-chat');
  const [closedTabs, setClosedTabs] = useState<Set<string>>(new Set());
  const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set());

  // Derive members for MemberBar
  const members = useMemo<GroupChatMemberBarItem[]>(() => {
    const result: GroupChatMemberBarItem[] = [];

    // Admin is always first
    result.push({
      id: conversationId,
      name: dispatcher.name,
      avatar: dispatcher.avatar,
      memberType: 'admin',
      status: 'online',
    });

    // Children
    if (info?.children) {
      for (const child of info.children) {
        result.push({
          id: child.sessionId,
          name: child.teammateName || child.title,
          avatar: child.teammateAvatar,
          memberType: child.isPermanent ? 'permanent' : 'temporary',
          status: childStatusToMemberStatus(child.status),
        });
      }
    }

    return result;
  }, [conversationId, dispatcher.name, dispatcher.avatar, info?.children]);

  // Derive tabs for TeammateTabBar
  const tabs = useMemo<TeammateTab[]>(() => {
    const result: TeammateTab[] = [
      {
        key: 'group-chat',
        label: t('dispatch.tabs.groupChat'),
        status: 'idle',
        hasUnread: false,
        closable: false,
      },
    ];

    if (info?.children) {
      for (const child of info.children) {
        if (closedTabs.has(child.sessionId)) continue;
        result.push({
          key: child.sessionId,
          label: child.teammateName || child.title,
          avatar: child.teammateAvatar,
          status: childStatusToTabStatus(child.status),
          hasUnread: unreadTabs.has(child.sessionId),
          closable: child.status !== 'running' && child.status !== 'pending',
        });
      }
    }

    return result;
  }, [info?.children, closedTabs, unreadTabs, t]);

  // Mark unread when child emits content and tab is not active
  useEffect(() => {
    const unsub = ipcBridge.geminiConversation.responseStream.on((msg) => {
      if (msg.type !== 'dispatch_event') return;
      if (msg.conversation_id !== conversationId) return;
      const data = msg.data as { childTaskId?: string } | undefined;
      if (!data?.childTaskId) return;
      if (data.childTaskId !== activeTabKey) {
        setUnreadTabs((prev) => new Set(prev).add(data.childTaskId!));
      }
    });
    return unsub;
  }, [activeTabKey, conversationId]);

  // Clear unread when switching to a tab
  const handleTabChange = useCallback((key: string) => {
    setActiveTabKey(key);
    setUnreadTabs((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleTabClose = useCallback(
    (key: string) => {
      setClosedTabs((prev) => new Set(prev).add(key));
      if (activeTabKey === key) {
        setActiveTabKey('group-chat');
      }
    },
    [activeTabKey]
  );

  return {
    members,
    tabs,
    activeTabKey,
    onTabChange: handleTabChange,
    onTabClose: handleTabClose,
  };
}

function childStatusToMemberStatus(status: ChildTaskInfoVO['status']): GroupChatMemberBarItem['status'] {
  switch (status) {
    case 'running':
    case 'pending':
      return 'working';
    case 'completed':
    case 'idle':
      return 'idle';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}

function childStatusToTabStatus(status: ChildTaskInfoVO['status']): TeammateTab['status'] {
  switch (status) {
    case 'running':
    case 'pending':
      return 'working';
    case 'completed':
    case 'idle':
      return 'idle';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'released';
    default:
      return 'idle';
  }
}
