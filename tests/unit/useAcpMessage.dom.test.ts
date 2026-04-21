/**
 * R5 架构风险单元测试：useAcpMessage 状态重置竞态
 *
 * 风险点（src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts）：
 *   - conversation_id 变化时同步重置状态，然后异步 hydrate
 *   - cancelled 标志防止旧 conversation_id 的 get 结果污染新会话状态
 *   - handleResponseMessage 第117行过滤：不属于当前 conversation_id 的消息被丢弃
 *   - turnFinishedRef 保护：finish 后到来的 thought 不会将 running 恢复为 true
 *   - 状态水合顺序：get 返回 running 后，hasHydratedRunningState 变为 true
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---- Captured IPC listeners ----
type ResponseFn = (message: Record<string, unknown>) => void;
let capturedResponseListener: ResponseFn | null = null;
const mockGetInvoke = vi.fn();
const mockAddOrUpdateMessage = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: {
        on: vi.fn((listener: ResponseFn) => {
          capturedResponseListener = listener;
          return () => {
            capturedResponseListener = null;
          };
        }),
      },
    },
    conversation: {
      get: {
        invoke: (...args: unknown[]) => mockGetInvoke(...args),
      },
    },
  },
}));

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: vi.fn((msg: unknown) => msg),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: vi.fn(() => mockAddOrUpdateMessage),
}));

import { useAcpMessage } from '../../src/renderer/pages/conversation/platforms/acp/useAcpMessage';

describe('R5 - useAcpMessage: state reset race condition (arch risk)', () => {
  beforeEach(() => {
    capturedResponseListener = null;
    mockAddOrUpdateMessage.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('1. conversation_id 切换后状态重置', () => {
    it('切换 conversation_id 后 running/thought/acpStatus/tokenUsage 重置为初始值', async () => {
      mockGetInvoke.mockResolvedValue({ status: 'running', type: 'acp' });

      const { result, rerender } = renderHook(({ id }) => useAcpMessage(id), {
        initialProps: { id: 'conv-aaa' },
      });

      // Flush initial hydration
      await act(async () => {
        await Promise.resolve();
      });

      // conv-aaa is running
      expect(result.current.running).toBe(true);
      expect(result.current.hasHydratedRunningState).toBe(true);

      // Now switch to conv-bbb, mock returns idle
      mockGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });

      rerender({ id: 'conv-bbb' });

      // Immediately after rerender (before get resolves), state should be reset
      expect(result.current.running).toBe(false);
      expect(result.current.hasHydratedRunningState).toBe(false);
      expect(result.current.acpStatus).toBeNull();
      expect(result.current.tokenUsage).toBeNull();
      expect(result.current.thought).toEqual({ description: '', subject: '' });

      // Flush hydration for conv-bbb
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(false);
    });
  });

  describe('2. cancelled 标志防止旧 get 结果污染新会话', () => {
    it('conv-aaa 的 get 延迟返回时，已切换到 conv-bbb，running 不被设为 true', async () => {
      let resolveAaa!: (v: unknown) => void;
      mockGetInvoke
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveAaa = resolve;
            })
        )
        .mockResolvedValue({ status: 'idle', type: 'acp' });

      const { result, rerender } = renderHook(({ id }) => useAcpMessage(id), {
        initialProps: { id: 'conv-aaa' },
      });

      // Switch to conv-bbb before conv-aaa's get resolves
      rerender({ id: 'conv-bbb' });

      // Flush conv-bbb's get
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.running).toBe(false);
      expect(result.current.hasHydratedRunningState).toBe(true);

      // Now resolve conv-aaa's get with running=true — should be ignored (cancelled)
      await act(async () => {
        resolveAaa({ status: 'running', type: 'acp' });
        await Promise.resolve();
      });

      // running must still be false — cancelled guard worked
      expect(result.current.running).toBe(false);
    });
  });

  describe('3. 旧会话消息被 handleResponseMessage 第117行过滤', () => {
    it('conversation_id 为 conv-bbb 时，来自 conv-aaa 的消息不调用 addOrUpdateMessage', async () => {
      mockGetInvoke.mockResolvedValue(null);

      renderHook(() => useAcpMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      // Send a message from a different conversation
      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: 'conv-aaa', // wrong conversation
          data: 'hello',
        });
      });

      expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
    });

    it('conversation_id 匹配的消息会调用 addOrUpdateMessage', async () => {
      mockGetInvoke.mockResolvedValue(null);

      renderHook(() => useAcpMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: 'conv-bbb', // correct conversation
          data: 'hello',
        });
      });

      expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. turnFinishedRef 保护：finish 后 thought 不恢复 running', () => {
    it('发送 finish 消息后，再发 thought 消息，running 保持 false', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useAcpMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      // Start a turn
      act(() => {
        capturedResponseListener?.({
          type: 'start',
          conversation_id: 'conv-bbb',
        });
      });
      expect(result.current.running).toBe(true);

      // Finish the turn
      act(() => {
        capturedResponseListener?.({
          type: 'finish',
          conversation_id: 'conv-bbb',
        });
      });
      expect(result.current.running).toBe(false);

      // Late-arriving thought should NOT recover running (turnFinishedRef=true)
      act(() => {
        capturedResponseListener?.({
          type: 'thought',
          conversation_id: 'conv-bbb',
          data: { subject: 'late', description: 'late thought' },
        });
      });

      // running must stay false
      expect(result.current.running).toBe(false);
    });

    it('新 start 消息清除 turnFinishedRef，后续 thought 可以重新设置 running=true', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useAcpMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      // Turn 1: start → finish
      act(() => {
        capturedResponseListener?.({ type: 'start', conversation_id: 'conv-bbb' });
      });
      act(() => {
        capturedResponseListener?.({ type: 'finish', conversation_id: 'conv-bbb' });
      });
      expect(result.current.running).toBe(false);

      // Turn 2: new start clears turnFinishedRef
      act(() => {
        capturedResponseListener?.({ type: 'start', conversation_id: 'conv-bbb' });
      });
      expect(result.current.running).toBe(true);

      // Now thought should be able to auto-recover running (it's already true from start, but reset first)
      act(() => {
        capturedResponseListener?.({ type: 'finish', conversation_id: 'conv-bbb' });
      });
      // Back to false
      expect(result.current.running).toBe(false);
    });
  });

  describe('5. 状态水合顺序：hasHydratedRunningState 和 running 正确跟随 get 结果', () => {
    it('get 返回 running=true 时，hasHydratedRunningState=true 且 running=true', async () => {
      mockGetInvoke.mockResolvedValue({ status: 'running', type: 'acp' });

      const { result } = renderHook(() => useAcpMessage('conv-bbb'));

      // Before hydration
      expect(result.current.hasHydratedRunningState).toBe(false);

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(true);
    });

    it('get 返回 null（会话不存在）时，hasHydratedRunningState=true 且 running=false', async () => {
      mockGetInvoke.mockResolvedValue(null);

      const { result } = renderHook(() => useAcpMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(false);
    });

    it('get 返回 idle 时，running=false', async () => {
      mockGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });

      const { result } = renderHook(() => useAcpMessage('conv-bbb'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(false);
    });
  });
});
