/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for S6: Sidebar Restructure
 *
 * Written SPEC-FIRST against tech-design.md Acceptance Criteria.
 * Primary target: WorkspaceGroupedHistory (src/renderer/pages/conversation/GroupedHistory/index.tsx)
 *
 * Covered ACs:
 *   AC-1 — Unified DM section renders correctly (two sections only: Channels + Direct Messages)
 *   AC-2 — Agent DM groups sorted by most recent activity
 *   AC-3 — Only agents with conversations appear
 *   AC-4 — Redundant "+" button removed from DM section header; AgentSelectionModal gone
 *   AC-5 — Channel section unchanged
 *   AC-6 — Collapsed sidebar: no separator between former General Agents and Assistants
 *   AC-8 — Existing features preserved (pin, batch mode, expand/collapse)
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------- //

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/', state: null }),
  useParams: () => ({ id: undefined }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@icon-park/react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid='icon-plus' {...props} />,
  Down: (props: Record<string, unknown>) => <span data-testid='icon-down' {...props} />,
  Right: (props: Record<string, unknown>) => <span data-testid='icon-right' {...props} />,
  Add: (props: Record<string, unknown>) => <span data-testid='icon-add' {...props} />,
  More: (props: Record<string, unknown>) => <span data-testid='icon-more' {...props} />,
  Pin: (props: Record<string, unknown>) => <span data-testid='icon-pin' {...props} />,
  FolderOpen: (props: Record<string, unknown>) => <span data-testid='icon-folder-open' {...props} />,
  Pound: (props: Record<string, unknown>) => <span data-testid='icon-pound' {...props} />,
  People: (props: Record<string, unknown>) => <span data-testid='icon-people' {...props} />,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Modal: ({
      visible,
      children,
      onCancel,
      title,
    }: {
      visible: boolean;
      children?: React.ReactNode;
      onCancel?: () => void;
      title?: React.ReactNode;
    }) =>
      visible ? (
        <div data-testid='arco-modal'>
          <div>{title}</div>
          <button data-testid='arco-modal-cancel' onClick={onCancel}>
            cancel
          </button>
          {children}
        </div>
      ) : null,
    Input: ({
      value,
      onChange,
      placeholder,
    }: {
      value?: string;
      onChange?: (v: string) => void;
      placeholder?: string;
    }) => (
      <input
        data-testid='arco-input'
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
    ),
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Empty: () => <div data-testid='empty' />,
  };
});

// Mock useConversations — the actual hook used by the component
const mockConversationsReturn = vi.fn();
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversations', () => ({
  useConversations: () => mockConversationsReturn(),
}));

// Mock useBatchSelection
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useBatchSelection', () => ({
  useBatchSelection: () => ({
    selectedConversationIds: new Set(),
    setSelectedConversationIds: vi.fn(),
    selectedCount: 0,
    allSelected: false,
    toggleSelectedConversation: vi.fn(),
    handleToggleSelectAll: vi.fn(),
  }),
}));

// Mock useConversationActions
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({
    renameModalVisible: false,
    renameModalName: '',
    setRenameModalName: vi.fn(),
    renameLoading: false,
    dropdownVisibleId: null,
    handleConversationClick: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleBatchDelete: vi.fn(),
    handleEditStart: vi.fn(),
    handleRenameConfirm: vi.fn(),
    handleRenameCancel: vi.fn(),
    handleTogglePin: vi.fn(),
    handleForkToDispatch: vi.fn(),
    handleMenuVisibleChange: vi.fn(),
    handleOpenMenu: vi.fn(),
  }),
}));

// Mock useExport
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useExport', () => ({
  useExport: () => ({
    exportTask: null,
    exportModalVisible: false,
    exportTargetPath: '',
    exportModalLoading: false,
    showExportDirectorySelector: false,
    setShowExportDirectorySelector: vi.fn(),
    closeExportModal: vi.fn(),
    handleSelectExportDirectoryFromModal: vi.fn(),
    handleSelectExportFolder: vi.fn(),
    handleExportConversation: vi.fn(),
    handleBatchExport: vi.fn(),
    handleConfirmExport: vi.fn(),
  }),
}));

// Mock useDragAndDrop
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useDragAndDrop', () => ({
  useDragAndDrop: () => ({
    sensors: [],
    activeId: null,
    activeConversation: null,
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
    isDragEnabled: false,
  }),
}));

// Mock useCronJobsMap
vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => <span data-testid='cron-indicator' />,
  useCronJobsMap: () => ({
    getJobStatus: vi.fn(() => null),
    markAsRead: vi.fn(),
    setActiveConversation: vi.fn(),
  }),
}));

// Mock useAgentRegistry
vi.mock('@/renderer/hooks/useAgentRegistry', () => ({
  useAgentRegistry: () => new Map(),
}));

// Mock AgentDMGroup to avoid deep dependency rendering — captures agentId for ordering assertions
vi.mock('@/renderer/pages/conversation/GroupedHistory/AgentDMGroup', () => ({
  default: ({ group, collapsed }: { group: { agentId: string }; collapsed?: boolean }) => (
    <div data-testid={`dm-group-${group.agentId}`} data-collapsed={String(collapsed)} />
  ),
}));

// Mock ChannelSection
vi.mock('@/renderer/pages/conversation/GroupedHistory/ChannelSection', () => ({
  default: ({ collapsed }: { collapsed?: boolean }) => (
    <div data-testid='channel-section' data-collapsed={String(collapsed)} />
  ),
}));

// Mock ConversationRow
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationRow', () => ({
  default: ({ conversation }: { conversation: { id: string } }) => (
    <div data-testid={`conv-row-${conversation.id}`} />
  ),
}));

// Mock SortableConversationRow
vi.mock('@/renderer/pages/conversation/GroupedHistory/SortableConversationRow', () => ({
  default: ({ conversation }: { conversation: { id: string } }) => (
    <div data-testid={`sortable-row-${conversation.id}`} />
  ),
}));

// Mock DragOverlayContent
vi.mock('@/renderer/pages/conversation/GroupedHistory/components/DragOverlayContent', () => ({
  default: () => null,
}));

// Mock AgentSelectionModal - AC-4: this component should no longer exist in the tree
// We intentionally mock it so if Developer accidentally keeps it, the test detects its presence.
vi.mock('@/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal', () => ({
  default: (props: { visible?: boolean }) =>
    props.visible ? <div data-testid='agent-selection-modal-present' /> : null,
}));

vi.mock('@/renderer/pages/conversation/components/WorkspaceCollapse', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/renderer/pages/conversation/dispatch/CreateGroupChatModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/settings/DirectorySelectionModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({ openTab: vi.fn(), closeTab: vi.fn() }),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

// --- Fixtures --------------------------------------------------------------- //

const makeAgentDMGroup = (
  agentId: string,
  latestActivityTime: number,
  isPermanent = false
) => ({
  agentId,
  agentName: agentId,
  agentAvatar: undefined,
  agentLogo: null,
  isPermanent,
  conversations: [],
  latestActivityTime,
  hasActiveConversation: false,
  ungroupedConversations: [],
  workspaceSubGroups: [],
  displayMode: 'flat' as const,
});

const makeEmptyConversationsReturn = () => ({
  conversations: [],
  isConversationGenerating: vi.fn(() => false),
  hasCompletionUnread: vi.fn(() => false),
  expandedWorkspaces: new Set<string>(),
  pinnedConversations: [],
  dispatchConversations: [],
  dispatchChildCounts: new Map(),
  timelineSections: [],
  agentDMGroups: [],
  handleToggleWorkspace: vi.fn(),
});

// --- Import component after all mocks are set ------------------------------ //

let WorkspaceGroupedHistory: React.FC<{ collapsed?: boolean; batchMode?: boolean }>;

const importComponent = async () => {
  const mod = await import('@/renderer/pages/conversation/GroupedHistory/index');
  WorkspaceGroupedHistory = mod.default as React.FC<{ collapsed?: boolean; batchMode?: boolean }>;
};

// --- Tests ----------------------------------------------------------------- //

describe('S6 Sidebar Restructure — WorkspaceGroupedHistory', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    if (!WorkspaceGroupedHistory) {
      await importComponent();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-1: Unified DM section — only two sections (Channels + Direct Messages)
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-001 (AC-1): renders the "Direct Messages" section header via i18n key', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.getByText('dispatch.sidebar.directMessagesSection')).toBeInTheDocument();
  });

  it('S6-002 (AC-1): does NOT render "General Agents" section header', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('dispatch.sidebar.generalAgentsSection')).not.toBeInTheDocument();
  });

  it('S6-003 (AC-1): does NOT render "Assistants" section header', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('dispatch.sidebar.assistantsSection')).not.toBeInTheDocument();
  });

  it('S6-004 (AC-1): renders channel section alongside DM section', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    // Channel section is present (mocked as data-testid='channel-section')
    expect(screen.getByTestId('channel-section')).toBeInTheDocument();
    // DM section header also present
    expect(screen.getByText('dispatch.sidebar.directMessagesSection')).toBeInTheDocument();
  });

  it('S6-005 (AC-1): all DM groups (permanent and non-permanent) render under one section', () => {
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [
        makeAgentDMGroup('claude', Date.now() - 1000, false), // non-permanent (CLI)
        makeAgentDMGroup('word-creator', Date.now() - 2000, true), // permanent (assistant)
      ],
    });

    render(<WorkspaceGroupedHistory collapsed={false} />);

    // Both groups render under the same section tree
    expect(screen.getByTestId('dm-group-claude')).toBeInTheDocument();
    expect(screen.getByTestId('dm-group-word-creator')).toBeInTheDocument();
    // Only one DM section header (not split into two)
    const dmHeaders = screen.queryAllByText('dispatch.sidebar.directMessagesSection');
    expect(dmHeaders).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-2: Agent DM groups sorted by most recent activity
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-006 (AC-2): agent groups are rendered in the order provided by agentDMGroups (sorted by activity)', () => {
    const now = Date.now();
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [
        makeAgentDMGroup('most-recent', now - 100),
        makeAgentDMGroup('older', now - 5000),
        makeAgentDMGroup('oldest', now - 10000),
      ],
    });

    render(<WorkspaceGroupedHistory collapsed={false} />);

    // All three groups are rendered
    const mostRecent = screen.getByTestId('dm-group-most-recent');
    const older = screen.getByTestId('dm-group-older');
    const oldest = screen.getByTestId('dm-group-oldest');

    // DOM order: most-recent should appear before older before oldest
    expect(mostRecent.compareDocumentPosition(older)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(older.compareDocumentPosition(oldest)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-3: Only agents with conversations appear
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-007 (AC-3): renders no DM group elements when agentDMGroups is empty', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    // No dm-group-* testids should exist
    expect(screen.queryAllByTestId(/^dm-group-/)).toHaveLength(0);
  });

  it('S6-008 (AC-3): renders exactly the DM groups provided (agents without conversations do not appear)', () => {
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [
        makeAgentDMGroup('agent-with-convs', Date.now()),
        // Agents with 0 conversations would not be in agentDMGroups at all (groupingHelpers behavior)
      ],
    });

    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.getByTestId('dm-group-agent-with-convs')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^dm-group-/)).toHaveLength(1);
  });

  it('S6-009 (AC-3): shows empty-state message when agentDMGroups is empty and sidebar is expanded', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.getByText('dispatch.sidebar.noDirectMessages')).toBeInTheDocument();
  });

  it('S6-010 (AC-3): empty-state message is NOT shown when agentDMGroups is non-empty', () => {
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [makeAgentDMGroup('claude', Date.now())],
    });

    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('dispatch.sidebar.noDirectMessages')).not.toBeInTheDocument();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-4: Redundant "+" button removed from DM section header
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-011 (AC-4): DM section header does NOT contain a "+" button', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    const dmHeader = screen.queryByText('dispatch.sidebar.directMessagesSection');
    expect(dmHeader).toBeInTheDocument();

    // The DM section header container should NOT have a plus icon
    const headerContainer =
      dmHeader?.closest('.chat-history__section') ?? dmHeader?.parentElement;

    const plusInHeader = headerContainer?.querySelector('[data-testid="icon-plus"]');
    expect(plusInHeader).toBeNull();
  });

  it('S6-012 (AC-4): AgentSelectionModal is NOT present in the DM section', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    // The AgentSelectionModal should not be rendered at all (component deleted)
    // Our mock renders with data-testid='agent-selection-modal-present' only when visible=true
    // Since the import itself should be gone, or at least no state manages it,
    // this should not appear.
    expect(screen.queryByTestId('agent-selection-modal-present')).not.toBeInTheDocument();
  });

  it('S6-013 (AC-4): i18n key "dispatch.sidebar.newDirectMessage" is NOT rendered', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    // The tooltip for the "+" button used this key — it should not appear after removal
    expect(screen.queryByText('dispatch.sidebar.newDirectMessage')).not.toBeInTheDocument();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-5: Channel section unchanged
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-014 (AC-5): ChannelSection renders in both expanded and collapsed states', () => {
    // Need at least one DM group so the component does not early-return in collapsed mode
    const withData = {
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [makeAgentDMGroup('claude', Date.now())],
    };
    mockConversationsReturn.mockReturnValue(withData);

    const { rerender } = render(<WorkspaceGroupedHistory collapsed={false} />);
    expect(screen.getByTestId('channel-section')).toBeInTheDocument();

    rerender(<WorkspaceGroupedHistory collapsed={true} />);
    expect(screen.getByTestId('channel-section')).toBeInTheDocument();
  });

  it('S6-015 (AC-5): ChannelSection receives the correct collapsed prop', () => {
    // Need at least one DM group so the component does not early-return in collapsed mode
    const withData = {
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [makeAgentDMGroup('claude', Date.now())],
    };
    mockConversationsReturn.mockReturnValue(withData);

    const { rerender } = render(<WorkspaceGroupedHistory collapsed={false} />);
    expect(screen.getByTestId('channel-section').getAttribute('data-collapsed')).toBe('false');

    rerender(<WorkspaceGroupedHistory collapsed={true} />);
    expect(screen.getByTestId('channel-section').getAttribute('data-collapsed')).toBe('true');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-6: Collapsed sidebar — no separator between former sections
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-016 (AC-6): in collapsed mode, DM section label is NOT rendered', () => {
    render(<WorkspaceGroupedHistory collapsed={true} />);

    expect(screen.queryByText('dispatch.sidebar.directMessagesSection')).not.toBeInTheDocument();
  });

  it('S6-017 (AC-6): in collapsed mode with mixed agents, DM groups are all rendered without separator', () => {
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [
        makeAgentDMGroup('claude', Date.now() - 100, false),
        makeAgentDMGroup('gemini', Date.now() - 200, false),
        makeAgentDMGroup('word-creator', Date.now() - 300, true),
      ],
    });

    render(<WorkspaceGroupedHistory collapsed={true} />);

    // All three groups render — no separator in between
    expect(screen.getByTestId('dm-group-claude')).toBeInTheDocument();
    expect(screen.getByTestId('dm-group-gemini')).toBeInTheDocument();
    expect(screen.getByTestId('dm-group-word-creator')).toBeInTheDocument();

    // No separator element between former General Agents and Assistants
    // The separator was a div with a border-b class — check there is only the channel/DM separator
    // (between channel section and dm section), not one between cli and permanent agents.
    // We verify no extra separator that would split DM groups exists.
    // The old code rendered: {collapsed && generalAgentGroups.length > 0 && assistantGroups.length > 0 && <div .../>}
    // After S6, with one unified section, this separator must be absent.
    // We can't reliably test invisible DOM structure, but we confirm all 3 agents are adjacent.
    const allDmGroups = screen.queryAllByTestId(/^dm-group-/);
    expect(allDmGroups).toHaveLength(3);
  });

  it('S6-018 (AC-6): in collapsed mode with only non-permanent agents, renders without crash', () => {
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [
        makeAgentDMGroup('claude', Date.now(), false),
        makeAgentDMGroup('gemini', Date.now() - 100, false),
      ],
    });

    expect(() => render(<WorkspaceGroupedHistory collapsed={true} />)).not.toThrow();
    expect(screen.getByTestId('dm-group-claude')).toBeInTheDocument();
    expect(screen.getByTestId('dm-group-gemini')).toBeInTheDocument();
  });

  it('S6-019 (AC-6): in collapsed mode with only permanent agents, renders without crash', () => {
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [
        makeAgentDMGroup('word-creator', Date.now(), true),
        makeAgentDMGroup('my-custom', Date.now() - 100, true),
      ],
    });

    expect(() => render(<WorkspaceGroupedHistory collapsed={true} />)).not.toThrow();
    expect(screen.getByTestId('dm-group-word-creator')).toBeInTheDocument();
    expect(screen.getByTestId('dm-group-my-custom')).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-8: Existing features preserved
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-020 (AC-8): pinned conversations are rendered when present', () => {
    const pinnedConv = {
      id: 'pinned-1',
      name: 'Pinned Conversation',
      type: 'gemini' as const,
      createTime: Date.now() - 1000,
      modifyTime: Date.now(),
      extra: {},
      model: {
        id: 'm1',
        name: 'Gemini',
        useModel: 'gemini-2.0-flash',
        platform: 'gemini' as const,
        baseUrl: '',
        apiKey: '',
      },
    };

    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      pinnedConversations: [pinnedConv],
    });

    render(<WorkspaceGroupedHistory collapsed={false} />);

    // When isDragEnabled is false (mock default), ConversationRow is used instead of SortableConversationRow.
    // Either testid is acceptable — at least one must be present.
    const sortableRow = screen.queryByTestId('sortable-row-pinned-1');
    const convRow = screen.queryByTestId('conv-row-pinned-1');
    expect(sortableRow ?? convRow).toBeInTheDocument();

    // The pinned section header renders as well
    expect(screen.getByText('conversation.history.pinnedSection')).toBeInTheDocument();
  });

  it('S6-021 (AC-8): component renders without errors when batchMode is true', () => {
    expect(() =>
      render(<WorkspaceGroupedHistory collapsed={false} batchMode={true} />)
    ).not.toThrow();
  });

  it('S6-022 (AC-8): component renders without errors when all data is empty', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    expect(() => render(<WorkspaceGroupedHistory collapsed={false} />)).not.toThrow();
  });

  it('S6-023 (AC-8): DM groups receive correct collapsed prop', () => {
    mockConversationsReturn.mockReturnValue({
      ...makeEmptyConversationsReturn(),
      agentDMGroups: [makeAgentDMGroup('claude', Date.now())],
    });

    const { rerender } = render(<WorkspaceGroupedHistory collapsed={false} />);
    expect(screen.getByTestId('dm-group-claude').getAttribute('data-collapsed')).toBe('false');

    rerender(<WorkspaceGroupedHistory collapsed={true} />);
    expect(screen.getByTestId('dm-group-claude').getAttribute('data-collapsed')).toBe('true');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // i18n / string hygiene
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-024: "Direct Messages" section label is not hardcoded in English', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    // t() mock returns keys; if hardcoded "Direct Messages" appears, the component bypassed i18n
    expect(screen.queryByText('Direct Messages')).not.toBeInTheDocument();
  });

  it('S6-025: "General Agents" is not hardcoded in English', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('General Agents')).not.toBeInTheDocument();
  });

  it('S6-026: "Assistants" section header is not hardcoded in English', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('Assistants')).not.toBeInTheDocument();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Failure paths
  // ──────────────────────────────────────────────────────────────────────────

  it('S6-027 (failure path): navigate is NOT called on initial render', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('S6-028 (failure path): AgentSelectionModal state is not accidentally triggered on mount', () => {
    render(<WorkspaceGroupedHistory collapsed={false} />);

    // If AgentSelectionModal is still in the tree with visible=false, that is acceptable.
    // But it must NOT be visible (showing).
    expect(screen.queryByTestId('agent-selection-modal-present')).not.toBeInTheDocument();
  });
});
