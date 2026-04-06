import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAcpSendInvoke = vi.fn();
const mockEmitterEmit = vi.fn();

let uuidCounter = 0;

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      sendMessage: {
        invoke: (...args: unknown[]) => mockAcpSendInvoke(...args),
      },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => `acp-init-${++uuidCounter}`),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => mockEmitterEmit(...args),
  },
}));

import { useAcpInitialMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpInitialMessage';

describe('useAcpInitialMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    sessionStorage.clear();
    mockAcpSendInvoke.mockResolvedValue({ success: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the stored ACP initial prompt once and clears the remount guard immediately', async () => {
    const beginPendingFirstResponse = vi.fn();
    const clearPendingFirstResponse = vi.fn();
    const appendAcpUiLog = vi.fn();
    const primeRequestTraceFallback = vi.fn();
    const clearPendingRequestTraceFallback = vi.fn(() => false);
    const checkAndUpdateTitle = vi.fn();

    sessionStorage.setItem(
      'acp_initial_message_conv-ready',
      JSON.stringify({
        input: 'send immediately',
        files: ['C:/workspace/spec.md'],
      })
    );

    const deferredSend = Promise.withResolvers<{ success: boolean }>();
    mockAcpSendInvoke.mockReturnValue(deferredSend.promise);

    const firstMount = renderHook(() =>
      useAcpInitialMessage({
        conversationId: 'conv-ready',
        backend: 'claude',
        agentName: 'Claude Code',
        sessionMode: 'workspace-write',
        beginPendingFirstResponse,
        clearPendingFirstResponse,
        appendAcpUiLog,
        primeRequestTraceFallback,
        clearPendingRequestTraceFallback,
        checkAndUpdateTitle,
      })
    );

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(sessionStorage.getItem('acp_initial_message_conv-ready')).toBeNull();
    expect(beginPendingFirstResponse).toHaveBeenCalledTimes(1);
    expect(primeRequestTraceFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'claude',
        agentName: 'Claude Code',
        sessionMode: 'workspace-write',
        timestamp: expect.any(Number),
      })
    );
    expect(checkAndUpdateTitle).toHaveBeenCalledWith('conv-ready', 'send immediately');
    expect(mockAcpSendInvoke).toHaveBeenCalledWith({
      input: 'send immediately',
      msg_id: 'acp-init-1',
      conversation_id: 'conv-ready',
      files: ['C:/workspace/spec.md'],
    });

    firstMount.unmount();

    renderHook(() =>
      useAcpInitialMessage({
        conversationId: 'conv-ready',
        backend: 'claude',
        agentName: 'Claude Code',
        sessionMode: 'workspace-write',
        beginPendingFirstResponse,
        clearPendingFirstResponse,
        appendAcpUiLog,
        primeRequestTraceFallback,
        clearPendingRequestTraceFallback,
        checkAndUpdateTitle,
      })
    );

    await Promise.resolve();
    expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);

    deferredSend.resolve({ success: true });

    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('chat.history.refresh');
    });

    expect(clearPendingFirstResponse).not.toHaveBeenCalled();
    expect(appendAcpUiLog).not.toHaveBeenCalled();
  });

  it('logs a send failure and clears pending first-response state when the bridge rejects the initial send', async () => {
    const beginPendingFirstResponse = vi.fn();
    const clearPendingFirstResponse = vi.fn();
    const appendAcpUiLog = vi.fn();
    const primeRequestTraceFallback = vi.fn();
    const clearPendingRequestTraceFallback = vi.fn(() => true);
    const checkAndUpdateTitle = vi.fn();

    sessionStorage.setItem(
      'acp_initial_message_conv-send-failed',
      JSON.stringify({
        input: 'failing prompt',
        files: [],
      })
    );

    mockAcpSendInvoke.mockResolvedValue({
      success: false,
      msg: 'Bridge send failed',
    });

    renderHook(() =>
      useAcpInitialMessage({
        conversationId: 'conv-send-failed',
        backend: 'claude',
        agentName: 'Claude Code',
        beginPendingFirstResponse,
        clearPendingFirstResponse,
        appendAcpUiLog,
        primeRequestTraceFallback,
        clearPendingRequestTraceFallback,
        checkAndUpdateTitle,
      })
    );

    await waitFor(() => {
      expect(appendAcpUiLog).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'send_failed',
          level: 'error',
          backend: 'claude',
          agentName: 'Claude Code',
          detail: 'Bridge send failed',
        })
      );
    });

    expect(clearPendingFirstResponse).toHaveBeenCalledTimes(1);
    expect(mockEmitterEmit).not.toHaveBeenCalled();
  });

  it('surfaces malformed initial-message payloads as send failures without hitting ACP send', async () => {
    const beginPendingFirstResponse = vi.fn();
    const clearPendingFirstResponse = vi.fn();
    const appendAcpUiLog = vi.fn();
    const primeRequestTraceFallback = vi.fn();
    const clearPendingRequestTraceFallback = vi.fn(() => true);
    const checkAndUpdateTitle = vi.fn();

    sessionStorage.setItem('acp_initial_message_conv-invalid', '{bad json');

    renderHook(() =>
      useAcpInitialMessage({
        conversationId: 'conv-invalid',
        backend: 'codex',
        agentName: 'Codex',
        beginPendingFirstResponse,
        clearPendingFirstResponse,
        appendAcpUiLog,
        primeRequestTraceFallback,
        clearPendingRequestTraceFallback,
        checkAndUpdateTitle,
      })
    );

    await waitFor(() => {
      expect(appendAcpUiLog).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'send_failed',
          level: 'error',
          backend: 'codex',
          agentName: 'Codex',
          detail: expect.stringMatching(/JSON|Unexpected|property/i),
        })
      );
    });

    expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    expect(beginPendingFirstResponse).not.toHaveBeenCalled();
    expect(primeRequestTraceFallback).not.toHaveBeenCalled();
    expect(checkAndUpdateTitle).not.toHaveBeenCalled();
    expect(clearPendingFirstResponse).toHaveBeenCalledTimes(1);
  });
});
