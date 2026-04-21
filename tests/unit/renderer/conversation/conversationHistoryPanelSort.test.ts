/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

/**
 * After the historyPinned migration, `isConversationPinned` is removed from
 * groupingHelpers (sidebar no longer has conversation-level pinning).
 * The history panel sort only cares about `extra.historyPinned`.
 */
const isHistoryPinned = (conv: TChatConversation): boolean => {
  const extra = conv.extra as { historyPinned?: boolean } | undefined;
  return Boolean(extra?.historyPinned);
};

/**
 * Test the sorting logic used in ConversationHistoryPanel.sameAgentConversations.
 *
 * The sort rule (from ConversationHistoryPanel.tsx ~line 61-65):
 *   1. History-pinned conversations (extra.historyPinned = true) come first
 *   2. Within same pinned status, sort by modifyTime descending
 *   3. null/undefined modifyTime treated as 0
 */

let _seq = 0;
function makeConv(overrides: Partial<TChatConversation> & { extra?: Record<string, unknown> } = {}): TChatConversation {
  const id = `sort-conv-${++_seq}`;
  return {
    id,
    name: `Conv ${id}`,
    type: 'gemini',
    createTime: 1000,
    modifyTime: 1000,
    extra: {},
    ...overrides,
  } as unknown as TChatConversation;
}

/**
 * Replicates the exact sorting from ConversationHistoryPanel (line 61-65).
 * We test this extracted logic rather than rendering the full component,
 * because the component has many React/router/IPC dependencies irrelevant to the sort.
 */
function sortSameAgent(conversations: TChatConversation[]): TChatConversation[] {
  return [...conversations].toSorted((a, b) => {
    const aPinned = isHistoryPinned(a);
    const bPinned = isHistoryPinned(b);
    if (aPinned !== bPinned) return bPinned ? 1 : -1;
    return (b.modifyTime ?? 0) - (a.modifyTime ?? 0);
  });
}

describe('ConversationHistoryPanel sameAgentConversations sort', () => {
  describe('pinned conversations sort before non-pinned', () => {
    it('should place a single pinned conversation before non-pinned ones', () => {
      const pinned = makeConv({ extra: { historyPinned: true }, modifyTime: 1000 });
      const normal1 = makeConv({ extra: {}, modifyTime: 5000 });
      const normal2 = makeConv({ extra: {}, modifyTime: 3000 });

      const result = sortSameAgent([normal1, pinned, normal2]);

      expect(result[0].id).toBe(pinned.id);
      expect(result[1].id).toBe(normal1.id);
      expect(result[2].id).toBe(normal2.id);
    });

    it('should place all pinned conversations before all non-pinned', () => {
      const pinned1 = makeConv({ extra: { historyPinned: true }, modifyTime: 2000 });
      const pinned2 = makeConv({ extra: { historyPinned: true }, modifyTime: 4000 });
      const normal = makeConv({ extra: {}, modifyTime: 9000 });

      const result = sortSameAgent([normal, pinned1, pinned2]);

      expect(result[0].id).toBe(pinned2.id);
      expect(result[1].id).toBe(pinned1.id);
      expect(result[2].id).toBe(normal.id);
    });
  });

  describe('sorting among multiple pinned conversations', () => {
    it('should sort pinned conversations by modifyTime descending', () => {
      const pinA = makeConv({ extra: { historyPinned: true }, modifyTime: 1000 });
      const pinB = makeConv({ extra: { historyPinned: true }, modifyTime: 5000 });
      const pinC = makeConv({ extra: { historyPinned: true }, modifyTime: 3000 });

      const result = sortSameAgent([pinA, pinB, pinC]);

      expect(result[0].id).toBe(pinB.id); // 5000
      expect(result[1].id).toBe(pinC.id); // 3000
      expect(result[2].id).toBe(pinA.id); // 1000
    });

    it('should handle pinned conversations with equal modifyTime stably', () => {
      const pinA = makeConv({ extra: { historyPinned: true }, modifyTime: 2000 });
      const pinB = makeConv({ extra: { historyPinned: true }, modifyTime: 2000 });

      const result = sortSameAgent([pinA, pinB]);
      // Both have same modifyTime, sort is stable so original order preserved
      expect(result).toHaveLength(2);
      expect(result.every((c) => isHistoryPinned(c))).toBe(true);
    });
  });

  describe('sorting among non-pinned conversations', () => {
    it('should sort non-pinned conversations by modifyTime descending', () => {
      const a = makeConv({ modifyTime: 1000 });
      const b = makeConv({ modifyTime: 5000 });
      const c = makeConv({ modifyTime: 3000 });

      const result = sortSameAgent([a, b, c]);

      expect(result[0].id).toBe(b.id); // 5000
      expect(result[1].id).toBe(c.id); // 3000
      expect(result[2].id).toBe(a.id); // 1000
    });
  });

  describe('modifyTime null/undefined boundary', () => {
    it('should treat null modifyTime as 0 (sorts last)', () => {
      const withTime = makeConv({ modifyTime: 1000 });
      const nullTime = makeConv({ modifyTime: null as unknown as number });

      const result = sortSameAgent([nullTime, withTime]);

      expect(result[0].id).toBe(withTime.id);
      expect(result[1].id).toBe(nullTime.id);
    });

    it('should treat undefined modifyTime as 0 (sorts last)', () => {
      const withTime = makeConv({ modifyTime: 500 });
      const undefinedTime = makeConv({});
      // Remove modifyTime to simulate undefined
      delete (undefinedTime as Record<string, unknown>).modifyTime;

      const result = sortSameAgent([undefinedTime, withTime]);

      expect(result[0].id).toBe(withTime.id);
      expect(result[1].id).toBe(undefinedTime.id);
    });

    it('should handle two conversations both with null modifyTime', () => {
      const a = makeConv({ modifyTime: null as unknown as number });
      const b = makeConv({ modifyTime: null as unknown as number });

      const result = sortSameAgent([a, b]);
      // Both treated as 0, stable sort preserves order
      expect(result).toHaveLength(2);
    });

    it('should sort pinned with null modifyTime before non-pinned with high modifyTime', () => {
      const pinnedNull = makeConv({
        extra: { historyPinned: true },
        modifyTime: null as unknown as number,
      });
      const normalHigh = makeConv({ modifyTime: 99999 });

      const result = sortSameAgent([normalHigh, pinnedNull]);

      expect(result[0].id).toBe(pinnedNull.id);
      expect(result[1].id).toBe(normalHigh.id);
    });
  });

  describe('empty and single-element inputs', () => {
    it('should return empty array for empty input', () => {
      expect(sortSameAgent([])).toEqual([]);
    });

    it('should return single element unchanged', () => {
      const single = makeConv({ modifyTime: 5000 });
      const result = sortSameAgent([single]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(single.id);
    });
  });

  describe('mixed scenario', () => {
    it('should correctly order a mix of pinned, non-pinned, and null modifyTime', () => {
      const pinnedRecent = makeConv({ extra: { historyPinned: true }, modifyTime: 8000 });
      const pinnedOld = makeConv({ extra: { historyPinned: true }, modifyTime: 2000 });
      const normalRecent = makeConv({ modifyTime: 9000 });
      const normalOld = makeConv({ modifyTime: 1000 });
      const normalNull = makeConv({ modifyTime: null as unknown as number });

      const result = sortSameAgent([normalNull, normalOld, pinnedOld, normalRecent, pinnedRecent]);

      // Pinned first (by modifyTime desc): pinnedRecent(8000), pinnedOld(2000)
      expect(result[0].id).toBe(pinnedRecent.id);
      expect(result[1].id).toBe(pinnedOld.id);
      // Then non-pinned (by modifyTime desc): normalRecent(9000), normalOld(1000), normalNull(0)
      expect(result[2].id).toBe(normalRecent.id);
      expect(result[3].id).toBe(normalOld.id);
      expect(result[4].id).toBe(normalNull.id);
    });
  });
});
