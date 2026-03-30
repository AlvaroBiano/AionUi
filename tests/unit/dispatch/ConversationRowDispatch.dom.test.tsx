/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks --- //

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
    useParams: () => ({ id: 'selected-id' }),
  };
});

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
  };
});

vi.mock('@icon-park/react', () => ({
  DeleteOne: () => <span data-testid='icon-delete' />,
  EditOne: () => <span data-testid='icon-edit' />,
  Export: () => <span data-testid='icon-export' />,
  MessageOne: () => <span data-testid='icon-message' />,
  People: () => <span data-testid='icon-people' />,
  Pound: () => <span data-testid='icon-pound' />,
  Pushpin: () => <span data-testid='icon-pushpin' />,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => null,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: () => null,
}));

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({}),
}));

vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import type { TChatConversation } from '@/common/config/storage';

const makeConversation = (overrides: Partial<TChatConversation> = {}): TChatConversation =>
  ({
    id: 'dispatch-1',
    name: 'My Group Chat',
    type: 'dispatch',
    createTime: Date.now(),
    modifyTime: Date.now(),
    extra: {
      dispatchSessionType: 'dispatcher',
    },
    model: { id: 'gemini', useModel: 'gemini-2.0-flash' },
    ...overrides,
  }) as TChatConversation;

const makeProps = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
  conversation: makeConversation(),
  isGenerating: false,
  hasCompletionUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: false,
  childTaskCount: undefined,
  onToggleChecked: vi.fn(),
  onConversationClick: vi.fn(),
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onDelete: vi.fn(),
  onExport: vi.fn(),
  onTogglePin: vi.fn(),
  getJobStatus: () => 'none',
  ...overrides,
});

describe('ConversationRow - Dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CMP-ROW-001: Dispatch conversation shows Pound icon
  it('CMP-ROW-001: renders Pound icon for dispatch conversation', () => {
    render(<ConversationRow {...makeProps()} />);

    expect(screen.getByTestId('icon-pound')).toBeInTheDocument();
  });

  // CMP-ROW-002: Dispatch conversation always shows Pound icon (avatar emoji no longer used for dispatch)
  it('CMP-ROW-002: renders Pound icon for dispatch conversation even when teammateConfig has avatar', () => {
    const conv = makeConversation({
      extra: {
        dispatchSessionType: 'dispatcher',
        teammateConfig: { avatar: '🎯' },
      },
    });
    render(<ConversationRow {...makeProps({ conversation: conv })} />);

    expect(screen.getByTestId('icon-pound')).toBeInTheDocument();
  });

  // CMP-ROW-003: Dispatch conversation shows child task count badge
  it('CMP-ROW-003: shows child task count badge when childTaskCount > 0', () => {
    render(<ConversationRow {...makeProps({ childTaskCount: 3 })} />);

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  // CMP-ROW-004: Dispatch conversation hides badge when childTaskCount is 0
  it('CMP-ROW-004: does not show badge when childTaskCount is 0', () => {
    render(<ConversationRow {...makeProps({ childTaskCount: 0 })} />);

    // 0 count should not be displayed per the condition: childTaskCount > 0
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  // CMP-ROW-005: Clicking row triggers onConversationClick
  it('CMP-ROW-005: clicking the row calls onConversationClick', () => {
    const onConversationClick = vi.fn();
    render(<ConversationRow {...makeProps({ onConversationClick })} />);

    const row = screen.getByText('My Group Chat').closest('[class*="chat-history__item"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    expect(onConversationClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'dispatch-1' }));
  });

  // CMP-ROW-006: Batch mode click toggles checked instead of navigating
  it('CMP-ROW-006: clicking row in batchMode calls onToggleChecked, not onConversationClick', () => {
    const onConversationClick = vi.fn();
    const onToggleChecked = vi.fn();
    render(<ConversationRow {...makeProps({ batchMode: true, onConversationClick, onToggleChecked })} />);

    const row = screen.getByText('My Group Chat').closest('[class*="chat-history__item"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    expect(onToggleChecked).toHaveBeenCalledWith(expect.objectContaining({ id: 'dispatch-1' }));
    expect(onConversationClick).not.toHaveBeenCalled();
  });

  // CMP-ROW-007: Dispatch conversation with undefined extra still renders Pound icon
  // (dispatch type check happens before extra access in renderLeadingIcon)
  it('CMP-ROW-007: renders Pound icon for dispatch conversation even with undefined extra', () => {
    const conv = makeConversation({ extra: undefined });
    render(<ConversationRow {...makeProps({ conversation: conv })} />);

    expect(screen.getByTestId('icon-pound')).toBeInTheDocument();
  });

  // CMP-ROW-008: Dispatch conversation with empty name shows Pound icon fallback
  it('CMP-ROW-008: renders Pound icon fallback when conversation name is empty', () => {
    const conv = makeConversation({ name: '' });
    render(<ConversationRow {...makeProps({ conversation: conv })} />);

    // The component uses conversation.name || t('conversation.welcome.newConversation')
    // for the tooltip; the row itself shows the Pound icon
    expect(screen.getByTestId('icon-pound')).toBeInTheDocument();
  });
});
