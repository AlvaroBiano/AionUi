/**
 * R1 单元测试：useWorkspaceEvents IPC 流 conversation_id 过滤
 *
 * 代码（src/renderer/pages/conversation/Workspace/hooks/useWorkspaceEvents.ts）
 * 三个 handler 检查 data.type 且过滤 data.conversation_id。
 * 本组测试：
 *   1. 不属于当前会话的消息不触发 throttledRefresh
 *   2. 确认正确行为（非 tool 类型消息不触发刷新）
 *   3. 验证 throttle 窗口内最多调用 2 次 refreshWorkspace
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---- Captured IPC listeners ----
type AnyFn = (data: Record<string, unknown>) => void;
const capturedListeners: {
  gemini: AnyFn | null;
  acp: AnyFn | null;
  codex: AnyFn | null;
} = { gemini: null, acp: null, codex: null };

vi.mock('@/common', () => ({
  ipcBridge: {
    geminiConversation: {
      responseStream: {
        on: vi.fn((listener: AnyFn) => {
          capturedListeners.gemini = listener;
          return () => {
            capturedListeners.gemini = null;
          };
        }),
      },
    },
    acpConversation: {
      responseStream: {
        on: vi.fn((listener: AnyFn) => {
          capturedListeners.acp = listener;
          return () => {
            capturedListeners.acp = null;
          };
        }),
      },
    },
    codexConversation: {
      responseStream: {
        on: vi.fn((listener: AnyFn) => {
          capturedListeners.codex = listener;
          return () => {
            capturedListeners.codex = null;
          };
        }),
      },
    },
    conversation: {
      responseSearchWorkSpace: {
        provider: vi.fn(() => vi.fn()),
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

// Import after vi.mock so hoisting works
import { useWorkspaceEvents } from '../../src/renderer/pages/conversation/Workspace/hooks/useWorkspaceEvents';

/** Helper to build a minimal UseWorkspaceEventsOptions */
function makeOptions(overrides: Partial<Parameters<typeof useWorkspaceEvents>[0]> = {}) {
  return {
    conversation_id: 'conv-bbb',
    eventPrefix: 'acp' as const,
    refreshWorkspace: vi.fn(),
    clearSelection: vi.fn(),
    setFiles: vi.fn(),
    setSelected: vi.fn(),
    setExpandedKeys: vi.fn(),
    setTreeKey: vi.fn(),
    selectedNodeRef: { current: null },
    selectedKeysRef: { current: [] as string[] },
    closeContextMenu: vi.fn(),
    setContextMenu: vi.fn(),
    closeRenameModal: vi.fn(),
    closeDeleteModal: vi.fn(),
    ...overrides,
  };
}

describe('R1 - useWorkspaceEvents: IPC stream lacks conversation_id filter (arch risk)', () => {
  beforeEach(() => {
    capturedListeners.gemini = null;
    capturedListeners.acp = null;
    capturedListeners.codex = null;
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acp_tool_call from a different conversation_id does NOT trigger refreshWorkspace', async () => {
    const options = makeOptions({ conversation_id: 'conv-bbb' });
    renderHook(() => useWorkspaceEvents(options));

    // Flush initial useEffect (conversation_id change → refreshWorkspace() + emit)
    await act(async () => {
      await Promise.resolve();
    });

    // Reset call count from initial mount effects
    (options.refreshWorkspace as ReturnType<typeof vi.fn>).mockClear();

    // Simulate: message from a DIFFERENT conversation (conv-aaa) with matching type
    act(() => {
      capturedListeners.acp?.({
        type: 'acp_tool_call',
        conversation_id: 'conv-aaa', // different from hook's conv-bbb
      });
    });

    // FIXED: conversation_id filter now prevents cross-conversation refresh
    expect(options.refreshWorkspace).not.toHaveBeenCalled();
  });

  it('non-tool message type does NOT trigger refreshWorkspace regardless of conversation_id', async () => {
    const options = makeOptions({ conversation_id: 'conv-bbb' });
    renderHook(() => useWorkspaceEvents(options));

    await act(async () => {
      await Promise.resolve();
    });
    (options.refreshWorkspace as ReturnType<typeof vi.fn>).mockClear();

    // Send a 'content' type message (not a tool call)
    act(() => {
      capturedListeners.acp?.({
        type: 'content',
        conversation_id: 'conv-aaa',
      });
    });

    expect(options.refreshWorkspace).not.toHaveBeenCalled();
  });

  it('message with matching conversation_id and tool type triggers refreshWorkspace', async () => {
    const options = makeOptions({ conversation_id: 'conv-bbb' });
    renderHook(() => useWorkspaceEvents(options));

    await act(async () => {
      await Promise.resolve();
    });
    (options.refreshWorkspace as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      capturedListeners.acp?.({
        type: 'acp_tool_call',
        conversation_id: 'conv-bbb', // same conversation
      });
    });

    expect(options.refreshWorkspace).toHaveBeenCalledTimes(1);
  });

  it('throttle: 5 rapid acp_tool_call messages produce at most 2 refreshWorkspace calls within 2000ms window', async () => {
    const options = makeOptions({ conversation_id: 'conv-bbb' });
    renderHook(() => useWorkspaceEvents(options));

    await act(async () => {
      await Promise.resolve();
    });
    (options.refreshWorkspace as ReturnType<typeof vi.fn>).mockClear();

    // Fire 5 rapid messages
    act(() => {
      for (let i = 0; i < 5; i++) {
        capturedListeners.acp?.({
          type: 'acp_tool_call',
          conversation_id: 'conv-bbb',
        });
      }
    });

    // After first call: 1 immediate refresh, pendingRef = true for calls 2-5
    expect(options.refreshWorkspace).toHaveBeenCalledTimes(1);

    // Advance timer past the 2000ms throttle window — trailing refresh fires
    act(() => {
      vi.advanceTimersByTime(2100);
    });

    // At most 2 calls: 1 immediate + 1 trailing
    expect(options.refreshWorkspace).toHaveBeenCalledTimes(2);
  });

  it('gemini tool_group message from different conversation does NOT trigger refresh (gemini stream)', async () => {
    const options = makeOptions({ conversation_id: 'conv-bbb' });
    renderHook(() => useWorkspaceEvents(options));

    await act(async () => {
      await Promise.resolve();
    });
    (options.refreshWorkspace as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      capturedListeners.gemini?.({
        type: 'tool_group',
        conversation_id: 'conv-aaa', // different conversation
      });
    });

    // FIXED: gemini stream now also filters by conversation_id
    expect(options.refreshWorkspace).not.toHaveBeenCalled();
  });

  it('codex tool_call message from different conversation does NOT trigger refresh (codex stream)', async () => {
    const options = makeOptions({ conversation_id: 'conv-bbb' });
    renderHook(() => useWorkspaceEvents(options));

    await act(async () => {
      await Promise.resolve();
    });
    (options.refreshWorkspace as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      capturedListeners.codex?.({
        type: 'codex_tool_call',
        conversation_id: 'conv-aaa',
      });
    });

    // FIXED: codex stream now also filters by conversation_id
    expect(options.refreshWorkspace).not.toHaveBeenCalled();
  });
});
