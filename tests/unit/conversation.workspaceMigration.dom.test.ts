/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceMigration } from '../../src/renderer/pages/conversation/Workspace/hooks/useWorkspaceMigration';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // IPC bridge
  showItemInFolder: vi.fn(),
  showOpenDialog: vi.fn(),
  getUserConversations: vi.fn(),
  getWorkspace: vi.fn(),
  copyFilesToWorkspace: vi.fn(),
  createWithConversation: vi.fn(),
  // cron
  listJobsByConversation: vi.fn(),
  onJobCreated: { on: vi.fn(() => vi.fn()) },
  onJobUpdated: { on: vi.fn(() => vi.fn()) },
  onJobRemoved: { on: vi.fn(() => vi.fn()) },
  // navigation
  navigate: vi.fn(),
  // emitter
  emit: vi.fn(),
  // platform
  isElectronDesktop: vi.fn(() => false),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { showItemInFolder: { invoke: mocks.showItemInFolder } },
    dialog: { showOpen: { invoke: mocks.showOpenDialog } },
    database: { getUserConversations: { invoke: mocks.getUserConversations } },
    conversation: {
      getWorkspace: { invoke: mocks.getWorkspace },
      createWithConversation: { invoke: mocks.createWithConversation },
    },
    fs: { copyFilesToWorkspace: { invoke: mocks.copyFilesToWorkspace } },
    cron: {
      listJobsByConversation: { invoke: mocks.listJobsByConversation },
      onJobCreated: mocks.onJobCreated,
      onJobUpdated: mocks.onJobUpdated,
      onJobRemoved: mocks.onJobRemoved,
      updateJob: { invoke: vi.fn() },
      removeJob: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: mocks.isElectronDesktop,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: mocks.emit },
}));

vi.mock('@/common/utils', () => ({
  uuid: () => 'new-uuid-123',
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const messageApiMock = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

const t = (key: string) => key;

function makeHook(overrides: { conversationId?: string; workspace?: string; isTemporaryWorkspace?: boolean }) {
  return renderHook(() =>
    useWorkspaceMigration({
      conversation_id: overrides.conversationId ?? 'conv-1',
      workspace: overrides.workspace ?? '/tmp/workspace',
      messageApi: messageApiMock,
      t,
      isTemporaryWorkspace: overrides.isTemporaryWorkspace ?? true,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – initial state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
  });

  it('showMigrationModal starts as false', () => {
    const { result } = makeHook({});
    expect(result.current.showMigrationModal).toBe(false);
  });

  it('showDirectorySelector starts as false', () => {
    const { result } = makeHook({});
    expect(result.current.showDirectorySelector).toBe(false);
  });

  it('selectedTargetPath starts as empty string', () => {
    const { result } = makeHook({});
    expect(result.current.selectedTargetPath).toBe('');
  });

  it('migrationLoading starts as false', () => {
    const { result } = makeHook({});
    expect(result.current.migrationLoading).toBe(false);
  });

  it('showCronMigrationPrompt starts as false', () => {
    const { result } = makeHook({});
    expect(result.current.showCronMigrationPrompt).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleOpenMigrationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
  });

  it('sets showMigrationModal to true', () => {
    const { result } = makeHook({});

    act(() => {
      result.current.handleOpenMigrationModal();
    });

    expect(result.current.showMigrationModal).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleCloseMigrationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
  });

  it('closes the modal when not loading', () => {
    const { result } = makeHook({});

    act(() => {
      result.current.handleOpenMigrationModal();
    });
    expect(result.current.showMigrationModal).toBe(true);

    act(() => {
      result.current.handleCloseMigrationModal();
    });
    expect(result.current.showMigrationModal).toBe(false);
  });

  it('resets selectedTargetPath when closing', () => {
    const { result } = makeHook({});

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/some/path']);
    });
    expect(result.current.selectedTargetPath).toBe('/some/path');

    act(() => {
      result.current.handleCloseMigrationModal();
    });
    expect(result.current.selectedTargetPath).toBe('');
  });

  it('also resets showCronMigrationPrompt when closing', () => {
    const { result } = makeHook({});

    act(() => {
      result.current.handleCloseMigrationModal();
    });

    expect(result.current.showCronMigrationPrompt).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleSelectDirectoryFromModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
  });

  it('sets selectedTargetPath to the first path from the array', () => {
    const { result } = makeHook({});

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/my/target']);
    });

    expect(result.current.selectedTargetPath).toBe('/my/target');
    expect(result.current.showDirectorySelector).toBe(false);
  });

  it('does not change selectedTargetPath when paths array is empty', () => {
    const { result } = makeHook({});

    act(() => {
      result.current.handleSelectDirectoryFromModal([]);
    });

    expect(result.current.selectedTargetPath).toBe('');
  });

  it('does not change selectedTargetPath when paths is undefined', () => {
    const { result } = makeHook({});

    act(() => {
      result.current.handleSelectDirectoryFromModal(undefined);
    });

    expect(result.current.selectedTargetPath).toBe('');
  });

  it('closes the directory selector even when paths is undefined', () => {
    const { result } = makeHook({});

    // Open directory selector first
    act(() => {
      result.current.closeDirectorySelector();
    });

    act(() => {
      result.current.handleSelectDirectoryFromModal(undefined);
    });

    expect(result.current.showDirectorySelector).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleSelectFolder (WebUI mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
    mocks.isElectronDesktop.mockReturnValue(false);
  });

  it('opens the directory selector modal when not on Electron', async () => {
    const { result } = makeHook({});

    await act(async () => {
      await result.current.handleSelectFolder();
    });

    expect(result.current.showDirectorySelector).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleSelectFolder (Electron mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
    mocks.isElectronDesktop.mockReturnValue(true);
  });

  it('calls native dialog and sets selectedTargetPath when Electron returns a path', async () => {
    mocks.showOpenDialog.mockResolvedValue(['/native/path']);
    const { result } = makeHook({});

    await act(async () => {
      await result.current.handleSelectFolder();
    });

    expect(mocks.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] });
    expect(result.current.selectedTargetPath).toBe('/native/path');
  });

  it('does not set path when dialog returns empty array', async () => {
    mocks.showOpenDialog.mockResolvedValue([]);
    const { result } = makeHook({});

    await act(async () => {
      await result.current.handleSelectFolder();
    });

    expect(result.current.selectedTargetPath).toBe('');
  });

  it('shows error message when dialog throws', async () => {
    mocks.showOpenDialog.mockRejectedValue(new Error('dialog error'));
    const { result } = makeHook({});

    await act(async () => {
      await result.current.handleSelectFolder();
    });

    expect(messageApiMock.error).toHaveBeenCalledWith('conversation.workspace.migration.selectFolderError');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleMigrationConfirm: validation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
  });

  it('shows error when isTemporaryWorkspace is false', async () => {
    const { result } = makeHook({ isTemporaryWorkspace: false });

    await act(async () => {
      await result.current.handleMigrationConfirm();
    });

    expect(messageApiMock.error).toHaveBeenCalledWith('conversation.workspace.migration.error');
  });

  it('shows error when no target path is selected', async () => {
    const { result } = makeHook({ isTemporaryWorkspace: true });

    await act(async () => {
      await result.current.handleMigrationConfirm();
    });

    expect(messageApiMock.error).toHaveBeenCalledWith('conversation.workspace.migration.noTargetPath');
  });

  it('shows warning when target path equals source workspace', async () => {
    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/same/path' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/same/path']);
    });

    await act(async () => {
      await result.current.handleMigrationConfirm();
    });

    expect(messageApiMock.warning).toHaveBeenCalledWith('conversation.workspace.migration.selectFolderError');
  });

  it('shows info when cron jobs are still loading', async () => {
    // Override mock to stay in loading state
    let resolveJobFetch: (value: any[]) => void;
    mocks.listJobsByConversation.mockReturnValue(
      new Promise((resolve) => {
        resolveJobFetch = resolve;
      })
    );

    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/source' });

    // Select a valid different target path
    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    // Don't resolve the jobs fetch yet — cronLoading is still true
    await act(async () => {
      await result.current.handleMigrationConfirm();
    });

    expect(messageApiMock.info).toHaveBeenCalledWith('common.loading');

    // Clean up
    resolveJobFetch!([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleMigrationConfirm: cron jobs prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows cron migration prompt when there are cron jobs', async () => {
    mocks.listJobsByConversation.mockResolvedValue([
      { id: 'job-1', metadata: { conversationId: 'conv-1' }, state: { lastStatus: 'success' }, enabled: true },
    ]);

    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/source' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    // Wait for jobs to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      await result.current.handleMigrationConfirm();
    });

    expect(result.current.showCronMigrationPrompt).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – executeMigration: success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
    mocks.isElectronDesktop.mockReturnValue(false);
    mocks.getUserConversations.mockResolvedValue([
      {
        id: 'conv-1',
        name: 'My Conversation',
        createTime: 1000,
        modifyTime: 1000,
        extra: { workspace: '/tmp/workspace', customWorkspace: false },
      },
    ]);
    mocks.getWorkspace.mockResolvedValue([]);
    mocks.copyFilesToWorkspace.mockResolvedValue({ success: true });
    mocks.createWithConversation.mockResolvedValue({ id: 'new-uuid-123' });
  });

  it('navigates to new conversation on success', async () => {
    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    expect(mocks.navigate).toHaveBeenCalledWith('/conversation/new-uuid-123');
  });

  it('emits chat.history.refresh after success', async () => {
    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('shows success message', async () => {
    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    expect(messageApiMock.success).toHaveBeenCalledWith('conversation.workspace.migration.success');
  });

  it('resets modal state after success', async () => {
    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleOpenMigrationModal();
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    expect(result.current.showMigrationModal).toBe(false);
    expect(result.current.selectedTargetPath).toBe('');
    expect(result.current.migrationLoading).toBe(false);
  });

  it('skips file copy when workspace is empty (no files)', async () => {
    mocks.getWorkspace.mockResolvedValue([]);
    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    // copyFilesToWorkspace should not be called when there are no files
    expect(mocks.copyFilesToWorkspace).not.toHaveBeenCalled();
    expect(mocks.createWithConversation).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – executeMigration: error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
    mocks.isElectronDesktop.mockReturnValue(false);
  });

  it('shows error when conversation is not found', async () => {
    mocks.getUserConversations.mockResolvedValue([]);

    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    expect(messageApiMock.error).toHaveBeenCalledWith('conversation.workspace.migration.error');
    expect(result.current.migrationLoading).toBe(false);
  });

  it('shows error when file copy fails', async () => {
    mocks.getUserConversations.mockResolvedValue([
      {
        id: 'conv-1',
        name: 'Chat',
        createTime: 1000,
        modifyTime: 1000,
        extra: { workspace: '/tmp/workspace' },
      },
    ]);
    mocks.getWorkspace.mockResolvedValue([
      { isFile: true, fullPath: '/tmp/workspace/file.txt', name: 'file.txt', isDir: false, relativePath: 'file.txt' },
    ]);
    mocks.copyFilesToWorkspace.mockResolvedValue({ success: false, msg: 'Permission denied' });

    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    expect(messageApiMock.error).toHaveBeenCalledWith('conversation.workspace.migration.error');
    expect(result.current.migrationLoading).toBe(false);
  });

  it('resets migrationLoading to false on error', async () => {
    mocks.getUserConversations.mockRejectedValue(new Error('DB error'));

    const { result } = makeHook({ isTemporaryWorkspace: true, workspace: '/tmp/workspace' });

    act(() => {
      result.current.handleSelectDirectoryFromModal(['/target']);
    });

    await act(async () => {
      await result.current.executeMigration(false);
    });

    expect(result.current.migrationLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWorkspaceMigration – handleOpenWorkspaceRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listJobsByConversation.mockResolvedValue([]);
  });

  it('calls showItemInFolder with the workspace path', async () => {
    mocks.showItemInFolder.mockResolvedValue(undefined);
    const { result } = makeHook({ workspace: '/my/workspace' });

    await act(async () => {
      await result.current.handleOpenWorkspaceRoot();
    });

    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/my/workspace');
  });

  it('shows error when showItemInFolder throws', async () => {
    mocks.showItemInFolder.mockRejectedValue(new Error('permission error'));
    const { result } = makeHook({ workspace: '/my/workspace' });

    await act(async () => {
      await result.current.handleOpenWorkspaceRoot();
    });

    expect(messageApiMock.error).toHaveBeenCalledWith('conversation.workspace.contextMenu.revealFailed');
  });
});
