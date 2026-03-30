# G3: UI Experience Layer - Technical Design

**Date**: 2026-03-30
**Status**: Design
**Scope**: Build the visual group-chat experience that Claude Code cannot offer -- MemberBar, Tab switching, read-only teammate observation, simplified creation, profile panel, and manual member addition.

---

## 1. Overview

G3 transforms the group chat from a "dispatcher black box" into a transparent team workspace. The user sees every teammate's real-time work, can inspect profiles, and can manually add agents -- all through two extra UI rows (MemberBar + TabBar) that sit on top of the existing ChatLayout.

### Current state (before G3)

```
GroupChatView
 +- ChatLayout (header, workspace sider)
    +- TaskOverview (collapsible child task list)
    +- GroupChatTimeline (admin <-> user messages)
    +- SendBox
    +- GroupMemberSider (right sidebar, 240px)
    +- TaskPanel (right panel, transcript viewer)
```

### Target state (after G3)

```
GroupChatView
 +- ChatLayout (header, workspace sider)
    +- MemberBar (new -- horizontal member strip + [+])
    +- TeammateTabBar (new -- [Group Chat] [Arch] [Dev] ...)
    +- ActiveTabContent:
    |   IF groupChatTab:
    |     +- TaskOverview
    |     +- GroupChatTimeline
    |     +- SendBox
    |   ELSE (teammate tab):
    |     +- TeammateTabView (read-only conversation stream)
    +- MemberProfileDrawer (new -- Drawer triggered by MemberBar avatar click)
```

Key principle: **GroupMemberSider and TaskPanel are retired**. Their functionality is absorbed by MemberBar (horizontal strip replaces vertical sidebar) and TeammateTabView (tab replaces side panel).

---

## 2. Sub-feature Designs

### G3.1: Simplify CreateGroupChatModal

**Problem**: Current modal has 5+ fields including model selector and seed message in an advanced collapse. The redesign spec says: 3 fields, zero-config-can-run.

**File changes**:

| File | Change |
|------|--------|
| `src/renderer/pages/conversation/dispatch/CreateGroupChatModal.tsx` | Remove model selector, remove seed message collapse. Keep: name, leader agent, workspace. |
| `src/process/bridge/dispatchBridge.ts` | Remove `modelOverride` handling from `createGroupChat` provider. Admin uses its agent's default model. |
| `src/common/adapter/ipcBridge.ts` | Remove `modelOverride` from `createGroupChat` params type (if typed there). |

**Concrete JSX structure (CreateGroupChatModal.tsx after):**

```tsx
<Modal title={t('dispatch.create.title')} visible={visible} onOk={handleCreate} ...>
  {/* 1. Group Chat Name */}
  <div className='py-8px'>
    <div className='text-14px mb-8px text-t-secondary'>{t('dispatch.create.titleLabel')}</div>
    <Input
      autoFocus
      value={name}
      onChange={setName}
      placeholder={t('dispatch.create.titlePlaceholder')} // default "New Group Chat"
      allowClear
    />
  </div>

  {/* 2. Admin Agent (required) */}
  <div className='py-8px'>
    <div className='text-14px mb-8px text-t-secondary'>{t('dispatch.create.adminLabel')}</div>
    <Select
      value={leaderAgentId}
      onChange={setLeaderAgentId}
      placeholder={t('dispatch.create.adminPlaceholder')}
      showSearch
    >
      {/* CLI agents (gemini, acp, codex...) */}
      {cliAgents.map(agent => (
        <Select.Option key={agent.id} value={agent.id}>
          <span className='flex items-center gap-6px'>
            <span>{agent.name}</span>
          </span>
        </Select.Option>
      ))}
      {/* Custom agents / assistants */}
      {customAgents.map(agent => (
        <Select.Option key={agent.id} value={agent.id}>
          <span className='flex items-center gap-6px'>
            {agent.avatar && <span className='text-16px leading-none'>{agent.avatar}</span>}
            <span>{agent.name}</span>
          </span>
        </Select.Option>
      ))}
    </Select>
  </div>

  {/* 3. Workspace (optional) */}
  <div className='py-8px'>
    <div className='text-14px mb-8px text-t-secondary'>{t('dispatch.create.workspaceLabel')}</div>
    <div className='flex items-center gap-8px'>
      <Input readOnly value={workspace} placeholder={t('dispatch.create.workspacePlaceholder')} ... />
      <Button type='secondary' icon={<FolderOpen />} onClick={handleBrowseWorkspace}>
        {t('dispatch.create.workspaceBrowse')}
      </Button>
    </div>
  </div>
</Modal>
```

**State changes**:
- Remove: `selectedModel`, `seedMessage`, `advancedExpanded`, `modelConfig` SWR
- Add: `cliAgents` derived from `ACP_BACKENDS_ALL` + gemini (same pattern as `useAgentRegistry`)
- `leaderAgentId` is now **required** -- OK button disabled when unset

**Backend (dispatchBridge.ts `createGroupChat` handler)**:
- Remove `params.modelOverride` path. Model is resolved from admin agent's `presetAgentType` and its default model.
- Remove `params.seedMessages` (no longer in creation modal; the welcome message replaces it).
- `adminAgentType` is derived from the selected agent's `presetAgentType`.

---

### G3.2: Admin Welcome Message

**Problem**: After group chat creation, the user sees a blank timeline and must type first. The redesign spec says: admin auto-generates a personalized welcome.

**File changes**:

| File | Change |
|------|--------|
| `src/process/task/dispatch/dispatchPrompt.ts` | Add `welcomeInstruction` section to `buildDispatchSystemPrompt` |
| `src/process/task/dispatch/DispatchAgentManager.ts` | After bootstrap, auto-send a system notification to trigger welcome |

**Implementation detail -- `dispatchPrompt.ts`**:

Add a new section to `buildDispatchSystemPrompt`:

```typescript
prompt += `
## Welcome Behavior
When the conversation starts (your first turn), greet the user warmly and explain:
1. They can describe a task and you will create temporary teammates to handle it.
2. They can manually add agents to the group using the [+] button, and you will coordinate them.
Ask the user what task they need help with.
Adapt your tone and style to your persona (if any leader profile is provided above).
`;
```

**Implementation detail -- `DispatchAgentManager.ts`**:

In `createBootstrap()`, after `this.start({...})`, trigger the welcome:

```typescript
// After `await this.start(...)` and tracker/notifier restoration:

// G3.2: Auto-trigger welcome message on first bootstrap (no children = fresh group)
const restoredChildren = this.tracker.getChildren(this.conversation_id);
if (restoredChildren.length === 0) {
  // Send a system notification to prompt the welcome
  void this.sendMessage({
    input: '[System] Group chat created. Please welcome the user.',
    msg_id: uuid(),
    isSystemNotification: true,
  }).catch((err) => {
    mainWarn('[DispatchAgentManager]', 'Welcome auto-trigger failed', err);
  });
}
```

The admin LLM will receive this system notification plus the "Welcome Behavior" prompt section, and generate a natural welcome message. Different admin agents (Claude, Gemini, custom assistants) will produce different welcome styles.

**Why `isSystemNotification: true`**: This flag prevents the message from being saved as a user message in the DB (see `sendMessage` line 230-239), so the user won't see the trigger prompt -- they'll only see the admin's generated response.

---

### G3.3: MemberBar + TeammateTabBar

This is the core UI restructure. Two new horizontal components replace the vertical GroupMemberSider.

#### 3.3.1 New types (`types.ts` additions)

```typescript
/** Member type classification */
export type MemberType = 'admin' | 'permanent' | 'temporary';

/** Unified member info for MemberBar (extends GroupChatMemberVO) */
export type GroupChatMemberBarItem = {
  /** Unique ID: admin uses conversation_id, children use sessionId */
  id: string;
  /** Display name */
  name: string;
  /** Avatar emoji or URL */
  avatar?: string;
  /** Member type */
  memberType: MemberType;
  /** Status indicator */
  status: 'online' | 'working' | 'idle' | 'error';
  /** Agent registry ID (for profile lookup) */
  agentId?: string;
};

/** Tab item for TeammateTabBar */
export type TeammateTab = {
  /** Tab key: 'group-chat' for main tab, childSessionId for teammates */
  key: string;
  /** Tab label */
  label: string;
  /** Status indicator */
  status: 'working' | 'idle' | 'error' | 'released';
  /** Avatar */
  avatar?: string;
  /** Has unread content (red dot) */
  hasUnread: boolean;
  /** Whether closable (completed tabs can be closed) */
  closable: boolean;
};

/** Props for MemberBar */
export type MemberBarProps = {
  members: GroupChatMemberBarItem[];
  onMemberClick: (memberId: string) => void;
  onAddMemberClick: () => void;
};

/** Props for TeammateTabBar */
export type TeammateTabBarProps = {
  tabs: TeammateTab[];
  activeTabKey: string;
  onTabChange: (key: string) => void;
  onTabClose: (key: string) => void;
};
```

#### 3.3.2 New component: `MemberBar.tsx`

**Location**: `src/renderer/pages/conversation/dispatch/components/MemberBar.tsx`

```tsx
const MemberBar: React.FC<MemberBarProps> = ({ members, onMemberClick, onAddMemberClick }) => {
  return (
    <div className='flex items-center gap-4px px-16px py-6px border-b border-bd-primary overflow-x-auto flex-shrink-0'>
      {members.map(member => (
        <Tooltip key={member.id} content={member.name}>
          <div
            className='relative cursor-pointer flex-shrink-0'
            onClick={() => onMemberClick(member.id)}
          >
            {/* Avatar circle (32px) */}
            <div className='w-32px h-32px rd-full flex-center bg-fill-2 text-14px'>
              {member.avatar ? <span>{member.avatar}</span> : <People size='16' />}
            </div>
            {/* Status dot (absolute, bottom-right) */}
            <span className={classNames(
              'absolute bottom-0 right-0 w-8px h-8px rd-full border-2 border-bg-1',
              statusColorMap[member.status]
            )} />
            {/* Crown badge for admin */}
            {member.memberType === 'admin' && (
              <Crown theme='filled' size={10}
                className='absolute top--2px right--2px text-warning-6' />
            )}
          </div>
        </Tooltip>
      ))}
      {/* [+] Add member button */}
      <Tooltip content={t('dispatch.memberBar.addMember')}>
        <div
          className='w-32px h-32px rd-full flex-center bg-fill-2 cursor-pointer
                     hover:bg-fill-3 transition-colors flex-shrink-0'
          onClick={onAddMemberClick}
        >
          <Plus size='14' />
        </div>
      </Tooltip>
    </div>
  );
};
```

**Status color mapping**:

```typescript
const statusColorMap: Record<string, string> = {
  online: 'bg-green-6',   // admin always-on, permanent idle
  working: 'bg-blue-6',   // running task
  idle: 'bg-gray-6',      // pending/offline
  error: 'bg-red-6',      // failed
};
```

#### 3.3.3 New component: `TeammateTabBar.tsx`

**Location**: `src/renderer/pages/conversation/dispatch/components/TeammateTabBar.tsx`

```tsx
const TeammateTabBar: React.FC<TeammateTabBarProps> = ({
  tabs, activeTabKey, onTabChange, onTabClose,
}) => {
  return (
    <div className='flex items-center gap-0 px-12px border-b border-bd-primary flex-shrink-0 overflow-x-auto'>
      {tabs.map(tab => (
        <div
          key={tab.key}
          className={classNames(
            'flex items-center gap-4px px-12px py-8px cursor-pointer text-13px',
            'border-b-2 transition-colors relative',
            tab.key === activeTabKey
              ? 'border-primary-6 text-primary-6 font-medium'
              : 'border-transparent text-t-secondary hover:text-t-primary'
          )}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.avatar && <span className='text-14px leading-none'>{tab.avatar}</span>}
          <span className='truncate max-w-120px'>{tab.label}</span>
          {/* Status dot */}
          <span className={classNames('w-6px h-6px rd-full flex-shrink-0', tabStatusColor[tab.status])} />
          {/* Unread red dot */}
          {tab.hasUnread && tab.key !== activeTabKey && (
            <span className='absolute top-4px right-4px w-6px h-6px rd-full bg-red-6' />
          )}
          {/* Close button for closable tabs */}
          {tab.closable && (
            <Close
              size='12'
              className='ml-2px hover:text-t-primary'
              onClick={(e) => { e.stopPropagation(); onTabClose(tab.key); }}
            />
          )}
        </div>
      ))}
    </div>
  );
};
```

**Tab overflow**: When tabs exceed container width, the `overflow-x-auto` allows horizontal scrolling. Future iteration may add a `...` dropdown.

#### 3.3.4 State management: `useGroupChatTabs` hook

**Location**: `src/renderer/pages/conversation/dispatch/hooks/useGroupChatTabs.ts`

This hook derives tab state from the existing `useGroupChatInfo` data.

```typescript
export function useGroupChatTabs(
  conversationId: string,
  info: GroupChatInfoVO | null,
  dispatcher: { name: string; avatar?: string }
) {
  const [activeTabKey, setActiveTabKey] = useState<string>('group-chat');
  const [closedTabs, setClosedTabs] = useState<Set<string>>(new Set());
  const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set());

  // Derive members for MemberBar
  const members = useMemo<GroupChatMemberBarItem[]>(() => {
    const result: GroupChatMemberBarItem[] = [];

    // Admin is always first
    result.push({
      id: conversationId,
      name: dispatcher.name,
      avatar: dispatcher.avatar,
      memberType: 'admin',
      status: 'online',
    });

    // Children
    if (info?.children) {
      for (const child of info.children) {
        result.push({
          id: child.sessionId,
          name: child.teammateName || child.title,
          avatar: child.teammateAvatar,
          memberType: child.isPermanent ? 'permanent' : 'temporary',
          status: childStatusToMemberStatus(child.status),
        });
      }
    }

    return result;
  }, [conversationId, dispatcher, info?.children]);

  // Derive tabs for TeammateTabBar
  const tabs = useMemo<TeammateTab[]>(() => {
    const result: TeammateTab[] = [
      {
        key: 'group-chat',
        label: t('dispatch.tabs.groupChat'),
        status: 'idle',
        hasUnread: false,
        closable: false,
      },
    ];

    if (info?.children) {
      for (const child of info.children) {
        if (closedTabs.has(child.sessionId)) continue;
        // Only show tabs for children that have been started (not just registered)
        result.push({
          key: child.sessionId,
          label: child.teammateName || child.title,
          avatar: child.teammateAvatar,
          status: childStatusToTabStatus(child.status),
          hasUnread: unreadTabs.has(child.sessionId),
          closable: child.status !== 'running' && child.status !== 'pending',
        });
      }
    }

    return result;
  }, [info?.children, closedTabs, unreadTabs]);

  // Mark unread when child emits content and tab is not active
  useEffect(() => {
    const unsub = ipcBridge.conversation.responseStream.on((msg) => {
      if (msg.type !== 'dispatch_event') return;
      const data = msg.data as GroupChatMessageData;
      if (!data.childTaskId) return;
      if (data.childTaskId !== activeTabKey) {
        setUnreadTabs(prev => new Set(prev).add(data.childTaskId!));
      }
    });
    return unsub;
  }, [activeTabKey]);

  // Clear unread when switching to a tab
  const handleTabChange = useCallback((key: string) => {
    setActiveTabKey(key);
    setUnreadTabs(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleTabClose = useCallback((key: string) => {
    setClosedTabs(prev => new Set(prev).add(key));
    if (activeTabKey === key) {
      setActiveTabKey('group-chat');
    }
  }, [activeTabKey]);

  return {
    members,
    tabs,
    activeTabKey,
    onTabChange: handleTabChange,
    onTabClose: handleTabClose,
  };
}
```

**Status mapping helpers**:

```typescript
function childStatusToMemberStatus(status: ChildTaskInfoVO['status']): GroupChatMemberBarItem['status'] {
  switch (status) {
    case 'running': case 'pending': return 'working';
    case 'completed': case 'idle': return 'idle';
    case 'failed': return 'error';
    default: return 'idle';
  }
}

function childStatusToTabStatus(status: ChildTaskInfoVO['status']): TeammateTab['status'] {
  switch (status) {
    case 'running': case 'pending': return 'working';
    case 'completed': case 'idle': return 'idle';
    case 'failed': return 'error';
    case 'cancelled': return 'released';
    default: return 'idle';
  }
}
```

#### 3.3.5 GroupChatView integration

**Modified file**: `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`

Major changes:
1. Remove `GroupMemberSider` import and JSX.
2. Remove `TaskOverview` from the top (it becomes part of the group-chat tab, but optional -- the tab bar already shows status).
3. Remove `TaskPanel` (replaced by TeammateTabView).
4. Add `MemberBar`, `TeammateTabBar`, conditional rendering based on `activeTabKey`.

```tsx
const GroupChatView: React.FC<GroupChatViewProps> = ({ conversation }) => {
  const { t } = useTranslation();
  const { messages, isLoading: messagesLoading, appendUserMessage } = useGroupChatMessages(conversation.id);
  const { info, error: infoError, retry: retryInfo, refresh: refreshInfo } = useGroupChatInfo(conversation.id, {
    autoRefreshInterval: 5_000, // faster for real-time tab updates
  });

  // Dispatcher info
  const extra = conversation.extra as { groupChatName?: string; teammateConfig?: { avatar?: string } };
  const dispatcherName = info?.dispatcherName || extra.groupChatName || conversation.name;
  const dispatcherAvatar = extra.teammateConfig?.avatar;

  // Tab state (replaces memberSider + taskPanel state)
  const {
    members,
    tabs,
    activeTabKey,
    onTabChange,
    onTabClose,
  } = useGroupChatTabs(conversation.id, info, {
    name: dispatcherName,
    avatar: dispatcherAvatar,
  });

  // Member profile drawer
  const [profileTarget, setProfileTarget] = useState<string | null>(null);

  // Add member modal
  const [addMemberVisible, setAddMemberVisible] = useState(false);

  // ... sendMessage handler (unchanged) ...

  if (infoError) {
    return /* error UI, unchanged */;
  }

  return (
    <ChatLayout
      workspaceEnabled={activeTabKey === 'group-chat' ? false : true}
      agentName={dispatcherName}
      agentLogo={dispatcherAvatar}
      agentLogoIsEmoji={Boolean(dispatcherAvatar)}
      sider={null}
      conversationId={conversation.id}
      title={conversation.name}
    >
      {/* MemberBar (G3.3) */}
      <MemberBar
        members={members}
        onMemberClick={(id) => setProfileTarget(id)}
        onAddMemberClick={() => setAddMemberVisible(true)}
      />

      {/* TeammateTabBar (G3.3) */}
      <TeammateTabBar
        tabs={tabs}
        activeTabKey={activeTabKey}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
      />

      {/* Active tab content */}
      <div className='flex-1 flex flex-col min-h-0'>
        {activeTabKey === 'group-chat' ? (
          /* Group chat tab: timeline + sendbox */
          <>
            <GroupChatTimeline
              messages={messages}
              isLoading={messagesLoading}
              dispatcherName={dispatcherName}
              dispatcherAvatar={dispatcherAvatar}
              conversationId={conversation.id}
            />
            <div className='max-w-800px w-full mx-auto mb-16px px-20px'>
              <SendBox
                value={sendBoxContent}
                onChange={setSendBoxContent}
                loading={sending}
                placeholder={t('dispatch.timeline.sendPlaceholder', { name: dispatcherName })}
                onSend={handleSend}
                defaultMultiLine={true}
                lockMultiLine={true}
                className='z-10'
              />
            </div>
          </>
        ) : (
          /* Teammate tab: read-only conversation view (G3.4) */
          <TeammateTabView
            childSessionId={activeTabKey}
            conversationId={conversation.id}
          />
        )}
      </div>

      {/* Member Profile Drawer (G3.5) */}
      <MemberProfileDrawer
        visible={Boolean(profileTarget)}
        memberId={profileTarget}
        members={members}
        childrenInfo={info?.children || []}
        conversationId={conversation.id}
        onClose={() => setProfileTarget(null)}
        onModelChange={() => refreshInfo()}
        onRemoveMember={(memberId) => {
          handleRemoveMember(memberId);
          setProfileTarget(null);
        }}
      />

      {/* Add Member Modal (G3.6) */}
      <AddMemberModal
        visible={addMemberVisible}
        onClose={() => setAddMemberVisible(false)}
        conversationId={conversation.id}
        existingMemberIds={members.map(m => m.agentId).filter(Boolean) as string[]}
        onMemberAdded={() => {
          refreshInfo();
          setAddMemberVisible(false);
        }}
      />
    </ChatLayout>
  );
};
```

**Removed state variables**: `selectedChildTaskId`, `overviewCollapsed`, `memberSiderCollapsed`, `saveModalTarget`, `savedTeammateNames`.

**Removed components from JSX**: `TaskOverview`, `GroupMemberSider`, `MemberSiderToggleButton`, `TaskPanel`, `SaveTeammateModal`, `GroupChatSettingsDrawer` (settings move to member profile drawer for admin).

---

### G3.4: Teammate Work View (Read-Only Tab)

**Problem**: The current `TaskPanel` shows a text transcript via `useTaskPanelTranscript` (5s polling). The redesign requires a real-time, streaming conversation view identical to a single-chat experience -- with thinking blocks, tool calls, code highlights -- but read-only.

#### Design decision: Reuse single-chat conversation renderer

Each child session is a full conversation in the DB (type `gemini`/`acp`/etc.). The existing single-chat components (timeline, message bubbles, tool call rendering, streaming) already work with any `conversation_id`. We subscribe to the child session's `responseStream` events.

**New component**: `TeammateTabView.tsx`

**Location**: `src/renderer/pages/conversation/dispatch/components/TeammateTabView.tsx`

```tsx
type TeammateTabViewProps = {
  /** Child session ID -- this IS a full conversation ID in the DB */
  childSessionId: string;
  /** Parent group chat conversation ID (for context) */
  conversationId: string;
};

const TeammateTabView: React.FC<TeammateTabViewProps> = ({ childSessionId }) => {
  // Load child conversation metadata to determine its type (gemini/acp/codex...)
  const { data: childConversation } = useSWR(
    `conversation:${childSessionId}`,
    () => ipcBridge.conversation.getConversation.invoke({ conversation_id: childSessionId })
  );

  if (!childConversation) {
    return <Spin className='flex-center flex-1' />;
  }

  // Render the appropriate chat component in read-only mode
  // The key insight: each platform chat component accepts a `conversation` prop
  // and handles its own message loading + stream subscription.
  // We wrap it in a read-only container that hides the send box.
  return (
    <div className='flex-1 flex flex-col min-h-0'>
      <ReadOnlyConversationRenderer
        conversation={childConversation}
      />
    </div>
  );
};
```

**New component**: `ReadOnlyConversationRenderer.tsx`

This is a thin wrapper that renders the platform-specific timeline (GeminiChat, AcpChat, etc.) **without** the SendBox. It reuses the existing message hooks and stream subscriptions that each platform chat already has.

```tsx
const ReadOnlyConversationRenderer: React.FC<{
  conversation: TChatConversation;
}> = ({ conversation }) => {
  // Route to the correct platform renderer based on conversation.type
  // Each renderer loads messages from DB and subscribes to responseStream
  // for the given conversation.id.

  switch (conversation.type) {
    case 'gemini':
      return <GeminiChatTimeline conversationId={conversation.id} readonly />;
    case 'acp':
      return <AcpChatTimeline conversationId={conversation.id} readonly />;
    case 'codex':
      return <CodexChatTimeline conversationId={conversation.id} readonly />;
    default:
      return <GenericTranscriptView conversationId={conversation.id} />;
  }
};
```

**Implementation strategy for `readonly` prop**:

Each platform's chat component currently combines timeline + send box. To support `readonly`, the cleanest approach is:

1. **Extract the timeline portion** of each platform chat into a standalone `<PlatformChatTimeline>` component.
2. The existing full chat components compose `<PlatformChatTimeline>` + `<SendBox>`.
3. `TeammateTabView` uses `<PlatformChatTimeline>` directly (no SendBox).

**For MVP**, since the current dispatch system only supports `gemini` children (G1 adds multi-engine), we only need to handle the `gemini` case. The concrete approach:

1. Extract `GeminiChat`'s timeline rendering into `GeminiChatTimeline` (or pass a `readonly` prop that hides SendBox).
2. For other types, fall back to `GenericTranscriptView` which uses the existing `useTaskPanelTranscript` hook (text-only view, still functional).

**Real-time updates**: The child session's messages flow through `ipcBridge.geminiConversation.responseStream` (or equivalent per platform). The timeline component already subscribes to `responseStream` filtered by `conversation_id`. By passing `childSessionId` as the `conversationId`, the timeline auto-receives real-time streaming updates. **No new IPC channel is needed.**

**Right-side workspace panel**: When a teammate tab is active, the workspace panel should show that teammate's working directory. This is handled by:
- Reading `childConversation.extra.workspace` (or `extra.worktreePath`).
- Passing it to `ChatLayout`'s workspace context.

```tsx
// In GroupChatView, when activeTabKey is a childSessionId:
const activeChildInfo = info?.children?.find(c => c.sessionId === activeTabKey);
const workspaceOverride = activeChildInfo?.workspace;

// Pass to ChatLayout:
<ChatLayout
  workspaceEnabled={activeTabKey !== 'group-chat'}
  workspaceOverride={workspaceOverride}  // new prop
  ...
>
```

---

### G3.5: Member Profile Drawer

**Problem**: Currently clicking a member in `GroupMemberSider` opens a `Popover` with 3 fields. The redesign requires a full Drawer with type-specific fields.

**New component**: `MemberProfileDrawer.tsx`

**Location**: `src/renderer/pages/conversation/dispatch/components/MemberProfileDrawer.tsx`

```tsx
type MemberProfileDrawerProps = {
  visible: boolean;
  memberId: string | null;
  members: GroupChatMemberBarItem[];
  childrenInfo: ChildTaskInfoVO[];
  conversationId: string;
  onClose: () => void;
  onModelChange: () => void;
  onRemoveMember: (memberId: string) => void;
};
```

**JSX structure**:

```tsx
<Drawer
  visible={visible}
  width={320}
  placement='right'
  title={member.name}
  onCancel={onClose}
  footer={null}
>
  {/* Status badge */}
  <div className='flex items-center gap-8px mb-16px'>
    <span className={statusDotClass} />
    <span className='text-13px text-t-secondary'>
      {statusLabel} -- {memberTypeLabel}
    </span>
  </div>

  {/* Base Agent (all types, read-only) */}
  <ProfileField label={t('dispatch.profile.baseAgent')} value={baseAgentName} />

  {/* Model (all types, editable) */}
  <ProfileField label={t('dispatch.profile.model')}>
    <Select value={currentModel} onChange={handleModelChange} size='small' />
  </ProfileField>

  {/* Rule (permanent members only, read-only) */}
  {member.memberType === 'permanent' && member.presetRules && (
    <ProfileField label={t('dispatch.profile.rules')}>
      <Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>
        {member.presetRules}
      </Typography.Paragraph>
    </ProfileField>
  )}

  {/* Skills (permanent members only, read-only) */}
  {member.memberType === 'permanent' && skills.length > 0 && (
    <ProfileField label={t('dispatch.profile.skills')}>
      <div className='flex flex-wrap gap-4px'>
        {skills.map(s => <Tag key={s} size='small'>{s}</Tag>)}
      </div>
    </ProfileField>
  )}

  {/* Current instruction (all types, read-only) */}
  {currentInstruction && (
    <ProfileField label={t('dispatch.profile.currentInstruction')}>
      <Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>
        {currentInstruction}
      </Typography.Paragraph>
    </ProfileField>
  )}

  {/* Current task + elapsed time (all types, read-only) */}
  {currentTask && (
    <ProfileField label={t('dispatch.profile.currentTask')}>
      <span>{currentTask.title}</span>
      <span className='text-t-secondary ml-8px'>{formatElapsed(currentTask.startedAt)}</span>
    </ProfileField>
  )}

  {/* Remove button (permanent members only) */}
  {member.memberType === 'permanent' && (
    <Button
      type='outline'
      status='danger'
      long
      className='mt-24px'
      onClick={() => onRemoveMember(member.id)}
    >
      {t('dispatch.profile.removeMember')}
    </Button>
  )}
</Drawer>
```

**Data source for profile fields**:

| Field | Source |
|-------|--------|
| Status | `ChildTaskInfoVO.status` mapped to display string |
| Base Agent | `ChildTaskInfoVO.agentType` (from G1 additions) or inferred from conversation type |
| Model | `ChildTaskInfoVO.modelName` (existing field) |
| Rules | `ChildTaskInfoVO.presetRules` (existing field) |
| Skills | Not currently in `ChildTaskInfoVO`; requires adding `enabledSkills?: string[]` to child info |
| Current Instruction | First user message in child transcript (admin's prompt to teammate) |
| Current Task | `ChildTaskInfoVO.title` + `createdAt` for elapsed time |

**Model change IPC**: New bridge handler `dispatch.updateChildModel`:

```typescript
// dispatchBridge.ts addition
ipcBridge.dispatch.updateChildModel.provider(async (params) => {
  // params: { conversationId, childSessionId, model: { providerId, modelName } }
  // Update the child conversation's model in DB
  // Note: this takes effect on the NEXT message to the child, not retroactively
});
```

---

### G3.6: Manual Add Member

**Problem**: Users cannot manually add existing agents to a group chat. The redesign allows adding via a [+] button on the MemberBar.

**New component**: `AddMemberModal.tsx`

**Location**: `src/renderer/pages/conversation/dispatch/components/AddMemberModal.tsx`

```tsx
type AddMemberModalProps = {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  existingMemberIds: string[];
  onMemberAdded: () => void;
};
```

**JSX structure**:

```tsx
<Modal
  title={t('dispatch.addMember.title')}
  visible={visible}
  onOk={handleAdd}
  onCancel={onClose}
>
  <Select
    value={selectedAgentId}
    onChange={setSelectedAgentId}
    placeholder={t('dispatch.addMember.placeholder')}
    showSearch
    filterOption={(input, option) =>
      option?.children?.toLowerCase().includes(input.toLowerCase())
    }
  >
    {availableAgents.map(agent => (
      <Select.Option
        key={agent.id}
        value={agent.id}
        disabled={existingMemberIds.includes(agent.id)}
      >
        <span className='flex items-center gap-6px'>
          {agent.avatar && <span className='text-16px'>{agent.avatar}</span>}
          <span>{agent.name}</span>
          {agent.description && (
            <span className='text-12px text-t-secondary ml-4px'>{agent.description}</span>
          )}
        </span>
      </Select.Option>
    ))}
  </Select>
</Modal>
```

**Data source**: `useAgentRegistry()` hook provides the unified agent list. Filter out agents already in the group.

**Backend flow after selection**:

1. Frontend calls `ipcBridge.dispatch.addMember.invoke({ conversationId, agentId })`.
2. **New bridge handler** `dispatch.addMember` in `dispatchBridge.ts`:

```typescript
ipcBridge.dispatch.addMember.provider(async (params) => {
  // 1. Look up agent profile from registry (customAgents + presets)
  const customAgents = ((await ProcessConfig.get('acp.customAgents')) || []) as AcpBackendConfig[];
  const agent = customAgents.find(a => a.id === params.agentId)
    || ASSISTANT_PRESETS.find(p => p.id === params.agentId);

  if (!agent) return { success: false, msg: 'Agent not found' };

  // 2. Store member in conversation extra.members[]
  const conversation = await conversationService.getConversation(params.conversationId);
  const extra = { ...(conversation.extra as Record<string, unknown>) };
  const memberList = (extra.members || []) as Array<{ agentId: string; addedAt: number }>;
  memberList.push({ agentId: params.agentId, addedAt: Date.now() });
  extra.members = memberList;
  await conversationService.updateConversation(params.conversationId, { extra });

  // 3. Inject system notification to admin agent
  const task = _workerTaskManager.getTask(params.conversationId);
  if (task) {
    const agentDescription = agent.description || agent.context?.slice(0, 100) || '';
    const notification = [
      `[System]: User added "${agent.name}" as a group member.`,
      agent.description ? `  - Description: ${agentDescription}` : '',
      agent.presetAgentType ? `  - Base Agent: ${agent.presetAgentType}` : '',
      agent.enabledSkills?.length ? `  - Skills: ${agent.enabledSkills.join(', ')}` : '',
      'Please acknowledge the new member and ask the user what task to assign them.',
    ].filter(Boolean).join('\n');

    await task.sendMessage({
      input: notification,
      msg_id: uuid(),
      isSystemNotification: true,
    });
  }

  return { success: true };
});
```

3. Admin receives the notification and generates a natural-language acknowledgment (e.g., "I see you added the PPT Assistant. What task should I assign?").

4. When the admin later calls `start_task` with `member_id`, the system resolves the member's profile from `extra.members` and auto-fills the teammate config (name, avatar, rules, skills, model, agent type).

---

## 3. Data Flow Changes

### Current flow (process -> renderer)

```
DispatchAgentManager
  -> emitGroupChatEvent() -> ipcBridge.geminiConversation.responseStream.emit()
  -> useGroupChatMessages subscribes -> updates timeline state

getGroupChatInfo IPC
  -> dispatchBridge reads children from DB
  -> useGroupChatInfo polls every 10s
  -> GroupChatView derives members for GroupMemberSider
```

### New flow (process -> renderer)

```
DispatchAgentManager
  -> emitGroupChatEvent() -> responseStream (unchanged)
  -> useGroupChatMessages subscribes -> updates timeline (unchanged)

Child session worker
  -> responseStream events with child's conversation_id
  -> TeammateTabView subscribes directly (via platform chat timeline component)
  -> Real-time streaming in teammate tab

getGroupChatInfo IPC
  -> dispatchBridge reads children + extra.members from DB
  -> useGroupChatInfo polls every 5s (faster for tab status)
  -> useGroupChatTabs derives members + tabs from info
  -> MemberBar renders members
  -> TeammateTabBar renders tabs with status + unread dots

addMember IPC (new)
  -> dispatchBridge stores member, injects notification
  -> Admin generates response
  -> responseStream event -> timeline update
  -> getGroupChatInfo refresh -> MemberBar update
```

### Key insight: No new IPC channels for real-time tab updates

The child session's messages already flow through `responseStream`. The `TeammateTabView` reuses the same subscription mechanism that single-chat views use. This is the core design advantage of treating each child session as a full conversation.

---

## 4. State Management Decision

### Decision: Local state in `useGroupChatTabs`, NOT a new Context

**Rationale**:

1. Tab state (activeTabKey, closedTabs, unreadTabs) is local to `GroupChatView` -- no other component tree needs it.
2. Member data is already derived from `useGroupChatInfo` (existing hook) -- no new data source.
3. A new Context would add complexity (Provider wrapping, re-render scope management) with no benefit.
4. The `useGroupChatTabs` hook encapsulates all tab logic and is called once in `GroupChatView`.

**What lives where**:

| State | Location | Why |
|-------|----------|-----|
| Tab list, active tab | `useGroupChatTabs` (hook) | Derived from `useGroupChatInfo`, local to GroupChatView |
| Unread dots | `useGroupChatTabs` (hook) | Listens to responseStream, updates per-tab |
| Member bar items | `useGroupChatTabs` (hook) | Derived from info.children + admin |
| Profile drawer target | `useState` in GroupChatView | Simple toggle, single consumer |
| Add member modal | `useState` in GroupChatView | Simple toggle |
| Child conversation data | `useSWR` in TeammateTabView | Per-tab, fetched on mount |
| Child message stream | Platform chat hook in TeammateTabView | Already exists per platform |

---

## 5. Key Design Decisions

### Q1: How does the tab bar get real-time updates from child sessions?

**Answer**: The tab bar shows status dots (working/idle/error). This data comes from `useGroupChatInfo` which polls `getGroupChatInfo` IPC every 5 seconds. The `DispatchSessionTracker` on the process side updates child status in real-time (via polling the child worker status). The IPC bridge reads the latest status from the DB.

For unread dots: `useGroupChatTabs` subscribes to `responseStream` and checks if `data.childTaskId` matches a non-active tab. If so, it sets the unread flag. This is event-driven, not polling.

### Q2: How does the read-only teammate view subscribe to another session's messages?

**Answer**: Each child session is a regular conversation with its own `conversation_id`. The platform chat timeline components (e.g., GeminiChat's message hook) already subscribe to `responseStream` filtered by `conversation_id`. By mounting a `GeminiChatTimeline` with `conversationId={childSessionId}`, it automatically receives the child's streaming messages. No new subscription mechanism needed.

### Q3: How does the [+] add member flow inject notifications into the admin conversation?

**Answer**: The `dispatch.addMember` bridge handler calls `task.sendMessage({ input: notification, msg_id: uuid(), isSystemNotification: true })` on the admin's `DispatchAgentManager`. The `isSystemNotification` flag ensures the notification is not persisted as a user message. The admin agent receives it as a system turn and generates a natural-language response visible in the group chat timeline.

### Q4: Should MemberBar/TabBar state extend existing DispatchContext?

**Answer**: No. There is no existing DispatchContext. The current GroupChatView uses plain `useState` hooks. The tab/member state is derived from the existing `useGroupChatInfo` hook with a thin `useGroupChatTabs` derivation layer. Adding a Context for this would be over-engineering.

### Q5: How to handle the transition between group chat tab and teammate tabs?

**Answer**: Conditional rendering, not routing. The `activeTabKey` state determines which component mounts:
- `'group-chat'` -> `GroupChatTimeline` + `SendBox`
- `childSessionId` -> `TeammateTabView`

Routing (react-router) would break the single-page group chat experience and require URL management for tabs. Conditional render is simpler and preserves the group chat's scroll position in the timeline (via React state preservation when unmounting/remounting -- or better, using `display: none` to keep the DOM alive).

**Optimization**: To preserve scroll position when switching tabs, use CSS-based tab switching instead of conditional mount/unmount:

```tsx
<div style={{ display: activeTabKey === 'group-chat' ? 'flex' : 'none' }} className='flex-1 flex-col min-h-0'>
  <GroupChatTimeline ... />
  <SendBox ... />
</div>
{tabs.filter(t => t.key !== 'group-chat').map(tab => (
  <div
    key={tab.key}
    style={{ display: activeTabKey === tab.key ? 'flex' : 'none' }}
    className='flex-1 flex-col min-h-0'
  >
    <TeammateTabView childSessionId={tab.key} conversationId={conversation.id} />
  </div>
))}
```

This keeps each tab's DOM mounted (preserving scroll, streaming state) while only showing the active one. The trade-off is higher memory usage with many tabs, but this is acceptable for the expected tab count (typically 3-6).

---

## 6. File Change Summary

### New files (7)

| File | Description |
|------|-------------|
| `src/renderer/pages/conversation/dispatch/components/MemberBar.tsx` | Horizontal member strip with avatars + status dots + [+] button |
| `src/renderer/pages/conversation/dispatch/components/TeammateTabBar.tsx` | Tab bar with group-chat + teammate tabs, unread dots, close buttons |
| `src/renderer/pages/conversation/dispatch/components/TeammateTabView.tsx` | Read-only conversation view for teammate tabs |
| `src/renderer/pages/conversation/dispatch/components/MemberProfileDrawer.tsx` | Member profile Drawer with type-specific fields |
| `src/renderer/pages/conversation/dispatch/components/AddMemberModal.tsx` | Agent selector modal for adding members |
| `src/renderer/pages/conversation/dispatch/hooks/useGroupChatTabs.ts` | Hook deriving tab state + unread tracking from useGroupChatInfo |
| `src/renderer/pages/conversation/dispatch/components/ReadOnlyConversationRenderer.tsx` | Platform-specific timeline router for read-only mode |

### Modified files (6)

| File | Change |
|------|--------|
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx` | Replace GroupMemberSider/TaskPanel with MemberBar/TabBar/TeammateTabView |
| `src/renderer/pages/conversation/dispatch/CreateGroupChatModal.tsx` | Simplify to 3 fields (name, admin, workspace) |
| `src/renderer/pages/conversation/dispatch/types.ts` | Add MemberBarItem, TeammateTab, new props types |
| `src/process/task/dispatch/dispatchPrompt.ts` | Add welcome behavior section |
| `src/process/task/dispatch/DispatchAgentManager.ts` | Add welcome auto-trigger in bootstrap |
| `src/process/bridge/dispatchBridge.ts` | Add `addMember` handler, simplify `createGroupChat`, add `updateChildModel` |

### Deprecated / removed files (0)

No files are deleted. `GroupMemberSider`, `MemberCard`, `TaskPanel`, `TaskOverview`, and `SaveTeammateModal` are no longer imported in `GroupChatView` but remain in the codebase for backward compatibility until confirmed unused.

### Directory structure after G3

```
src/renderer/pages/conversation/dispatch/
  GroupChatView.tsx              (modified)
  GroupChatTimeline.tsx          (unchanged)
  CreateGroupChatModal.tsx       (modified)
  ChildTaskCard.tsx              (unchanged)
  ChildTaskCard.module.css       (unchanged)
  TaskPanel.tsx                  (deprecated, unused)
  TaskPanel.module.css           (deprecated, unused)
  types.ts                       (modified)
  components/
    MemberBar.tsx                (new)
    TeammateTabBar.tsx           (new)
    TeammateTabView.tsx          (new)
    ReadOnlyConversationRenderer.tsx (new)
    MemberProfileDrawer.tsx      (new)
    AddMemberModal.tsx           (new)
    GroupMemberSider.tsx         (deprecated, unused)
    MemberCard.tsx               (deprecated, unused)
    MemberCard.module.css        (deprecated, unused)
    TaskOverview.tsx             (deprecated, unused)
    TaskOverview.module.css      (deprecated, unused)
    GroupChatSettingsDrawer.tsx   (deprecated, unused)
    SaveTeammateModal.tsx        (deprecated, unused)
  hooks/
    useGroupChatInfo.ts          (unchanged)
    useGroupChatMessages.ts      (unchanged)
    useGroupChatTabs.ts          (new)
    useTaskPanelTranscript.ts    (deprecated, unused)
    useIsSavedTeammate.ts        (deprecated, unused)
    useChildTaskDetail.ts        (deprecated, unused)
```

Note: `components/` will have 12 children (6 new + 6 deprecated). After confirming deprecation, the deprecated files should be deleted to comply with the 10-child directory limit.

---

## 7. Self-Debate: Objections and Responses

### Objection 1: "CSS `display: none` tab switching wastes memory with many teammate tabs"

**Concern**: Each `TeammateTabView` mounts a full chat timeline with its own message state, stream subscription, and DOM nodes. With 10+ tabs, this could cause memory bloat.

**Response**: The typical group chat has 3-6 teammates (the prompt template already limits concurrent children to 3 by default, configurable up to 10). For this range, the memory overhead of keeping 3-6 chat timelines mounted is negligible (each is a scrollable div with ~20-50 message nodes). If we observe memory issues in practice, we can add a **lazy eviction policy**: only keep the 3 most recently active tabs mounted, unmount the rest (losing scroll position but saving memory). This is a future optimization, not a blocker.

### Objection 2: "Polling `useGroupChatInfo` every 5s for tab status is wasteful"

**Concern**: The current 10s polling is already a compromise. Reducing to 5s doubles the IPC traffic. Each poll reads all children from the DB.

**Response**: The poll is lightweight -- it reads conversation rows (no message bodies) and does in-memory status mapping. The 5s interval only fires when there are active (running/pending) children (the existing `hasActive` skip logic in `useGroupChatInfo` handles this). When all children are idle/completed, polling stops entirely. For **real-time unread dots**, we use event-driven `responseStream` subscription (zero polling). The 5s poll only affects the status dots on tabs, which is acceptable latency for a status indicator.

Alternative considered: push-based status updates via a new IPC event channel. Rejected because it would require changes to `DispatchSessionTracker` (emit on every status change) and a new IPC bridge -- high cost for marginal latency improvement (5s -> instant for status dots only).

### Objection 3: "The `dispatch.addMember` handler stores members in `conversation.extra.members` but the admin doesn't actually use `member_id` in `start_task` yet"

**Concern**: G3.6 adds the "add member" flow and injects a notification, but the actual `member_id` resolution in `start_task` is stubbed (`throw new Error('member_id resolution not yet implemented (planned for G3)')` in `DispatchAgentManager.ts` line 354). The feature is incomplete.

**Response**: Correct. G3.6 delivers the **UI flow** (select agent -> add to group -> notify admin), which is the user-facing value. The admin can still dispatch tasks to the added member by creating a `start_task` with the member's config manually assembled in the prompt. The `member_id` resolution (auto-fill config from registry) is a G4 enhancement that makes the admin's job easier but doesn't block the user flow. The notification message includes enough info (name, description, skills, base agent) for the admin to construct a proper `start_task`.

### Objection 4: "Extracting GeminiChatTimeline for read-only reuse requires refactoring the Gemini platform code"

**Concern**: The current `GeminiChat` component is monolithic -- timeline + sendbox + hooks are tightly coupled. Extracting a standalone timeline component is a non-trivial refactor that could introduce regressions.

**Response**: For MVP, we do NOT refactor `GeminiChat`. Instead, `TeammateTabView` uses the existing `useTaskPanelTranscript` hook (text-only transcript with 5s polling) as a fallback. This is the current `TaskPanel` approach, just rendered in a tab instead of a side panel. It's functional, shows conversation flow, and doesn't require any platform code changes.

The full streaming/thinking/tool-call rendering (reusing single-chat components) is a **Phase 2 enhancement** within G3. It requires:
1. Extracting `GeminiChatTimeline` from `GeminiChat` (mechanical refactor).
2. Adding a `readonly` prop that hides SendBox.
3. Doing the same for `AcpChat`, `CodexChat` etc.

This phased approach de-risks the initial delivery.

### Objection 5: "Removing GroupMemberSider eliminates the vertical member list which some users may prefer"

**Concern**: The horizontal MemberBar only shows avatars (no names visible). Users lose the detailed member list view that GroupMemberSider provided.

**Response**: The MemberBar shows names on hover (via `Tooltip`). For detailed info, clicking an avatar opens the `MemberProfileDrawer` (G3.5) which shows much more than the old sidebar. The tab bar also shows teammate names with status. Net information density is higher, not lower. If we get user feedback requesting a detailed list view, we can add a "list view" toggle to MemberBar in a future iteration.

---

## 8. Acceptance Criteria

### G3.1: Simplified CreateGroupChatModal

- [ ] Modal shows exactly 3 fields: Name (optional, defaults to "New Group Chat"), Admin Agent (required), Workspace (optional)
- [ ] Model selector and seed message fields are removed from the modal
- [ ] Admin Agent selector shows both CLI agents (Gemini, ACP, Codex...) and custom assistants
- [ ] OK button is disabled when no Admin Agent is selected
- [ ] Group chat creates successfully with only Admin Agent selected (other fields empty)
- [ ] Navigation to new group chat works after creation

### G3.2: Admin Welcome Message

- [ ] After creating a new group chat, the admin automatically sends a welcome message (no user input required)
- [ ] Welcome message mentions the two collaboration modes (auto-create teammates / manual add members)
- [ ] Welcome message style varies based on admin agent persona (different admin = different tone)
- [ ] Welcome message does NOT appear when reopening an existing group chat (only on fresh creation)
- [ ] The system trigger message ("[System] Group chat created...") is NOT visible to the user in the timeline

### G3.3: MemberBar + TeammateTabBar

- [ ] MemberBar renders as a horizontal strip below the header with avatar circles (32px)
- [ ] Admin avatar has a crown badge and always-green status dot
- [ ] Child members show status dots: green (idle/completed), blue (running/pending), gray (cancelled), red (failed)
- [ ] [+] button at the end of MemberBar opens Add Member modal
- [ ] Clicking any avatar opens the Member Profile Drawer
- [ ] TeammateTabBar renders below MemberBar with [Group Chat] as the leftmost tab
- [ ] Teammate tabs appear automatically when children are created (via `useGroupChatInfo` polling)
- [ ] Active tab has a bottom border highlight and bold text
- [ ] Inactive tabs with new content show a red unread dot
- [ ] Unread dot clears when switching to that tab
- [ ] Completed/cancelled/failed tabs show a close button (X)
- [ ] Closing a tab removes it from the bar and switches to Group Chat tab
- [ ] Tab bar scrolls horizontally when tabs overflow container width
- [ ] MemberBar + TabBar total height does not exceed 80px

### G3.4: Teammate Work View (Read-Only Tab)

- [ ] Clicking a teammate tab shows that teammate's conversation transcript
- [ ] Tab view has NO input box / send box (read-only)
- [ ] Transcript updates in real-time when the teammate is working (via polling or stream)
- [ ] Switching back to Group Chat tab preserves the group timeline scroll position
- [ ] Switching between teammate tabs preserves each tab's scroll position (CSS display:none approach)
- [ ] Loading spinner shows while transcript is being fetched

### G3.5: Member Profile Drawer

- [ ] Clicking a member avatar in MemberBar opens a right-side Drawer (320px width)
- [ ] Admin profile shows: status, base agent, model (editable), current instruction, current task + elapsed time
- [ ] Permanent member profile shows: status, base agent, model (editable), rules (read-only), skills (read-only), current instruction, current task, "Remove from group" button
- [ ] Temporary member profile shows: status, base agent, model (editable), current instruction, current task + elapsed time
- [ ] Changing model via the profile drawer persists the change (IPC call)
- [ ] "Remove from group" button removes the permanent member and notifies the admin
- [ ] Drawer closes on outside click or close button

### G3.6: Manual Add Member

- [ ] Clicking [+] in MemberBar opens a modal with an agent selector
- [ ] Agent selector shows all available agents from `useAgentRegistry` (CLI agents + presets + custom)
- [ ] Already-added members are disabled (grayed out) in the selector
- [ ] After adding a member, the admin receives a system notification with the member's profile info
- [ ] Admin generates a natural-language acknowledgment message in the group chat timeline
- [ ] The new member appears in the MemberBar after the next `useGroupChatInfo` refresh
- [ ] Adding multiple members in sequence works correctly (each triggers a separate admin notification)

### Cross-cutting Acceptance Criteria

- [ ] `bunx tsc --noEmit` passes with zero errors (TypeScript strict mode)
- [ ] `bun run lint:fix` produces zero remaining warnings
- [ ] No regressions in existing group chat functionality (create, send message, view timeline, cancel child)
- [ ] All new components use `@arco-design/web-react` + `@icon-park/react` (no raw HTML interactive elements)
- [ ] All CSS uses UnoCSS utility classes or CSS Modules with semantic tokens (no hardcoded colors)
- [ ] All user-facing strings use i18n keys (no hardcoded text)
- [ ] New files follow PascalCase (components) or camelCase (hooks/utils) naming conventions
- [ ] `components/` directory does not exceed 10 active children (deprecated files count toward limit until deleted)

---

## 9. Implementation Order

The recommended implementation sequence (respects dependencies):

```
G3.1 (CreateGroupChatModal simplification)
  -> G3.2 (Welcome message -- depends on simplified creation flow)
  -> G3.3 (MemberBar + TabBar -- can start in parallel with G3.2)
     -> G3.4 (TeammateTabView -- depends on TabBar for mounting)
     -> G3.5 (MemberProfileDrawer -- depends on MemberBar for trigger)
     -> G3.6 (AddMemberModal -- depends on MemberBar [+] button)
```

G3.1 and G3.2 are quick wins (1-2 files each). G3.3 is the largest task (new hook + 2 components + GroupChatView rewrite). G3.4-G3.6 can be parallelized after G3.3.
