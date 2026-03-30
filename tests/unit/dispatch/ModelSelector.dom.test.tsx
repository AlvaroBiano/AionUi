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
      if (params) return `${key}:${JSON.stringify(params)}`;
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
  FolderOpen: (props: Record<string, unknown>) => <span data-testid='icon-folder-open' {...props} />,
  Up: (props: Record<string, unknown>) => <span data-testid='icon-up' {...props} />,
}));

// Mock SWR to control model config data
vi.mock('swr', () => ({
  default: (key: string, fetcher: () => Promise<unknown>) => {
    // Trigger the fetcher and return mock data
    const result = { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    if (key === 'model.config') {
      result.data = getModelConfigInvoke() as undefined;
    }
    return result;
  },
}));

import CreateGroupChatModal from '@/renderer/pages/conversation/dispatch/CreateGroupChatModal';

const mockProviders = [
  {
    id: 'gemini-provider',
    name: 'Google Gemini',
    enabled: true,
    model: ['gemini-2.0-flash', 'gemini-2.0-pro'],
    modelEnabled: { 'gemini-2.0-flash': true, 'gemini-2.0-pro': true },
    useModel: 'gemini-2.0-flash',
  },
  {
    id: 'openai-provider',
    name: 'OpenAI',
    enabled: true,
    model: ['gpt-4o', 'gpt-4o-mini'],
    modelEnabled: { 'gpt-4o': true, 'gpt-4o-mini': false },
    useModel: 'gpt-4o',
  },
  {
    id: 'disabled-provider',
    name: 'Disabled Provider',
    enabled: false,
    model: ['model-x'],
    modelEnabled: { 'model-x': true },
    useModel: 'model-x',
  },
];

// G3.1: Model selector was removed from CreateGroupChatModal.
// These tests are obsolete and skipped until the test file is cleaned up.
describe.skip('ModelSelector (deprecated by G3.1)', () => {
  const defaultProps = {
    visible: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    configStorageGetMock.mockResolvedValue([]);
    getModelConfigInvoke.mockReturnValue(mockProviders);
  });

  // AC-F2-001: Model selector is rendered in CreateGroupChatModal
  it('AC-F2-001: renders Model label in modal', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.create.modelLabel')).toBeInTheDocument();
    });
  });

  // AC-F2-002: Models are grouped by provider name
  it('AC-F2-002: groups models by provider name in dropdown', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    // Open model selector dropdown
    const modelSelect = screen.getAllByText('dispatch.create.modelPlaceholder')[0];
    await act(async () => {
      fireEvent.click(modelSelect);
    });

    await waitFor(() => {
      // Should show provider group labels
      expect(screen.getByText('Google Gemini')).toBeInTheDocument();
      expect(screen.getByText('OpenAI')).toBeInTheDocument();
    });

    // Disabled provider should NOT appear
    expect(screen.queryByText('Disabled Provider')).not.toBeInTheDocument();
  });

  // AC-F2-003: Disabled providers are not shown
  it('AC-F2-003: filters out disabled providers', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    const modelSelect = screen.getAllByText('dispatch.create.modelPlaceholder')[0];
    await act(async () => {
      fireEvent.click(modelSelect);
    });

    await waitFor(() => {
      expect(screen.queryByText('Disabled Provider')).not.toBeInTheDocument();
      expect(screen.queryByText('model-x')).not.toBeInTheDocument();
    });
  });

  // AC-F2-004: Disabled models within enabled providers are not shown
  it('AC-F2-004: filters out disabled models', async () => {
    render(<CreateGroupChatModal {...defaultProps} />);

    const modelSelect = screen.getAllByText('dispatch.create.modelPlaceholder')[0];
    await act(async () => {
      fireEvent.click(modelSelect);
    });

    await waitFor(() => {
      expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    });
    // gpt-4o-mini is disabled
    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument();
  });

  // AC-F2-005: Selected model is passed via IPC modelOverride
  it('AC-F2-005: passes modelOverride in IPC call when model selected', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-model' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

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

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: { providerId: 'openai-provider', useModel: 'gpt-4o' },
        })
      );
    });
  });

  // AC-F2-006: No model selected sends undefined modelOverride
  it('AC-F2-006: sends undefined modelOverride when using default', async () => {
    createGroupChatInvoke.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-default-model' },
    });

    render(<CreateGroupChatModal {...defaultProps} />);

    const okButton = screen.getByText('dispatch.create.confirm');
    await act(async () => {
      fireEvent.click(okButton);
    });

    await waitFor(() => {
      expect(createGroupChatInvoke).toHaveBeenCalledWith(expect.objectContaining({ modelOverride: undefined }));
    });
  });

  // AC-F2-007: Empty model list renders the model label (dropdown is empty)
  it('AC-F2-007: shows empty state when no models available', async () => {
    getModelConfigInvoke.mockReturnValue([]);

    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.create.modelLabel')).toBeInTheDocument();
    });
  });

  // EDGE-F2-001: getModelConfig returns undefined
  it('EDGE-F2-001: handles undefined model config gracefully', async () => {
    getModelConfigInvoke.mockReturnValue(undefined);

    render(<CreateGroupChatModal {...defaultProps} />);

    // Should render without crashing
    await waitFor(() => {
      expect(screen.getByText('dispatch.create.modelLabel')).toBeInTheDocument();
    });
  });

  // EDGE-F2-002: All providers disabled
  it('EDGE-F2-002: shows empty state when all providers are disabled', async () => {
    getModelConfigInvoke.mockReturnValue([
      { id: 'p1', name: 'P1', enabled: false, models: [{ name: 'm1', enabled: true }] },
    ]);

    render(<CreateGroupChatModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('dispatch.create.modelLabel')).toBeInTheDocument();
    });
  });
});
