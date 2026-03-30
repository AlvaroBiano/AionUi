# S5: New Conversation Flow Redesign — Technical Design

## 1. File Change List

| #   | File                                                                            | Action     | Description                                                                                |
| --- | ------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| 1   | `src/renderer/pages/conversation/GroupedHistory/AgentSelectionModal.tsx`        | **New**    | Modal component for selecting an agent when starting a new DM                              |
| 2   | `src/renderer/pages/conversation/GroupedHistory/AgentSelectionModal.module.css` | **New**    | CSS Module for the modal's agent grid styling                                              |
| 3   | `src/renderer/pages/conversation/GroupedHistory/index.tsx`                      | **Modify** | Add "+" button to DM section header; wire AgentSelectionModal open/close                   |
| 4   | `src/renderer/pages/conversation/GroupedHistory/types.ts`                       | **Modify** | Add `AgentSelectionModalProps` type                                                        |
| 5   | `src/renderer/components/layout/Sider.tsx`                                      | **Modify** | "+ New Conversation" navigates to `/guid` with `{ prefillAgentId: undefined }` (unchanged) |
| 6   | `src/renderer/pages/guid/GuidPage.tsx`                                          | **Modify** | Consume `location.state.prefillAgentId` — pre-select agent in pill bar on mount            |
| 7   | `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`                        | **Modify** | Accept optional `prefillAgentId` to override the last-selected agent on load               |

### Directory child count check

- `src/renderer/pages/conversation/GroupedHistory/` currently has 10 children (AgentDMGroup.tsx, ChannelSection.tsx, ConversationRow.tsx, ConversationSearchPopover.tsx, DragOverlayContent.tsx, SortableConversationRow.tsx, WorkspaceSubGroup.tsx, hooks/, index.tsx, types.ts). Adding 2 files (AgentSelectionModal.tsx + CSS Module) brings it to 12 — **exceeds the 10-child limit**. Mitigation: move `AgentSelectionModal.tsx` + its CSS Module into a new `components/` subdirectory under `GroupedHistory/`, bringing the parent back to 11. Alternatively, consider the modal as logically belonging to the DM section and place it under a `dm/` subdirectory. **Preferred**: create `GroupedHistory/components/` with `AgentSelectionModal.tsx` and `AgentSelectionModal.module.css` (parent stays at 11). See objection 3 in self-debate.

**Revised table after directory limit fix:**

| #   | File                                                                                       | Action     | Description                                                              |
| --- | ------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| 1   | `src/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.tsx`        | **New**    | Modal component for selecting an agent when starting a new DM            |
| 2   | `src/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.module.css` | **New**    | CSS Module for the modal's agent grid styling                            |
| 3   | `src/renderer/pages/conversation/GroupedHistory/index.tsx`                                 | **Modify** | Add "+" button to DM section header; wire AgentSelectionModal open/close |
| 4   | `src/renderer/pages/conversation/GroupedHistory/types.ts`                                  | **Modify** | Add `AgentSelectionModalProps` type                                      |
| 5   | `src/renderer/pages/guid/GuidPage.tsx`                                                     | **Modify** | Pass `prefillAgentId` from `location.state` into `useGuidAgentSelection` |
| 6   | `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`                                   | **Modify** | Accept optional `prefillAgentId`; override agent selection on load       |

- `GroupedHistory/` goes from 10 to 11 children (adding `components/`). This is 1 over the limit. To stay at 10, move `DragOverlayContent.tsx` into `components/` as well (it is a private sub-component). Final: parent has 10 children, `components/` has 3.

---

## 2. Type Definitions

### Additions to `GroupedHistory/types.ts`

```typescript
import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';

/** Props for the AgentSelectionModal component */
export type AgentSelectionModalProps = {
  /** Whether the modal is visible */
  visible: boolean;
  /** All available agents from the registry */
  agents: AgentIdentity[];
  /** Callback when an agent is selected — receives the agent ID */
  onSelect: (agentId: string) => void;
  /** Callback to close the modal */
  onClose: () => void;
};
```

### No new standalone type files needed

The `AgentIdentity` type from `@/renderer/utils/model/agentIdentity` already contains all necessary fields (`id`, `name`, `avatar`, `employeeType`, `source`). The modal uses this directly.

---

## 3. Component Design

### 3.1 UI Pattern Choice: Modal

The agent selection panel uses an Arco `<Modal>` component (not Drawer, not Popover).

```
AgentSelectionModal
├── Modal header: "Select an agent" (i18n key)
├── Search input (Input from @arco-design)
├── Agent list (two sections)
│   ├── "Permanent" section header
│   │   └── AgentCard[] (grid of clickable agent cards)
│   └── "Temporary" section header
│       └── AgentCard[] (grid of clickable agent cards)
└── Each AgentCard:
    ├── Avatar (emoji | logo img | letter fallback)
    ├── Agent name
    └── Source badge (small text: "Preset" | "Custom" | "CLI")
```

### 3.2 Component Hierarchy

```
WorkspaceGroupedHistory (index.tsx)
  └── DM section header
      ├── "Direct Messages" label
      └── "+" button → onClick: setAgentSelectionVisible(true)
  └── AgentSelectionModal
      ├── visible={agentSelectionVisible}
      ├── agents={registryAgents}
      ├── onSelect={handleAgentSelected}
      └── onClose={() => setAgentSelectionVisible(false)}
```

### 3.3 AgentSelectionModal internals

```typescript
const AgentSelectionModal: React.FC<AgentSelectionModalProps> = ({
  visible, agents, onSelect, onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useTranslation();

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const list = q ? agents.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    ) : agents;

    // Partition: permanent first, then temporary
    const permanent = list.filter(a => a.employeeType === 'permanent');
    const temporary = list.filter(a => a.employeeType === 'temporary');
    return { permanent, temporary };
  }, [agents, searchQuery]);

  // Reset search when modal closes
  useEffect(() => {
    if (!visible) setSearchQuery('');
  }, [visible]);

  return (
    <Modal
      visible={visible}
      title={t('dispatch.sidebar.selectAgent')}
      onCancel={onClose}
      footer={null}
      style={{ borderRadius: '12px' }}
      alignCenter
    >
      <Input
        allowClear
        placeholder={t('dispatch.sidebar.searchAgents')}
        value={searchQuery}
        onChange={setSearchQuery}
      />
      {/* Permanent agents section */}
      {/* Temporary agents section */}
      {/* Each card calls onSelect(agent.id) on click */}
    </Modal>
  );
};
```

### 3.4 Flow after agent selection

When an agent is selected in the modal:

1. `onSelect(agentId)` fires.
2. The handler in `WorkspaceGroupedHistory` calls `navigate('/guid', { state: { prefillAgentId: agentId } })`.
3. GuidPage receives `prefillAgentId` from `location.state`.
4. `useGuidAgentSelection` maps the registry-format agent ID (e.g., `preset:word-creator`, `custom:abc123`, `claude`) to the pill-bar key format used internally by Guid. For `preset:*` and `custom:*` IDs, the key is used as-is. For CLI agent IDs like `claude`, `codex`, the key is the backend name directly.
5. The agent is pre-selected in the pill bar. The user can start typing immediately.

---

## 4. Data Flow

```
User clicks "+" in DM section header
       │
       ▼
setAgentSelectionVisible(true)
       │
       ▼
AgentSelectionModal opens
       │
       ├──► useAgentRegistry() → Map<agentId, AgentIdentity>
       │    Convert to sorted array (permanent first, then temporary)
       │
       ├──► User types in search → filter agents client-side
       │
       └──► User clicks an agent card
              │
              ▼
       onSelect(agentId) fires
              │
              ▼
       navigate('/guid', { state: { prefillAgentId: agentId } })
              │
              ▼
       GuidPage mounts
              │
              ├──► useGuidInput({ locationState }) → reads workspace (unchanged)
              │
              └──► useGuidAgentSelection({ ..., prefillAgentId })
                     │
                     ├── If prefillAgentId is set:
                     │   Override initial selectedAgentKey with mapped key
                     │   Skip loading from ConfigStorage 'guid.lastSelectedAgent'
                     │
                     └── If prefillAgentId is absent:
                         Load from ConfigStorage as before (no behavior change)
```

### Key data flow decisions

1. **No new IPC calls** — `useAgentRegistry()` already provides all agent data. The modal is a pure client-side filter over the existing registry.

2. **Agent ID format bridging** — The registry uses IDs like `preset:word-creator`, `custom:abc`, `claude`, `gemini`. The Guid page's `useGuidAgentSelection` uses keys like `gemini`, `custom:abc`, `claude`. For preset agents, the registry ID `preset:word-creator` maps to the `getAgentKey({ backend: 'custom', customAgentId: 'builtin-word-creator' })` pattern OR matches directly if `findAgentByKey` supports it. Since `findAgentByKey` already handles `custom:` prefix keys, and presets show up in `availableAgents` with `isPreset: true`, the mapping must convert `preset:X` to the key format used in `availableAgents`. This requires a small helper or lookup in the effect that processes `prefillAgentId`.

3. **GuidPage is preserved** — The current GuidPage stays as the conversation creation page. It gains the ability to accept a pre-selected agent via location state. This is additive, not destructive.

4. **AgentProfilePage "Start conversation" now works end-to-end** — S4 already wires `navigate('/guid', { state: { prefillAgentId } })`. S5 adds the consumer side in GuidPage, completing the round-trip.

5. **Sidebar top-level "+" button unchanged** — The existing "+" at the top of Sider.tsx continues to navigate to `/guid` without any `prefillAgentId`. This gives users the classic flow (pick agent on GuidPage). The new DM "+" provides the shortcut flow.

---

## 5. Self-Debate

### Decision 1: Modal vs. Drawer vs. Popover for agent selection

**Choice**: Modal (Arco `<Modal>`)

**Objections**:

1. **Objection: Popover would be lighter weight** — A Popover anchored to the "+" button avoids the heavy modal overlay and feels more inline, similar to how Slack shows a user picker.
   - **Counter**: The agent list can be long (10+ agents with presets + custom + CLI). A Popover has limited vertical space and no built-in scrolling pattern. On mobile, Popovers are especially problematic — they overflow viewport. Modal provides built-in scrolling, backdrop dismiss, and consistent cross-platform behavior. The CreateGroupChatModal in ChannelSection already establishes the Modal pattern for sidebar creation flows.

2. **Objection: Drawer would keep sidebar context** — A Drawer sliding from the left would overlay the sidebar partially, letting the user see the DM list below.
   - **Counter**: The sidebar is narrow (typically 260-300px). A Drawer within it would be extremely cramped. A Drawer from the right loses spatial association with the "+" button. The Modal centered on screen has ample space for search + grid layout. Slack itself uses a centered dialog for "new message" recipient selection.

3. **Objection: Modal interrupts flow** — The user must dismiss the modal before doing anything else. What if they change their mind?
   - **Counter**: The modal has `footer={null}` (no OK/Cancel buttons) — selecting an agent immediately closes it and navigates. Clicking outside or pressing Escape also dismisses. The interaction is: click "+" → click agent → done. Two clicks, no confirmation step. This is faster than the current flow (click "+" → navigate to GuidPage → scroll pill bar → click agent).

### Decision 2: Navigate to GuidPage vs. directly create a conversation

**Choice**: Navigate to GuidPage with agent pre-selected.

**Objections**:

1. **Objection: Extra step** — Why not skip GuidPage entirely and create a blank conversation with the agent directly?
   - **Counter**: GuidPage provides essential pre-conversation functionality: model selection, mode selection (yolo/safe), workspace selection, file attachment, and the message input. Skipping it means either (a) creating empty conversations that clutter the sidebar, or (b) reimplementing all these features in a new flow. GuidPage is the right place for conversation setup.

2. **Objection: GuidPage still shows the pill bar** — If the agent is already selected, the pill bar is redundant visual noise.
   - **Counter**: The pill bar serves a secondary purpose: letting the user change their mind without going back. If they clicked "Claude" but meant "Codex", they can switch directly. Hiding the pill bar when `prefillAgentId` is present would be a jarring inconsistency. The pill bar is small and non-intrusive.

3. **Objection: Loss of the "full GuidPage" landing experience** — New users may prefer seeing all agents + assistants on the guide page rather than being dropped into a pre-selected state.
   - **Counter**: The full GuidPage experience is preserved when clicking the top-level "+" button in Sider.tsx (no `prefillAgentId`). The DM "+" is an intentional shortcut for users who already know which agent they want. Both paths coexist.

### Decision 3: "+" button placement — DM section header vs. sidebar footer vs. top-level "+"

**Choice**: DM section header (next to "Direct Messages" label), matching the existing ChannelSection "+" pattern.

**Objections**:

1. **Objection: Inconsistency with top-level "+"** — Users now have two "+" buttons that create conversations via different flows.
   - **Counter**: This matches Slack exactly: there is a global "New message" button AND a "+" next to each section (Channels, DMs). The top-level "+" is the universal entry (no agent pre-selection). The DM section "+" is the agent-specific shortcut. Their visual placement makes the distinction clear.

2. **Objection: DM section may not be visible** — If the user has no DM conversations yet, `hasDMGroups` is false and the DM section (with its "+") is not rendered.
   - **Counter**: This is a genuine gap. Fix: always render the DM section header (with the "+" button) regardless of `hasDMGroups`. When there are no DMs, show the header + "+" + an empty state message ("No conversations yet. Click + to start one."). This ensures the "+" is always discoverable.

3. **Objection: Mobile sidebar — "+" in section header is hard to tap** — The "+" is a small 14px icon (matching ChannelSection). On mobile this is a poor tap target.
   - **Counter**: ChannelSection already uses this same size for its "+" and this hasn't been raised as an issue. For consistency, keep the same size. If mobile tap targets become a concern, it should be addressed globally for both Channel and DM section "+" buttons in a future pass.

### Decision 4: Keep GuidPage or deprecate it

**Choice**: Keep GuidPage. It is NOT deprecated.

**Objections**:

1. **Objection: GuidPage is now redundant** — With the agent selection modal, users can always pick an agent before reaching GuidPage. The agent pill bar and assistant selection area on GuidPage are no longer needed.
   - **Counter**: GuidPage serves two distinct functions: (a) agent selection (pill bar + assistant cards), and (b) conversation setup (input, model, mode, workspace, files). Only (a) is partially overlapped by the new modal. Function (b) is essential and has no replacement. GuidPage remains the conversation composition page.

2. **Objection: Two agent selection UIs is confusing** — Users can select an agent via the DM "+" modal OR via GuidPage's pill bar and assistant area. Which is "correct"?
   - **Counter**: They serve different entry points. The modal is a fast-path from the sidebar. GuidPage's selection is the full-featured path (shows agent descriptions, modes, models). Both ultimately set the same `selectedAgentKey`. This is the same pattern as Slack: you can start a DM from the sidebar or from the compose window.

3. **Objection: The `prefillAgentId` mechanism is fragile** — Location state is lost on page refresh and doesn't persist across navigation.
   - **Counter**: This is intentional. `prefillAgentId` is a one-shot hint. After GuidPage reads it, the selection is held in React state and also persisted to `guid.lastSelectedAgent` via `setSelectedAgentKey`. Refresh falls back to the persisted preference. The hint is consumed once and discarded.

---

## 6. Implementation Details

### 6.1 DM section always-render change (WorkspaceGroupedHistory)

Currently the DM section renders only when `hasDMGroups` is true. Change to always render the section header:

```typescript
{/* Direct Messages section — always show header with "+" for new DM */}
<div className='mb-8px min-w-0'>
  {!collapsed && (
    <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold flex items-center justify-between'>
      <span>{t('dispatch.sidebar.directMessagesSection')}</span>
      <Tooltip content={t('dispatch.sidebar.newDirectMessage')} position='top' mini>
        <span
          className='flex-center cursor-pointer hover:bg-fill-2 rd-4px p-2px transition-colors'
          onClick={() => setAgentSelectionVisible(true)}
        >
          <Plus theme='outline' size='14' />
        </span>
      </Tooltip>
    </div>
  )}
  {hasDMGroups ? (
    <div className='min-w-0'>
      {agentDMGroups.map((group) => (
        <AgentDMGroup key={group.agentId} group={group} ... />
      ))}
    </div>
  ) : !collapsed ? (
    <div className='px-12px py-4px text-12px text-t-secondary'>
      {t('dispatch.sidebar.noDirectMessages')}
    </div>
  ) : null}
</div>
```

### 6.2 useGuidAgentSelection prefillAgentId support

Add `prefillAgentId` to the options type and consume it in the load-last-agent effect:

```typescript
type UseGuidAgentSelectionOptions = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  localeKey: string;
  prefillAgentId?: string; // NEW: from location.state
};

// In the "Load last selected agent" useEffect:
useEffect(() => {
  if (!availableAgents || availableAgents.length === 0) return;

  // If prefillAgentId is provided, use it instead of saved preference
  if (prefillAgentId) {
    const mapped = mapRegistryIdToGuidKey(prefillAgentId, availableAgents, customAgents);
    if (mapped) {
      _setSelectedAgentKey(mapped);
      return; // Skip loading from storage
    }
  }

  // Existing load-from-storage logic...
}, [availableAgents, prefillAgentId]);
```

The `mapRegistryIdToGuidKey` helper converts registry IDs to Guid key format:

```typescript
function mapRegistryIdToGuidKey(
  registryId: string,
  availableAgents: AvailableAgent[],
  customAgents: AcpBackendConfig[]
): string | null {
  // Direct backend match (claude, gemini, codex, etc.)
  if (availableAgents.some((a) => a.backend === registryId)) {
    return registryId;
  }

  // Custom agent: "custom:abc" → "custom:abc" (same format)
  if (registryId.startsWith('custom:')) {
    const customId = registryId.slice(7);
    if (customAgents.some((a) => a.id === customId)) {
      return registryId;
    }
  }

  // Preset agent: "preset:word-creator" → find in availableAgents by isPreset + customAgentId match
  if (registryId.startsWith('preset:')) {
    const presetId = registryId.slice(7);
    const match = availableAgents.find(
      (a) =>
        a.isPreset && a.customAgentId && (a.customAgentId === presetId || a.customAgentId === `builtin-${presetId}`)
    );
    if (match) {
      return getAgentKeyUtil(match);
    }
  }

  return null;
}
```

### 6.3 GuidPage change

Minimal — just pass `prefillAgentId` through:

```typescript
// In GuidPage.tsx:
const locationState = location.state as { workspace?: string; prefillAgentId?: string } | null;

const agentSelection = useGuidAgentSelection({
  modelList: modelSelection.modelList,
  isGoogleAuth: modelSelection.isGoogleAuth,
  localeKey,
  prefillAgentId: locationState?.prefillAgentId,
});
```

### 6.4 i18n keys to add

| Key                                 | en-US                | zh-CN        |
| ----------------------------------- | -------------------- | ------------ |
| `dispatch.sidebar.selectAgent`      | Select an agent      | 选择一个助手 |
| `dispatch.sidebar.searchAgents`     | Search agents...     | 搜索助手...  |
| `dispatch.sidebar.newDirectMessage` | New direct message   | 新建直接消息 |
| `dispatch.sidebar.noDirectMessages` | No conversations yet | 暂无对话     |
| `dispatch.sidebar.permanentAgents`  | Saved Assistants     | 已保存的助手 |
| `dispatch.sidebar.temporaryAgents`  | CLI Agents           | CLI 代理     |

---

## Acceptance Criteria

### Agent Selection Modal

- [ ] AC-1: A "+" button appears in the DM section header, matching the ChannelSection "+" style (14px Plus icon with hover:bg-fill-2).
- [ ] AC-2: Clicking the "+" button opens an `AgentSelectionModal` (Arco Modal, centered, no footer buttons).
- [ ] AC-3: The modal displays all agents from `useAgentRegistry()`, partitioned into "Saved Assistants" (permanent) and "CLI Agents" (temporary) sections.
- [ ] AC-4: Each agent card shows: avatar (emoji/logo/letter fallback), name, and source label.
- [ ] AC-5: A search input at the top of the modal filters agents by name (case-insensitive, client-side).
- [ ] AC-6: Clicking an agent card closes the modal and navigates to `/guid` with `state.prefillAgentId` set to the agent's registry ID.
- [ ] AC-7: Clicking outside the modal or pressing Escape dismisses it without navigation.
- [ ] AC-8: The search input resets when the modal closes.

### DM Section Always Visible

- [ ] AC-9: The "Direct Messages" section header and "+" button render even when there are no DM conversations (`agentDMGroups.length === 0`).
- [ ] AC-10: When no DMs exist and sidebar is expanded, a "No conversations yet" message appears below the header.

### GuidPage Agent Pre-Selection

- [ ] AC-11: Navigating to `/guid` with `state.prefillAgentId = 'claude'` pre-selects the Claude agent in the pill bar.
- [ ] AC-12: Navigating to `/guid` with `state.prefillAgentId = 'preset:word-creator'` pre-selects the Word Creator preset in the pill bar.
- [ ] AC-13: Navigating to `/guid` with `state.prefillAgentId = 'custom:abc123'` pre-selects the custom agent in the pill bar.
- [ ] AC-14: Navigating to `/guid` without `prefillAgentId` (e.g., from the top-level "+" button) loads the last-selected agent from storage as before (no regression).
- [ ] AC-15: If `prefillAgentId` refers to an agent not found in `availableAgents`, the system falls back to loading from storage (graceful degradation).

### AgentProfilePage Integration

- [ ] AC-16: The "Start conversation" button on AgentProfilePage (S4) now works end-to-end: clicking it navigates to GuidPage with the correct agent pre-selected.

### General

- [ ] AC-17: All user-facing strings use i18n keys (no hardcoded text).
- [ ] AC-18: All interactive elements use `@arco-design/web-react` components (Modal, Input, Tooltip).
- [ ] AC-19: All icons use `@icon-park/react`.
- [ ] AC-20: TypeScript strict mode — no `any`, all types defined with `type` keyword.
- [ ] AC-21: Existing sidebar "+" button behavior is unchanged (navigates to `/guid` with no prefill).
- [ ] AC-22: The new `components/` subdirectory under `GroupedHistory/` keeps the parent directory at or under 10 children.

[DONE]
