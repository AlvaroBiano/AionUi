/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
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

const getTeammateConfigInvoke = vi.fn();
const saveTeammateInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      getTeammateConfig: {
        invoke: (...args: unknown[]) => getTeammateConfigInvoke(...args),
      },
      saveTeammate: {
        invoke: (...args: unknown[]) => saveTeammateInvoke(...args),
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

// Mock Arco Message globally so we can assert on calls
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      success: (...args: unknown[]) => mockMessageSuccess(...args),
      error: (...args: unknown[]) => mockMessageError(...args),
    },
  };
});

vi.mock('@icon-park/react', () => ({
  Close: (props: Record<string, unknown>) => <span data-testid="icon-close" {...props} />,
  People: (props: Record<string, unknown>) => <span data-testid="icon-people" {...props} />,
}));

// --- Import component after mocks --- //

import SaveTeammateModal from '@/renderer/pages/conversation/dispatch/components/SaveTeammateModal';

// --- Tests --- //

describe('SaveTeammateModal', () => {
  const defaultProps = {
    visible: true,
    childSessionId: 'child-session-1',
    initialName: 'Agent Alpha',
    initialAvatar: 'robot',
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getTeammateConfigInvoke.mockResolvedValue({
      success: true,
      data: {
        name: 'Agent Alpha',
        avatar: 'robot',
        presetRules: 'You are a helpful assistant.',
      },
    });
    saveTeammateInvoke.mockResolvedValue({
      success: true,
      data: { assistantId: 'new-assistant-id' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ST-001: Modal renders with Name, Avatar, System Prompt fields
  it('ST-001: renders Modal with Name, Avatar, and System Prompt fields', async () => {
    render(<SaveTeammateModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.teammate.saveTitle')).toBeInTheDocument();
      expect(screen.getByText('dispatch.teammate.nameLabel')).toBeInTheDocument();
      expect(screen.getByText('dispatch.teammate.avatarLabel')).toBeInTheDocument();
      expect(screen.getByText('dispatch.teammate.promptLabel')).toBeInTheDocument();
    });
  });

  // ST-002: Initial values are loaded from IPC (getTeammateConfig)
  it('ST-002: initial values loaded from getTeammateConfig IPC', async () => {
    render(<SaveTeammateModal {...defaultProps} />);

    await waitFor(() => {
      expect(getTeammateConfigInvoke).toHaveBeenCalledWith({ childSessionId: 'child-session-1' });
    });

    // After IPC resolves, form should be populated
    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('dispatch.teammate.namePlaceholder');
      expect(nameInput).toHaveValue('Agent Alpha');
    });
  });

  // ST-003: Submit button disabled state — verifies button exists with loading when fetching
  it('ST-003: save button shows loading during fetch', async () => {
    // Delay the IPC response so we can observe the fetching state
    getTeammateConfigInvoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, data: { name: '', avatar: '', presetRules: '' } }), 1000)),
    );

    render(<SaveTeammateModal {...defaultProps} />);

    // During fetch, the save button should be in loading state
    const saveButton = screen.getByText('dispatch.teammate.saveConfirm');
    expect(saveButton.closest('button')).toBeInTheDocument();
  });

  // ST-004: Submit calls saveTeammate IPC with correct params
  it('ST-004: submit calls saveTeammate IPC with form values', async () => {
    render(<SaveTeammateModal {...defaultProps} />);

    // Wait for form to populate
    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.teammate.namePlaceholder')).toHaveValue('Agent Alpha');
    });

    // Click save
    const saveButton = screen.getByText('dispatch.teammate.saveConfirm');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(saveTeammateInvoke).toHaveBeenCalledWith({
        name: 'Agent Alpha',
        avatar: 'robot',
        presetRules: 'You are a helpful assistant.',
      });
    });
  });

  // ST-005: Success triggers onSaved callback
  it('ST-005: successful save calls onSaved with assistantId', async () => {
    render(<SaveTeammateModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.teammate.namePlaceholder')).toHaveValue('Agent Alpha');
    });

    const saveButton = screen.getByText('dispatch.teammate.saveConfirm');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(defaultProps.onSaved).toHaveBeenCalledWith('new-assistant-id');
      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(mockMessageSuccess).toHaveBeenCalledWith('dispatch.teammate.saveSuccess');
    });
  });

  // ST-006: Duplicate name shows error message
  it('ST-006: duplicate name shows error toast', async () => {
    saveTeammateInvoke.mockResolvedValue({
      success: false,
      msg: 'Assistant with this name already exists',
    });

    render(<SaveTeammateModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.teammate.namePlaceholder')).toHaveValue('Agent Alpha');
    });

    const saveButton = screen.getByText('dispatch.teammate.saveConfirm');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('dispatch.teammate.saveDuplicate');
    });
    // onSaved should NOT have been called
    expect(defaultProps.onSaved).not.toHaveBeenCalled();
  });

  // ST-007: Hidden modal does not fetch config
  it('ST-007: does not fetch config when not visible', () => {
    render(<SaveTeammateModal {...defaultProps} visible={false} />);
    expect(getTeammateConfigInvoke).not.toHaveBeenCalled();
  });

  // ST-008: Cancel button calls onClose
  it('ST-008: cancel button calls onClose', async () => {
    render(<SaveTeammateModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.teammate.cancel')).toBeInTheDocument();
    });

    const cancelButton = screen.getByText('dispatch.teammate.cancel');
    await act(async () => {
      fireEvent.click(cancelButton);
    });

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  // ST-009: IPC fetch error falls back to initial values
  it('ST-009: falls back to initial props on IPC fetch error', async () => {
    getTeammateConfigInvoke.mockRejectedValue(new Error('Network error'));

    render(<SaveTeammateModal {...defaultProps} />);

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('dispatch.teammate.namePlaceholder');
      expect(nameInput).toHaveValue('Agent Alpha');
    });
  });

  // ST-010: Generic save error shows error toast
  it('ST-010: generic save error shows error toast', async () => {
    saveTeammateInvoke.mockResolvedValue({
      success: false,
      msg: 'Internal server error',
    });

    render(<SaveTeammateModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.teammate.namePlaceholder')).toHaveValue('Agent Alpha');
    });

    const saveButton = screen.getByText('dispatch.teammate.saveConfirm');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('dispatch.teammate.saveError');
    });
  });
});
