/**
 * White-box unit tests for useGroupChatMessages hook.
 * Test IDs: HK-MSG-001 through HK-MSG-015 + edge/adversarial cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetConversationMessagesInvoke = vi.fn().mockResolvedValue([]);
let responseStreamCallback: ((message: Record<string, unknown>) => void) | null = null;
const mockResponseStreamUnsub = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessages: {
        invoke: (...args: unknown[]) => mockGetConversationMessagesInvoke(...args),
      },
    },
    conversation: {
      responseStream: {
        on: (cb: (message: Record<string, unknown>) => void) => {
          responseStreamCallback = cb;
          return mockResponseStreamUnsub;
        },
      },
    },
  },
}));

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

import { useGroupChatMessages } from '../../../src/renderer/pages/conversation/dispatch/hooks/useGroupChatMessages';

// ── Helpers ────────────────────────────────────────────────────────────────

function emitStreamMessage(msg: Record<string, unknown>) {
  act(() => {
    responseStreamCallback?.(msg);
  });
}

function makeDbMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    position: 'right',
    type: 'text',
    content: { content: 'hello' },
    createdAt: 1000,
    ...overrides,
  };
}

function makeDispatchEvent(overrides: Record<string, unknown> = {}) {
  return {
    sourceSessionId: 'child-1',
    sourceRole: 'child',
    displayName: 'Agent A',
    content: 'Working on it',
    messageType: 'task_started',
    timestamp: Date.now(),
    childTaskId: 'task-1',
    avatar: '🤖',
    ...overrides,
  };
}

/** Render hook and wait for initial load to complete */
async function renderAndWaitForLoad(conversationId: string) {
  const hookResult = renderHook(() => useGroupChatMessages(conversationId));
  // Flush the promise from the useEffect DB fetch
  await act(async () => {});
  return hookResult;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useGroupChatMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseStreamCallback = null;
    mockGetConversationMessagesInvoke.mockResolvedValue([]);
  });

  // HK-MSG-001: Initial loading state
  describe('HK-MSG-001: initial state', () => {
    it('starts with isLoading true and empty messages', () => {
      const { result } = renderHook(() => useGroupChatMessages('conv-1'));

      expect(result.current.isLoading).toBe(true);
      expect(result.current.messages).toEqual([]);
    });
  });

  // HK-MSG-002: Loads historical messages from DB
  describe('HK-MSG-002: loads DB messages', () => {
    it('fetches messages for the given conversationId', async () => {
      const dbMsg = makeDbMessage({ id: 'db-1', position: 'right' });
      mockGetConversationMessagesInvoke.mockResolvedValue([dbMsg]);

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(mockGetConversationMessagesInvoke).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.messages.length).toBe(1);
    });

    it('parses user messages (position=right) correctly', async () => {
      const dbMsg = makeDbMessage({ id: 'u-1', position: 'right', content: { content: 'user says hi' } });
      mockGetConversationMessagesInvoke.mockResolvedValue([dbMsg]);

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.messages[0].sourceRole).toBe('user');
      expect(result.current.messages[0].content).toBe('user says hi');
    });
  });

  // HK-MSG-003: Parses dispatcher messages from DB
  describe('HK-MSG-003: dispatcher DB messages', () => {
    it('parses assistant messages (type=text, not position=right)', async () => {
      const dbMsg = makeDbMessage({
        id: 'a-1',
        position: 'left',
        type: 'text',
        content: { content: 'dispatcher reply' },
      });
      mockGetConversationMessagesInvoke.mockResolvedValue([dbMsg]);

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.messages[0].sourceRole).toBe('dispatcher');
      expect(result.current.messages[0].content).toBe('dispatcher reply');
    });

    it('skips non-text messages without content', async () => {
      const dbMsg = makeDbMessage({
        id: 'skip-1',
        position: 'left',
        type: 'image',
        content: { content: '' },
      });
      mockGetConversationMessagesInvoke.mockResolvedValue([dbMsg]);

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.messages.length).toBe(0);
    });
  });

  // HK-MSG-004: Handles empty/null DB response
  describe('HK-MSG-004: empty/null DB response', () => {
    it('handles null response gracefully', async () => {
      mockGetConversationMessagesInvoke.mockResolvedValue(null);

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.isLoading).toBe(false);
      expect(result.current.messages).toEqual([]);
    });

    it('handles non-array response gracefully', async () => {
      mockGetConversationMessagesInvoke.mockResolvedValue('not-an-array');

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.isLoading).toBe(false);
      expect(result.current.messages).toEqual([]);
    });
  });

  // HK-MSG-005: DB fetch error
  describe('HK-MSG-005: DB fetch error', () => {
    it('sets isLoading to false on error', async () => {
      mockGetConversationMessagesInvoke.mockRejectedValue(new Error('DB error'));

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.isLoading).toBe(false);
      expect(result.current.messages).toEqual([]);
    });
  });

  // HK-MSG-006: Subscribe to response stream
  describe('HK-MSG-006: stream subscription', () => {
    it('subscribes to responseStream on mount', async () => {
      await renderAndWaitForLoad('conv-1');

      expect(responseStreamCallback).toBeInstanceOf(Function);
    });

    it('returns unsub function for cleanup', async () => {
      const { unmount } = await renderAndWaitForLoad('conv-1');

      unmount();

      expect(mockResponseStreamUnsub).toHaveBeenCalled();
    });
  });

  // HK-MSG-007: Filters stream by conversation_id
  describe('HK-MSG-007: filters stream by conversation_id', () => {
    it('ignores messages for other conversations', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-OTHER',
        type: 'dispatch_event',
        data: makeDispatchEvent(),
      });

      expect(result.current.messages.length).toBe(0);
    });
  });

  // HK-MSG-008: Handles dispatch_event stream messages
  describe('HK-MSG-008: dispatch_event messages', () => {
    it('appends a new timeline message for task_started', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_started', childTaskId: 'task-1' }),
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].childTaskId).toBe('task-1');
    });

    // OBS-02: Failure case -- partial data object with missing required fields
    it('still appends message with undefined fields when data has partial shape', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: { content: 'partial', messageType: 'task_started' },
      });

      // toTimelineMessage does not validate -- it produces a message with undefined fields
      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].sourceSessionId).toBeUndefined();
    });
  });

  // HK-MSG-009: In-place update for status card (task_progress)
  describe('HK-MSG-009: in-place status card update', () => {
    it('updates existing card for task_progress matching childTaskId', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      // First: task_started
      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_started', childTaskId: 'task-1', content: 'Starting' }),
      });

      const originalId = result.current.messages[0].id;

      // Second: task_progress updates in-place
      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_progress', childTaskId: 'task-1', content: '50% done' }),
      });

      expect(result.current.messages.length).toBe(1);
      // CF-2: task_progress preserves original content and updates progressSummary
      expect(result.current.messages[0].content).toBe('Starting');
      expect(result.current.messages[0].progressSummary).toBe('50% done');
      expect(result.current.messages[0].id).toBe(originalId);
    });
  });

  // HK-MSG-010: In-place update for task_completed
  describe('HK-MSG-010: in-place update for task_completed', () => {
    it('updates existing card for task_completed', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_started', childTaskId: 'task-2' }),
      });

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_completed', childTaskId: 'task-2', content: 'Done!' }),
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Done!');
    });
  });

  // HK-MSG-011: In-place update for task_failed
  describe('HK-MSG-011: in-place update for task_failed', () => {
    it('updates existing card for task_failed', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_started', childTaskId: 'task-3' }),
      });

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_failed', childTaskId: 'task-3', content: 'Error occurred' }),
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Error occurred');
    });
  });

  // HK-MSG-012: Non-status dispatch event without matching childTaskId appends
  describe('HK-MSG-012: non-matching childTaskId appends new message', () => {
    it('appends when no existing card matches the childTaskId', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: makeDispatchEvent({ messageType: 'task_progress', childTaskId: 'unknown-task' }),
      });

      expect(result.current.messages.length).toBe(1);
    });
  });

  // HK-MSG-013: Handles text stream messages (dispatcher responses)
  describe('HK-MSG-013: text stream messages', () => {
    it('appends dispatcher text messages from stream', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'text',
        msg_id: 'text-1',
        data: { content: 'Hello from dispatcher' },
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].sourceRole).toBe('dispatcher');
      expect(result.current.messages[0].content).toBe('Hello from dispatcher');
    });

    it('handles string data in text messages', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'text',
        msg_id: 'text-2',
        data: 'raw string content',
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('raw string content');
    });
  });

  // HK-MSG-014: Ignores text messages with empty content
  describe('HK-MSG-014: ignores empty text messages', () => {
    it('does not append when content is empty string', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'text',
        msg_id: 'empty-1',
        data: { content: '' },
      });

      expect(result.current.messages.length).toBe(0);
    });
  });

  // HK-MSG-015: ConversationId change resets state
  describe('HK-MSG-015: conversationId change resets state', () => {
    it('resets messages and re-fetches when conversationId changes', async () => {
      const dbMsgA = makeDbMessage({ id: 'a-msg', position: 'right', content: { content: 'msg A' } });
      const dbMsgB = makeDbMessage({ id: 'b-msg', position: 'right', content: { content: 'msg B' } });

      mockGetConversationMessagesInvoke.mockResolvedValueOnce([dbMsgA]).mockResolvedValueOnce([dbMsgB]);

      let convId = 'conv-1';
      const { result, rerender } = renderHook(() => useGroupChatMessages(convId));

      await act(async () => {});

      expect(result.current.messages[0].content).toBe('msg A');

      convId = 'conv-2';
      rerender();

      await act(async () => {});

      expect(result.current.messages[0].content).toBe('msg B');
    });

    // ISSUE-03: Verify old subscription is unsubscribed before new one
    it('unsubscribes old stream subscription when conversationId changes', async () => {
      let convId = 'conv-1';
      const { rerender } = renderHook(() => useGroupChatMessages(convId));

      await act(async () => {});

      convId = 'conv-2';
      rerender();

      await act(async () => {});

      expect(mockResponseStreamUnsub).toHaveBeenCalledTimes(1);
    });
  });

  // Edge: malformed dispatch_event does not crash
  describe('Edge: malformed dispatch_event', () => {
    it('silently skips malformed dispatch_event data', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      // Send a dispatch_event with null data
      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'dispatch_event',
        data: null,
      });

      // Should not crash; messages remain empty
      expect(result.current.messages.length).toBe(0);
    });
  });

  // Edge: DB message with missing id uses fallback
  describe('Edge: DB message missing id uses index fallback', () => {
    it('generates a fallback id from index', async () => {
      const dbMsg = makeDbMessage({ id: undefined, position: 'right', content: { content: 'no-id' } });
      mockGetConversationMessagesInvoke.mockResolvedValue([dbMsg]);

      const { result } = await renderAndWaitForLoad('conv-1');

      expect(result.current.messages[0].id).toBe('db-0');
    });
  });

  // Edge: DB message with non-object content returns empty string
  describe('Edge: DB message with primitive content', () => {
    it('extracts empty content from primitive content field', async () => {
      const dbMsg = makeDbMessage({ id: 'prim-1', position: 'right', content: 'just a string' });
      mockGetConversationMessagesInvoke.mockResolvedValue([dbMsg]);

      const { result } = await renderAndWaitForLoad('conv-1');

      // parseDbMessage returns '' for non-object content; user messages still get created
      expect(result.current.messages[0].content).toBe('');
    });
  });

  // Adversarial: unknown stream type is ignored
  describe('Adversarial: unknown stream type', () => {
    it('does not add messages for unknown types', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      emitStreamMessage({
        conversation_id: 'conv-1',
        type: 'some_unknown_type',
        data: { content: 'ignored' },
      });

      expect(result.current.messages.length).toBe(0);
    });
  });

  // Adversarial: multiple rapid dispatch events
  describe('Adversarial: rapid sequential events', () => {
    it('handles multiple rapid dispatch events without data loss', async () => {
      const { result } = await renderAndWaitForLoad('conv-1');

      for (let i = 0; i < 5; i++) {
        emitStreamMessage({
          conversation_id: 'conv-1',
          type: 'dispatch_event',
          data: makeDispatchEvent({ messageType: 'task_started', childTaskId: `task-${i}` }),
        });
      }

      expect(result.current.messages.length).toBe(5);
    });
  });

  // ISSUE-08 / ARCH-C-005: stale t() closure -- known limitation
  describe.skip('ARCH-C-005: stale t() closure', () => {
    it('TODO: stream text messages use stale t() if language changes mid-session', () => {
      // The t function is captured in the responseStream effect callback (line 153)
      // but t is not in the effect dependency array (line 163).
      // If the user switches language mid-session, new stream messages will still
      // use the old t() function for displayName translation.
    });
  });
});
