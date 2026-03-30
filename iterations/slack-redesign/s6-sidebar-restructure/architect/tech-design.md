# S6: Sidebar Restructure — Technical Design

**Date**: 2026-03-30
**Status**: Draft
**Author**: Architect Agent

---

## Overview

Merge the current three-section sidebar (Channels / General Agents / Assistants) into a two-section layout (Channels / Direct Messages). The "Favorites" section is deferred to a future iteration. Remove the redundant "+ New direct message" button from the General Agents section header.

This change eliminates the confusing "General Agents" vs "Assistants" technical distinction that users cannot understand, replacing it with a single unified "Direct Messages" section sorted by most recent activity.

---

## Changed Files

### 1. `src/renderer/pages/conversation/GroupedHistory/index.tsx` (PRIMARY)

**What changes:**
- Remove the `generalAgentGroups` / `assistantGroups` split (`useMemo` calls on lines 220-221)
- Replace the two separate DM section blocks (lines 463-522) with a single "Direct Messages" section that renders all `agentDMGroups` together
- Remove the `AgentSelectionModal` import and all references (`agentSelectionVisible` state, `handleAgentSelected` callback, `registryAgents` memo, the `<AgentSelectionModal>` JSX)
- Remove the `useAgentRegistry` import (no longer needed locally — it is consumed upstream in `ConversationHistoryContext`)
- Remove the collapsed-mode separator between General Agents and Assistants (lines 496-498)
- Section header text changes from `t('dispatch.sidebar.generalAgentsSection')` to `t('dispatch.sidebar.directMessagesSection')`
- Remove the `<Tooltip>` + `<Plus>` button from the DM section header (the "+ New direct message" entry point)
- Empty state text remains `t('dispatch.sidebar.noDirectMessages')`

**Resulting JSX structure (DM section):**
```tsx
{/* Direct Messages section (unified — replaces General Agents + Assistants) */}
<div className='mb-8px min-w-0'>
  {!collapsed && (
    <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold'>
      <span>{t('dispatch.sidebar.directMessagesSection')}</span>
    </div>
  )}
  {agentDMGroups.length > 0 ? (
    <div className='min-w-0'>
      {agentDMGroups.map((group) => (
        <AgentDMGroup
          key={group.agentId}
          group={group}
          collapsed={collapsed}
          selectedConversationId={id}
          renderConversation={renderDMConversation}
        />
      ))}
    </div>
  ) : !collapsed ? (
    <div className='px-12px py-4px text-12px text-t-secondary'>
      {t('dispatch.sidebar.noDirectMessages')}
    </div>
  ) : null}
</div>
```

### 2. `src/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers.ts`

**What changes:**
- `groupConversationsByAgent()` already sorts by `latestActivityTime` desc (line 243) — no change needed for sorting
- `buildGroupedHistory()` already builds unified `agentDMGroups` — the `isPermanent` split happens in the UI layer, not here
- **No changes required** in this file. The grouping logic is already correct for the new layout.

### 3. `src/renderer/pages/conversation/GroupedHistory/AgentDMGroup.tsx`

**What changes:**
- No structural changes. This component already handles both permanent and temporary agents identically.
- The `isPermanent` field on `AgentDMGroupData` is still used internally for `displayMode` logic (subtitle vs grouped) — keep as-is.

### 4. `src/renderer/pages/conversation/GroupedHistory/ChannelSection.tsx`

**What changes:**
- No changes. Channel section remains as-is.

### 5. `src/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.tsx`

**What changes:**
- **Delete this file entirely.** It was only used by the "+ New direct message" button in the General Agents section header. With that button removed, this component has zero consumers.

### 6. `src/renderer/pages/conversation/GroupedHistory/types.ts`

**What changes:**
- Remove the `AgentSelectionModalProps` type definition (lines 133-143). No other consumer.

### 7. `src/renderer/components/layout/Sider.tsx`

**What changes:**
- No changes. The top-level "+ New Conversation" button and search remain. The batch mode toggle remains.

### 8. i18n locale files (6 files, all under `src/renderer/services/i18n/locales/`)

See [i18n Changes](#i18n-key-changes) section below.

---

## Data Flow Changes

### Current Flow
```
ConversationHistoryContext
  -> buildGroupedHistory() -> agentDMGroups[]
    -> index.tsx splits by isPermanent:
       generalAgentGroups = agentDMGroups.filter(!isPermanent)
       assistantGroups = agentDMGroups.filter(isPermanent)
    -> Renders as 2 separate sections
```

### New Flow
```
ConversationHistoryContext
  -> buildGroupedHistory() -> agentDMGroups[]
    -> index.tsx uses agentDMGroups directly (no split)
    -> Renders as 1 unified "Direct Messages" section
```

### Agent Filtering: "Only show agents with conversations"

This is **already the current behavior**. `groupConversationsByAgent()` in `groupingHelpers.ts` iterates over existing conversations and groups them by agent — agents without conversations never appear. No additional filtering logic is needed.

### Sorting: "By most recent activity time"

This is **already the current behavior**. `groupConversationsByAgent()` already sorts the result array by `latestActivityTime` desc (line 243 of `groupingHelpers.ts`). No change needed.

### "Show more" folding for inactive agents

**Deferred.** The design decision mentions "inactive agents auto-fold into 'Show more'" but does not define the threshold (how many visible, what counts as "inactive"). This is a separate UX enhancement that can be added incrementally without structural changes — `agentDMGroups` is already sorted by activity, so a simple `slice(0, N)` + "Show more" toggle is trivial to add later.

---

## i18n Key Changes

### Keys to REMOVE

| Key | Reason |
|-----|--------|
| `dispatch.sidebar.generalAgentsSection` | Section no longer exists |
| `dispatch.sidebar.assistantsSection` | Section no longer exists |
| `dispatch.sidebar.newDirectMessage` | "+" button removed from DM section header |
| `dispatch.sidebar.selectAgent` | AgentSelectionModal deleted |
| `dispatch.sidebar.searchAgents` | AgentSelectionModal deleted |
| `dispatch.sidebar.permanentAgents` | AgentSelectionModal deleted |
| `dispatch.sidebar.temporaryAgents` | AgentSelectionModal deleted |
| `dispatch.sidebar.noAgentsFound` | AgentSelectionModal deleted |
| `dispatch.sidebar.agentSourcePreset` | AgentSelectionModal deleted |
| `dispatch.sidebar.agentSourceCustom` | AgentSelectionModal deleted |
| `dispatch.sidebar.agentSourceCli` | AgentSelectionModal deleted |

### Keys to KEEP (already exist)

| Key | Usage |
|-----|-------|
| `dispatch.sidebar.directMessagesSection` | New unified DM section header ("Direct Messages") |
| `dispatch.sidebar.noDirectMessages` | Empty state for DM section |
| `dispatch.sidebar.channelsSection` | Channel section header (unchanged) |
| `dispatch.sidebar.newGroupChat` | Channel "+" button tooltip (unchanged) |

### Affected locale files

- `src/renderer/services/i18n/locales/en-US/dispatch.json`
- `src/renderer/services/i18n/locales/zh-CN/dispatch.json`
- `src/renderer/services/i18n/locales/zh-TW/dispatch.json`
- `src/renderer/services/i18n/locales/ja-JP/dispatch.json`
- `src/renderer/services/i18n/locales/ko-KR/dispatch.json`
- `src/renderer/services/i18n/locales/tr-TR/dispatch.json`
- `src/renderer/services/i18n/i18n-keys.d.ts` (auto-generated, remove corresponding union members)

---

## Backward Compatibility

1. **No data migration required.** Conversations, pinned state, agent identities — all stored data is untouched. The change is purely a UI presentation layer refactoring.

2. **`isPermanent` field retained.** `AgentDMGroupData.isPermanent` continues to exist and is used by `displayMode` logic inside `groupConversationsByAgent()`. Only the UI split based on `isPermanent` is removed.

3. **Timeline fallback preserved.** When `agentRegistry` is unavailable (edge case), the existing timeline-based rendering fallback still works.

4. **AgentSelectionModal removal.** Users currently discovering new agents via the "+" button in the General Agents section will instead use the top-level "+ New Conversation" button which navigates to GuidPage. GuidPage already contains agent selection functionality. No capability is lost.

---

## Self-Debate

### Objection 1: Removing AgentSelectionModal eliminates a useful shortcut

**Argument:** The AgentSelectionModal lets users quickly start a DM with a specific agent without leaving the sidebar. Removing it forces users to navigate to GuidPage, which is a heavier interaction.

**Response:** The design decision explicitly states "合并重复入口" — consolidate duplicate entry points. The AgentSelectionModal and GuidPage's agent selection do the same thing. Having both confuses users about which to use. The "+ New Conversation" button is already the primary entry point (top of sidebar, always visible). The modal was a secondary shortcut used by power users at best. If usage data later shows demand, we can re-add a streamlined version. For now, fewer entry points = less confusion, which is the core goal of S6.

### Objection 2: Merging all agents into one section makes the list too long

**Argument:** If a user has 5 CLI agents + 8 assistants, that's 13 items in one section. The old two-section layout at least provided visual grouping. A flat list of 13+ agents is harder to scan.

**Response:** This concern is valid but mitigated by three factors: (a) only agents with conversations appear, so the effective count is much lower than the total configured count; (b) the list is sorted by activity, so the 2-3 most-used agents are always at the top; (c) the "Show more" folding (planned for a follow-up) will cap the visible count. In Slack, users routinely have 20+ DM entries in a single section without confusion — the activity-based sort makes the top items predictable. The two-section split actually made scanning *harder* because users had to check two places.

### Objection 3: Deferring "Favorites" and "Show more" makes S6 feel incomplete

**Argument:** The design decision document shows a full vision with Favorites pinned at top and "Show more (3)" folding. Delivering only the section merge without these features might feel like a regression — users lose the visual separation without gaining the compensating UX improvements.

**Response:** Shipping incrementally is deliberate. The section merge is a standalone improvement: it removes confusion ("what's the difference between General Agents and Assistants?"). Favorites and Show-more are additive enhancements that don't depend on the merge and don't block it. Bundling them together would increase scope, risk, and review time. The merge can ship, be validated with users, and then Favorites/Show-more can iterate on top. The design decision itself marks Favorites interaction as "待讨论" (to be discussed), confirming it's not ready for implementation.

---

## Acceptance Criteria

### AC-1: Unified DM section renders correctly
- [ ] Sidebar shows exactly **two** sections: "Channels" and "Direct Messages"
- [ ] The "General Agents" and "Assistants" section headers no longer appear
- [ ] All agent DM groups (both CLI agents and preset/custom assistants) render under the single "Direct Messages" section

### AC-2: Agent DM groups sorted by most recent activity
- [ ] The agent closest to the top of the DM list is the one with the most recent conversation activity
- [ ] Creating a new message with an agent moves that agent to the top of the list

### AC-3: Only agents with conversations appear
- [ ] An agent with zero conversations does **not** appear in the DM list
- [ ] Starting the first conversation with a new agent causes it to appear in the DM list

### AC-4: Redundant "+" button removed
- [ ] The "Direct Messages" section header has **no** "+" button
- [ ] The `AgentSelectionModal` component is fully removed (no dead code)
- [ ] The top-level "+ New Conversation" button in the sidebar header still works and navigates to GuidPage

### AC-5: Channel section unchanged
- [ ] The "Channels" section still renders with its "+" button for creating group chats
- [ ] Channel collapse/expand toggle still works

### AC-6: Collapsed sidebar works correctly
- [ ] In collapsed mode, all agent avatars render in a single continuous list (no separator between former "General Agents" and "Assistants")
- [ ] Popover on avatar click still shows conversation list

### AC-7: i18n keys cleaned up
- [ ] Keys `generalAgentsSection`, `assistantsSection`, `newDirectMessage`, and all AgentSelectionModal-related keys are removed from all 6 locale files
- [ ] Key `directMessagesSection` is used for the unified section header
- [ ] No i18n key type errors (`bunx tsc --noEmit` passes)

### AC-8: Existing features preserved
- [ ] Pinned conversations section still renders at the top (when present)
- [ ] Drag-and-drop reordering of pinned conversations still works
- [ ] Batch mode (select / delete / export) still works for all conversations
- [ ] `AgentDMGroup` expand/collapse, workspace sub-groups, and conversation count badges still work
- [ ] CronJobIndicator still renders on conversations with active cron jobs

### AC-9: No regressions
- [ ] `bun run test` passes
- [ ] `bun run lint:fix` produces no errors
- [ ] `bunx tsc --noEmit` produces no type errors

[DONE]
