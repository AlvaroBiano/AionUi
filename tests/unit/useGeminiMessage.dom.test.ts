/**
 * Regression tests for useGeminiMessage hook
 * Covers resetState ref sync (#1354 follow-up) and activeMsgIdRef filtering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Capture IPC listener set up by the hook
let capturedResponseListener: ((message: unknown) => void) | null = null;
const mockGetInvoke = vi.fn().mockResolvedValue(null);

vi.mock('@/common', () => ({
  ipcBridge: {
    geminiConversation: {
      responseStream: {
        on: vi.fn((listener: (message: unknown) => void) => {
          capturedResponseListener = listener;
          return () => {
            capturedResponseListener = null;
          };
        }),
      },
    },
    conversation: {
      get: { invoke: (...args: unknown[]) => mockGetInvoke(...args) },
      update: { invoke: vi.fn().mockResolvedValue(null) },
      stop: { invoke: vi.fn().mockResolvedValue(null) },
    },
    database: {
      getConversationMessages: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: vi.fn((msg: unknown) => msg),
}));

vi.mock('@/renderer/messages/hooks', () => ({
  useAddOrUpdateMessage: vi.fn(() => vi.fn()),
}));

// Mock renderer dependencies required for GeminiSendBox.tsx module to load
vi.mock('@/renderer/hooks/useAgentReadinessCheck', () => ({
  useAgentReadinessCheck: vi.fn(() => ({
    isChecking: false,
    error: null,
    availableAgents: [],
    bestAgent: null,
    progress: 0,
    currentAgent: null,
    performFullCheck: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  })),
}));

vi.mock('@/renderer/hooks/useAutoTitle', () => ({
  useAutoTitle: vi.fn(() => ({ checkAndUpdateTitle: vi.fn() })),
}));

vi.mock('@/renderer/hooks/useLatestRef', () => ({
  useLatestRef: vi.fn((val: unknown) => ({ current: val })),
}));

vi.mock('@/renderer/hooks/useOpenFileSelector', () => ({
  useOpenFileSelector: vi.fn(() => ({ openFileSelector: vi.fn(), onSlashBuiltinCommand: vi.fn() })),
}));

vi.mock('@/renderer/hooks/useSendBoxDraft', () => ({
  getSendBoxDraftHook: vi.fn(() => vi.fn(() => ({ data: null, mutate: vi.fn() }))),
}));

vi.mock('@/renderer/hooks/useSendBoxFiles', () => ({
  createSetUploadFile: vi.fn(() => vi.fn()),
  useSendBoxFiles: vi.fn(() => ({ handleFilesAdded: vi.fn(), clearFiles: vi.fn() })),
}));

vi.mock('@/renderer/hooks/useSlashCommands', () => ({
  useSlashCommands: vi.fn(() => []),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: vi.fn(() => ({ setSendBoxHandler: vi.fn() })),
}));

vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
  MAX_UPLOAD_SIZE_MB: 50,
  FileService: { uploadFile: vi.fn(), isSupportedFile: vi.fn(() => true) },
  isSupportedFile: vi.fn(() => true),
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: { primary: '#000', secondary: '#666' },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/utils/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn((a: unknown) => a),
}));

vi.mock('@/renderer/utils/messageFiles', () => ({
  buildDisplayMessage: vi.fn((msg: unknown) => msg),
  collectSelectedFiles: vi.fn(() => []),
}));

vi.mock('@/renderer/utils/modelContextLimits', () => ({
  getModelContextLimit: vi.fn(() => null),
}));

vi.mock('@/renderer/components/AgentSetupCard', () => ({ default: vi.fn(() => null) }));
vi.mock('@/renderer/components/ContextUsageIndicator', () => ({ default: vi.fn(() => null) }));
vi.mock('@/renderer/components/FilePreview', () => ({ default: vi.fn(() => null) }));
vi.mock('@/renderer/components/HorizontalFileList', () => ({ default: vi.fn(() => null) }));
vi.mock('@/renderer/components/sendbox', () => ({ default: vi.fn(() => null) }));
vi.mock('@/renderer/components/ThoughtDisplay', () => ({ default: vi.fn(() => null) }));
vi.mock('@/renderer/components/AgentModeSelector', () => ({ default: vi.fn(() => null) }));

vi.mock('@arco-design/web-react', () => ({
  Button: vi.fn(() => null),
  Message: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
  Tag: vi.fn(() => null),
}));

vi.mock('@icon-park/react', () => ({
  Plus: vi.fn(() => null),
  Shield: vi.fn(() => null),
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'test-uuid'),
}));

// Import after all vi.mock calls so hoisting takes effect
import { useGeminiMessage } from '../../src/renderer/pages/conversation/platforms/gemini/useGeminiMessage';

const CONVERSATION_ID = 'test-conv-1';

describe('useGeminiMessage', () => {
  beforeEach(() => {
    capturedResponseListener = null;
    mockGetInvoke.mockResolvedValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resetState() resets running state to false', async () => {
    const { result } = renderHook(() => useGeminiMessage(CONVERSATION_ID));

    // Flush initial useEffect (conversation.get.invoke promise)
    await act(async () => {
      await Promise.resolve();
    });

    // Set waitingResponse to true via the exposed setter
    act(() => {
      result.current.setWaitingResponse(true);
    });

    expect(result.current.running).toBe(true);

    // Call resetState — should synchronously clear all running flags
    act(() => {
      result.current.resetState();
    });

    expect(result.current.running).toBe(false);
  });

  it('resetState() clears activeMsgIdRef so thought events from new messages pass through', async () => {
    const { result } = renderHook(() => useGeminiMessage(CONVERSATION_ID));

    await act(async () => {
      await Promise.resolve();
    });

    // Pin activeMsgIdRef to "msg-A"
    act(() => {
      result.current.setActiveMsgId('msg-A');
    });

    // Thought from a different msg_id should be filtered out
    act(() => {
      capturedResponseListener?.({
        type: 'thought',
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-B',
        data: { subject: 'filtered', description: 'should not appear' },
      });
      vi.runAllTimers();
    });

    expect(result.current.thought.subject).toBe('');

    // Reset clears activeMsgIdRef to null
    act(() => {
      result.current.resetState();
    });

    // Same thought event (msg-B) should now pass through
    act(() => {
      capturedResponseListener?.({
        type: 'thought',
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-B',
        data: { subject: 'visible', description: 'should appear' },
      });
      vi.runAllTimers();
    });

    expect(result.current.thought.subject).toBe('visible');
  });

  it('activeMsgIdRef correctly filters stale events after a new request begins', async () => {
    const { result } = renderHook(() => useGeminiMessage(CONVERSATION_ID));

    await act(async () => {
      await Promise.resolve();
    });

    // Simulate: old request → stop → new request lifecycle
    act(() => {
      result.current.setActiveMsgId('msg-old');
    });

    act(() => {
      result.current.resetState();
    });

    // New request starts
    act(() => {
      result.current.setActiveMsgId('msg-new');
    });

    // Thought from new request should pass through
    act(() => {
      capturedResponseListener?.({
        type: 'thought',
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-new',
        data: { subject: 'new-thought', description: 'new request' },
      });
      vi.runAllTimers();
    });

    expect(result.current.thought.subject).toBe('new-thought');

    // Reset thought for the next assertion
    act(() => {
      result.current.setThought({ subject: '', description: '' });
    });

    // Thought from a stale/unrelated msg_id should be filtered
    act(() => {
      capturedResponseListener?.({
        type: 'thought',
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-stale',
        data: { subject: 'stale-thought', description: 'should be filtered' },
      });
      vi.runAllTimers();
    });

    expect(result.current.thought.subject).toBe('');
  });
});

// ---------------------------------------------------------------------------
// R5 架构风险：useGeminiMessage 状态重置竞态
// ---------------------------------------------------------------------------

describe('R5 - useGeminiMessage: state reset race condition (arch risk)', () => {
  beforeEach(() => {
    capturedResponseListener = null;
    mockGetInvoke.mockResolvedValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('1. conversation_id 切换后状态重置', () => {
    it('切换 conversation_id 后 streamRunning/hasActiveTools/waitingResponse 重置', async () => {
      mockGetInvoke.mockResolvedValue({ status: 'running', type: 'gemini' });

      const { result, rerender } = renderHook(({ id }) => useGeminiMessage(id), {
        initialProps: { id: 'conv-aaa' },
      });

      await act(async () => {
        await Promise.resolve();
      });

      // conv-aaa is running
      expect(result.current.running).toBe(true);
      expect(result.current.hasHydratedRunningState).toBe(true);

      // Switch to conv-bbb — mock returns idle
      mockGetInvoke.mockResolvedValue({ status: 'idle', type: 'gemini' });
      rerender({ id: 'conv-bbb' });

      // Immediately after switch: hasHydratedRunningState should reset
      expect(result.current.hasHydratedRunningState).toBe(false);

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.running).toBe(false);
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
  });

  describe('2. cancelled 标志防止旧 get 结果污染新会话', () => {
    it('conv-aaa 的 get 在切换后才 resolve，其 running 结果不影响 conv-bbb 状态', async () => {
      let resolveAaa!: (v: unknown) => void;
      mockGetInvoke
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveAaa = resolve;
            })
        )
        .mockResolvedValue({ status: 'idle', type: 'gemini' });

      const { result, rerender } = renderHook(({ id }) => useGeminiMessage(id), {
        initialProps: { id: 'conv-aaa' },
      });

      rerender({ id: 'conv-bbb' });

      await act(async () => {
        await Promise.resolve();
      });

      // conv-bbb is idle
      expect(result.current.running).toBe(false);
      expect(result.current.hasHydratedRunningState).toBe(true);

      // Late resolve of conv-aaa's get with running=true — must be ignored
      await act(async () => {
        resolveAaa({ status: 'running', type: 'gemini' });
        await Promise.resolve();
      });

      expect(result.current.running).toBe(false);
    });
  });

  describe('3. 旧会话消息被 conversation_id 检查过滤', () => {
    it('conv-aaa 的 content 消息不影响 conv-bbb 的 running 状态', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useGeminiMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.running).toBe(false);

      // Send a content message from a different conversation — should be filtered at line 108
      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: 'conv-aaa', // different conversation
          data: 'content text',
        });
      });

      // If the filter works correctly, running stays false (streamRunning was not set)
      expect(result.current.running).toBe(false);
    });

    it('conv-bbb 自己的 content 消息触发 streamRunning=true', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useGeminiMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: 'conv-bbb', // correct conversation
          data: 'content text',
        });
      });

      // streamRunning=true → running=true
      expect(result.current.running).toBe(true);
    });
  });

  describe('4. tool_group 状态转换', () => {
    it('tool_group with Executing tools sets hasActiveTools via running composite', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useGeminiMessage(CONVERSATION_ID));

      await act(async () => {
        await Promise.resolve();
      });

      // Send tool_group with executing tool
      act(() => {
        capturedResponseListener?.({
          type: 'tool_group',
          conversation_id: CONVERSATION_ID,
          data: [{ status: 'Executing', name: 'read_file' }],
        });
      });

      // running = waitingResponse || streamRunning || hasActiveTools
      // hasActiveTools=true → running=true
      expect(result.current.running).toBe(true);
    });

    it('tool_group with all Done tools transitions hasActiveTools to false and sets waitingResponse', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useGeminiMessage(CONVERSATION_ID));

      await act(async () => {
        await Promise.resolve();
      });

      // First: tools active
      act(() => {
        capturedResponseListener?.({
          type: 'tool_group',
          conversation_id: CONVERSATION_ID,
          data: [{ status: 'Executing', name: 'read_file' }],
        });
      });
      expect(result.current.running).toBe(true);

      // Then: tools done — hasActiveTools=false, waitingResponse=true (wasActive && !hasActive)
      act(() => {
        capturedResponseListener?.({
          type: 'tool_group',
          conversation_id: CONVERSATION_ID,
          data: [{ status: 'Done', name: 'read_file' }],
        });
      });

      // waitingResponse=true keeps running=true until stream finishes
      expect(result.current.running).toBe(true);
    });
  });

  describe('5. activeMsgIdRef 过滤不同 msg_id 的 thought', () => {
    it('设置 activeMsgId 后，不同 msg_id 的 thought 被过滤', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useGeminiMessage(CONVERSATION_ID));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        result.current.setActiveMsgId('msg-active');
      });

      act(() => {
        capturedResponseListener?.({
          type: 'thought',
          conversation_id: CONVERSATION_ID,
          msg_id: 'msg-other',
          data: { subject: 'filtered', description: 'not visible' },
        });
        vi.runAllTimers();
      });

      expect(result.current.thought.subject).toBe('');
    });

    it('相同 msg_id 的 thought 通过过滤', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useGeminiMessage(CONVERSATION_ID));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        result.current.setActiveMsgId('msg-active');
      });

      act(() => {
        capturedResponseListener?.({
          type: 'thought',
          conversation_id: CONVERSATION_ID,
          msg_id: 'msg-active',
          data: { subject: 'visible', description: 'should appear' },
        });
        vi.runAllTimers();
      });

      expect(result.current.thought.subject).toBe('visible');
    });
  });
});
