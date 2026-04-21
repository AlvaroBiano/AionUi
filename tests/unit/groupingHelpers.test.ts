/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildAgentGroupedHistory } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import type { TChatConversation } from '@/common/config/storage';

// ---------------------------------------------------------------------------
// Helper to build a minimal TChatConversation
// ---------------------------------------------------------------------------

let _idSeq = 0;
function makeConv(
  overrides: Partial<TChatConversation> & {
    type?: string;
    extra?: Record<string, unknown>;
    modifyTime?: number;
  } = {}
): TChatConversation {
  const id = `conv-${++_idSeq}`;
  return {
    id,
    name: `Conversation ${id}`,
    type: 'acp',
    createTime: 1000,
    modifyTime: 1000,
    extra: {},
    ...overrides,
  } as unknown as TChatConversation;
}

const emptyMap = new Map<string, { displayName: string; avatarSrc: string | null; avatarEmoji?: string }>();

const testMap = new Map([
  ['claude', { displayName: 'Claude Code', avatarSrc: null }],
  ['gemini', { displayName: 'Gemini', avatarSrc: null }],
  ['qwen', { displayName: 'Qwen Code', avatarSrc: null }],
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildAgentGroupedHistory', () => {
  it('empty input → empty agentGroups', () => {
    const result = buildAgentGroupedHistory([], emptyMap);
    expect(result.agentGroups).toHaveLength(0);
  });

  it('return type no longer has pinnedConversations field', () => {
    const result = buildAgentGroupedHistory([], emptyMap);
    expect('pinnedConversations' in result).toBe(false);
  });

  it('gemini conversation without presetAssistantId → grouped under "gemini"', () => {
    const conv = makeConv({ type: 'gemini', extra: {}, modifyTime: 2000 });
    const result = buildAgentGroupedHistory([conv], testMap);
    expect(result.agentGroups).toHaveLength(1);
    expect(result.agentGroups[0].agentKey).toBe('gemini');
    expect(result.agentGroups[0].conversations).toHaveLength(1);
  });

  it('gemini conversation with presetAssistantId → grouped under that preset id', () => {
    const conv = makeConv({
      type: 'gemini',
      extra: { presetAssistantId: 'assistant-abc' },
      modifyTime: 3000,
    });
    const result = buildAgentGroupedHistory([conv], emptyMap);
    expect(result.agentGroups).toHaveLength(1);
    expect(result.agentGroups[0].agentKey).toBe('assistant-abc');
  });

  it('acp conversation without customAgentId uses backend as group key', () => {
    const conv = makeConv({ type: 'acp', extra: { backend: 'claude' }, modifyTime: 4000 });
    const result = buildAgentGroupedHistory([conv], testMap);
    expect(result.agentGroups).toHaveLength(1);
    expect(result.agentGroups[0].agentKey).toBe('claude');
    expect(result.agentGroups[0].displayName).toBe('Claude Code');
  });

  it('acp conversation with customAgentId → "custom:<uuid>" group key', () => {
    const uuid = 'deadbeef-1234';
    const conv = makeConv({
      type: 'acp',
      extra: { backend: 'custom', customAgentId: uuid },
      modifyTime: 5000,
    });
    const result = buildAgentGroupedHistory([conv], emptyMap);
    expect(result.agentGroups).toHaveLength(1);
    expect(result.agentGroups[0].agentKey).toBe(`custom:${uuid}`);
  });

  it('acp conversation with no backend and no customAgentId falls back to "acp"', () => {
    const conv = makeConv({ type: 'acp', extra: {}, modifyTime: 5500 });
    const result = buildAgentGroupedHistory([conv], emptyMap);
    expect(result.agentGroups[0].agentKey).toBe('acp');
  });

  it('multiple conversations grouped into correct agent buckets', () => {
    const c1 = makeConv({ type: 'acp', extra: { backend: 'claude' }, modifyTime: 6000 });
    const c2 = makeConv({ type: 'acp', extra: { backend: 'qwen' }, modifyTime: 7000 });
    const c3 = makeConv({ type: 'acp', extra: { backend: 'claude' }, modifyTime: 8000 });

    const result = buildAgentGroupedHistory([c1, c2, c3], testMap);
    expect(result.agentGroups).toHaveLength(2);

    const claudeGroup = result.agentGroups.find((g) => g.agentKey === 'claude');
    const qwenGroup = result.agentGroups.find((g) => g.agentKey === 'qwen');

    expect(claudeGroup?.conversations).toHaveLength(2);
    expect(qwenGroup?.conversations).toHaveLength(1);
  });

  it('agentGroups sorted by most-recent conversation descending', () => {
    const old = makeConv({ type: 'acp', extra: { backend: 'claude' }, modifyTime: 1000 });
    const recent = makeConv({ type: 'gemini', extra: {}, modifyTime: 9000 });

    const result = buildAgentGroupedHistory([old, recent], testMap);
    // gemini (time=9000) should come before claude (time=1000)
    expect(result.agentGroups[0].agentKey).toBe('gemini');
    expect(result.agentGroups[1].agentKey).toBe('claude');
  });

  it('within a group, conversations sorted by activity time descending', () => {
    const older = makeConv({ type: 'acp', extra: { backend: 'claude' }, modifyTime: 2000 });
    const newer = makeConv({ type: 'acp', extra: { backend: 'claude' }, modifyTime: 8000 });

    const result = buildAgentGroupedHistory([older, newer], testMap);
    const group = result.agentGroups[0];
    expect(group.conversations[0].modifyTime).toBe(8000);
    expect(group.conversations[1].modifyTime).toBe(2000);
  });

  it('all conversations go into agentGroups (no pinnedConversations field)', () => {
    // After migration, buildAgentGroupedHistory no longer has pinnedConversations.
    // Even conversations with historyPinned=true go into agentGroups.
    const pinned = makeConv({
      type: 'acp',
      extra: { backend: 'claude', historyPinned: true, historyPinnedAt: 9999 },
      modifyTime: 9000,
    });
    const normal = makeConv({ type: 'acp', extra: { backend: 'claude' }, modifyTime: 5000 });

    const result = buildAgentGroupedHistory([pinned, normal], testMap);
    expect('pinnedConversations' in result).toBe(false);

    // Both conversations should appear in agentGroups
    const allGroupedIds = result.agentGroups.flatMap((g) => g.conversations.map((c) => c.id));
    expect(allGroupedIds).toContain(pinned.id);
    expect(allGroupedIds).toContain(normal.id);
  });

  it('legacy extra.pinned conversations also go into agentGroups', () => {
    const legacyPinned = makeConv({
      type: 'acp',
      extra: { backend: 'claude', pinned: true, pinnedAt: 9999 },
      modifyTime: 9000,
    });

    const result = buildAgentGroupedHistory([legacyPinned], testMap);
    expect('pinnedConversations' in result).toBe(false);
    expect(result.agentGroups[0].conversations).toHaveLength(1);
  });

  it('team conversation (has teamId) is filtered out entirely', () => {
    const team = makeConv({ type: 'acp', extra: { backend: 'claude', teamId: 'team-1' }, modifyTime: 9000 });
    const normal = makeConv({ type: 'acp', extra: { backend: 'qwen' }, modifyTime: 5000 });

    const result = buildAgentGroupedHistory([team, normal], testMap);
    const allIds = result.agentGroups.flatMap((g) => g.conversations.map((c) => c.id));
    expect(allIds).not.toContain(team.id);
    expect(allIds).toContain(normal.id);
  });

  it('displayName and avatarSrc resolved from agentDisplayMap when available', () => {
    const conv = makeConv({ type: 'acp', extra: { backend: 'qwen' }, modifyTime: 3000 });
    const result = buildAgentGroupedHistory([conv], testMap);
    const group = result.agentGroups[0];
    expect(group.displayName).toBe('Qwen Code');
    expect(group.avatarSrc).toBeNull();
  });

  it('displayName falls back to agentKey when not in map', () => {
    const conv = makeConv({ type: 'gemini', extra: { presetAssistantId: 'unknown-preset' }, modifyTime: 2000 });
    const result = buildAgentGroupedHistory([conv], emptyMap);
    const group = result.agentGroups[0];
    expect(group.displayName).toBe('unknown-preset');
  });
});
