/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DOM tests for TaskPanel SendBox feature (F-4.1).
 * Tests send box rendering for different statuses, send flow, enter key, error handling.
 * Test IDs: SB-001 through SB-012.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Arco Design Grid uses window.matchMedia internally
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// --- Mocks --- //

const getChildTranscriptInvoke = vi.fn();
const sendMessageInvoke = vi.fn();
const notifyParentInvoke = vi.fn();
const responseStreamOnMock = vi.fn();
const unsubMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      getChildTranscript: {
        invoke: (...args: unknown[]) => getChildTranscriptInvoke(...args),
      },
      notifyParent: {
        invoke: (...args: unknown[]) => notifyParentInvoke(...args),
      },
    },
    conversation: {
      sendMessage: {
        invoke: (...args: unknown[]) => sendMessageInvoke(...args),
      },
      responseStream: {
        on: (cb: (...args: unknown[]) => void) => {
          responseStreamOnMock(cb);
          return unsubMock;
        },
      },
    },
    acpConversation: {
      getAvailableAgents: {
        invoke: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'test-msg-uuid'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));

const mockMessageError = vi.fn();

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Modal: {
      ...actual.Modal,
      confirm: vi.fn((config: { onOk?: () => void | Promise<void> }) => {
        void config.onOk?.();
      }),
    },
    Message: {
      ...actual.Message,
      error: (...args: unknown[]) => mockMessageError(...args),
    },
  };
});

vi.mock('@icon-park/react', () => ({
  Close: (props: Record<string, unknown>) => <span data-testid='icon-close' {...props} />,
  CloseOne: (props: Record<string, unknown>) => <span data-testid='icon-close-one' {...props} />,
  Refresh: (props: Record<string, unknown>) => <span data-testid='icon-refresh' {...props} />,
  People: (props: Record<string, unknown>) => <span data-testid='icon-people' {...props} />,
  SendOne: (props: Record<string, unknown>) => <span data-testid='icon-send' {...props} />,
  CheckOne: (props: Record<string, unknown>) => <span data-testid='icon-check' {...props} />,
}));

// --- Import component after mocks --- //

import type { ChildTaskInfoVO } from '@/renderer/pages/conversation/dispatch/types';
import TaskPanel from '@/renderer/pages/conversation/dispatch/TaskPanel';

// --- Helpers --- //

const makeChildInfo = (overrides: Partial<ChildTaskInfoVO> = {}): ChildTaskInfoVO => ({
  sessionId: 'child-session-1',
  title: 'Research API endpoints',
  status: 'running',
  teammateName: 'Agent Alpha',
  teammateAvatar: undefined,
  createdAt: Date.now() - 60000,
  lastActivityAt: Date.now(),
  ...overrides,
});

// --- Tests --- //

describe('TaskPanel SendBox (F-4.1)', () => {
  const defaultProps = {
    childTaskId: 'child-session-1',
    childInfo: makeChildInfo(),
    conversationId: 'parent-conv-123',
    onClose: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getChildTranscriptInvoke.mockResolvedValue({
      success: true,
      data: { messages: [], status: 'running' },
    });
    sendMessageInvoke.mockResolvedValue({});
    notifyParentInvoke.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // SB-001: SendBox is visible when child is running
  it('SB-001: shows send box for running child', async () => {
    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'running' })} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });
  });

  // SB-002: SendBox is visible when child is idle
  it('SB-002: shows send box for idle child', async () => {
    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'idle' })} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });
  });

  // SB-003: SendBox is hidden when child is completed
  it('SB-003: hides send box for completed child', async () => {
    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'completed' })} />);

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    expect(screen.queryByText('dispatch.taskPanel.sendToChild')).not.toBeInTheDocument();
  });

  // SB-004: SendBox is hidden when child is failed
  it('SB-004: hides send box for failed child', async () => {
    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'failed' })} />);

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    expect(screen.queryByText('dispatch.taskPanel.sendToChild')).not.toBeInTheDocument();
  });

  // SB-005: SendBox is hidden when child is cancelled
  it('SB-005: hides send box for cancelled child', async () => {
    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'cancelled' })} />);

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    expect(screen.queryByText('dispatch.taskPanel.sendToChild')).not.toBeInTheDocument();
  });

  // SB-006: Send button is disabled when input is empty
  it('SB-006: send button disabled when input is empty', async () => {
    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      const sendButton = screen.getByText('dispatch.taskPanel.sendToChild').closest('button');
      expect(sendButton).toBeDisabled();
    });
  });

  // SB-007: Send flow calls sendMessage and notifyParent
  it('SB-007: send calls conversation.sendMessage and dispatch.notifyParent', async () => {
    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });

    // Type a message
    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Hello child agent' } });
    });

    // Click send
    const sendButton = screen.getByText('dispatch.taskPanel.sendToChild').closest('button')!;
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(sendMessageInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          input: 'Hello child agent',
          conversation_id: 'child-session-1',
        })
      );
      expect(notifyParentInvoke).toHaveBeenCalledWith({
        parentConversationId: 'parent-conv-123',
        childSessionId: 'child-session-1',
        childName: 'Agent Alpha',
        userMessage: 'Hello child agent',
      });
    });
  });

  // SB-008: Input clears after successful send
  it('SB-008: clears input after successful send', async () => {
    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Test message' } });
    });

    const sendButton = screen.getByText('dispatch.taskPanel.sendToChild').closest('button')!;
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });

  // SB-009: Send failure shows error toast (Error instance)
  it('SB-009: send failure with Error shows error message', async () => {
    sendMessageInvoke.mockRejectedValue(new Error('Connection lost'));

    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Test message' } });
    });

    const sendButton = screen.getByText('dispatch.taskPanel.sendToChild').closest('button')!;
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('Connection lost');
    });
  });

  // SB-010: Send failure with non-Error shows generic message
  it('SB-010: send failure with non-Error shows generic error', async () => {
    sendMessageInvoke.mockRejectedValue('unknown error');

    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Test message' } });
    });

    const sendButton = screen.getByText('dispatch.taskPanel.sendToChild').closest('button')!;
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('dispatch.taskPanel.sendFailed');
    });
  });

  // SB-011: Does not send empty/whitespace messages
  it('SB-011: ignores whitespace-only messages', async () => {
    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '   ' } });
    });

    // Button should still be disabled since value.trim() is empty
    const sendButton = screen.getByText('dispatch.taskPanel.sendToChild').closest('button')!;
    expect(sendButton).toBeDisabled();
  });

  // SB-012: Uses i18n fallback as childName when teammateName is absent
  it('SB-012: uses i18n fallback as childName when teammateName is absent', async () => {
    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ teammateName: undefined })} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.sendToChild')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Fallback test' } });
    });

    const sendButton = screen.getByText('dispatch.taskPanel.sendToChild').closest('button')!;
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(notifyParentInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          childName: 'dispatch.taskPanel.childAgent',
        })
      );
    });
  });
});
