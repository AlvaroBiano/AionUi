/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks --- //

const createGroupChatInvoke = vi.fn();
const navigateMock = vi.fn();
const emitterEmitMock = vi.fn();
const messageErrorMock = vi.fn();
const configStorageGetMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      createGroupChat: {
        invoke: (...args: unknown[]) => createGroupChatInvoke(...args),
      },
    },
  },
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => configStorageGetMock(...args),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && 'count' in params) return `${params.count}/2000`;
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => emitterEmitMock(...args),
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      error: (...args: unknown[]) => messageErrorMock(...args),
    },
  };
});

vi.mock('@icon-park/react', () => ({
  People: (props: Record<string, unknown>) => <span data-testid='icon-people' {...props} />,
  Brain: (props: Record<string, unknown>) => <span data-testid='icon-brain' {...props} />,
  SettingTwo: (props: Record<string, unknown>) => <span data-testid='icon-setting' {...props} />,
  Down: (props: Record<string, unknown>) => <span data-testid='icon-down' {...props} />,
  Up: (props: Record<string, unknown>) => <span data-testid='icon-up' {...props} />,
  FolderOpen: (props: Record<string, unknown>) => <span data-testid='icon-folder-open' {...props} />,
}));

import CreateGroupChatModal from '@/renderer/pages/conversation/dispatch/CreateGroupChatModal';

// G3.1: Seed messages (Advanced Settings) were removed from CreateGroupChatModal.
// These tests are obsolete and skipped until the test file is cleaned up.
describe.skip('SeedMessages (Advanced Settings) (deprecated by G3.1)', () => {
  const defaultProps = {
    visible: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    configStorageGetMock.mockResolvedValue([]);
  });

  // AC-F4-001: Advanced Settings section is rendered (collapsed by default)
  it('AC-F4-001: renders Advanced Settings toggle in collapsed state', () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    expect(screen.getByText('dispatch.create.advancedSettings')).toBeInTheDocument();
  });

  // AC-F4-002: Clicking Advanced Settings expands to show System Prompt textarea
  it('AC-F4-002: expanding Advanced Settings reveals System Prompt textarea', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    await waitFor(() => {
      expect(screen.getByText('dispatch.create.seedMessageLabel')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder')).toBeInTheDocument();
    });
  });

  // AC-F4-003: Textarea has 2000 character limit
  it('AC-F4-003: textarea enforces 2000 character limit', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');

    // Input a long string
    const longText = 'a'.repeat(2001);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: longText } });
    });

    // The maxLength attribute or controlled state should limit to 2000
    expect((textarea as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(2000);
  });

  // AC-F4-004: Character counter is displayed
  it('AC-F4-004: displays character counter', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Hello world' } });
    });

    // Should show character count (e.g., "11/2000")
    await waitFor(() => {
      const counter = screen.getByText(/\/2000/);
      expect(counter).toBeInTheDocument();
    });
  });

  // AC-F4-005: Seed message is passed in IPC call
  it('AC-F4-005: passes seedMessages in IPC call when text entered', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-seed' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    // Expand Advanced Settings
    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Focus on API design patterns' } });
    });

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(
        expect.objectContaining({ seedMessages: 'Focus on API design patterns' })
      );
    });
  });

  // AC-F4-006: Empty seed message sends undefined
  it('AC-F4-006: sends undefined seedMessages when textarea is empty', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-empty-seed' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(expect.objectContaining({ seedMessages: undefined }));
    });
  });

  // AC-F4-007: Whitespace-only seed message is treated as empty
  it('AC-F4-007: trims whitespace and sends undefined for whitespace-only input', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-ws-seed' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '   \n  \t  ' } });
    });

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(expect.objectContaining({ seedMessages: undefined }));
    });
  });

  // AC-F4-008: Seed message is trimmed before sending
  it('AC-F4-008: trims seed message before sending', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-trim-seed' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '  Focus on security  ' } });
    });

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(
        expect.objectContaining({ seedMessages: 'Focus on security' })
      );
    });
  });

  // AC-F4-009: Collapsing and re-expanding preserves text
  it('AC-F4-009: preserves seed message text through collapse/expand cycle', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    // Expand
    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'My custom instructions' } });
    });

    // Collapse
    await act(async () => {
      fireEvent.click(screen.getByText('dispatch.create.advancedSettings'));
    });

    // Re-expand
    await act(async () => {
      fireEvent.click(screen.getByText('dispatch.create.advancedSettings'));
    });

    const restoredTextarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    expect(restoredTextarea).toHaveValue('My custom instructions');
  });

  // EDGE-F4-001: Seed message is cleared after successful creation and modal reopen
  it('EDGE-F4-001: resets seed message after successful creation', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-reset-seed' },
    });

    const { rerender } = render(<CreateGroupChatModal {...defaultProps} />);

    // Enter seed message
    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });

    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Some instructions' } });
    });

    // Submit
    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(defaultProps.onCreated).toHaveBeenCalled();
    });

    // Reopen modal
    rerender(<CreateGroupChatModal {...defaultProps} visible={false} />);
    rerender(<CreateGroupChatModal {...defaultProps} visible={true} />);

    // Advanced settings should be collapsed, and seed should be cleared
    const newAdvancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(newAdvancedToggle);
    });

    const newTextarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    expect(newTextarea).toHaveValue('');
  });
});
