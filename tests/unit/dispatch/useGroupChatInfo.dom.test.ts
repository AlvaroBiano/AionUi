/**
 * White-box unit tests for useGroupChatInfo hook.
 * Test IDs: HK-INFO-001 through HK-INFO-006.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetGroupChatInfoInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      getGroupChatInfo: {
        invoke: (...args: unknown[]) => mockGetGroupChatInfoInvoke(...args),
      },
    },
  },
}));

import { useGroupChatInfo } from '../../../src/renderer/pages/conversation/dispatch/hooks/useGroupChatInfo';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSuccessResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      dispatcherId: 'disp-1',
      dispatcherName: 'My Group',
      children: [
        {
          sessionId: 'child-1',
          title: 'Task A',
          status: 'running',
          teammateName: 'Agent A',
          teammateAvatar: '🤖',
          createdAt: 1000,
          lastActivityAt: 2000,
        },
      ],
      pendingNotificationCount: 3,
      ...overrides,
    },
  };
}

/** Render hook and wait for initial fetch to settle */
async function renderAndWaitForLoad(conversationId: string) {
  const hookResult = renderHook(() => useGroupChatInfo(conversationId));
  await act(async () => {});
  return hookResult;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useGroupChatInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGroupChatInfoInvoke.mockResolvedValue(makeSuccessResponse());
  });

  // HK-INFO-001: Initial loading state
  describe('HK-INFO-001: initial loading state', () => {
    it('starts with isLoading true and info null', () => {
      const { result } = renderHook(() => useGroupChatInfo('conv-1'));

      expect(result.current.isLoading).toBe(true);
      expect(result.current.info).toBeNull();
    });
  });

  // HK-INFO-002: Fetches info on mount
  describe('HK-INFO-002: fetches info on mount', () => {
    it('calls getGroupChatInfo with conversationId and populates info', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      expect(mockGetGroupChatInfoInvoke).toHaveBeenCalledWith({ conversationId: 'conv-1' });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.info?.dispatcherId).toBe('disp-1');
    });

    it('maps children with correct status types', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.info?.children.length).toBe(1);
      expect(result.current.info?.children[0].status).toBe('running');
    });
  });

  // HK-INFO-003: Handles API failure
  describe('HK-INFO-003: handles API failure', () => {
    it('sets isLoading false and keeps info null on error', async () => {
      mockGetGroupChatInfoInvoke.mockRejectedValue(new Error('Network error'));

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.isLoading).toBe(false);
      expect(result.current.info).toBeNull();
    });
  });

  // HK-INFO-004: Handles unsuccessful response
  describe('HK-INFO-004: handles unsuccessful response', () => {
    it('does not set info when response.success is false', async () => {
      mockGetGroupChatInfoInvoke.mockResolvedValue({ success: false, msg: 'Not found' });

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.isLoading).toBe(false);
      expect(result.current.info).toBeNull();
    });
  });

  // HK-INFO-005: Refresh callback re-fetches data
  describe('HK-INFO-005: refresh callback', () => {
    it('provides a refresh function that re-fetches info', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      // First call is from mount
      expect(mockGetGroupChatInfoInvoke).toHaveBeenCalledTimes(1);
      expect(result.current.info?.dispatcherName).toBe('My Group');

      // Update response for second fetch
      mockGetGroupChatInfoInvoke.mockResolvedValue(
        makeSuccessResponse({ dispatcherName: 'Updated Group', pendingNotificationCount: 5 })
      );

      await act(async () => {
        result.current.refresh();
      });

      // Flush the refresh promise
      await act(async () => {});

      expect(mockGetGroupChatInfoInvoke).toHaveBeenCalledTimes(2);
      expect(result.current.info?.dispatcherName).toBe('Updated Group');
    });

    // ISSUE-01: Stale data retained when refresh returns unsuccessful response
    it('retains previous info when refresh fails with unsuccessful response', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');
      expect(result.current.info).not.toBeNull();

      mockGetGroupChatInfoInvoke.mockResolvedValue({ success: false, msg: 'Error' });
      await act(async () => {
        result.current.refresh();
      });
      await act(async () => {});

      // Source does NOT clear info on failure -- stale data is retained
      expect(result.current.info?.dispatcherId).toBe('disp-1');
    });

    // ISSUE-02: Stale data retained when refresh rejects
    it('retains previous info when refresh throws an error', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');
      expect(result.current.info).not.toBeNull();

      mockGetGroupChatInfoInvoke.mockRejectedValue(new Error('Network failure'));
      await act(async () => {
        result.current.refresh();
      });
      await act(async () => {});

      // Source catch block only clears isLoading, info remains stale
      expect(result.current.info?.dispatcherId).toBe('disp-1');
    });
  });

  // HK-INFO-006: ConversationId change triggers re-fetch
  describe('HK-INFO-006: conversationId change triggers re-fetch', () => {
    it('re-fetches when conversationId changes', async () => {
      let convId = 'conv-1';
      const { result, rerender } = renderHook(() => useGroupChatInfo(convId));

      await act(async () => {});

      expect(result.current.info?.dispatcherId).toBe('disp-1');

      mockGetGroupChatInfoInvoke.mockResolvedValue(
        makeSuccessResponse({ dispatcherId: 'disp-2', dispatcherName: 'Group 2' })
      );

      convId = 'conv-2';
      rerender();

      await act(async () => {});

      expect(mockGetGroupChatInfoInvoke).toHaveBeenCalledWith({ conversationId: 'conv-2' });
      expect(result.current.info?.dispatcherId).toBe('disp-2');
    });
  });
});
