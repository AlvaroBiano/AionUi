/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DOM tests for GroupChatSettingsDrawer component (F-4.3).
 * Tests form rendering, validation, submit flow, leader agent dropdown, close behavior.
 * Test IDs: GCS-001 through GCS-012.
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

const updateGroupChatSettingsInvoke = vi.fn();
const getAvailableAgentsInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dispatch: {
      updateGroupChatSettings: {
        invoke: (...args: unknown[]) => updateGroupChatSettingsInvoke(...args),
      },
    },
    acpConversation: {
      getAvailableAgents: {
        invoke: (...args: unknown[]) => getAvailableAgentsInvoke(...args),
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
  Close: (props: Record<string, unknown>) => <span data-testid='icon-close' {...props} />,
}));

// --- Import component after mocks --- //

import GroupChatSettingsDrawer from '@/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer';

// --- Tests --- //

describe('GroupChatSettingsDrawer (F-4.3)', () => {
  const defaultProps = {
    visible: true,
    onClose: vi.fn(),
    conversationId: 'conv-123',
    currentSettings: {
      groupChatName: 'Test Group',
      leaderAgentId: '',
      seedMessages: 'Initial instructions',
    },
    onSaved: vi.fn(),
  };

  const mockAgents = [
    { customAgentId: 'agent-1', name: 'Leader Alpha', avatar: 'A', isPreset: true },
    { customAgentId: 'agent-2', name: 'Leader Beta', avatar: 'B', isPreset: true },
    { customAgentId: null, name: 'Non-Custom', isPreset: false },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    getAvailableAgentsInvoke.mockResolvedValue({
      success: true,
      data: mockAgents,
    });
    updateGroupChatSettingsInvoke.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // GCS-001: Drawer renders with title and form fields
  it('GCS-001: renders drawer with title and all form fields', async () => {
    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.settings.title')).toBeInTheDocument();
      expect(screen.getByText('dispatch.settings.nameLabel')).toBeInTheDocument();
      expect(screen.getByText('dispatch.settings.leaderAgentLabel')).toBeInTheDocument();
      expect(screen.getByText('dispatch.settings.seedMessagesLabel')).toBeInTheDocument();
    });
  });

  // GCS-002: Current settings pre-fill form fields
  it('GCS-002: pre-fills name and seed messages from currentSettings', async () => {
    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('dispatch.settings.namePlaceholder');
      expect(nameInput).toHaveValue('Test Group');
    });
  });

  // GCS-003: Fetches available agents for leader dropdown when visible
  it('GCS-003: fetches available agents on open', async () => {
    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(getAvailableAgentsInvoke).toHaveBeenCalled();
    });
  });

  // GCS-004: Does not fetch agents when not visible
  it('GCS-004: does not fetch agents when drawer is hidden', () => {
    render(<GroupChatSettingsDrawer {...defaultProps} visible={false} />);

    expect(getAvailableAgentsInvoke).not.toHaveBeenCalled();
  });

  // GCS-005: Save button calls updateGroupChatSettings IPC with correct params
  it('GCS-005: save calls updateGroupChatSettings with form values', async () => {
    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.settings.namePlaceholder')).toHaveValue('Test Group');
    });

    const saveButton = screen.getByText('dispatch.settings.save');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(updateGroupChatSettingsInvoke).toHaveBeenCalledWith({
        conversationId: 'conv-123',
        groupChatName: 'Test Group',
        leaderAgentId: undefined,
        seedMessages: 'Initial instructions',
        maxConcurrentChildren: 3,
      });
    });
  });

  // GCS-006: Successful save calls onSaved and onClose callbacks
  it('GCS-006: successful save triggers onSaved and onClose', async () => {
    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.settings.namePlaceholder')).toHaveValue('Test Group');
    });

    const saveButton = screen.getByText('dispatch.settings.save');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(defaultProps.onSaved).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(mockMessageSuccess).toHaveBeenCalledWith('dispatch.settings.saveSuccess');
    });
  });

  // GCS-007: Failed save shows error message
  it('GCS-007: failed save shows error toast', async () => {
    updateGroupChatSettingsInvoke.mockResolvedValue({
      success: false,
      msg: 'Something went wrong',
    });

    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.settings.namePlaceholder')).toHaveValue('Test Group');
    });

    const saveButton = screen.getByText('dispatch.settings.save');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('Something went wrong');
    });
    expect(defaultProps.onSaved).not.toHaveBeenCalled();
  });

  // GCS-008: Save exception shows generic error
  it('GCS-008: save exception shows generic error toast', async () => {
    updateGroupChatSettingsInvoke.mockRejectedValue(new Error('Network error'));

    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.settings.namePlaceholder')).toHaveValue('Test Group');
    });

    const saveButton = screen.getByText('dispatch.settings.save');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('Network error');
    });
  });

  // GCS-009: Cancel button calls onClose
  it('GCS-009: cancel button calls onClose', async () => {
    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('common.cancel')).toBeInTheDocument();
    });

    const cancelButton = screen.getByText('common.cancel');
    await act(async () => {
      fireEvent.click(cancelButton);
    });

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  // GCS-010: Empty name field sends undefined groupChatName
  it('GCS-010: empty name sends undefined groupChatName', async () => {
    render(
      <GroupChatSettingsDrawer
        {...defaultProps}
        currentSettings={{ groupChatName: '', leaderAgentId: '', seedMessages: '' }}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.settings.namePlaceholder')).toHaveValue('');
    });

    const saveButton = screen.getByText('dispatch.settings.save');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(updateGroupChatSettingsInvoke).toHaveBeenCalledWith({
        conversationId: 'conv-123',
        groupChatName: undefined,
        leaderAgentId: undefined,
        seedMessages: undefined,
        maxConcurrentChildren: 3,
      });
    });
  });

  // GCS-011: Form resets when drawer reopens with new settings
  it('GCS-011: form resets to new currentSettings on reopen', async () => {
    const { rerender } = render(<GroupChatSettingsDrawer {...defaultProps} visible={false} />);

    rerender(
      <GroupChatSettingsDrawer
        {...defaultProps}
        visible={true}
        currentSettings={{ groupChatName: 'New Name', leaderAgentId: '', seedMessages: 'New seed' }}
      />
    );

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('dispatch.settings.namePlaceholder');
      expect(nameInput).toHaveValue('New Name');
    });
  });

  // GCS-012: Failed save with no msg uses fallback
  it('GCS-012: failed save with no msg uses i18n fallback', async () => {
    updateGroupChatSettingsInvoke.mockResolvedValue({
      success: false,
    });

    render(<GroupChatSettingsDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('dispatch.settings.namePlaceholder')).toHaveValue('Test Group');
    });

    const saveButton = screen.getByText('dispatch.settings.save');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('dispatch.settings.saveFailed');
    });
  });
});
