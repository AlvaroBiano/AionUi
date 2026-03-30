/**
 * White-box unit tests for useChildTaskDetail hook.
 * Test IDs: HK-CHILD-001 through HK-CHILD-006.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetChildTranscriptInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      getChildTranscript: {
        invoke: (...args: unknown[]) => mockGetChildTranscriptInvoke(...args),
      },
    },
  },
}));

import { useChildTaskDetail } from '../../../src/renderer/pages/conversation/dispatch/hooks/useChildTaskDetail';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTranscriptResponse(messages: Array<{ role: string; content: string; timestamp: number }> = []) {
  return {
    success: true,
    data: { messages },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useChildTaskDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChildTranscriptInvoke.mockResolvedValue(
      makeTranscriptResponse([{ role: 'user', content: 'hello', timestamp: 1000 }])
    );
  });

  // HK-CHILD-001: Initial state
  describe('HK-CHILD-001: initial state', () => {
    it('returns empty transcript and no loading state initially', () => {
      const { result } = renderHook(() => useChildTaskDetail());

      expect(result.current.getTranscript('child-1')).toBeUndefined();
      expect(result.current.isTranscriptLoading('child-1')).toBe(false);
    });
  });

  // HK-CHILD-002: loadTranscript fetches and stores transcript
  describe('HK-CHILD-002: loadTranscript fetches data', () => {
    it('fetches transcript and makes it available via getTranscript', async () => {
      const { result } = renderHook(() => useChildTaskDetail());

      await act(async () => {
        result.current.loadTranscript('child-1');
      });

      // Flush the promise chain
      await act(async () => {});

      expect(mockGetChildTranscriptInvoke).toHaveBeenCalledWith({ childSessionId: 'child-1', limit: 50 });

      const transcript = result.current.getTranscript('child-1');
      expect(transcript).toBeDefined();
      expect(transcript?.length).toBe(1);
    });
  });

  // HK-CHILD-003: loadTranscript sets loading state
  describe('HK-CHILD-003: loading state during fetch', () => {
    it('sets isTranscriptLoading true while fetching', async () => {
      let resolvePromise: (value: unknown) => void = () => {};
      mockGetChildTranscriptInvoke.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { result } = renderHook(() => useChildTaskDetail());

      act(() => {
        result.current.loadTranscript('child-1');
      });

      expect(result.current.isTranscriptLoading('child-1')).toBe(true);

      await act(async () => {
        resolvePromise(makeTranscriptResponse());
      });

      expect(result.current.isTranscriptLoading('child-1')).toBe(false);
    });
  });

  // HK-CHILD-004: Skips fetch if already cached
  describe('HK-CHILD-004: skips fetch if already cached', () => {
    it('does not re-fetch for an already loaded childSessionId', async () => {
      const { result } = renderHook(() => useChildTaskDetail());

      await act(async () => {
        result.current.loadTranscript('child-1');
      });

      await act(async () => {});

      expect(mockGetChildTranscriptInvoke).toHaveBeenCalledTimes(1);

      // Second call should be a no-op
      act(() => {
        result.current.loadTranscript('child-1');
      });

      expect(mockGetChildTranscriptInvoke).toHaveBeenCalledTimes(1);
    });
  });

  // HK-CHILD-005: Handles fetch failure
  describe('HK-CHILD-005: handles fetch failure', () => {
    it('clears loading state on failure and transcript remains undefined', async () => {
      mockGetChildTranscriptInvoke.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useChildTaskDetail());

      await act(async () => {
        result.current.loadTranscript('child-fail');
      });

      await act(async () => {});

      expect(result.current.isTranscriptLoading('child-fail')).toBe(false);
      expect(result.current.getTranscript('child-fail')).toBeUndefined();
    });

    // OBS-03: Retry after .catch() should succeed since transcriptsRef is not updated
    it('allows retry after a rejected fetch succeeds on second attempt', async () => {
      mockGetChildTranscriptInvoke.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useChildTaskDetail());

      await act(async () => {
        result.current.loadTranscript('child-retry');
      });
      await act(async () => {});

      expect(result.current.getTranscript('child-retry')).toBeUndefined();

      // Retry should work because transcriptsRef was never set
      mockGetChildTranscriptInvoke.mockResolvedValueOnce(
        makeTranscriptResponse([{ role: 'user', content: 'retried', timestamp: 5000 }])
      );
      await act(async () => {
        result.current.loadTranscript('child-retry');
      });
      await act(async () => {});

      expect(result.current.getTranscript('child-retry')?.length).toBe(1);
    });
  });

  // ISSUE-04 (revised): Handles soft failure (success: false) and allows retry
  describe('HK-CHILD-007: soft failure does not cache, allows retry', () => {
    it('does not cache transcript when response.success is false', async () => {
      mockGetChildTranscriptInvoke.mockResolvedValue({ success: false, msg: 'Not found' });

      const { result } = renderHook(() => useChildTaskDetail());

      await act(async () => {
        result.current.loadTranscript('child-soft-fail');
      });
      await act(async () => {});

      expect(result.current.getTranscript('child-soft-fail')).toBeUndefined();
      expect(result.current.isTranscriptLoading('child-soft-fail')).toBe(false);
    });

    it('allows retry after soft failure succeeds on second attempt', async () => {
      mockGetChildTranscriptInvoke.mockResolvedValueOnce({ success: false, msg: 'Not found' });

      const { result } = renderHook(() => useChildTaskDetail());

      await act(async () => {
        result.current.loadTranscript('child-soft-fail');
      });
      await act(async () => {});

      expect(result.current.getTranscript('child-soft-fail')).toBeUndefined();

      // Retry should work because transcript was not cached
      mockGetChildTranscriptInvoke.mockResolvedValueOnce(
        makeTranscriptResponse([{ role: 'user', content: 'retry', timestamp: 3000 }])
      );
      await act(async () => {
        result.current.loadTranscript('child-soft-fail');
      });
      await act(async () => {});

      expect(result.current.getTranscript('child-soft-fail')?.length).toBe(1);
    });
  });

  // HK-CHILD-006: Multiple children can be loaded independently
  describe('HK-CHILD-006: multiple independent children', () => {
    it('loads transcripts for multiple children independently', async () => {
      mockGetChildTranscriptInvoke
        .mockResolvedValueOnce(makeTranscriptResponse([{ role: 'user', content: 'msg A', timestamp: 1000 }]))
        .mockResolvedValueOnce(makeTranscriptResponse([{ role: 'assistant', content: 'msg B', timestamp: 2000 }]));

      const { result } = renderHook(() => useChildTaskDetail());

      await act(async () => {
        result.current.loadTranscript('child-1');
        result.current.loadTranscript('child-2');
      });

      // Flush all promises
      await act(async () => {});

      expect(result.current.getTranscript('child-1')?.length).toBe(1);
      expect(result.current.getTranscript('child-2')?.length).toBe(1);
      expect(mockGetChildTranscriptInvoke).toHaveBeenCalledTimes(2);
    });
  });
});
