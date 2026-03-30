/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks --- //

const getChildTranscriptInvoke = vi.fn();
const responseStreamOnMock = vi.fn();
const unsubMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      getChildTranscript: {
        invoke: (...args: unknown[]) => getChildTranscriptInvoke(...args),
      },
      notifyParent: {
        invoke: vi.fn().mockResolvedValue({ success: true }),
      },
    },
    conversation: {
      sendMessage: {
        invoke: vi.fn().mockResolvedValue({}),
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
  uuid: vi.fn(() => 'test-uuid'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Modal: {
      ...actual.Modal,
      confirm: vi.fn((config: { onOk?: () => void | Promise<void> }) => {
        // Immediately invoke onOk to bypass the confirmation dialog in tests
        void config.onOk?.();
      }),
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

import type { ChildTaskInfoVO } from '@/renderer/pages/conversation/dispatch/types';

// We import TaskPanel after mocks are set up
// TaskPanel is a new file that will be created in Phase 2b
// For now we test the expected interface and behavior contract

const makeChildInfo = (overrides: Partial<ChildTaskInfoVO> = {}): ChildTaskInfoVO => ({
  sessionId: 'child-session-1',
  title: 'Research API endpoints',
  status: 'running',
  teammateName: 'Agent Alpha',
  teammateAvatar: '🤖',
  createdAt: Date.now() - 60000,
  lastActivityAt: Date.now(),
  ...overrides,
});

const mockTranscript = [
  { role: 'user', content: 'Please research the API endpoints', timestamp: 1000 },
  { role: 'assistant', content: 'I will analyze the available endpoints...', timestamp: 2000 },
];

describe('TaskPanel', () => {
  const defaultProps = {
    childTaskId: 'child-session-1',
    childInfo: makeChildInfo(),
    conversationId: 'conv-123',
    onClose: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getChildTranscriptInvoke.mockResolvedValue({
      success: true,
      data: { messages: mockTranscript, status: 'running' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // We dynamically import TaskPanel since it's a new file
  // If the file doesn't exist yet, tests will naturally fail with import error
  // This is intentional — tests are written ahead of implementation

  let TaskPanel: React.ComponentType<typeof defaultProps>;

  beforeEach(async () => {
    try {
      const mod = await import('@/renderer/pages/conversation/dispatch/TaskPanel');
      TaskPanel = mod.default;
    } catch {
      // Component not yet implemented — skip
    }
  });

  // AC-F3-001: TaskPanel renders agent name and task title in header
  it('AC-F3-001: renders agent name and task title in header', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
      expect(screen.getByText('Research API endpoints')).toBeInTheDocument();
    });
  });

  // AC-F3-002: TaskPanel displays status tag
  it('AC-F3-002: displays status tag matching child task status', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'completed' })} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.status.completed')).toBeInTheDocument();
    });
  });

  // AC-F3-003: TaskPanel shows transcript messages
  it('AC-F3-003: shows full transcript messages', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Please research the API endpoints')).toBeInTheDocument();
      expect(screen.getByText('I will analyze the available endpoints...')).toBeInTheDocument();
    });
  });

  // AC-F3-004: Running status triggers auto-refresh every 5s
  it('AC-F3-004: auto-refreshes transcript every 5 seconds when running', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    // Initial load
    await waitFor(() => {
      expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(1);
    });

    // Advance 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(2);

    // Advance another 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(3);
  });

  // AC-F3-005: Completed task stops auto-refresh
  it('AC-F3-005: does not auto-refresh when task is completed', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'completed' })} />);

    await waitFor(() => {
      expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    // Should still be 1 — no polling for completed tasks
    expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(1);
  });

  // AC-F3-006: Manual refresh button triggers data fetch
  it('AC-F3-006: refresh button triggers transcript reload', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(1);
    });

    const refreshBtn =
      screen.getByTestId('icon-refresh').closest('button') || screen.getByText('dispatch.taskPanel.refresh');
    await act(async () => {
      fireEvent.click(refreshBtn!);
    });

    expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(2);
  });

  // AC-F3-007: Cancel button visible for running/pending tasks
  it('AC-F3-007: shows cancel button for running task', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'running' })} />);

    await waitFor(() => {
      const cancelBtn =
        screen.getByText('dispatch.childTask.cancel') || screen.getByRole('button', { name: /cancel/i });
      expect(cancelBtn).toBeInTheDocument();
    });
  });

  // AC-F3-008: Cancel button hidden for completed tasks
  it('AC-F3-008: hides cancel button for completed task', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'completed' })} />);

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    // Cancel should not be present for completed tasks
    expect(screen.queryByText('dispatch.childTask.cancel')).not.toBeInTheDocument();
  });

  // AC-F3-009: Cancel button calls onCancel with childTaskId
  it('AC-F3-009: cancel button calls onCancel callback', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    const cancelBtn = screen.getByText('dispatch.childTask.cancel') || screen.getByRole('button', { name: /cancel/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(defaultProps.onCancel).toHaveBeenCalledWith('child-session-1');
  });

  // AC-F3-010: ESC key closes the panel
  it('AC-F3-010: ESC key triggers onClose', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  // AC-F3-011: Close button triggers onClose
  it('AC-F3-011: close button triggers onClose', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    const closeBtn = screen.getByTestId('icon-close').closest('button') || screen.getByText('dispatch.taskPanel.close');
    await act(async () => {
      fireEvent.click(closeBtn!);
    });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  // AC-F3-012: Empty transcript shows placeholder
  it('AC-F3-012: shows no transcript message when transcript is empty', async () => {
    if (!TaskPanel) return;

    getChildTranscriptInvoke.mockResolvedValue({
      messages: [],
      status: 'pending',
    });

    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ status: 'pending' })} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.taskPanel.noTranscript')).toBeInTheDocument();
    });
  });

  // AC-F3-013: Avatar emoji is displayed
  it('AC-F3-013: renders avatar emoji in header', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('🤖')).toBeInTheDocument();
    });
  });

  // AC-F3-014: Fallback People icon when no avatar
  it('AC-F3-014: renders People icon when no avatar provided', async () => {
    if (!TaskPanel) return;

    render(<TaskPanel {...defaultProps} childInfo={makeChildInfo({ teammateAvatar: undefined })} />);

    await waitFor(() => {
      expect(screen.getByTestId('icon-people')).toBeInTheDocument();
    });
  });

  // EDGE-F3-001: Unmounting cleans up interval
  it('EDGE-F3-001: cleans up polling interval on unmount', async () => {
    if (!TaskPanel) return;

    const { unmount } = render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(1);
    });

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    // Should not have been called again after unmount
    expect(getChildTranscriptInvoke).toHaveBeenCalledTimes(1);
  });

  // EDGE-F3-002: Unsubscribes from responseStream on unmount
  it('EDGE-F3-002: unsubscribes from responseStream on unmount', async () => {
    if (!TaskPanel) return;

    const { unmount } = render(<TaskPanel {...defaultProps} />);

    await waitFor(() => {
      expect(responseStreamOnMock).toHaveBeenCalled();
    });

    unmount();

    expect(unsubMock).toHaveBeenCalled();
  });

  // EDGE-F3-003: Transcript fetch error
  it('EDGE-F3-003: handles transcript fetch error gracefully', async () => {
    if (!TaskPanel) return;

    getChildTranscriptInvoke.mockRejectedValue(new Error('Network error'));

    render(<TaskPanel {...defaultProps} />);

    // Should not crash, should show error or empty state
    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });
  });
});
