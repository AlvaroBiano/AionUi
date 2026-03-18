/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatLayout from '../../src/renderer/pages/conversation/ChatLayout';

const chatLayoutMocks = vi.hoisted(() => ({
  openTabs: [] as Array<{ id: string; name: string; workspace: string; type: 'gemini' }>,
  updateTabName: vi.fn(),
  setSiderCollapsed: vi.fn(),
  setSplitRatio: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('../../src/common', () => ({
  ipcBridge: {
    conversation: {
      update: {
        invoke: chatLayoutMocks.invoke,
      },
    },
  },
}));

vi.mock('../../src/common/storage', () => ({
  ConfigStorage: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/common/storageKeys', () => ({
  STORAGE_KEYS: {
    WORKSPACE_PANEL_COLLAPSE: 'workspace-panel-collapse',
  },
}));

vi.mock('../../src/renderer/components/AgentModeSelector', () => ({
  default: () => <div data-testid='agent-mode-selector' />,
}));

vi.mock('../../src/renderer/components/FlexFullContainer', () => ({
  default: ({
    children,
    className,
    containerClassName,
  }: React.PropsWithChildren<{ className?: string; containerClassName?: string }>) => (
    <div className={className}>
      <div className={containerClassName}>{children}</div>
    </div>
  ),
}));

vi.mock('../../src/renderer/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
    siderCollapsed: false,
    setSiderCollapsed: chatLayoutMocks.setSiderCollapsed,
  }),
}));

vi.mock('../../src/renderer/hooks/useResizableSplit', () => ({
  useResizableSplit: () => ({
    splitRatio: 30,
    setSplitRatio: chatLayoutMocks.setSplitRatio,
    createDragHandle: () => null,
  }),
}));

vi.mock('../../src/renderer/pages/conversation/ConversationTabs', () => ({
  default: () => null,
}));

vi.mock('../../src/renderer/pages/conversation/context/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    openTabs: chatLayoutMocks.openTabs,
    updateTabName: chatLayoutMocks.updateTabName,
  }),
}));

vi.mock('../../src/renderer/pages/conversation/preview', () => ({
  PreviewPanel: () => <div data-testid='preview-panel' />,
  usePreviewContext: () => ({
    isOpen: false,
  }),
}));

vi.mock('../../src/renderer/pages/conversation/components/ConversationTitleMinimap', () => ({
  default: ({ conversationId }: { conversationId?: string }) => (
    <button aria-label='Search conversation' type='button'>
      {conversationId}
    </button>
  ),
}));

vi.mock('../../src/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

vi.mock('../../src/renderer/utils/focus', () => ({
  blurActiveElement: vi.fn(),
}));

vi.mock('../../src/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('../../src/renderer/utils/workspaceEvents', () => ({
  WORKSPACE_HAS_FILES_EVENT: 'workspace-has-files',
  WORKSPACE_TOGGLE_EVENT: 'workspace-toggle',
  dispatchWorkspaceStateEvent: vi.fn(),
  dispatchWorkspaceToggleEvent: vi.fn(),
}));

vi.mock('../../src/types/acpTypes', () => ({
  ACP_BACKENDS_ALL: {
    gemini: {
      name: 'Gemini',
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('swr', () => ({
  default: () => ({
    data: undefined,
  }),
}));

describe('ChatLayout', () => {
  beforeEach(() => {
    chatLayoutMocks.openTabs = [];
    chatLayoutMocks.updateTabName.mockReset();
    chatLayoutMocks.setSiderCollapsed.mockReset();
    chatLayoutMocks.setSplitRatio.mockReset();
    chatLayoutMocks.invoke.mockReset();
  });

  it('keeps the conversation search entry visible when tabs are open', () => {
    chatLayoutMocks.openTabs = [{ id: 'conv-1', name: 'Test Conversation', workspace: 'E:/workspace', type: 'gemini' }];

    render(
      <ChatLayout
        title='Test Conversation'
        sider={<div>workspace</div>}
        siderTitle='Workspace'
        backend='gemini'
        conversationId='conv-1'
      >
        <div>chat body</div>
      </ChatLayout>
    );

    expect(screen.getByLabelText('Search conversation')).toBeInTheDocument();
  });
});
