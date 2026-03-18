/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ConversationTokenUsageRecord = {
  id: string;
  conversationId: string;
  backend: string;
  replyIndex: number;
  assistantMessageId?: string;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  contextUsed?: number;
  contextSize?: number;
  sessionCostAmount?: number;
  sessionCostCurrency?: string;
  createdAt: number;
  updatedAt: number;
};

export type ConversationTokenUsageRecordInput = Omit<
  ConversationTokenUsageRecord,
  'id' | 'replyIndex' | 'createdAt' | 'updatedAt'
> & {
  replyIndex?: number;
};

export type ConversationTokenUsageRange = {
  startTime?: number;
  endTime?: number;
};

export type ConversationTokenUsageSummary = {
  conversationId: string;
  backend?: string;
  replyCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedReadTokens: number;
  totalCachedWriteTokens: number;
  totalThoughtTokens: number;
  totalTokens: number;
  latestContextUsed?: number;
  latestContextSize?: number;
  latestSessionCostAmount?: number;
  latestSessionCostCurrency?: string;
  lastReplyIndex?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
};

export type ConversationTokenUsageMonitorSummary = {
  conversationCount: number;
  replyCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedReadTokens: number;
  totalCachedWriteTokens: number;
  totalThoughtTokens: number;
  totalTokens: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
};

export type ConversationTokenUsageMonitorGroup = {
  agent?: string;
  backend?: string;
  summary: ConversationTokenUsageMonitorSummary;
};

export type ConversationTokenUsageMonitorResult = {
  range: ConversationTokenUsageRange;
  summary: ConversationTokenUsageMonitorSummary;
  groups: {
    byAgent: ConversationTokenUsageMonitorGroup[];
    byBackend: ConversationTokenUsageMonitorGroup[];
    byAgentBackend: ConversationTokenUsageMonitorGroup[];
  };
};
