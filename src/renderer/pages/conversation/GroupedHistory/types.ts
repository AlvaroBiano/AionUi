/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

export type AgentGroup = {
  agentKey: string;
  displayName: string;
  avatarSrc: string | null;
  avatarEmoji?: string;
  conversations: TChatConversation[];
};

export type AgentGroupedHistoryResult = {
  pinnedConversations: TChatConversation[];
  agentGroups: AgentGroup[];
};

export type WorkspaceGroup = {
  workspace: string;
  displayName: string;
  conversations: TChatConversation[];
};

export type TimelineItem = {
  type: 'workspace' | 'conversation';
  time: number;
  workspaceGroup?: WorkspaceGroup;
  conversation?: TChatConversation;
};

export type TimelineSection = {
  timeline: string;
  items: TimelineItem[];
};

export type GroupedHistoryResult = {
  pinnedConversations: TChatConversation[];
  timelineSections: TimelineSection[];
};

export type ExportZipFile = {
  name: string;
  content?: string;
  sourcePath?: string;
};

export type ExportTask =
  | { mode: 'single'; conversation: TChatConversation }
  | { mode: 'batch'; conversationIds: string[] }
  | null;

export type ConversationRowProps = {
  conversation: TChatConversation;
  isGenerating: boolean;
  hasCompletionUnread: boolean;
  collapsed: boolean;
  tooltipEnabled: boolean;
  batchMode: boolean;
  checked: boolean;
  selected: boolean;
  menuVisible: boolean;
  /** Agent avatar image URL for the conversation row */
  avatarSrc?: string | null;
  /** Agent avatar emoji for the conversation row */
  avatarEmoji?: string;
  /** Agent avatar background color for the conversation row */
  avatarBgColor?: string;
  onToggleChecked: (conversation: TChatConversation) => void;
  onConversationClick: (conversation: TChatConversation) => void;
  onOpenMenu: (conversation: TChatConversation) => void;
  onMenuVisibleChange: (conversationId: string, visible: boolean) => void;
  onEditStart: (conversation: TChatConversation) => void;
  onDelete: (conversationId: string) => void;
  onExport?: (conversation: TChatConversation) => void;
  onTogglePin: (conversation: TChatConversation) => void;
  getJobStatus: (conversationId: string) => 'none' | 'active' | 'paused' | 'error' | 'unread';
};

export type WorkspaceGroupedHistoryProps = {
  onSessionClick?: () => void;
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
};

export type DragItemType = 'conversation' | 'workspace';

export type DragItem = {
  type: DragItemType;
  id: string;
  conversation?: TChatConversation;
  workspaceGroup?: WorkspaceGroup;
  sourceSection: 'pinned' | string;
  sourceWorkspace?: string;
};
