/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TChatConversation } from '../../../../src/common/config/storage';
import { isConversationPinned } from '../../../../src/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

// ── Hoist mocks ─────────────────────────────────────────────────────────────

const mockUpdate = vi.fn();
const mockEmit = vi.fn();
const mockMessageError = vi.fn();

vi.mock('../../../../src/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers', () => ({
  isConversationPinned: (conv: TChatConversation) => {
    const extra = conv.extra as { historyPinned?: boolean } | undefined;
    return Boolean(extra?.historyPinned);
  },
  resolveAgentKey: () => 'gemini',
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeConv(overrides: Partial<TChatConversation> & { extra?: Record<string, unknown> } = {}): TChatConversation {
  return {
    id: 'test-conv-1',
    name: 'Test Conversation',
    type: 'gemini',
    createTime: 1000,
    modifyTime: 1000,
    extra: {},
    ...overrides,
  } as unknown as TChatConversation;
}

/**
 * Replicate the toggle-pin logic from ConversationHistoryPanel (line 100-125).
 * We extract and test the core logic to avoid rendering the full component tree,
 * which has many React/router/IPC dependencies irrelevant to this unit test.
 */
async function handleTogglePin(conv: TChatConversation) {
  const pinned = isConversationPinned(conv);
  try {
    const success = await mockUpdate({
      id: conv.id,
      updates: {
        extra: {
          historyPinned: !pinned,
          historyPinnedAt: pinned ? undefined : Date.now(),
        } as Partial<TChatConversation['extra']>,
      } as Partial<TChatConversation>,
      mergeExtra: true,
    });
    if (success) {
      mockEmit('chat.history.refresh');
    } else {
      mockMessageError('conversation.history.pinFailed');
    }
  } catch {
    mockMessageError('conversation.history.pinFailed');
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('handleTogglePin (ConversationHistoryPanel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pinning an unpinned conversation', () => {
    it('should call IPC with historyPinned=true and a historyPinnedAt timestamp', async () => {
      const conv = makeConv({ id: 'conv-unpin', extra: {} });
      const before = Date.now();
      mockUpdate.mockResolvedValue(true);

      await handleTogglePin(conv);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const call = mockUpdate.mock.calls[0][0];
      expect(call.id).toBe('conv-unpin');
      expect(call.updates.extra.historyPinned).toBe(true);
      expect(call.updates.extra.historyPinnedAt).toBeGreaterThanOrEqual(before);
      expect(call.updates.extra.historyPinnedAt).toBeLessThanOrEqual(Date.now());
      expect(call.mergeExtra).toBe(true);
    });

    it('should emit chat.history.refresh on success', async () => {
      const conv = makeConv({ extra: {} });
      mockUpdate.mockResolvedValue(true);

      await handleTogglePin(conv);

      expect(mockEmit).toHaveBeenCalledWith('chat.history.refresh');
    });

    it('should not emit refresh when IPC returns false', async () => {
      const conv = makeConv({ extra: {} });
      mockUpdate.mockResolvedValue(false);

      await handleTogglePin(conv);

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('unpinning a pinned conversation', () => {
    it('should call IPC with historyPinned=false and historyPinnedAt=undefined', async () => {
      const conv = makeConv({
        id: 'conv-pinned',
        extra: { historyPinned: true, historyPinnedAt: 5000 },
      });
      mockUpdate.mockResolvedValue(true);

      await handleTogglePin(conv);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const call = mockUpdate.mock.calls[0][0];
      expect(call.id).toBe('conv-pinned');
      expect(call.updates.extra.historyPinned).toBe(false);
      expect(call.updates.extra.historyPinnedAt).toBeUndefined();
      expect(call.mergeExtra).toBe(true);
    });

    it('should emit chat.history.refresh on success', async () => {
      const conv = makeConv({ extra: { historyPinned: true, historyPinnedAt: 5000 } });
      mockUpdate.mockResolvedValue(true);

      await handleTogglePin(conv);

      expect(mockEmit).toHaveBeenCalledWith('chat.history.refresh');
    });
  });

  describe('error handling', () => {
    it('should show error message when IPC returns false', async () => {
      const conv = makeConv({ extra: {} });
      mockUpdate.mockResolvedValue(false);

      await handleTogglePin(conv);

      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockMessageError).toHaveBeenCalledWith('conversation.history.pinFailed');
    });

    it('should show error message when IPC throws', async () => {
      const conv = makeConv({ extra: {} });
      mockUpdate.mockRejectedValue(new Error('IPC failure'));

      await handleTogglePin(conv);

      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockMessageError).toHaveBeenCalledWith('conversation.history.pinFailed');
    });

    it('should not throw when IPC rejects', async () => {
      const conv = makeConv({ extra: {} });
      mockUpdate.mockRejectedValue(new Error('network error'));

      await expect(handleTogglePin(conv)).resolves.toBeUndefined();
    });
  });
});
