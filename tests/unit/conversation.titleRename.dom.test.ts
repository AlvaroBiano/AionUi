/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTitleRename } from '../../src/renderer/pages/conversation/hooks/useTitleRename';

// Hoisted mocks
const { invokeConversationUpdateMock, refreshConversationCacheMock, emitMock, messageMock } = vi.hoisted(() => ({
  invokeConversationUpdateMock: vi.fn(),
  refreshConversationCacheMock: vi.fn(),
  emitMock: vi.fn(),
  messageMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      update: {
        invoke: invokeConversationUpdateMock,
      },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  refreshConversationCache: refreshConversationCacheMock,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: emitMock,
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Message: messageMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const updateTabNameMock = vi.fn();

function makeHook(overrides: {
  title?: string;
  conversationId?: string;
  onRename?: (newName: string) => Promise<boolean>;
}) {
  return renderHook(() =>
    useTitleRename({
      title: overrides.title,
      conversationId: overrides.conversationId,
      updateTabName: updateTabNameMock,
      onRename: overrides.onRename,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – initial state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('editingTitle starts as false', () => {
    const { result } = makeHook({ title: 'Hello', conversationId: 'conv-1' });
    expect(result.current.editingTitle).toBe(false);
  });

  it('titleDraft is initialised from string title prop', () => {
    const { result } = makeHook({ title: 'My Chat', conversationId: 'conv-1' });
    expect(result.current.titleDraft).toBe('My Chat');
  });

  it('titleDraft defaults to empty string when title is undefined', () => {
    const { result } = makeHook({ conversationId: 'conv-1' });
    expect(result.current.titleDraft).toBe('');
  });

  it('renameLoading starts as false', () => {
    const { result } = makeHook({ title: 'Hello', conversationId: 'conv-1' });
    expect(result.current.renameLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – canRenameTitle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is true when title is a string and conversationId is provided', () => {
    const { result } = makeHook({ title: 'Chat', conversationId: 'conv-1' });
    expect(result.current.canRenameTitle).toBe(true);
  });

  it('is true when title is a string and onRename callback is provided', () => {
    const { result } = makeHook({ title: 'Chat', onRename: vi.fn().mockResolvedValue(true) });
    expect(result.current.canRenameTitle).toBe(true);
  });

  it('is false when title is undefined', () => {
    const { result } = makeHook({ conversationId: 'conv-1' });
    expect(result.current.canRenameTitle).toBe(false);
  });

  it('is false when title is a string but neither conversationId nor onRename is provided', () => {
    const { result } = makeHook({ title: 'Chat' });
    expect(result.current.canRenameTitle).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – submitTitleRename: empty / whitespace input', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AC29: empty draft reverts to original title and exits editing mode', async () => {
    const { result } = makeHook({ title: 'Original', conversationId: 'conv-1' });

    act(() => result.current.setEditingTitle(true));
    act(() => result.current.setTitleDraft(''));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(result.current.editingTitle).toBe(false);
    expect(result.current.titleDraft).toBe('Original');
    expect(invokeConversationUpdateMock).not.toHaveBeenCalled();
  });

  it('whitespace-only draft reverts to original title and exits editing mode', async () => {
    const { result } = makeHook({ title: 'Original', conversationId: 'conv-1' });

    act(() => result.current.setEditingTitle(true));
    act(() => result.current.setTitleDraft('   '));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(result.current.editingTitle).toBe(false);
    expect(result.current.titleDraft).toBe('Original');
    expect(invokeConversationUpdateMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – submitTitleRename: unchanged title', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exits editing without calling IPC when draft equals current title', async () => {
    const { result } = makeHook({ title: 'Same Title', conversationId: 'conv-1' });

    act(() => result.current.setEditingTitle(true));
    act(() => result.current.setTitleDraft('Same Title'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(result.current.editingTitle).toBe(false);
    expect(invokeConversationUpdateMock).not.toHaveBeenCalled();
  });

  it('trims before comparing: draft with extra spaces equals trimmed original', async () => {
    const { result } = makeHook({ title: 'Title', conversationId: 'conv-1' });

    act(() => result.current.setEditingTitle(true));
    act(() => result.current.setTitleDraft('  Title  '));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(result.current.editingTitle).toBe(false);
    expect(invokeConversationUpdateMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – submitTitleRename: successful rename via IPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls ipcBridge.conversation.update with the trimmed new title', async () => {
    invokeConversationUpdateMock.mockResolvedValue({ id: 'conv-1', name: 'New Name' });
    const { result } = makeHook({ title: 'Old Name', conversationId: 'conv-1' });

    act(() => result.current.setEditingTitle(true));
    act(() => result.current.setTitleDraft('New Name'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(invokeConversationUpdateMock).toHaveBeenCalledWith({
      id: 'conv-1',
      updates: { name: 'New Name' },
    });
  });

  it('calls refreshConversationCache and updateTabName on success', async () => {
    invokeConversationUpdateMock.mockResolvedValue(true);
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setTitleDraft('New'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(refreshConversationCacheMock).toHaveBeenCalledWith('conv-1');
    expect(updateTabNameMock).toHaveBeenCalledWith('conv-1', 'New');
    expect(emitMock).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('shows success message and closes editing mode', async () => {
    invokeConversationUpdateMock.mockResolvedValue(true);
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setEditingTitle(true));
    act(() => result.current.setTitleDraft('New'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(result.current.editingTitle).toBe(false);
    expect(messageMock.success).toHaveBeenCalledWith('conversation.history.renameSuccess');
  });

  it('shows error message and keeps editing open when IPC returns falsy', async () => {
    invokeConversationUpdateMock.mockResolvedValue(null);
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setEditingTitle(true));
    act(() => result.current.setTitleDraft('New'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(messageMock.error).toHaveBeenCalledWith('conversation.history.renameFailed');
    // editingTitle stays true since rename failed
    expect(result.current.editingTitle).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – submitTitleRename: IPC throws exception', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows error message and resets renameLoading when IPC throws', async () => {
    invokeConversationUpdateMock.mockRejectedValue(new Error('Network error'));
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setTitleDraft('New'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(messageMock.error).toHaveBeenCalledWith('conversation.history.renameFailed');
    expect(result.current.renameLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – submitTitleRename: custom onRename callback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls onRename instead of ipcBridge when provided', async () => {
    const onRenameMock = vi.fn().mockResolvedValue(true);
    const { result } = makeHook({ title: 'Old', onRename: onRenameMock });

    act(() => result.current.setTitleDraft('Via Callback'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(onRenameMock).toHaveBeenCalledWith('Via Callback');
    expect(invokeConversationUpdateMock).not.toHaveBeenCalled();
  });

  it('does NOT call refreshConversationCache when using onRename', async () => {
    const onRenameMock = vi.fn().mockResolvedValue(true);
    const { result } = makeHook({ title: 'Old', onRename: onRenameMock });

    act(() => result.current.setTitleDraft('New'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(refreshConversationCacheMock).not.toHaveBeenCalled();
    expect(messageMock.success).toHaveBeenCalled();
  });

  it('shows error message when onRename returns false', async () => {
    const onRenameMock = vi.fn().mockResolvedValue(false);
    const { result } = makeHook({ title: 'Old', onRename: onRenameMock });

    act(() => result.current.setTitleDraft('New'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(messageMock.error).toHaveBeenCalledWith('conversation.history.renameFailed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – AC30: 120-character limit (maxLength contract)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a 120-character title and saves it successfully', async () => {
    invokeConversationUpdateMock.mockResolvedValue(true);
    const title120 = 'A'.repeat(120);
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setTitleDraft(title120));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(invokeConversationUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ updates: { name: title120 } }));
    expect(messageMock.success).toHaveBeenCalled();
  });

  it('does not trim a 120-char title (exact length is preserved)', async () => {
    invokeConversationUpdateMock.mockResolvedValue(true);
    const title120 = 'B'.repeat(120);
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setTitleDraft(title120));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    // The hook does not truncate — it receives whatever the Input component
    // enforced via maxLength={120}. Here we verify the draft is passed as-is.
    const callArg = invokeConversationUpdateMock.mock.calls[0][0];
    expect(callArg.updates.name).toHaveLength(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – special characters in title', () => {
  beforeEach(() => vi.clearAllMocks());

  it('handles title with special characters correctly', async () => {
    invokeConversationUpdateMock.mockResolvedValue(true);
    const specialTitle = '  <script>alert(1)</script>  ';
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setTitleDraft(specialTitle));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    // Trim is applied, so leading/trailing spaces are removed
    expect(invokeConversationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ updates: { name: '<script>alert(1)</script>' } })
    );
  });

  it('handles unicode title (emoji) without errors', async () => {
    invokeConversationUpdateMock.mockResolvedValue(true);
    const emojiTitle = '🚀 AI Chat 🤖';
    const { result } = makeHook({ title: 'Old', conversationId: 'conv-1' });

    act(() => result.current.setTitleDraft(emojiTitle));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(invokeConversationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ updates: { name: emojiTitle } })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – titleDraft syncs when title prop changes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates titleDraft when title prop changes from outside', () => {
    const { result, rerender } = renderHook(
      ({ title }: { title: string }) =>
        useTitleRename({
          title,
          conversationId: 'conv-1',
          updateTabName: updateTabNameMock,
        }),
      { initialProps: { title: 'Original' } }
    );

    expect(result.current.titleDraft).toBe('Original');

    rerender({ title: 'Updated Externally' });

    expect(result.current.titleDraft).toBe('Updated Externally');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTitleRename – submitTitleRename: no-op when canRenameTitle is false', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when neither conversationId nor onRename is provided', async () => {
    const { result } = makeHook({ title: 'Hello' });

    act(() => result.current.setTitleDraft('New Title'));

    await act(async () => {
      await result.current.submitTitleRename();
    });

    expect(invokeConversationUpdateMock).not.toHaveBeenCalled();
    expect(messageMock.success).not.toHaveBeenCalled();
    expect(messageMock.error).not.toHaveBeenCalled();
  });
});
