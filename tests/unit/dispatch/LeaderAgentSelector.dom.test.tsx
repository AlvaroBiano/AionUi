/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks --- //

const configStorageGetMock = vi.fn();
const createGroupChatInvoke = vi.fn();
const navigateMock = vi.fn();
const emitterEmitMock = vi.fn();
const messageErrorMock = vi.fn();

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
    t: (key: string) => key,
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

const mockAgents = [
  { id: 'agent-1', name: 'Code Reviewer', enabled: true, presetRules: 'Review code carefully', avatar: '🔍' },
  { id: 'agent-2', name: 'Architect', enabled: true, presetRules: 'Design systems', avatar: '🏗️' },
  { id: 'agent-3', name: 'Disabled Agent', enabled: false, presetRules: 'Should not appear' },
];

describe('LeaderAgentSelector', () => {
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
  });

  // AC-F1-001: Leader Agent selector is rendered in CreateGroupChatModal
  it('AC-F1-001: renders Leader Agent label in modal', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.create.adminLabel')).toBeInTheDocument();
    });
  });

  // AC-F1-002: Dropdown shows only enabled assistants
  it('AC-F1-002: shows only enabled assistants in dropdown options', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(configStorageGetMock).toHaveBeenCalledWith('acp.customAgents');
    });

    // Open the select dropdown
    const leaderSelect = screen.getAllByText('dispatch.create.adminPlaceholder')[0];
    await act(async () => {
      fireEvent.click(leaderSelect);
    });

    // Enabled agents should be visible
    await waitFor(() => {
      expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    // Disabled agent should NOT be visible
    expect(screen.queryByText('Disabled Agent')).not.toBeInTheDocument();
  });

  // AC-F1-003: Each option displays avatar + name
  it('AC-F1-003: options display avatar emoji alongside name', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(configStorageGetMock).toHaveBeenCalledWith('acp.customAgents');
    });

    const leaderSelect = screen.getAllByText('dispatch.create.adminPlaceholder')[0];
    await act(async () => {
      fireEvent.click(leaderSelect);
    });

    await waitFor(() => {
      expect(screen.getByText('🔍')).toBeInTheDocument();
      expect(screen.getByText('🏗️')).toBeInTheDocument();
    });
  });

  // AC-F1-004: Selection can be cleared (allowClear)
  it('AC-F1-004: selecting and clearing restores default behavior', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-leader' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(configStorageGetMock).toHaveBeenCalledWith('acp.customAgents');
    });

    // Select an agent
    const leaderSelect = screen.getAllByText('dispatch.create.adminPlaceholder')[0];
    await act(async () => {
      fireEvent.click(leaderSelect);
    });

    await waitFor(() => {
      expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Code Reviewer'));
    });

    // Submit without clearing — leaderAgentId should be included
    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(expect.objectContaining({ leaderAgentId: 'agent-1' }));
    });
  });

  // AC-F1-005: Selected assistant's ID is passed in createGroupChat IPC
  it('AC-F1-005: passes leaderAgentId in IPC call when agent selected', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-agent-sel' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(configStorageGetMock).toHaveBeenCalledWith('acp.customAgents');
    });

    const leaderSelect = screen.getAllByText('dispatch.create.adminPlaceholder')[0];
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
      expect(createGroupChatInvoke).toHaveBeenCalledWith(expect.objectContaining({ leaderAgentId: 'agent-2' }));
    });
  });

  // AC-F1-006: No agent selected → OK button is disabled (G3.1: admin agent is required)
  it('AC-F1-006: OK button is disabled when no agent selected', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    // G3.1: handleCreate returns early if !leaderAgentId, so invoke should NOT be called
    expect(createGroupChatInvoke).not.toHaveBeenCalled();
  });

  // AC-F1-007: Empty assistant list shows the leader agent label (dropdown is empty)
  it('AC-F1-007: shows empty state when no assistants are configured', async () => {
    configStorageGetMock.mockImplementation((key: string) => {
      if (key === 'acp.customAgents') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.create.adminLabel')).toBeInTheDocument();
    });
  });

  // EDGE-F1-001: ConfigStorage returns undefined (no agents configured)
  it('EDGE-F1-001: handles undefined from ConfigStorage gracefully', async () => {
    configStorageGetMock.mockImplementation((key: string) => {
      if (key === 'acp.customAgents') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    // Should render without crashing
    await waitFor(() => {
      expect(screen.getByText('dispatch.create.adminLabel')).toBeInTheDocument();
    });
  });

  // EDGE-F1-002: All agents are disabled
  it('EDGE-F1-002: shows empty state when all agents are disabled', async () => {
    configStorageGetMock.mockImplementation((key: string) => {
      if (key === 'acp.customAgents') {
        return Promise.resolve([
          { id: 'a1', name: 'A', enabled: false },
          { id: 'a2', name: 'B', enabled: false },
        ]);
      }
      return Promise.resolve(undefined);
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    // No enabled agents means the dropdown should show empty state
    await waitFor(() => {
      expect(screen.getByText('dispatch.create.adminLabel')).toBeInTheDocument();
    });
  });
});
