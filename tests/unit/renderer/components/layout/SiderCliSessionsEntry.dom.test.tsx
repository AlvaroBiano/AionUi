/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const listExternalCliSessions = vi.hoisted(() => vi.fn());
const importExternalCliSession = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const closeAllTabs = vi.hoisted(() => vi.fn());
const openTab = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      listExternalCliSessions: { invoke: listExternalCliSessions },
      importExternalCliSession: { invoke: importExternalCliSession },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    openTab,
    closeAllTabs,
    activeTab: null,
  }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: vi.fn(() => null),
}));

vi.mock('@/renderer/utils/ui/focus', () => ({
  blockMobileInputFocus: vi.fn(),
  blurActiveElement: vi.fn(),
}));

import SiderCliSessionsEntry from '../../../../../src/renderer/components/layout/Sider/SiderNav/SiderCliSessionsEntry';

describe('SiderCliSessionsEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listExternalCliSessions.mockResolvedValue([
      {
        id: 'codex:session-codex-1',
        provider: 'codex',
        sessionId: 'session-codex-1',
        title: 'Fix flaky sidebar jitter when creating a new chat',
        workspace: '/tmp/codex-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    importExternalCliSession.mockResolvedValue({
      id: 'conv-2450',
      name: 'Fix flaky sidebar jitter when creating a new chat',
      type: 'acp',
      extra: {
        workspace: '/tmp/codex-workspace',
        customWorkspace: true,
      },
      createTime: Date.now(),
      modifyTime: Date.now(),
    });
  });

  it('loads recent CLI sessions and continues the selected one', async () => {
    render(<SiderCliSessionsEntry isMobile={false} collapsed={false} siderTooltipProps={{}} />);

    fireEvent.click(screen.getByText('conversation.cliSessions.entry'));

    expect(await screen.findByText('Fix flaky sidebar jitter when creating a new chat')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.cliSessions.continue' }));

    await waitFor(() => {
      expect(importExternalCliSession).toHaveBeenCalledWith({
        provider: 'codex',
        sessionId: 'session-codex-1',
      });
    });

    expect(openTab).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/conversation/conv-2450');
  });
});
