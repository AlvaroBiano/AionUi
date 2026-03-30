# S2 Channels Area Redesign - Tech Design

## Overview

Transform the sidebar Channels section from a flat list of dispatch `ConversationRow`s into a Slack-style channel list with `#` prefix icons, unread badges, and active task count indicators.

---

## 1. File Change List

| #   | File (absolute from project root)                                    | Action     | Description                                                                                             |
| --- | -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `src/renderer/pages/conversation/GroupedHistory/ChannelSection.tsx`  | **Create** | New component: renders the Channels section header + channel row list                                   |
| 2   | `src/renderer/pages/conversation/GroupedHistory/index.tsx`           | **Modify** | Replace inline channel rendering block (lines 410-429) with `<ChannelSection>`                          |
| 3   | `src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx` | **Modify** | Change leading icon for dispatch conversations from `People`/avatar to `#` icon from `@icon-park/react` |
| 4   | `src/renderer/pages/conversation/GroupedHistory/types.ts`            | **Modify** | Add `ChannelSectionProps` type                                                                          |
| 5   | `src/renderer/services/i18n/locales/en-US/dispatch.json`             | **Modify** | Add new i18n keys for channel-specific labels                                                           |
| 6   | `src/renderer/services/i18n/locales/zh-CN/dispatch.json`             | **Modify** | Add corresponding zh-CN translations                                                                    |

---

## 2. Type Definitions

### New types in `types.ts`

```typescript
/** Props for the ChannelSection component */
export type ChannelSectionProps = {
  /** Dispatch conversations to render as channels */
  conversations: TChatConversation[];
  /** Map of dispatch conversation ID -> active child task count */
  childTaskCounts: Map<string, number>;
  /** Whether the sidebar is collapsed */
  collapsed: boolean;
  /** Whether sidebar tooltip is enabled (collapsed mode) */
  tooltipEnabled: boolean;
  /** Whether batch selection mode is active */
  batchMode: boolean;
  /** Currently selected conversation ID (from route) */
  selectedConversationId?: string;
  /** Callback to open the create group chat modal */
  onCreateChannel: () => void;
  /** Render function for individual conversation rows (reuses existing getConversationRowProps pattern) */
  renderConversation: (conversation: TChatConversation) => React.ReactNode;
};
```

No new standalone types are needed beyond `ChannelSectionProps`. The existing `ConversationRowProps` already carries `childTaskCount?: number` which will continue to power the active task badge on each channel row.

---

## 3. Component Props: ChannelSection

```
ChannelSection
  Props: ChannelSectionProps (see above)

  Internal state: none (stateless presentation component)

  Renders:
    - Section header: "Channels" label + "+" button (when !collapsed)
    - Empty state: subtle message when conversations.length === 0 (when !collapsed)
    - Channel list: maps conversations through renderConversation()
```

### ConversationRow Modifications

The `renderLeadingIcon()` method in `ConversationRow.tsx` will be changed for dispatch conversations:

**Before (current):**

```typescript
if (isDispatchConversation) {
  const extra = conversation.extra as { teammateConfig?: { avatar?: string } };
  const avatar = extra.teammateConfig?.avatar;
  if (avatar) {
    return <span className='text-18px leading-none flex-shrink-0'>{avatar}</span>;
  }
  return <People theme='outline' size='20' className='line-height-0 flex-shrink-0' />;
}
```

**After (Slack-style):**

```typescript
if (isDispatchConversation) {
  return <Pound theme='outline' size='18' className='line-height-0 flex-shrink-0 text-t-secondary' />;
}
```

The `Pound` icon (`#` symbol) is imported from `@icon-park/react`. This replaces the `People` icon and any avatar emoji for channels, giving a consistent Slack-like `#channel-name` appearance.

The child task count badge already renders via the existing code block:

```typescript
{isDispatchConversation && typeof childTaskCount === 'number' && childTaskCount > 0 && (
  <span className='ml-4px text-11px text-t-secondary bg-fill-2 px-4px py-1px rd-full flex-shrink-0'>
    {childTaskCount}
  </span>
)}
```

This stays as-is -- it already provides the active task count indicator.

### Unread Badge

Dispatch conversations already have the `hasCompletionUnread` mechanism from `useConversationHistoryContext`. The existing unread dot in `ConversationRow` is currently gated behind `!isDispatchConversation`:

```typescript
{
  !isDispatchConversation && renderCompletionUnreadDot();
}
```

**Change:** Remove the `!isDispatchConversation` guard so dispatch channels also show the unread indicator dot. This makes the unread state visible for channels, consistent with Slack behavior.

---

## 4. Data Flow

```
ConversationHistoryContext
  |
  +-> useConversations() hook
  |     |
  |     +-> groupedHistory.dispatchConversations   (TChatConversation[])
  |     +-> dispatchChildCounts                     (Map<string, number>)
  |     +-> isConversationGenerating()              (per-conversation)
  |     +-> hasCompletionUnread()                   (per-conversation)
  |
  +-> WorkspaceGroupedHistory (index.tsx)
        |
        +-> getConversationRowProps()  -- builds ConversationRowProps per conversation
        +-> renderConversation()       -- wraps in <ConversationRow>
        |
        +-> <ChannelSection>           **NEW**
              conversations={dispatchConversations}
              childTaskCounts={dispatchChildCounts}
              collapsed={collapsed}
              tooltipEnabled={tooltipEnabled}
              batchMode={batchMode}
              selectedConversationId={id}
              onCreateChannel={() => setCreateGroupChatVisible(true)}
              renderConversation={renderConversation}
```

Key points:

- **No new data fetching.** All data already flows through `useConversations()` and `getConversationRowProps()`.
- **ChannelSection is a pure presentation wrapper.** It receives `renderConversation` as a render prop, so all row-level logic (click handlers, menus, badges) remain in `ConversationRow`.
- **childTaskCounts** is passed to ChannelSection for potential future use (e.g., section-level aggregate), but individual row counts are already embedded in `ConversationRowProps.childTaskCount` via `getConversationRowProps`.

---

## 5. Self-Debate

### Decision 1: Use `Pound` icon from `@icon-park/react` for the `#` prefix

**Objection 1a: What if `Pound` doesn't exist in @icon-park/react?**
Response: The icon-park library includes `Pound` (hash symbol). If it does not exist under that exact name, alternatives include `NumberSymbol` or `HashtagKey`. The implementer must verify the import compiles. Fallback: render a styled `<span>#</span>` with matching font-size and color, which is semantically equivalent and still avoids emoji.

**Objection 1b: Removing the teammate avatar from the channel icon loses identity information.**
Response: In Slack, channels never show avatars -- they always use `#`. The avatar was meaningful when channels were "group chats" but in the Slack mental model, a channel is a topic/room, not a person. The channel _name_ already conveys identity. The avatar information is still preserved in `conversation.extra.teammateConfig` and visible inside the GroupChatView header when you open the channel.

**Objection 1c: The `#` icon color should adapt to active/selected state.**
Response: The current ConversationRow already applies `text-1` on selected state via the name element. For the icon, using `text-t-secondary` as base and letting the parent row's hover/selected styles cascade (via `group-hover:text-1` or selected class) is sufficient. If needed, add a conditional class: `selected ? 'text-t-primary' : 'text-t-secondary'`.

### Decision 2: ChannelSection as a separate component vs. keeping inline

**Objection 2a: A new file adds complexity -- the inline block is only ~20 lines.**
Response: True, but S1 already established the pattern with `AgentDMGroup.tsx`. Consistency demands that the Channels section follows the same extraction pattern. The component also provides a clear boundary for future enhancements (channel search, channel categories, collapse/expand).

**Objection 2b: ChannelSection has no internal state -- it's just a wrapper div.**
Response: Even stateless components earn their keep when they encapsulate a semantic section. The section header rendering (label + create button + empty state) is logically distinct from the parent's DnD context and modal management. Extracting it reduces `index.tsx` cognitive load.

**Objection 2c: The `renderConversation` render-prop pattern creates tight coupling.**
Response: This pattern is already established by `AgentDMGroup` (which takes the same `renderConversation` prop). It avoids duplicating `getConversationRowProps` logic and keeps the single source of truth for row configuration in `index.tsx`. The coupling is intentional and consistent.

### Decision 3: Enabling unread dot for dispatch conversations

**Objection 3a: Dispatch conversations may not have meaningful "unread" state.**
Response: They do. The `hasCompletionUnread` mechanism tracks whether a background completion finished while the user was viewing a different conversation. This is exactly the "new activity" signal that Slack shows with a bold channel name or dot. Dispatch channels frequently complete child tasks in the background, making this highly relevant.

**Objection 3b: The unread dot might conflict with the child task count badge.**
Response: They convey different information. The child task count shows _how many tasks are active_ (always visible). The unread dot shows _whether new activity occurred since last visit_ (disappears on click). They occupy different positions: count badge is inline after the name, unread dot is right-aligned. No visual conflict.

**Objection 3c: Users might find it noisy if channels constantly show unread.**
Response: The unread state auto-clears when the user clicks into the conversation (via `clearCompletionUnread` in `useConversations`). This matches Slack behavior exactly. If it proves noisy, a future iteration can add "mute channel" functionality, but that is out of scope for S2.

### Decision 4: Not adding a channel-level collapse/expand toggle

**Objection 4a: Slack lets you collapse the Channels section.**
Response: Correct, but S2 scope is specifically the channel _row_ appearance, not section-level UX. The section header already exists from S1. Adding collapse would require persisting expansion state (localStorage), which is a separate concern. Defer to S3 or a polish pass.

**Objection 4b: Without collapse, a user with many channels has a long scroll.**
Response: Current usage patterns show 1-5 dispatch conversations per user. The DM section below is already collapsible per-agent via AgentDMGroup. Channel count is unlikely to be a problem in the near term.

**Objection 4c: At least add the chevron icon for visual parity with DMs.**
Response: Fair point. ChannelSection will render a collapsible header with `Down`/`Right` chevron, matching `AgentDMGroup` visually, with local `useState` for expansion. This is a low-cost addition that improves consistency. **Updated design: include collapse toggle in ChannelSection.**

---

## 6. Acceptance Criteria

Each criterion is independently pass/fail decidable.

### Visual / UI Criteria

- [ ] **AC-1: Channel rows show `#` icon.** Every conversation row in the Channels section displays a `#` (hash/pound) icon from `@icon-park/react` as the leading icon. No `People` icon or emoji avatar appears for dispatch conversations.

- [ ] **AC-2: Channel section header shows "Channels" label.** The section header text reads the i18n value for `dispatch.sidebar.channelsSection` (currently "Channels" in en-US).

- [ ] **AC-3: "+" button creates new channel.** Clicking the `+` icon in the Channels section header opens the `CreateGroupChatModal`.

- [ ] **AC-4: Active task count badge visible.** For a dispatch conversation with active child tasks (count > 0), a numeric badge appears to the right of the channel name showing the count.

- [ ] **AC-5: Unread indicator dot visible for channels.** When a dispatch conversation has `hasCompletionUnread === true` and is not currently selected, a blue dot appears on the right side of the row. The dot disappears when the channel is clicked.

- [ ] **AC-6: Collapsed sidebar shows `#` icon only.** When the sidebar is collapsed, channel rows show only the `#` icon (no text), with a tooltip on hover showing the channel name.

- [ ] **AC-7: Channel section is collapsible.** The Channels section header includes a chevron toggle. Clicking it collapses/expands the channel list. Default state is expanded.

### Structural / Code Criteria

- [ ] **AC-8: ChannelSection.tsx exists.** File exists at `src/renderer/pages/conversation/GroupedHistory/ChannelSection.tsx` and exports a React component.

- [ ] **AC-9: ChannelSectionProps type defined.** `ChannelSectionProps` is exported from `types.ts` with the fields specified in section 2.

- [ ] **AC-10: index.tsx uses ChannelSection.** The inline channel rendering block in `index.tsx` (the `{/* Channels section */}` comment block) is replaced with a `<ChannelSection>` component invocation.

- [ ] **AC-11: No `any` types.** `grep -r 'any' ChannelSection.tsx` returns zero matches for TypeScript `any` usage.

- [ ] **AC-12: All user-facing text uses i18n.** No hardcoded English strings in `ChannelSection.tsx`. All text passes through `t()`.

- [ ] **AC-13: i18n keys added.** New keys are added to both `en-US/dispatch.json` and `zh-CN/dispatch.json` for any new user-facing strings (e.g., empty state message).

- [ ] **AC-14: Icons from @icon-park/react only.** No emoji characters used as icons. The `#` symbol comes from the icon-park `Pound` (or equivalent hash icon).

- [ ] **AC-15: UnoCSS utilities used for styling.** No inline `style={{}}` objects in ChannelSection.tsx unless strictly necessary for dynamic values. All static styles use UnoCSS utility classes.

### Behavioral Criteria

- [ ] **AC-16: Clicking a channel row navigates to the conversation.** The existing `onConversationClick` handler fires and the URL updates to `/conversation/{id}`.

- [ ] **AC-17: Right-click / menu still works.** The three-dot context menu on channel rows still shows rename, export, delete options (same as before).

- [ ] **AC-18: Batch mode still works for channels.** When batch mode is active, channel rows show checkboxes and support selection.

- [ ] **AC-19: Empty channels section.** When there are zero dispatch conversations, the Channels section header still renders (with the `+` button) but shows no channel rows. An optional subtle empty-state text may appear (i18n key `dispatch.sidebar.noChannels`).

---

## i18n Keys to Add

### en-US/dispatch.json additions under `sidebar`:

```json
{
  "sidebar": {
    "noChannels": "No channels yet",
    "collapseChannels": "Collapse channels",
    "expandChannels": "Expand channels"
  }
}
```

### zh-CN/dispatch.json additions under `sidebar`:

```json
{
  "sidebar": {
    "noChannels": "\u8fd8\u6ca1\u6709\u9891\u9053",
    "collapseChannels": "\u6536\u8d77\u9891\u9053",
    "expandChannels": "\u5c55\u5f00\u9891\u9053"
  }
}
```

---

## Implementation Notes

1. **Icon verification**: The implementer must verify that `Pound` (or `NumberSymbol` / `Hashtag`) exists in the installed version of `@icon-park/react`. Run: `grep -r "Pound\|NumberSymbol\|Hashtag" node_modules/@icon-park/react/lib/map.js` to confirm.

2. **Directory child count**: The GroupedHistory directory currently has 10 direct children (at the limit per CLAUDE.md). Adding `ChannelSection.tsx` makes 11. The implementer should check if any file can be moved into a subdirectory, or request an exception given this is a closely related sibling component.

3. **CSS class `collapsed-hidden`**: This existing utility class (used in ConversationRow) hides content when sidebar is collapsed. ChannelSection should use the same class for text elements.

4. **Testing**: Unit test for ChannelSection should verify: renders header, renders channel rows via renderConversation, shows empty state, collapse toggle works. Use Vitest + React Testing Library.

[DONE]
