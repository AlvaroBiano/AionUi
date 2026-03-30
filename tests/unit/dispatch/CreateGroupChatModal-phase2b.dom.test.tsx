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
const getModelConfigInvoke = vi.fn();
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
    mode: {
      getModelConfig: {
        invoke: () => getModelConfigInvoke(),
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

// Mock SWR to control model config data
vi.mock('swr', () => ({
  default: (key: string) => {
    const result = { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    if (key === 'model.config') {
      result.data = getModelConfigInvoke() as undefined;
    }
    return result;
  },
}));

import CreateGroupChatModal from '@/renderer/pages/conversation/dispatch/CreateGroupChatModal';

const mockAgents = [
  { id: 'agent-1', name: 'Code Reviewer', enabled: true, presetRules: 'Review code', avatar: '🔍' },
  { id: 'agent-2', name: 'Architect', enabled: true, presetRules: 'Design systems', avatar: '🏗️' },
];

const mockProviders = [
  {
    id: 'gemini-provider',
    name: 'Google Gemini',
    enabled: true,
    model: ['gemini-2.0-flash'],
    modelEnabled: { 'gemini-2.0-flash': true },
    useModel: 'gemini-2.0-flash',
  },
  {
    id: 'openai-provider',
    name: 'OpenAI',
    enabled: true,
    model: ['gpt-4o'],
    modelEnabled: { 'gpt-4o': true },
    useModel: 'gpt-4o',
  },
];

// G3.1: Model selector and seed messages were removed from CreateGroupChatModal.
// Phase 2b integration tests are obsolete and skipped until the test file is cleaned up.
describe.skip('CreateGroupChatModal — Phase 2b Integration (deprecated by G3.1)', () => {
  const defaultProps = {
    visible: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    configStorageGetMock.mockImplementation((key: string) => {
      if (key === 'acp.customAgents') return Promise.resolve(mockAgents);
      return Promise.resolve(undefined);
    });
    getModelConfigInvoke.mockReturnValue(mockProviders);
  });

  // INT-001: Modal layout renders all Phase 2b fields in correct order
  it('INT-001: renders Name, Leader Agent, Model, and Advanced Settings sections', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      // All labels should be present
      expect(screen.getByText('dispatch.create.titleLabel')).toBeInTheDocument();
      expect(screen.getByText('dispatch.create.leaderAgentLabel')).toBeInTheDocument();
      expect(screen.getByText('dispatch.create.modelLabel')).toBeInTheDocument();
      expect(screen.getByText('dispatch.create.advancedSettings')).toBeInTheDocument();
    });
  });

  // INT-002: Full creation flow with all Phase 2b fields populated
  it('INT-002: sends all Phase 2b parameters in IPC call', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-full-2b' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(configStorageGetMock).toHaveBeenCalledWith('acp.customAgents');
    });

    // Fill name
    const nameInput = screen.getByPlaceholderText('dispatch.create.titlePlaceholder');
    fireEvent.change(nameInput, { target: { value: 'Full Test Chat' } });

    // Select leader agent
    const leaderSelect = screen.getAllByText('dispatch.create.leaderAgentPlaceholder')[0];
    await act(async () => {
      fireEvent.click(leaderSelect);
    });
    await waitFor(() => {
      expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Code Reviewer'));
    });

    // Select model
    const modelSelect = screen.getAllByText('dispatch.create.modelPlaceholder')[0];
    await act(async () => {
      fireEvent.click(modelSelect);
    });
    await waitFor(() => {
      expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('gpt-4o'));
    });

    // Expand advanced settings and add seed message
    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });
    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Be thorough in code review' } });
    });

    // Submit
    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith({
        name: 'Full Test Chat',
        leaderAgentId: 'agent-1',
        modelOverride: { providerId: 'openai-provider', useModel: 'gpt-4o' },
        seedMessages: 'Be thorough in code review',
      });
    });
  });

  // INT-003: Successful creation navigates and fires callbacks
  it('INT-003: navigates and fires onCreated on success with all params', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-nav-2b' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(defaultProps.onCreated).toHaveBeenCalledWith('conv-nav-2b');
      expect(navigateMock).toHaveBeenCalledWith('/conversation/conv-nav-2b');
      expect(emitterEmitMock).toHaveBeenCalledWith('chat.history.refresh');
    });
  });

  // INT-004: Cancel resets ALL new fields
  it('INT-004: cancel clears all fields including Phase 2b additions', async () => {
    const { rerender } = render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(configStorageGetMock).toHaveBeenCalledWith('acp.customAgents');
    });

    // Select leader
    const leaderSelect = screen.getAllByText('dispatch.create.leaderAgentPlaceholder')[0];
    await act(async () => {
      fireEvent.click(leaderSelect);
    });
    await waitFor(() => {
      expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Code Reviewer'));
    });

    // Expand and fill seed
    const advancedToggle = screen.getByText('dispatch.create.advancedSettings');
    await act(async () => {
      fireEvent.click(advancedToggle);
    });
    const textarea = screen.getByPlaceholderText('dispatch.create.seedMessagePlaceholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Some text' } });
    });

    // Cancel
    const cancelButton = screen.getByText('common.cancel');
    fireEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();

    // Reopen modal to verify state was reset
    rerender(<CreateGroupChatModal {...defaultProps} visible={false} />);
    rerender(<CreateGroupChatModal {...defaultProps} visible={true} />);

    // Leader should be back to placeholder
    expect(screen.getAllByText('dispatch.create.leaderAgentPlaceholder')[0]).toBeInTheDocument();
  });

  // INT-005: API failure shows error and preserves form state
  it('INT-005: API failure shows error message without clearing form', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: false,
      msg: 'Leader agent not found',
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(configStorageGetMock).toHaveBeenCalledWith('acp.customAgents');
    });

    // Select leader
    const leaderSelect = screen.getAllByText('dispatch.create.leaderAgentPlaceholder')[0];
    await act(async () => {
      fireEvent.click(leaderSelect);
    });
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Architect'));
    });

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledWith('Leader agent not found');
    });

    // Form should NOT have navigated
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // INT-006: Loading state during creation disables submit
  it('INT-006: shows loading state during API call', async () => {
    let resolveCreate: (v: unknown) => void;
    createGroupChatInvoke.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );

    render(<CreateGroupChatModal {...defaultProps} />);

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    // Should be in loading state
    const okBtnEl = okButton.closest('button');
    expect(okBtnEl?.classList.toString()).toMatch(/loading/);

    await act(async () => {
      resolveCreate!({ success: true, data: { conversationId: 'conv-load-2b' } });
    });
  });

  // INT-007: Backward compat — no Phase 2b fields = Phase 2a behavior
  it('INT-007: without Phase 2b fields, behaves like Phase 2a', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-compat' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    const nameInput = screen.getByPlaceholderText('dispatch.create.titlePlaceholder');
    fireEvent.change(nameInput, { target: { value: 'Simple Chat' } });

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Simple Chat',
          leaderAgentId: undefined,
          modelOverride: undefined,
          seedMessages: undefined,
        })
      );
    });
  });

  // EDGE-INT-001: Network exception preserves all form state
  it('EDGE-INT-001: network exception shows fallback error', async () => {
    createGroupChatInvoke.mockRejectedValue(new Error('Connection refused'));

    render(<CreateGroupChatModal {...defaultProps} />);

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledWith('dispatch.create.error');
    });
  });

  // EDGE-INT-002: Modal not visible does not render Phase 2b fields
  it('EDGE-INT-002: hidden modal does not render Phase 2b fields', () => {
    render(<CreateGroupChatModal {...defaultProps} visible={false} />);

    expect(screen.queryByText('dispatch.create.leaderAgentLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('dispatch.create.modelLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('dispatch.create.advancedSettings')).not.toBeInTheDocument();
  });
});
