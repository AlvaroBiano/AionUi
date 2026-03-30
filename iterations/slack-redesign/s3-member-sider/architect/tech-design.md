# S3 Group Chat Member Sidebar - Tech Design

## Overview

Add a collapsible member panel to the right side of `GroupChatView`, showing all child agents (members) in the current group chat with their avatar, name, status, leader badge, employee type badge, hover config summary, and click-to-edit functionality.

---

## 1. File Change List

| #   | File (absolute from project root)                                           | Action     | Description                                                                                           |
| --- | --------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `src/renderer/pages/conversation/dispatch/components/GroupMemberSider.tsx`  | **Create** | New component: member list panel with header, member cards, and collapse toggle                       |
| 2   | `src/renderer/pages/conversation/dispatch/components/MemberCard.tsx`        | **Create** | New component: individual member card with avatar, badges, hover popover, click handler               |
| 3   | `src/renderer/pages/conversation/dispatch/components/MemberCard.module.css` | **Create** | CSS Module for hover/active states, badge styling, popover transitions                                |
| 4   | `src/renderer/pages/conversation/dispatch/types.ts`                         | **Modify** | Add `GroupChatMemberVO`, `MemberCardProps`, `GroupMemberSiderProps`                                   |
| 5   | `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`                | **Modify** | Add member sider panel alongside TaskPanel in the right area                                          |
| 6   | `src/renderer/pages/conversation/dispatch/hooks/useGroupChatInfo.ts`        | **Modify** | Map new fields (`presetRules`, `isLeader`, `isPermanent`) from bridge response into `GroupChatInfoVO` |
| 7   | `src/process/bridge/dispatchBridge.ts`                                      | **Modify** | Enrich `getGroupChatInfo` response with `presetRules`, `isLeader`, `isPermanent` per child            |
| 8   | `src/renderer/services/i18n/locales/en-US/dispatch.json`                    | **Modify** | Add i18n keys for member sider labels                                                                 |
| 9   | `src/renderer/services/i18n/locales/zh-CN/dispatch.json`                    | **Modify** | Add corresponding zh-CN translations                                                                  |

**Directory child count check**: `dispatch/components/` currently has 4 files. Adding 3 more (GroupMemberSider.tsx, MemberCard.tsx, MemberCard.module.css) brings it to 7, within the 10-child limit.

---

## 2. Type Definitions

### New types in `dispatch/types.ts`

```typescript
/** Member info for the group chat member sidebar (S3) */
export type GroupChatMemberVO = {
  /** Child session ID */
  sessionId: string;
  /** Display name */
  name: string;
  /** Avatar emoji or URL */
  avatar?: string;
  /** Agent status */
  status: 'pending' | 'running' | 'idle' | 'completed' | 'failed' | 'cancelled';
  /** Whether this member is the leader (dispatcher) */
  isLeader: boolean;
  /** Whether this member is a permanent (saved) assistant vs temporary */
  isPermanent: boolean;
  /** Model name if non-default */
  modelName?: string;
  /** Working directory */
  workspace?: string;
  /** Preset rules (first 100 chars shown on hover) */
  presetRules?: string;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Creation timestamp */
  createdAt: number;
};
```

### Modifications to existing types

**`ChildTaskInfoVO`** — add three new optional fields:

```typescript
export type ChildTaskInfoVO = {
  // ... existing fields ...
  /** S3: Preset rules for hover config summary */
  presetRules?: string;
  /** S3: Whether this child uses a saved (permanent) assistant config */
  isPermanent?: boolean;
};
```

**`GroupChatInfoVO`** — add `leaderSessionId` (the dispatcher session is not a child, so leader identification uses `leaderAgentId` from extra; the dispatcher itself is rendered as a pseudo-member at the top of the list):

No structural change needed to `GroupChatInfoVO` — `leaderAgentId` already exists.

---

## 3. Component Props

### GroupMemberSiderProps

```typescript
/** Props for the GroupMemberSider component (S3) */
export type GroupMemberSiderProps = {
  /** List of members derived from GroupChatInfoVO.children */
  members: GroupChatMemberVO[];
  /** Dispatcher info (rendered as leader pseudo-member) */
  dispatcher: {
    name: string;
    avatar?: string;
  };
  /** Leader agent ID (to match against saved agents) */
  leaderAgentId?: string;
  /** Currently selected member session ID (for highlight) */
  selectedMemberId?: string | null;
  /** Callback when a member card is clicked */
  onSelectMember: (sessionId: string) => void;
  /** Callback to open config edit modal for a member */
  onEditConfig: (sessionId: string) => void;
  /** Whether the sider is collapsed */
  collapsed: boolean;
  /** Toggle collapse callback */
  onToggleCollapse: () => void;
};
```

### MemberCardProps

```typescript
/** Props for the MemberCard component (S3) */
export type MemberCardProps = {
  /** Member data */
  member: GroupChatMemberVO;
  /** Whether this card is currently selected/highlighted */
  isSelected: boolean;
  /** Click handler — selects member and opens TaskPanel */
  onClick: () => void;
  /** Double-click or edit-icon click — opens config edit modal */
  onEditConfig: () => void;
};
```

---

## 4. Data Flow

### Current flow (before S3)

```
dispatchBridge.getGroupChatInfo (main process)
  -> IPC -> useGroupChatInfo hook (renderer)
    -> GroupChatInfoVO.children: ChildTaskInfoVO[]
      -> TaskOverview, GroupChatTimeline use children data
```

### S3 flow (additions)

```
dispatchBridge.getGroupChatInfo (main process)
  [MODIFY] For each child conversation, also read:
    - extra.presetRules (string, already stored at child creation)
    - Whether teammateConfig.name matches a saved assistant in acp.customAgents
      -> isPermanent = true if match found
  -> IPC -> useGroupChatInfo hook (renderer)
    [MODIFY] Map new fields (presetRules, isPermanent) into ChildTaskInfoVO
      -> GroupChatView derives GroupChatMemberVO[] from ChildTaskInfoVO[]
        -> GroupMemberSider receives members prop
          -> MemberCard renders each member
```

### Key decisions on data sourcing

1. **presetRules**: Already stored in `childConversation.extra.presetRules` at child creation time (see `DispatchAgentManager.startChildTask` line 412). The bridge just needs to read and return it.

2. **isPermanent**: Determined by checking if `teammateConfig.name` exists in `acp.customAgents` (the saved assistant registry). This check happens in the bridge handler, NOT the renderer, to avoid exposing raw config data to the renderer process.

3. **isLeader**: The dispatcher itself is not a child. We render the dispatcher as a special "leader" row at the top. For child agents, `isLeader` is always `false`. The dispatcher info comes from `GroupChatInfoVO.dispatcherName` / conversation extra.

4. **Member list refresh**: Piggybacks on the existing `useGroupChatInfo` auto-refresh (10s interval when children are active). No new IPC channel needed.

### Bridge modification detail

In `dispatchBridge.ts`, the `getGroupChatInfo` handler already iterates child conversations. Add to the `.map()`:

```typescript
// Read presetRules from child extra
presetRules: childExtra.presetRules,
// Check if teammate is a saved (permanent) assistant
isPermanent: childExtra.teammateConfig?.name
  ? savedAgentNames.has(childExtra.teammateConfig.name)
  : false,
```

Where `savedAgentNames` is a `Set<string>` built from `ProcessConfig.get('acp.customAgents')` at the start of the handler (one read per request, not per child).

---

## 5. Component Structure

### GroupMemberSider

```
GroupMemberSider
  |-- Header: "Members (N)" + collapse toggle button
  |-- Dispatcher row (leader, always first, special styling)
  |-- Scrollable member list
  |     |-- MemberCard (for each child in members[])
  |-- (empty state if no children yet)
```

- Width: fixed `240px`, matching TaskPanel pattern
- Position: right side of the flex row in GroupChatView, between chat area and TaskPanel
- Collapse: slides to 0 width with CSS transition (same pattern as workspace sider)

### MemberCard

```
MemberCard
  |-- Left: Avatar (emoji span or People icon)
  |-- Center column:
  |     |-- Row 1: Name + leader badge (Crown icon) + type badge (CheckOne or Timer icon)
  |     |-- Row 2: Status tag (reuse getTagColor from TaskPanel)
  |-- Right: activity time
  |-- [Hover] Popover with config summary:
  |     |-- Model: modelName or "Default"
  |     |-- Workspace: last path segment
  |     |-- Rules: first 100 chars of presetRules + "..."
```

**Icons used** (all from `@icon-park/react`):

- Leader badge: `Crown` (theme='filled', size=14)
- Permanent employee: `CheckOne` (theme='filled', size=12)
- Temporary employee: `Timer` (theme='outline', size=12)
- Default avatar: `People` (theme='outline')
- Collapse toggle: `DoubleRight` / `DoubleLeft` (theme='outline')

**NO emoji** used for badges — strictly Icon Park icons per conventions.

### Layout in GroupChatView

```
<div className='flex-1 flex flex-row min-h-0'>
  {/* Left: Timeline + SendBox (existing) */}
  <div className='flex-1 flex flex-col min-h-0 min-w-0'>
    ...existing content...
  </div>

  {/* Middle: Member Sider (NEW, S3) */}
  {memberSiderVisible && (
    <GroupMemberSider
      members={members}
      dispatcher={...}
      ...
    />
  )}

  {/* Right: TaskPanel (existing, conditional) */}
  {selectedChildTaskId && selectedChildInfo && (
    <TaskPanel ... />
  )}
</div>
```

The member sider toggle button is added to `headerExtra` next to the existing settings gear icon.

---

## 6. Self-Debate

### Decision 1: Member sider as a separate panel vs. integrated into TaskOverview

**Chosen**: Separate `GroupMemberSider` panel on the right side.

**Objection 1.1**: Adding another panel increases horizontal space pressure. On narrow screens (<1200px), three panels (chat + member sider + task panel) could be unusable.

- **Resolution**: Member sider and TaskPanel are mutually exclusive in narrow viewports. When TaskPanel opens, member sider auto-collapses. Add a `min-width` media query: below 900px, member sider defaults to collapsed.

**Objection 1.2**: The member list already exists in TaskOverview (the horizontal bar at the top). This duplicates information.

- **Resolution**: TaskOverview shows a compact summary bar optimized for quick task selection. The member sider provides richer per-member info (badges, config hover). Different purposes, acceptable overlap. Future iteration could remove member list from TaskOverview if sider proves sufficient.

**Objection 1.3**: The sider adds a new component to `dispatch/components/` which already has 4 files. Two new files (GroupMemberSider + MemberCard) plus a CSS module = 7 total, still under the 10-child limit, but trending upward.

- **Resolution**: 7/10 is acceptable. If more components are needed in future phases, split into `dispatch/components/members/` subdirectory.

### Decision 2: Fetching isPermanent in the bridge vs. the renderer

**Chosen**: Bridge computes `isPermanent` by checking `acp.customAgents` in the main process.

**Objection 2.1**: This adds a `ProcessConfig.get('acp.customAgents')` call on every `getGroupChatInfo` request (every 10s during active tasks). Performance concern.

- **Resolution**: `ProcessConfig.get` is a file I/O read cached by the config layer. The custom agents list is typically small (<50 entries). One Set lookup per child is O(1). Negligible overhead.

**Objection 2.2**: The renderer already has access to custom agents via `ConfigStorage.get('acp.customAgents')` (used in other components). Computing in the renderer avoids modifying the bridge.

- **Resolution**: Three-process architecture rule: the renderer should not cross-reference raw config data to compute derived state. The bridge is the correct place to compute derived fields. Also, `useIsSavedTeammate` hook already exists but is per-child (N IPC calls). Computing in bulk in the bridge is more efficient.

**Objection 2.3**: If a user saves a teammate while the sider is open, `isPermanent` won't update until the next refresh cycle (10s).

- **Resolution**: After `SaveTeammateModal.onSaved`, we already call `refreshInfo()`. This triggers an immediate re-fetch of `getGroupChatInfo` which will recompute `isPermanent`. No stale data issue.

### Decision 3: Click behavior — open TaskPanel vs. open config edit modal

**Chosen**: Single click selects member and opens TaskPanel (same as TaskOverview click). A dedicated edit icon button on hover opens config edit.

**Objection 3.1**: Users might expect click to show config details, not the task transcript.

- **Resolution**: The primary use case during active group chat is monitoring task progress. Config viewing is secondary. Hover popover already shows a config summary. Explicit edit button is discoverable and prevents accidental modal opens.

**Objection 3.2**: Opening TaskPanel from member sider when TaskPanel is already open for a different child could be jarring.

- **Resolution**: Reuse existing `handleViewDetail` which toggles: clicking the same member closes TaskPanel, clicking a different one switches. Consistent with current TaskOverview behavior.

**Objection 3.3**: The "edit config" modal for a running child agent may not make sense — changing presetRules mid-execution has no effect.

- **Resolution**: The modal shows config as read-only for running/completed children. Edit is only enabled for idle children or as a "save as new assistant" action. This matches the existing `SaveTeammateModal` pattern.

### Decision 4: Dispatcher rendered as pseudo-member at top of list

**Chosen**: Render the dispatcher (leader) as a special row at the top of the member list, visually distinct.

**Objection 4.1**: The dispatcher is not a child session — clicking it cannot open a TaskPanel.

- **Resolution**: Dispatcher row click opens the GroupChatSettingsDrawer instead. Clearly different action, communicated via tooltip.

**Objection 4.2**: If no leader agent is configured, the "leader" row shows a generic dispatcher name, which could be confusing.

- **Resolution**: Only show the Crown badge when `leaderAgentId` is set. Otherwise show the dispatcher as "Orchestrator" with a neutral icon, making it clear this is the coordination agent rather than a team leader.

**Objection 4.3**: The dispatcher row at the top creates visual inconsistency — it has no status dot, no activity time, no hover config.

- **Resolution**: Give it a distinct visual treatment: slightly larger avatar area, "Leader" sub-label, no status dot. The visual difference is intentional to communicate it is not a regular member.

---

## 7. i18n Keys

Add to `dispatch.json` (both en-US and zh-CN):

```json
{
  "dispatch.memberSider.title": "Members",
  "dispatch.memberSider.collapse": "Collapse member panel",
  "dispatch.memberSider.expand": "Expand member panel",
  "dispatch.memberSider.empty": "No members yet",
  "dispatch.memberSider.leader": "Leader",
  "dispatch.memberSider.orchestrator": "Orchestrator",
  "dispatch.memberSider.permanent": "Saved",
  "dispatch.memberSider.temporary": "Temporary",
  "dispatch.memberSider.configSummary": "Config Summary",
  "dispatch.memberSider.model": "Model",
  "dispatch.memberSider.workspace": "Workspace",
  "dispatch.memberSider.rules": "Rules",
  "dispatch.memberSider.rulesNone": "No preset rules",
  "dispatch.memberSider.defaultModel": "Default",
  "dispatch.memberSider.editConfig": "View config",
  "dispatch.memberSider.memberCount": "{{count}} members"
}
```

zh-CN equivalents:

```json
{
  "dispatch.memberSider.title": "成员",
  "dispatch.memberSider.collapse": "收起成员面板",
  "dispatch.memberSider.expand": "展开成员面板",
  "dispatch.memberSider.empty": "暂无成员",
  "dispatch.memberSider.leader": "组长",
  "dispatch.memberSider.orchestrator": "调度器",
  "dispatch.memberSider.permanent": "已保存",
  "dispatch.memberSider.temporary": "临时",
  "dispatch.memberSider.configSummary": "配置摘要",
  "dispatch.memberSider.model": "模型",
  "dispatch.memberSider.workspace": "工作区",
  "dispatch.memberSider.rules": "规则",
  "dispatch.memberSider.rulesNone": "无预设规则",
  "dispatch.memberSider.defaultModel": "默认",
  "dispatch.memberSider.editConfig": "查看配置",
  "dispatch.memberSider.memberCount": "{{count}} 位成员"
}
```

---

## Acceptance Criteria

### AC-1: Member sider renders with correct member count

- **Given** a group chat with N child agents
- **When** the user opens the group chat view
- **Then** the member sider header shows "Members (N+1)" (N children + 1 dispatcher)
- **Pass/fail**: Count in header matches `info.children.length + 1`

### AC-2: Leader badge displays correctly

- **Given** a group chat with `leaderAgentId` configured
- **When** the member sider renders
- **Then** the dispatcher row shows a `Crown` icon (from @icon-park/react) next to the name
- **Pass/fail**: Crown icon is visible; no emoji used

### AC-3: Employee type badge — permanent vs temporary

- **Given** child A uses a saved assistant config (exists in `acp.customAgents`) and child B uses a temporary config
- **When** both are rendered in the member sider
- **Then** child A shows `CheckOne` icon with "Saved" tooltip; child B shows `Timer` icon with "Temporary" tooltip
- **Pass/fail**: Correct icon renders for each type; icons are from @icon-park/react, NOT emoji

### AC-4: Hover shows config summary popover

- **Given** a member card for a child with `modelName="gemini-2.5-pro"`, `workspace="/projects/app"`, `presetRules="You are a senior engineer who..."`
- **When** the user hovers over the card for >200ms
- **Then** a Popover (Arco `Popover`) appears showing: Model: gemini-2.5-pro, Workspace: app, Rules: "You are a senior engineer who..." (truncated to 100 chars)
- **Pass/fail**: Popover renders with all three fields; presetRules truncated at 100 chars with ellipsis

### AC-5: Click selects member and opens TaskPanel

- **Given** the member sider is showing and no TaskPanel is open
- **When** the user clicks a child member card
- **Then** `handleViewDetail(sessionId)` is called, opening TaskPanel for that child
- **Pass/fail**: TaskPanel opens with correct child data

### AC-6: Mutual exclusion on narrow viewports

- **Given** viewport width < 900px
- **When** TaskPanel opens
- **Then** member sider auto-collapses
- **Pass/fail**: Member sider width becomes 0; TaskPanel is fully visible

### AC-7: Toggle button in header

- **Given** the group chat header
- **When** the user clicks the member toggle button (People icon)
- **Then** the member sider toggles between visible (240px) and collapsed (0px)
- **Pass/fail**: Panel width transitions smoothly; button icon changes direction

### AC-8: Bridge returns enriched member data

- **Given** a group chat with 2 children, one using a saved assistant and one temporary
- **When** `getGroupChatInfo` IPC is invoked
- **Then** response includes `presetRules` (string or undefined) and `isPermanent` (boolean) for each child
- **Pass/fail**: Fields present in IPC response; `isPermanent` correctly reflects `acp.customAgents` lookup

### AC-9: No emoji in badges

- **When** inspecting the rendered member sider DOM
- **Then** no emoji characters (crown, checkmark, hourglass, etc.) are used for badges
- **Pass/fail**: All badge icons are `@icon-park/react` SVG components

### AC-10: i18n compliance

- **Given** the app is set to zh-CN locale
- **When** the member sider renders
- **Then** all labels ("Members", "Leader", "Saved", "Temporary", etc.) show Chinese translations
- **Pass/fail**: No hardcoded English strings in the rendered output

### AC-11: Dispatcher row click opens settings

- **Given** the dispatcher pseudo-member at the top of the list
- **When** the user clicks it
- **Then** `GroupChatSettingsDrawer` opens (reuse existing `setSettingsVisible(true)`)
- **Pass/fail**: Settings drawer becomes visible

### AC-12: TypeScript strict compliance

- **When** running `bunx tsc --noEmit`
- **Then** no type errors related to S3 changes
- **Pass/fail**: Zero new type errors

[DONE]
