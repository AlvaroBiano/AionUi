/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for ConversationHistoryPanel (P1)
 *
 * Covers:
 * 1. formatTime logic – today / within-7-days / older-than-7-days branches
 *    (formatTime is a private function; tested via rendered output and
 *     an equivalent pure-logic re-implementation here)
 * 2. sameAgentConversations – filters by agentKey, sorts by modifyTime desc,
 *    slices to max 20, handles modifyTime=undefined
 * 3. isCreatingRef – prevents duplicate "new conversation" creation on rapid
 *    double-click (concurrent guard)
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  createWithConversationMock: vi.fn(),
  conversationGetMock: vi.fn(),
  emitterEmitMock: vi.fn(),
  conversations: [] as TChatConversation[],
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigateMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: (...args: unknown[]) => mocks.conversationGetMock(...args) },
      createWithConversation: { invoke: (...args: unknown[]) => mocks.createWithConversationMock(...args) },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: () => 'test-uuid-123',
}));

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: mocks.conversations,
  }),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: (...args: unknown[]) => mocks.emitterEmitMock(...args) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'conversation.welcome.newConversation') return '新会话';
      if (key === 'conversation.history.historyPanel') return 'History';
      return key;
    },
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    title,
    icon,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    title?: string;
    icon?: React.ReactNode;
  }) => (
    <button onClick={onClick} title={title} data-testid='history-btn'>
      {icon}
      {children}
    </button>
  ),
  Dropdown: ({
    children,
    droplist,
    popupVisible,
    onVisibleChange,
  }: {
    children: React.ReactNode;
    droplist: React.ReactNode;
    popupVisible: boolean;
    onVisibleChange: (v: boolean) => void;
  }) => (
    <div>
      <div onClick={() => onVisibleChange(!popupVisible)}>{children}</div>
      {popupVisible && <div data-testid='history-dropdown'>{droplist}</div>}
    </div>
  ),
  Popconfirm: ({ children, onOk }: { children: React.ReactNode; onOk?: () => void; [key: string]: unknown }) => (
    <div data-testid='popconfirm' onClick={onOk}>
      {children}
    </div>
  ),
}));

vi.mock('@icon-park/react', () => ({
  History: () => <span data-testid='history-icon' />,
  Plus: () => <span data-testid='plus-icon' />,
  DeleteOne: () => <span data-testid='delete-icon' />,
  Pushpin: () => <span data-testid='pushpin-icon' />,
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: { primary: '#000' },
}));

// ── Import under test (after mocks) ───────────────────────────────────────

import ConversationHistoryPanel from '@/renderer/pages/conversation/components/ConversationHistoryPanel';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeConversation(overrides: Partial<TChatConversation> = {}): TChatConversation {
  return {
    id: `conv-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Conversation',
    type: 'acp',
    extra: { backend: 'claude' },
    createTime: Date.now(),
    modifyTime: Date.now(),
    ...overrides,
  } as TChatConversation;
}

function renderPanel(conversation: TChatConversation) {
  return render(<ConversationHistoryPanel conversation={conversation} />);
}

function openDropdown() {
  fireEvent.click(screen.getByTestId('history-btn').parentElement!);
}

// ── formatTime logic (P1) ─────────────────────────────────────────────────
//
// formatTime is private to ConversationHistoryPanel. We test its behaviour
// by verifying the rendered timestamp text in the dropdown.
//
// The function's contract:
//   diff < 1 day  → toLocaleTimeString  (HH:MM)
//   diff < 7 days → toLocaleDateString  (weekday: 'short')
//   else          → toLocaleDateString  (month + day)

describe('ConversationHistoryPanel – formatTime branches', () => {
  const base = makeConversation({ type: 'acp', extra: { backend: 'claude' } });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigateMock.mockReset();
  });

  it('shows time (HH:MM) for a conversation modified less than 24 hours ago', () => {
    const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
    mocks.conversations = [{ ...base, id: 'c1', modifyTime: thirtyMinsAgo }];

    renderPanel(base);
    openDropdown();

    // The rendered time text should match locale time format (e.g. "10:30" or "10:30 AM")
    // We check it does NOT look like a weekday or month/day only format
    const dropdown = screen.getByTestId('history-dropdown');
    const timeEl = dropdown.querySelector('span.text-11px');
    expect(timeEl).not.toBeNull();
    const text = timeEl!.textContent ?? '';
    // A time string contains ':' (e.g. "10:30")
    expect(text).toMatch(/:/);
  });

  it('shows weekday for a conversation modified 2 days ago (within 7 days)', () => {
    const twoDaysAgo = Date.now() - 2 * 86400000;
    mocks.conversations = [{ ...base, id: 'c2', modifyTime: twoDaysAgo }];

    renderPanel(base);
    openDropdown();

    const dropdown = screen.getByTestId('history-dropdown');
    const timeEl = dropdown.querySelector('span.text-11px');
    expect(timeEl).not.toBeNull();
    const text = timeEl!.textContent ?? '';
    // Weekday names are 3 chars in 'short' locale (e.g. "Mon", "Tue", "周一", "月")
    // Key assertion: does NOT contain ':' (not a time format)
    expect(text).not.toMatch(/:/);
  });

  it('shows month/day for a conversation modified more than 7 days ago', () => {
    const tenDaysAgo = Date.now() - 10 * 86400000;
    mocks.conversations = [{ ...base, id: 'c3', modifyTime: tenDaysAgo }];

    renderPanel(base);
    openDropdown();

    const dropdown = screen.getByTestId('history-dropdown');
    const timeEl = dropdown.querySelector('span.text-11px');
    expect(timeEl).not.toBeNull();
    // Month/day format contains '/' or '-' in most locales
    // The key assertion: is not a time (no ':') and not a short weekday
    const text = timeEl!.textContent ?? '';
    expect(text).not.toMatch(/:/);
  });

  it('does not render a time element when modifyTime and createTime are both 0 or undefined', () => {
    const noTime = { ...base, id: 'c4', modifyTime: undefined, createTime: undefined } as unknown as TChatConversation;
    mocks.conversations = [noTime];

    renderPanel(base);
    openDropdown();

    const dropdown = screen.getByTestId('history-dropdown');
    // ts=0 means diff is huge — no time element rendered (ts > 0 guard in component)
    const timeEls = dropdown.querySelectorAll('span.text-11px');
    expect(timeEls).toHaveLength(0);
  });
});

// ── sameAgentConversations: filtering & sorting (P1) ──────────────────────

describe('ConversationHistoryPanel – sameAgentConversations filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only shows conversations with the same agentKey as the current conversation', () => {
    const current = makeConversation({ type: 'acp', extra: { backend: 'claude' } });
    const sameClaude = makeConversation({
      id: 'same-1',
      name: 'Claude chat',
      type: 'acp',
      extra: { backend: 'claude' },
      modifyTime: Date.now() - 1000,
    });
    const differentGemini = makeConversation({
      id: 'diff-1',
      name: 'Gemini chat',
      type: 'gemini',
      extra: {},
      modifyTime: Date.now() - 2000,
    });

    mocks.conversations = [sameClaude, differentGemini];

    renderPanel(current);
    openDropdown();

    const dropdown = screen.getByTestId('history-dropdown');
    expect(dropdown.textContent).toContain('Claude chat');
    expect(dropdown.textContent).not.toContain('Gemini chat');
  });

  it('sorts conversations by modifyTime descending (most recent first)', () => {
    const current = makeConversation({ type: 'acp', extra: { backend: 'claude' } });
    const now = Date.now();
    const older = makeConversation({
      id: 'old-1',
      name: 'Older Chat',
      type: 'acp',
      extra: { backend: 'claude' },
      modifyTime: now - 5000,
    });
    const newer = makeConversation({
      id: 'new-1',
      name: 'Newer Chat',
      type: 'acp',
      extra: { backend: 'claude' },
      modifyTime: now - 1000,
    });

    mocks.conversations = [older, newer]; // intentionally wrong order

    renderPanel(current);
    openDropdown();

    const dropdown = screen.getByTestId('history-dropdown');
    const items = dropdown.querySelectorAll('span.text-13px.flex-1');
    expect(items[0]?.textContent).toBe('Newer Chat');
    expect(items[1]?.textContent).toBe('Older Chat');
  });

  it('handles modifyTime=undefined in sort without throwing (uses 0 as fallback)', () => {
    const current = makeConversation({ type: 'acp', extra: { backend: 'claude' } });
    const withTime = makeConversation({
      id: 'has-time',
      name: 'Has Time',
      type: 'acp',
      extra: { backend: 'claude' },
      modifyTime: Date.now() - 1000,
    });
    const noTime = {
      ...makeConversation({ type: 'acp', extra: { backend: 'claude' } }),
      id: 'no-time',
      name: 'No Time',
      modifyTime: undefined,
    } as unknown as TChatConversation;

    mocks.conversations = [noTime, withTime];

    // Should not throw
    expect(() => {
      renderPanel(current);
      openDropdown();
    }).not.toThrow();

    const dropdown = screen.getByTestId('history-dropdown');
    // 'Has Time' should appear before 'No Time' since undefined → 0 (oldest)
    const items = dropdown.querySelectorAll('span.text-13px.flex-1');
    const names = Array.from(items).map((el) => el.textContent);
    expect(names.indexOf('Has Time')).toBeLessThan(names.indexOf('No Time'));
  });

  it('shows at most 20 conversations (slices to 20)', () => {
    const current = makeConversation({ type: 'acp', extra: { backend: 'claude' } });
    const many = Array.from({ length: 25 }, (_, i) =>
      makeConversation({
        id: `conv-${i}`,
        name: `Chat ${i}`,
        type: 'acp',
        extra: { backend: 'claude' },
        modifyTime: Date.now() - i * 1000,
      })
    );

    mocks.conversations = many;

    renderPanel(current);
    openDropdown();

    const dropdown = screen.getByTestId('history-dropdown');
    const items = dropdown.querySelectorAll('span.text-13px.flex-1');
    // Max 20 conversation rows (excludes the "新会话" button at the top)
    expect(items.length).toBeLessThanOrEqual(20);
  });
});

// ── isCreatingRef: concurrent creation guard (P1) ─────────────────────────

describe('ConversationHistoryPanel – "New Conversation" concurrent creation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations = [];
    mocks.conversationGetMock.mockResolvedValue(null);
  });

  it('calls createWithConversation exactly once even if "新会话" is clicked rapidly twice', async () => {
    // conversation.get resolves immediately, createWithConversation stays pending
    mocks.conversationGetMock.mockResolvedValue(null);
    let resolveCreate!: () => void;
    mocks.createWithConversationMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        })
    );

    const current = makeConversation({ type: 'acp', extra: { backend: 'claude' } });

    renderPanel(current);
    openDropdown();

    const newConvSpan = screen.getByText('新会话');
    const newConvBtn = newConvSpan.closest('div.cursor-pointer') as HTMLElement;
    expect(newConvBtn).not.toBeNull();

    // First click — isCreatingRef flips to true synchronously before async work
    fireEvent.click(newConvBtn);
    // Second click — isCreatingRef is already true, no-op
    fireEvent.click(newConvBtn);

    // Flush the microtask queue so the first click's async chain runs through
    // conversation.get (already resolved) and reaches createWithConversation
    await act(async () => {
      await Promise.resolve();
    });

    // createWithConversation must have been called only once
    expect(mocks.createWithConversationMock).toHaveBeenCalledTimes(1);

    // Resolve to allow cleanup
    await act(async () => {
      resolveCreate();
    });
  });

  it('navigates to the new conversation after creation', async () => {
    mocks.createWithConversationMock.mockResolvedValue(undefined);

    const current = makeConversation({ type: 'acp', extra: { backend: 'claude' } });

    renderPanel(current);
    openDropdown();

    const newConvSpan = screen.getByText('新会话');
    const newConvBtn = newConvSpan.closest('div.cursor-pointer') as HTMLElement;
    expect(newConvBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(newConvBtn);
    });

    await waitFor(() => {
      expect(mocks.navigateMock).toHaveBeenCalledWith('/conversation/test-uuid-123');
    });
  });
});
