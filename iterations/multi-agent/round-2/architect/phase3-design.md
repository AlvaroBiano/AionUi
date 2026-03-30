# Phase 3 Technical Design

## 1. Architecture Overview

Phase 3 adds two features on top of the existing dispatch multi-agent system:

1. **F-3.1 Save Teammate as Assistant** -- a new IPC round-trip (`getTeammateConfig` + `saveTeammate`) that reads a child conversation's `extra.presetRules` / `extra.teammateConfig`, presents it in a modal, and writes a new `AcpBackendConfig` entry into `acp.customAgents`.

2. **F-3.2 Parent-Child Task Overview** -- a pure renderer-side component (`TaskOverview`) that consumes the existing `useGroupChatInfo` hook data and renders a collapsible summary panel above the timeline. No new IPC channels required; only a minor enhancement to `useGroupChatInfo` for auto-refresh.

### Process Boundary Map

```
Renderer                           Main Process
  SaveTeammateModal.tsx              dispatchBridge.ts
  TaskOverview.tsx                     |
  ChildTaskCard.tsx (modified)         +-- dispatch.get-teammate-config (NEW)
  TaskPanel.tsx (modified)             +-- dispatch.save-teammate (NEW)
  GroupChatView.tsx (modified)         |
  hooks/useGroupChatInfo.ts (mod)      +-- ProcessConfig.get/set('acp.customAgents')
  hooks/useIsSavedTeammate.ts (NEW)    |
  types.ts (modified)                  v
  ipcBridge.ts (modified)           conversationRepo (DB read)
```

---

## 2. F-3.1: Save Teammate as Assistant

### 2.1 Data Model

**Source data** (child conversation `extra`):

```typescript
// TChatConversation (type='dispatch', dispatchSessionType='dispatch_child')
extra: {
  presetRules?: string;           // teammate system prompt
  teammateConfig?: {
    name: string;
    avatar?: string;
  };
}
```

**Target data** (`AcpBackendConfig` in `acp.customAgents`):

```typescript
{
  id: string;           // uuid()
  name: string;         // from modal input (pre-filled with teammateConfig.name)
  avatar?: string;      // from modal input (pre-filled with teammateConfig.avatar)
  context?: string;     // from modal input (pre-filled with extra.presetRules)
  enabled: true;
  isPreset: true;       // makes it selectable as a leader agent
  presetAgentType: 'gemini';  // dispatch children are gemini-based
  source: 'dispatch_teammate';  // custom field for provenance tracking
}
```

**Key mapping**: `presetRules` (dispatch extra) maps to `context` (AcpBackendConfig). This is the same mapping used in `dispatchBridge.ts` line 93: `leaderPresetRules = leaderAgent.context`.

### 2.2 IPC Channels

#### 2.2.1 `dispatch.get-teammate-config`

**Purpose**: Fetch the full teammate configuration from a child session's DB record. The renderer has `teammateName` and `teammateAvatar` from `useGroupChatInfo`, but `presetRules` is not included in the info response (it's in the conversation extra, not in the children summary).

**ipcBridge.ts addition** (inside `dispatch` object):

```typescript
/** Get full teammate config for save-as-assistant modal */
getTeammateConfig: bridge.buildProvider<
  IBridgeResponse<{
    name: string;
    avatar?: string;
    presetRules?: string;
  }>,
  { childSessionId: string }
>('dispatch.get-teammate-config'),
```

**dispatchBridge.ts handler**:

```typescript
ipcBridge.dispatch.getTeammateConfig.provider(async (params) => {
  const conversation = await conversationService.getConversation(params.childSessionId);
  if (!conversation) {
    return { success: false, msg: 'Child session not found' };
  }
  const extra = conversation.extra as {
    teammateConfig?: { name: string; avatar?: string };
    presetRules?: string;
  };
  return {
    success: true,
    data: {
      name: extra.teammateConfig?.name || conversation.name,
      avatar: extra.teammateConfig?.avatar,
      presetRules: extra.presetRules,
    },
  };
});
```

#### 2.2.2 `dispatch.save-teammate`

**Purpose**: Persist a new assistant entry into `acp.customAgents`.

**ipcBridge.ts addition** (inside `dispatch` object):

```typescript
/** Save a temporary teammate as a persistent assistant */
saveTeammate: bridge.buildProvider<
  IBridgeResponse<{ assistantId: string }>,
  {
    name: string;
    avatar?: string;
    presetRules?: string;
  }
>('dispatch.save-teammate'),
```

**dispatchBridge.ts handler**:

```typescript
ipcBridge.dispatch.saveTeammate.provider(async (params) => {
  try {
    const customAgents = ((await ProcessConfig.get('acp.customAgents')) || []) as AcpBackendConfig[];

    // Duplicate name check
    if (customAgents.some((a) => a.name === params.name)) {
      return { success: false, msg: 'Assistant with this name already exists' };
    }

    const newId = uuid();
    const newAgent: AcpBackendConfig = {
      id: newId,
      name: params.name,
      avatar: params.avatar,
      context: params.presetRules,
      enabled: true,
      isPreset: true,
      presetAgentType: 'gemini',
    };
    // Attach source marker via type assertion (AcpBackendConfig doesn't have 'source')
    (newAgent as Record<string, unknown>).source = 'dispatch_teammate';

    customAgents.push(newAgent);
    await ProcessConfig.set('acp.customAgents', customAgents);

    return { success: true, data: { assistantId: newId } };
  } catch (error) {
    return { success: false, msg: String(error) };
  }
});
```

**Design note on `source` field**: `AcpBackendConfig` does not currently define a `source` field. Rather than modifying the shared interface (which risks breaking other consumers), we attach it via type assertion. This is safe because `ProcessConfig` serializes to JSON -- extra fields are preserved. When we need to filter by source, we cast to `Record<string, unknown>` and read `.source`.

### 2.3 UI Components

#### 2.3.1 SaveTeammateModal

**File**: `src/renderer/pages/conversation/dispatch/modals/SaveTeammateModal.tsx`

**Props**:

```typescript
type SaveTeammateModalProps = {
  visible: boolean;
  childSessionId: string;
  /** Pre-filled values from useGroupChatInfo (avoids IPC if already known) */
  initialName?: string;
  initialAvatar?: string;
  onClose: () => void;
  onSaved: (assistantId: string) => void;
};
```

**Behavior**:

1. On open (`visible=true`), calls `ipcBridge.dispatch.getTeammateConfig({ childSessionId })` to fetch `presetRules` (and confirm name/avatar).
2. Pre-fills form fields: Name (Input, required), Avatar (Input, single emoji), System Prompt (Input.TextArea, maxLength=4000).
3. Save button calls `ipcBridge.dispatch.saveTeammate(...)`.
4. On success: `Message.success(t('dispatch.teammate.saveSuccess'))`, calls `onSaved(assistantId)`, closes modal.
5. On duplicate name: `Message.error(t('dispatch.teammate.saveDuplicate'))`.

**Arco components used**: `Modal`, `Form`, `Input`, `Input.TextArea`, `Button`, `Message`.

#### 2.3.2 useIsSavedTeammate Hook

**File**: `src/renderer/pages/conversation/dispatch/hooks/useIsSavedTeammate.ts`

```typescript
/**
 * Check whether a teammate name already exists in acp.customAgents.
 * Uses ipcBridge.acpConversation.getAvailableAgents to read the list.
 */
export function useIsSavedTeammate(teammateName?: string): {
  isSaved: boolean;
  isChecking: boolean;
} {
  // Calls getAvailableAgents on mount, checks if any agent.name === teammateName
  // Re-checks when teammateName changes
  // Returns { isSaved: true/false, isChecking: boolean }
}
```

**Why `getAvailableAgents` instead of a new IPC?** -- This endpoint already exists and returns all custom agents. It avoids creating a dedicated "check if saved" IPC. The list is typically small (<50 agents), so filtering client-side is acceptable.

#### 2.3.3 ChildTaskCard Modifications

Add a "Save" icon button in the action area, next to "View Details":

```tsx
{
  /* After the View Details button */
}
{
  !isSaved && hasTeammateConfig && (
    <Button
      type='text'
      size='mini'
      icon={<Save theme='outline' size='14' />}
      onClick={() => onSave?.(message.childTaskId!)}
      aria-label={t('dispatch.teammate.save')}
    >
      {t('dispatch.teammate.save')}
    </Button>
  );
}
{
  isSaved && (
    <span className='flex items-center gap-4px text-t-secondary text-12px'>
      <CheckOne theme='outline' size='14' />
      {t('dispatch.teammate.saved')}
    </span>
  );
}
```

**New props added to `ChildTaskCardProps`**:

```typescript
/** Save callback */
onSave?: (childTaskId: string) => void;
/** Whether this teammate has already been saved */
isSaved?: boolean;
```

**Condition for showing Save**: `message.avatar` or `message.displayName` exists AND `message.displayName !== 'Agent'` (default name means no custom teammate config).

#### 2.3.4 TaskPanel Modifications

Add "Save as Assistant" button in the header area, next to the status Tag:

```tsx
{
  /* After the Tag component in the header */
}
{
  !isSaved && childInfo.teammateName && (
    <Button
      type='text'
      size='mini'
      onClick={() => setShowSaveModal(true)}
      aria-label={t('dispatch.teammate.saveAsAssistant')}
    >
      {t('dispatch.teammate.saveAsAssistant')}
    </Button>
  );
}
{
  isSaved && (
    <span className='flex items-center gap-4px text-t-secondary text-12px ml-4px'>
      <CheckOne theme='outline' size='14' />
      {t('dispatch.teammate.saved')}
    </span>
  );
}
```

### 2.4 Flow Diagram

```
User clicks "Save" on ChildTaskCard
  |
  v
GroupChatView sets saveModalTarget = { childSessionId, name, avatar }
  |
  v
SaveTeammateModal opens (visible=true)
  |
  +-- [mount] calls dispatch.getTeammateConfig({ childSessionId })
  |     |
  |     v (Main Process)
  |   conversationService.getConversation(childSessionId)
  |     reads extra.teammateConfig + extra.presetRules
  |     returns { name, avatar, presetRules }
  |
  +-- User edits form fields
  |
  +-- User clicks "Save"
  |     |
  |     v
  |   calls dispatch.saveTeammate({ name, avatar, presetRules })
  |     |
  |     v (Main Process)
  |   ProcessConfig.get('acp.customAgents')
  |   check duplicate name
  |   generate uuid()
  |   build AcpBackendConfig { id, name, avatar, context, enabled, isPreset, ... }
  |   ProcessConfig.set('acp.customAgents', [...existing, newAgent])
  |   return { success: true, data: { assistantId } }
  |
  +-- onSaved(assistantId)
  |     |
  |     v
  |   Message.success("Saved!")
  |   useIsSavedTeammate re-evaluates -> isSaved=true
  |   Save button -> "Saved" gray text
```

---

## 3. F-3.2: Parent-Child Task Overview

### 3.1 Component Design

#### 3.1.1 TaskOverview

**File**: `src/renderer/pages/conversation/dispatch/TaskOverview.tsx`

**Props**:

```typescript
type TaskOverviewProps = {
  dispatcherName: string;
  dispatcherAvatar?: string;
  children: ChildTaskInfoVO[];
  selectedChildTaskId?: string | null;
  onSelectChild: (childTaskId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};
```

**Structure**:

```
+-- Container (border, rounded, mx-16px mt-8px)
    +-- Header row (always visible, ~40px)
    |   +-- Dispatcher avatar + name
    |   +-- Collapse/Expand button (icon: Up/Down)
    |
    +-- Child list (hidden when collapsed, max-height 200px, overflow-y auto)
    |   +-- ChildRow (clickable)
    |   |   +-- Avatar emoji (or People icon)
    |   |   +-- Name (truncate)
    |   |   +-- Status indicator (colored dot/icon)
    |   |   +-- Last activity time (relative)
    |   ...
    |
    +-- Summary bar (hidden when collapsed)
        +-- "3 tasks | 1 running | 1 completed | 1 pending"
```

**Status indicators** (rendered as colored `<span>` with CSS):

- `pending`: gray circle (`color-text-4`)
- `running`: blue circle (`primary-6`) + pulse animation
- `completed` / `idle`: green check (`success-6`)
- `failed`: red cross (`danger-6`)
- `cancelled`: gray stop (`color-text-4`)

#### 3.1.2 TaskOverview.module.css

**File**: `src/renderer/pages/conversation/dispatch/TaskOverview.module.css`

Key styles:

- `.container` -- border, border-radius, transition for collapse
- `.childRow` -- hover background, selected highlight, cursor pointer
- `.statusDot` -- base dot style (8px circle)
- `.statusRunning` -- `@keyframes pulse` animation
- `.collapsed` -- max-height:0, overflow:hidden with transition

```css
.container {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  transition: max-height 200ms ease;
}

.contentArea {
  max-height: 200px;
  overflow-y: auto;
  transition: max-height 200ms ease;
}

.contentAreaCollapsed {
  max-height: 0;
  overflow: hidden;
}

.childRow {
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.childRow:hover {
  background-color: var(--color-fill-2);
}

.childRowSelected {
  background-color: rgba(var(--primary-6), 0.08);
}

.statusDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.statusRunning {
  animation: pulse 1.5s ease-in-out infinite;
}

.summaryBar {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-text-3);
  border-top: 1px solid var(--color-border);
}
```

### 3.2 Data Flow

#### 3.2.1 Data Source

TaskOverview directly consumes `info.children` from the existing `useGroupChatInfo` hook. No new IPC channel needed.

#### 3.2.2 Auto-Refresh Enhancement

`useGroupChatInfo` will gain an optional `autoRefreshInterval` parameter:

```typescript
export function useGroupChatInfo(conversationId: string, options?: { autoRefreshInterval?: number }) {
  // ... existing logic ...

  // Auto-refresh when interval is provided
  useEffect(() => {
    if (!options?.autoRefreshInterval) return;
    const timer = setInterval(() => {
      refresh();
    }, options.autoRefreshInterval);
    return () => clearInterval(timer);
  }, [options?.autoRefreshInterval, refresh]);

  return { info, isLoading, error, retry, refresh };
}
```

**In GroupChatView**, compute whether auto-refresh is needed:

```typescript
const hasActiveChildren = useMemo(() => {
  return info?.children?.some(c => c.status === 'running' || c.status === 'pending') ?? false;
}, [info?.children]);

const { info, ... } = useGroupChatInfo(conversation.id, {
  autoRefreshInterval: hasActiveChildren ? 10_000 : undefined,
});
```

**Circular dependency concern**: `hasActiveChildren` depends on `info`, but `info` comes from the hook that needs `hasActiveChildren`. Resolution: use a `useRef` for the interval flag, updated post-render. The hook reads `options.autoRefreshInterval` from a ref, not from state, breaking the cycle. Alternatively, always pass 10000ms and let the hook skip refresh when all children are terminal (simpler approach).

**Chosen approach**: Always pass `autoRefreshInterval: 10_000` and let the hook skip the refresh call when all children are in terminal states. This is simpler and avoids the circular dependency.

#### 3.2.3 GroupChatView Integration

TaskOverview is placed between the notification banner and the GroupChatTimeline:

```tsx
{
  /* Task Overview (F-3.2) */
}
{
  info?.children && info.children.length > 0 && (
    <TaskOverview
      dispatcherName={dispatcherName}
      dispatcherAvatar={dispatcherAvatar}
      children={info.children}
      selectedChildTaskId={selectedChildTaskId}
      onSelectChild={handleViewDetail}
      collapsed={overviewCollapsed}
      onToggleCollapse={() => setOverviewCollapsed((prev) => !prev)}
    />
  );
}
```

New state in GroupChatView: `const [overviewCollapsed, setOverviewCollapsed] = useState(false);`

---

## 4. Self-Debate Log

### Decision 1: Where to store the `source` marker on saved assistants

- **Option A**: Add `source?: string` field to `AcpBackendConfig` interface.
  - Pro: Type-safe, discoverable, IDE autocomplete.
  - Con: Modifies a shared interface used across the entire codebase (17+ references). All consumers would see the new field. Risk of unintended side effects in agent detection, health check, or UI rendering code that iterates over AcpBackendConfig fields.

- **Option B**: Attach `source` via type assertion (`(newAgent as Record<string, unknown>).source = 'dispatch_teammate'`).
  - Pro: Zero impact on existing code. JSON serialization preserves the field transparently. Reading it back requires explicit casting, which is the correct pattern for a field only meaningful in one context.
  - Con: Not type-safe at the write site. Could be accidentally dropped if someone reconstructs the object.

- **Verdict**: **Option B**. The `source` field is a provenance tag used only by the dispatch save-teammate feature. It does not belong in the shared `AcpBackendConfig` interface because no other consumer needs it. The serialization safety of JSON + `ProcessConfig` is sufficient. If we later need cross-feature filtering by source, we can promote it to the interface at that time.

### Decision 2: How to check if a teammate is already saved (useIsSavedTeammate)

- **Option A**: Create a new dedicated IPC channel `dispatch.check-teammate-saved` that takes `{ name: string }` and returns `{ isSaved: boolean }`.
  - Pro: Minimal data transfer, exact semantics.
  - Con: Another IPC channel to maintain. The check is trivial (name comparison in a list). Over-engineering for a simple lookup.

- **Option B**: Reuse `ipcBridge.acpConversation.getAvailableAgents()` which returns all agents (built-in + custom), and filter client-side.
  - Pro: Reuses existing infrastructure. No new IPC. The list is typically small (<50 items).
  - Con: Fetches more data than needed. Makes an IPC call that returns agent binary paths, health info, etc.

- **Option C**: Create a new IPC `dispatch.list-saved-teammates` that returns only dispatch-sourced agents.
  - Pro: Semantically clean.
  - Con: Same over-engineering problem as Option A.

- **Verdict**: **Option B**. The `getAvailableAgents` endpoint is already called elsewhere in the UI (e.g., CreateGroupChatModal's leader selector). The response is lightweight and cached. Client-side filtering by `name` match is trivial. This avoids adding IPC channels for a simple boolean check.

### Decision 3: Auto-refresh strategy for TaskOverview

- **Option A**: Conditional interval -- only set `setInterval` when there are active children. Requires computing `hasActiveChildren` from hook output, creating a circular dependency (hook depends on options, options depend on hook output).
  - Pro: No wasted IPC calls when all tasks are done.
  - Con: Circular dependency requires `useRef` workaround or two-pass rendering. Complex.

- **Option B**: Always set a 10s interval, but skip the actual IPC call inside the hook if all known children are in terminal states.
  - Pro: Simple. No circular dependency. The "skip" check is a cheap in-memory comparison against the last known `info.children`.
  - Con: `setInterval` timer is always active (negligible cost). The first refresh after all tasks complete will make one redundant IPC call before detecting terminal states.

- **Option C**: Use event-driven refresh -- listen for `conversation.turnCompleted` emitter events scoped to child session IDs.
  - Pro: Real-time updates, no polling overhead.
  - Con: Requires knowing all child session IDs to subscribe. The emitter pattern in AionUi is conversation-scoped, not parent-scoped. Would need significant refactoring.

- **Verdict**: **Option B**. Simplicity wins. The 10-second interval with skip-on-terminal is easy to implement, test, and reason about. The overhead of an extra IPC call after all tasks complete is negligible. Option C is architecturally superior but requires infrastructure changes beyond Phase 3 scope.

### Decision 4: Directory organization for new files

- **Option A**: Put `SaveTeammateModal.tsx` in `dispatch/modals/`, `TaskOverview.tsx` directly in `dispatch/`.
  - Current count: 9 items (7 files + hooks/ + 1 CSS). Adding `TaskOverview.tsx`, `TaskOverview.module.css`, and `modals/` = 12 direct items. Exceeds the 10-item limit.

- **Option B**: Put `SaveTeammateModal.tsx` in `dispatch/modals/`, put `TaskOverview.tsx` + CSS in `dispatch/panels/` alongside `TaskPanel.tsx` (moved there).
  - Requires moving `TaskPanel.tsx` and `TaskPanel.module.css` into `panels/`. Reduces dispatch/ direct items but creates a migration chore.

- **Option C**: Put `SaveTeammateModal.tsx` in `dispatch/modals/`, `TaskOverview.tsx` and `TaskOverview.module.css` directly in `dispatch/`. Accept 11 items temporarily with a follow-up cleanup task.
  - Con: Violates the 10-item rule.

- **Option D**: Merge `TaskOverview.module.css` into UnoCSS utilities (no separate CSS module file). Put `SaveTeammateModal.tsx` in `dispatch/modals/`, `TaskOverview.tsx` directly in `dispatch/`.
  - Current: 9 items. Add: `modals/` (1) + `TaskOverview.tsx` (1) = 11. Still exceeds 10.

- **Option E**: Put both `SaveTeammateModal.tsx` and `TaskOverview.tsx` + CSS into `dispatch/components/`.
  - Current: 9. Add: `components/` (1). Remove: none. Total: 10. Exactly at limit.

- **Verdict**: **Option E**. Create a `dispatch/components/` subdirectory for both new view components (`SaveTeammateModal.tsx`, `TaskOverview.tsx`, `TaskOverview.module.css`). This keeps the `dispatch/` directory at exactly 10 items (7 existing files + `hooks/` + `components/` + types.ts file is already counted). Clean, follows the project convention, no migration needed.

  Final dispatch/ structure (10 items):

  ```
  dispatch/
    ChildTaskCard.module.css
    ChildTaskCard.tsx
    CreateGroupChatModal.tsx
    GroupChatTimeline.tsx
    GroupChatView.tsx
    TaskPanel.module.css
    TaskPanel.tsx
    components/           <-- NEW subdirectory
      SaveTeammateModal.tsx
      TaskOverview.tsx
      TaskOverview.module.css
    hooks/
    types.ts
  ```

  Wait -- that's 10 items. Let me recount: ChildTaskCard.module.css (1), ChildTaskCard.tsx (2), CreateGroupChatModal.tsx (3), GroupChatTimeline.tsx (4), GroupChatView.tsx (5), TaskPanel.module.css (6), TaskPanel.tsx (7), components/ (8), hooks/ (9), types.ts (10). Exactly 10. Passes the constraint.

### Decision 5: presetAgentType for saved assistants

- **Option A**: Set `presetAgentType: 'gemini'` because dispatch children currently use `type: 'gemini'` worker.
  - Pro: Matches the actual runtime behavior. When the saved assistant is later used as a leader agent, it will create a gemini-based conversation, which is correct for the dispatch system.
  - Con: If in the future dispatch supports non-gemini children, saved assistants would have the wrong type.

- **Option B**: Omit `presetAgentType`, let it default (which is `'gemini'` per the code comment in acpTypes.ts).
  - Pro: Simpler. Same effect as Option A.
  - Con: Implicit default is fragile -- if the default changes, behavior silently changes.

- **Verdict**: **Option A**. Explicit `presetAgentType: 'gemini'` is safer than relying on a default. The PRD states the saved assistant should be selectable in CreateGroupChatModal's leader selector, and the leader selector uses `presetAgentType` to determine conversation creation type.

---

## 5. File Change List

### New Files

| File                                                                          | Purpose                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/renderer/pages/conversation/dispatch/components/SaveTeammateModal.tsx`   | Save teammate confirmation modal with form                       |
| `src/renderer/pages/conversation/dispatch/components/TaskOverview.tsx`        | Collapsible parent-child task overview panel                     |
| `src/renderer/pages/conversation/dispatch/components/TaskOverview.module.css` | Styles for TaskOverview (collapse animation, pulse, status dots) |
| `src/renderer/pages/conversation/dispatch/hooks/useIsSavedTeammate.ts`        | Hook to check if teammate name exists in customAgents            |

### Modified Files

| File                                                                 | Changes                                                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/common/adapter/ipcBridge.ts`                                    | Add `saveTeammate` and `getTeammateConfig` to `dispatch` object                                     |
| `src/process/bridge/dispatchBridge.ts`                               | Add `dispatch.save-teammate` and `dispatch.get-teammate-config` provider handlers                   |
| `src/renderer/pages/conversation/dispatch/ChildTaskCard.tsx`         | Add Save icon button with `onSave` prop + saved state display                                       |
| `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`             | Add "Save as Assistant" button in header + local SaveTeammateModal state                            |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`         | Integrate TaskOverview + SaveTeammateModal + `overviewCollapsed` state + auto-refresh               |
| `src/renderer/pages/conversation/dispatch/types.ts`                  | Add `TaskOverviewProps`, `SaveTeammateModalProps`, extend `ChildTaskCardProps` and `TaskPanelProps` |
| `src/renderer/pages/conversation/dispatch/hooks/useGroupChatInfo.ts` | Add optional `autoRefreshInterval` parameter with terminal-state skip logic                         |
| i18n locale files (6 languages)                                      | Add all `dispatch.teammate.*` and `dispatch.overview.*` keys per PRD Appendix A                     |

---

## 6. Migration Notes

### 6.1 No DB Schema Changes

Both features operate on existing data structures:

- F-3.1 reads from child conversation `extra` (already populated by Phase 2a `startChildSession`) and writes to `acp.customAgents` (existing config key).
- F-3.2 reads from `useGroupChatInfo` (existing IPC).

### 6.2 Backward Compatibility

- The two new IPC channels (`dispatch.save-teammate`, `dispatch.get-teammate-config`) are additive. Old renderer code simply won't call them.
- The `source: 'dispatch_teammate'` marker on saved assistants is invisible to existing code that reads `acp.customAgents` -- it's an extra JSON field that existing consumers don't access.
- `useGroupChatInfo`'s new `autoRefreshInterval` parameter is optional with no default behavior change.

### 6.3 Feature Flag Consideration

No feature flag needed. Both features are purely additive UI and are gated by natural conditions:

- Save button only appears when `teammateConfig` exists on a child.
- TaskOverview only renders when `info.children.length > 0`.

### 6.4 i18n Rollout

All 6 supported languages must have translations before merge. Keys are listed in PRD Appendix A. English is the source locale; other languages should be translated during the implementation PR.

### 6.5 Testing Requirements

Per NFR-5, new components need >= 80% coverage:

| Test File                           | Scope                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `SaveTeammateModal.test.tsx`        | Modal rendering, form validation, IPC mock for save/duplicate                  |
| `TaskOverview.test.tsx`             | Rendering with various child states, collapse toggle, click selection          |
| `useIsSavedTeammate.test.ts`        | Hook behavior with mocked getAvailableAgents                                   |
| `useGroupChatInfo.test.ts` (extend) | Auto-refresh interval logic, terminal-state skip                               |
| `dispatchBridge.test.ts` (extend)   | save-teammate handler (success, duplicate, error), get-teammate-config handler |
