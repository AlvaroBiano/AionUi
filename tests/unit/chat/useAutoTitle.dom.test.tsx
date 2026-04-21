import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import type { TMessage } from '@/common/chat/chatLib';

const conversationGetMock = vi.fn();
const conversationUpdateMock = vi.fn();
const getConversationMessagesMock = vi.fn();
const updateTabNameMock = vi.fn();
const emitterEmitMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: {
        invoke: (...args: unknown[]) => conversationGetMock(...args),
      },
      update: {
        invoke: (...args: unknown[]) => conversationUpdateMock(...args),
      },
    },
    database: {
      getConversationMessages: {
        invoke: (...args: unknown[]) => getConversationMessagesMock(...args),
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: () => 'New Chat',
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    updateTabName: updateTabNameMock,
  }),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => emitterEmitMock(...args),
  },
}));

const createUserMessage = (content: string): TMessage => ({
  id: content,
  conversation_id: 'conv-1',
  type: 'text',
  position: 'right',
  content: { content },
  createdAt: Date.now(),
});

describe('useAutoTitle – happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the first user message from history for the title', async () => {
    conversationGetMock.mockResolvedValue({ id: 'conv-1', name: 'New Chat' });
    getConversationMessagesMock.mockResolvedValue([
      createUserMessage('帮我整理一个 monorepo CI 失败排查清单'),
      createUserMessage('继续'),
    ]);
    conversationUpdateMock.mockResolvedValue(true);

    const { result } = renderHook(() => useAutoTitle());

    await result.current.checkAndUpdateTitle('conv-1', '继续');

    expect(conversationUpdateMock).toHaveBeenCalledWith({
      id: 'conv-1',
      updates: { name: '帮我整理一个 monorepo CI 失败排查清单' },
    });
    expect(updateTabNameMock).toHaveBeenCalledWith('conv-1', '帮我整理一个 monorepo CI 失败排查清单');
    expect(emitterEmitMock).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('falls back to the current input when history is still empty', async () => {
    conversationGetMock.mockResolvedValue({ id: 'conv-1', name: 'New Chat' });
    getConversationMessagesMock.mockResolvedValue([]);
    conversationUpdateMock.mockResolvedValue(true);

    const { result } = renderHook(() => useAutoTitle());

    await result.current.checkAndUpdateTitle('conv-1', '继续');

    expect(conversationUpdateMock).toHaveBeenCalledWith({
      id: 'conv-1',
      updates: { name: '继续' },
    });
  });
});

// ---------------------------------------------------------------------------
// syncTitleFromHistory – branch coverage (P1)
// Guard: manually-renamed conversations must NOT be overwritten by auto-title
// ---------------------------------------------------------------------------
describe('useAutoTitle – syncTitleFromHistory: already-renamed conversation guard (P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT overwrite a conversation that has already been renamed (name !== defaultTitle)', async () => {
    // Conversation has a custom name — not the default "New Chat"
    conversationGetMock.mockResolvedValue({ id: 'conv-1', name: 'My Project Notes' });

    const { result } = renderHook(() => useAutoTitle());

    await result.current.syncTitleFromHistory('conv-1');

    // Should bail out early — no messages fetched, no update called
    expect(getConversationMessagesMock).not.toHaveBeenCalled();
    expect(conversationUpdateMock).not.toHaveBeenCalled();
    expect(updateTabNameMock).not.toHaveBeenCalled();
  });

  it('does NOT update when conversation.get returns null (deleted/not found)', async () => {
    conversationGetMock.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoTitle());

    await result.current.syncTitleFromHistory('conv-missing');

    expect(getConversationMessagesMock).not.toHaveBeenCalled();
    expect(conversationUpdateMock).not.toHaveBeenCalled();
    expect(updateTabNameMock).not.toHaveBeenCalled();
  });

  it('does NOT call updateTabName when conversation.update returns falsy', async () => {
    conversationGetMock.mockResolvedValue({ id: 'conv-1', name: 'New Chat' });
    getConversationMessagesMock.mockResolvedValue([createUserMessage('Hello world')]);
    // IPC update fails
    conversationUpdateMock.mockResolvedValue(false);

    const { result } = renderHook(() => useAutoTitle());

    await result.current.syncTitleFromHistory('conv-1');

    expect(conversationUpdateMock).toHaveBeenCalled();
    // updateTabName must NOT be called since the persistence failed
    expect(updateTabNameMock).not.toHaveBeenCalled();
    expect(emitterEmitMock).not.toHaveBeenCalled();
  });

  it('does NOT call updateTabName when conversation.update returns null', async () => {
    conversationGetMock.mockResolvedValue({ id: 'conv-1', name: 'New Chat' });
    getConversationMessagesMock.mockResolvedValue([createUserMessage('Hello world')]);
    conversationUpdateMock.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoTitle());

    await result.current.syncTitleFromHistory('conv-1');

    expect(updateTabNameMock).not.toHaveBeenCalled();
  });

  it('does NOT update when no title can be derived (no messages, no fallback)', async () => {
    conversationGetMock.mockResolvedValue({ id: 'conv-1', name: 'New Chat' });
    getConversationMessagesMock.mockResolvedValue([]);

    const { result } = renderHook(() => useAutoTitle());

    // syncTitleFromHistory with no fallbackContent
    await result.current.syncTitleFromHistory('conv-1');

    expect(conversationUpdateMock).not.toHaveBeenCalled();
    expect(updateTabNameMock).not.toHaveBeenCalled();
  });

  it('handles IPC conversation.get throwing an error without crashing', async () => {
    conversationGetMock.mockRejectedValue(new Error('IPC error'));

    const { result } = renderHook(() => useAutoTitle());

    // Should not throw
    await expect(result.current.syncTitleFromHistory('conv-1')).resolves.toBeUndefined();

    expect(conversationUpdateMock).not.toHaveBeenCalled();
    expect(updateTabNameMock).not.toHaveBeenCalled();
  });
});
