/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';

const mockMessageList = vi.hoisted(() => vi.fn<[], TMessage[]>(() => []));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => mockMessageList(),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => null,
}));

vi.mock('@/renderer/hooks/file/useAutoPreviewOfficeFiles', () => ({
  useAutoPreviewOfficeFiles: () => undefined,
}));

vi.mock('@/renderer/pages/conversation/Messages/useAutoScroll', () => ({
  useAutoScroll: () => ({
    virtuosoRef: { current: null },
    handleScrollerRef: vi.fn(),
    handleScroll: vi.fn(),
    handleAtBottomStateChange: vi.fn(),
    handleFollowOutput: vi.fn(),
    showScrollButton: false,
    scrollToBottom: vi.fn(),
    hideScrollButton: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, key: 'default' }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data }: { data: unknown[] }) => <div data-testid='virtuoso' data-count={data.length} />,
}));

vi.mock('@arco-design/web-react', () => ({
  Image: {
    PreviewGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span data-testid='icon-down' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

vi.mock('@/renderer/utils/common', () => ({
  uuid: () => 'test-uuid',
}));

vi.mock('@/renderer/utils/chat/chatMinimapEvents', () => ({
  CHAT_MESSAGE_JUMP_EVENT: 'chat:message:jump',
}));

vi.mock('@/renderer/pages/conversation/Messages/components/SelectionReplyButton', () => ({
  default: () => null,
}));

// Mock all message sub-components to avoid deep render trees
vi.mock('@/renderer/pages/conversation/Messages/components/MessagetText', () => ({
  default: () => <div data-testid='message-text' />,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageTips', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolCall', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroup', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageAgentStatus', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpPermission', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/codex/MessageCodexToolCall', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/codex/MessageFileChanges', () => ({
  default: () => null,
  parseDiff: vi.fn(() => ({})),
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessagePlan', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageThinking', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageCronTrigger', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageSkillSuggest', () => ({
  default: () => null,
}));
vi.mock('./messages.css', () => ({}));
vi.mock('@/renderer/pages/conversation/Messages/messages.css', () => ({}));
vi.mock('@renderer/utils/ui/HOC', () => {
  const hoc = Object.assign((_outer: React.FC<any>) => (inner: React.FC<any>) => inner, {
    Create: (comp: React.FC<any>) => comp,
    Wrapper:
      (..._comps: unknown[]) =>
      (comp: React.FC<any>) =>
        comp,
    Hook:
      (..._hooks: unknown[]) =>
      (comp: React.FC<any>) =>
        comp,
  });
  return { default: hoc };
});

import MessageList from '@/renderer/pages/conversation/Messages/MessageList';

describe('MessageList emptySlot', () => {
  it('renders emptySlot when message list is empty and emptySlot is provided', () => {
    mockMessageList.mockReturnValue([]);

    render(<MessageList emptySlot={<div data-testid='empty-state'>No messages yet</div>} />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(screen.queryByTestId('virtuoso')).not.toBeInTheDocument();
  });

  it('does not render emptySlot when message list is non-empty', () => {
    const message: TMessage = {
      id: 'msg-1',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      content: { content: 'Hello' },
    };
    mockMessageList.mockReturnValue([message]);

    render(<MessageList emptySlot={<div data-testid='empty-state'>No messages yet</div>} />);

    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    expect(screen.getByTestId('virtuoso')).toBeInTheDocument();
  });

  it('renders Virtuoso when emptySlot is not provided even if list is empty', () => {
    mockMessageList.mockReturnValue([]);

    render(<MessageList />);

    expect(screen.getByTestId('virtuoso')).toBeInTheDocument();
  });

  it('centers the emptySlot container', () => {
    mockMessageList.mockReturnValue([]);

    const { container } = render(<MessageList emptySlot={<div data-testid='empty-state' />} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('items-center');
    expect(wrapper.className).toContain('justify-center');
  });
});
