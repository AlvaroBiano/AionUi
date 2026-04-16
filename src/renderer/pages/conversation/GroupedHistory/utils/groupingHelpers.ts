/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspace/workspaceHistory';

import type {
  AgentGroup,
  AgentGroupedHistoryResult,
  GroupedHistoryResult,
  TimelineItem,
  TimelineSection,
} from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const isCronJobConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { cronJobId?: string } | undefined;
  return Boolean(extra?.cronJobId);
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return 0;
};

export const groupConversationsByWorkspace = (
  conversations: TChatConversation[],
  t: (key: string) => string
): TimelineSection[] => {
  const allWorkspaceGroups = new Map<string, TChatConversation[]>();
  const withoutWorkspaceConvs: TChatConversation[] = [];

  conversations.forEach((conv) => {
    const workspace = conv.extra?.workspace;
    const customWorkspace = conv.extra?.customWorkspace;

    if (customWorkspace && workspace) {
      if (!allWorkspaceGroups.has(workspace)) {
        allWorkspaceGroups.set(workspace, []);
      }
      allWorkspaceGroups.get(workspace)!.push(conv);
    } else {
      withoutWorkspaceConvs.push(conv);
    }
  });

  const items: TimelineItem[] = [];

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const latestConversationTime = getActivityTime(sortedConvs[0]);
    const updateTime = getWorkspaceUpdateTime(workspace);
    const time = Math.max(updateTime, latestConversationTime);
    items.push({
      type: 'workspace',
      time,
      workspaceGroup: {
        workspace,
        displayName: getWorkspaceDisplayName(workspace),
        conversations: sortedConvs,
      },
    });
  });

  withoutWorkspaceConvs.forEach((conv) => {
    items.push({
      type: 'conversation',
      time: getActivityTime(conv),
      conversation: conv,
    });
  });

  items.sort((a, b) => b.time - a.time);

  if (items.length === 0) return [];

  return [
    {
      timeline: t('conversation.history.recents'),
      items,
    },
  ];
};

/** Check whether a conversation belongs to a team (should be hidden from sidebar). */
const isTeamConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { teamId?: string } | undefined;
  return Boolean(extra?.teamId);
};

/**
 * Resolve the agent key for a conversation, matching GuidPage agentKey format.
 */
export const resolveAgentKey = (conv: TChatConversation): string => {
  if (conv.type === 'gemini') {
    return (conv.extra as { presetAssistantId?: string } | undefined)?.presetAssistantId ?? 'gemini';
  }
  if (conv.type === 'acp') {
    const extra = conv.extra as
      | {
          customAgentId?: string;
          backend?: string;
          presetAssistantId?: string;
        }
      | undefined;
    // Preset assistants (e.g. codex-based) store their ID in presetAssistantId, not customAgentId
    if (extra?.presetAssistantId) return extra.presetAssistantId;
    if (extra?.customAgentId) return `custom:${extra.customAgentId}`;
    return extra?.backend ?? 'acp';
  }
  return conv.type;
};

/**
 * Build agent-grouped history from conversations.
 * agentDisplayMap provides display metadata per agentKey.
 */
export const buildAgentGroupedHistory = (
  conversations: TChatConversation[],
  agentDisplayMap: Map<string, { displayName: string; avatarSrc: string | null; avatarEmoji?: string }>
): AgentGroupedHistoryResult => {
  // Filter out team-owned conversations
  const visibleConversations = conversations.filter((conv) => !isTeamConversation(conv));

  const pinnedConversations = visibleConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = visibleConversations.filter((conv) => !isConversationPinned(conv));

  const groupMap = new Map<string, AgentGroup>();

  for (const conv of normalConversations) {
    const key = resolveAgentKey(conv);
    if (!groupMap.has(key)) {
      const meta = agentDisplayMap.get(key);
      groupMap.set(key, {
        agentKey: key,
        displayName: meta?.displayName ?? key,
        avatarSrc: meta?.avatarSrc ?? null,
        avatarEmoji: meta?.avatarEmoji,
        conversations: [],
      });
    }
    groupMap.get(key)!.conversations.push(conv);
  }

  // Sort each group's conversations by activity time descending
  for (const group of groupMap.values()) {
    group.conversations.sort((a, b) => getActivityTime(b) - getActivityTime(a));
  }

  // Sort groups by their most recent conversation's activity time descending
  const agentGroups = [...groupMap.values()].toSorted((a, b) => {
    const timeA = a.conversations[0] ? getActivityTime(a.conversations[0]) : 0;
    const timeB = b.conversations[0] ? getActivityTime(b.conversations[0]) : 0;
    return timeB - timeA;
  });

  return { pinnedConversations, agentGroups };
};

export const buildGroupedHistory = (
  conversations: TChatConversation[],
  t: (key: string) => string
): GroupedHistoryResult => {
  // Filter out team-owned conversations; they are only visible via the Teams panel
  const visibleConversations = conversations.filter((conv) => !isTeamConversation(conv));

  const pinnedConversations = visibleConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = visibleConversations.filter(
    (conversation) => !isConversationPinned(conversation) && !isCronJobConversation(conversation)
  );

  return {
    pinnedConversations,
    timelineSections: groupConversationsByWorkspace(normalConversations, t),
  };
};
