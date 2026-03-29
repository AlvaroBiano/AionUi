/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime, getTimelineLabel } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName, isTemporaryWorkspace } from '@/renderer/utils/workspace/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspace/workspaceHistory';

import type {
  AgentDMGroupData,
  GroupedHistoryResult,
  TimelineItem,
  TimelineSection,
  WorkspaceGroup,
  WorkspaceSubGroupData,
} from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';
import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';
import { resolveAgentId, resolveAgentDisplayName, resolveAgentAvatar } from '@/renderer/utils/model/agentIdentity';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';

export const getConversationTimelineLabel = (conversation: TChatConversation, t: (key: string) => string): string => {
  const time = getActivityTime(conversation);
  return getTimelineLabel(time, Date.now(), t);
};

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return 0;
};

export const groupConversationsByTimelineAndWorkspace = (
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

  const workspaceGroupsByTimeline = new Map<string, WorkspaceGroup[]>();

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const latestConv = sortedConvs[0];
    const timeline = getConversationTimelineLabel(latestConv, t);

    if (!workspaceGroupsByTimeline.has(timeline)) {
      workspaceGroupsByTimeline.set(timeline, []);
    }

    workspaceGroupsByTimeline.get(timeline)!.push({
      workspace,
      displayName: getWorkspaceDisplayName(workspace),
      conversations: sortedConvs,
    });
  });

  const withoutWorkspaceByTimeline = new Map<string, TChatConversation[]>();

  withoutWorkspaceConvs.forEach((conv) => {
    const timeline = getConversationTimelineLabel(conv, t);
    if (!withoutWorkspaceByTimeline.has(timeline)) {
      withoutWorkspaceByTimeline.set(timeline, []);
    }
    withoutWorkspaceByTimeline.get(timeline)!.push(conv);
  });

  const timelineOrder = [
    'conversation.history.today',
    'conversation.history.yesterday',
    'conversation.history.recent7Days',
    'conversation.history.earlier',
  ];
  const sections: TimelineSection[] = [];

  timelineOrder.forEach((timelineKey) => {
    const timeline = t(timelineKey);
    const withWorkspace = workspaceGroupsByTimeline.get(timeline) || [];
    const withoutWorkspace = withoutWorkspaceByTimeline.get(timeline) || [];

    if (withWorkspace.length === 0 && withoutWorkspace.length === 0) return;

    const items: TimelineItem[] = [];

    withWorkspace.forEach((group) => {
      const updateTime = getWorkspaceUpdateTime(group.workspace);
      const time = updateTime > 0 ? updateTime : getActivityTime(group.conversations[0]);
      items.push({
        type: 'workspace',
        time,
        workspaceGroup: group,
      });
    });

    withoutWorkspace.forEach((conv) => {
      items.push({
        type: 'conversation',
        time: getActivityTime(conv),
        conversation: conv,
      });
    });

    items.sort((a, b) => b.time - a.time);

    sections.push({
      timeline,
      items,
    });
  });

  return sections;
};

/**
 * Group non-dispatch conversations by agent identity (Slack-like DM grouping).
 * Each agent becomes a "person" with all their conversations listed under them.
 */
export const groupConversationsByAgent = (
  conversations: TChatConversation[],
  agentRegistry: Map<string, AgentIdentity>,
  generatingIds?: Set<string>
): AgentDMGroupData[] => {
  const groups = new Map<string, TChatConversation[]>();

  for (const conv of conversations) {
    const agentId = resolveAgentId(conv);
    if (!groups.has(agentId)) {
      groups.set(agentId, []);
    }
    groups.get(agentId)!.push(conv);
  }

  const result: AgentDMGroupData[] = [];

  for (const [agentId, convs] of groups) {
    const sorted = [...convs].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const latest = sorted[0];
    const identity = agentRegistry.get(agentId);

    // Resolve display info from registry or from conversation itself
    const agentName = identity?.name || resolveAgentDisplayName(latest);
    const agentAvatar = identity?.avatar || resolveAgentAvatar(latest);
    const isPermanent = identity?.employeeType === 'permanent';

    // Get CLI agent logo (SVG path) for agents without emoji avatar
    const backendKey = identity?.backendType || agentId;
    const agentLogo = !agentAvatar ? getAgentLogo(backendKey) : null;

    const hasActive = generatingIds ? sorted.some((c) => generatingIds.has(c.id)) : false;

    // Compute workspace sub-groups
    const ungrouped: TChatConversation[] = [];
    const workspaceMap = new Map<string, TChatConversation[]>();

    for (const conv of sorted) {
      const extra = conv.extra as { customWorkspace?: boolean; workspace?: string } | undefined;
      if (extra?.customWorkspace === true && extra.workspace && !isTemporaryWorkspace(extra.workspace)) {
        if (!workspaceMap.has(extra.workspace)) {
          workspaceMap.set(extra.workspace, []);
        }
        workspaceMap.get(extra.workspace)!.push(conv);
      } else {
        ungrouped.push(conv);
      }
    }

    // Build workspace sub-groups sorted by latestActivityTime desc
    const workspaceSubGroups: WorkspaceSubGroupData[] = [...workspaceMap.entries()]
      .map(([wsPath, wsConvs]) => {
        const sortedWsConvs = [...wsConvs].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
        return {
          workspacePath: wsPath,
          displayName: getWorkspaceDisplayName(wsPath),
          conversations: sortedWsConvs,
          latestActivityTime: getActivityTime(sortedWsConvs[0]),
        };
      })
      .toSorted((a, b) => b.latestActivityTime - a.latestActivityTime);

    // Determine display mode
    // - flat: no custom workspaces
    // - subtitle: exactly 1 workspace with no ungrouped conversations (assistants only —
    //   general agents skip subtitle to avoid showing inherited dispatch workspace paths)
    // - grouped: multiple workspaces, or 1 workspace + ungrouped conversations → folder view
    const customWsCount = workspaceMap.size;
    let displayMode: 'flat' | 'subtitle' | 'grouped';
    if (customWsCount === 0) {
      displayMode = 'flat';
    } else if (customWsCount === 1 && ungrouped.length === 0 && isPermanent) {
      displayMode = 'subtitle';
    } else {
      displayMode = 'grouped';
    }

    const ungroupedConversations = ungrouped;

    result.push({
      agentId,
      agentName,
      agentAvatar,
      agentLogo,
      isPermanent,
      conversations: sorted,
      latestActivityTime: getActivityTime(latest),
      hasActiveConversation: hasActive,
      ungroupedConversations,
      workspaceSubGroups,
      displayMode,
      ...(displayMode === 'subtitle'
        ? {
            singleWorkspaceDisplayName: workspaceSubGroups[0].displayName,
            singleWorkspacePath: workspaceSubGroups[0].workspacePath,
          }
        : {}),
    });
  }

  // Sort groups by latest activity time (most recent first)
  result.sort((a, b) => b.latestActivityTime - a.latestActivityTime);

  return result;
};

export const buildGroupedHistory = (
  conversations: TChatConversation[],
  t: (key: string) => string,
  agentRegistry?: Map<string, AgentIdentity>,
  generatingIds?: Set<string>
): GroupedHistoryResult => {
  // Filter out dispatch_child conversations from sidebar display.
  // Raw conversation list is preserved upstream for child count computation.
  const visibleConversations = conversations.filter((conv) => {
    // Check extra.dispatchSessionType, not conv.type — child conversations use type='gemini' (CR-004/BUG-001)
    const extra = conv.extra as { dispatchSessionType?: string } | undefined;
    return extra?.dispatchSessionType !== 'dispatch_child';
  });

  // Separate dispatch (dispatcher) conversations from normal conversations
  const dispatchConversations = visibleConversations
    .filter((conv) => conv.type === 'dispatch')
    .toSorted((a, b) => getActivityTime(b) - getActivityTime(a));

  const nonDispatchConversations = visibleConversations.filter((conv) => conv.type !== 'dispatch');

  const pinnedConversations = nonDispatchConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = nonDispatchConversations.filter((conversation) => !isConversationPinned(conversation));

  // Build agent-based DM groups from all non-dispatch, non-pinned conversations
  const agentDMGroups = agentRegistry
    ? groupConversationsByAgent(normalConversations, agentRegistry, generatingIds)
    : [];

  return {
    pinnedConversations,
    dispatchConversations,
    // Skip timeline calculation when agentRegistry is present — DM groups are rendered instead
    timelineSections: agentRegistry ? [] : groupConversationsByTimelineAndWorkspace(normalConversations, t),
    agentDMGroups,
  };
};
