# S3 Group Chat Member Sidebar — Developer Changes

[DONE]

## Files Changed

### New Files

| File                                                                        | Description                                                                                                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/pages/conversation/dispatch/components/GroupMemberSider.tsx`  | Member panel component with header, dispatcher row, scrollable member list, and collapse toggle. Exports `MemberSiderToggleButton` for use in the header.               |
| `src/renderer/pages/conversation/dispatch/components/MemberCard.tsx`        | Individual member card with avatar, Crown/CheckOne/Timer badges, status Tag, activity time, hover Popover config summary (model/workspace/rules), and edit icon button. |
| `src/renderer/pages/conversation/dispatch/components/MemberCard.module.css` | CSS Module for card hover/active/selected states, avatar sizing, badge colors, edit button visibility, and popover content layout.                                      |

### Modified Files

| File                                                                 | Changes                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/renderer/pages/conversation/dispatch/types.ts`                  | Added `GroupChatMemberVO`, `GroupMemberSiderProps`, `MemberCardProps` types. Added `presetRules?: string` and `isPermanent?: boolean` to `ChildTaskInfoVO`.                                                                          |
| `src/common/adapter/ipcBridge.ts`                                    | Added `presetRules` and `isPermanent` to the `getGroupChatInfo` response children array type.                                                                                                                                        |
| `src/process/bridge/dispatchBridge.ts`                               | Enriched `getGroupChatInfo` handler: builds `savedAgentNames` Set from `acp.customAgents`, then maps `presetRules` and `isPermanent` per child.                                                                                      |
| `src/renderer/pages/conversation/dispatch/hooks/useGroupChatInfo.ts` | Maps `presetRules`, `isPermanent`, `modelName`, `workspace`, `leaderAgentId`, `seedMessages`, `maxConcurrentChildren` from the IPC response into `GroupChatInfoVO` (some fields were previously dropped).                            |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`         | Added `memberSiderCollapsed` state, `members` memo derived from `info.children`, viewport-width auto-collapse effect, `MemberSiderToggleButton` in `headerExtra`, and `GroupMemberSider` rendered between chat area and `TaskPanel`. |
| `src/renderer/services/i18n/locales/en-US/dispatch.json`             | Added `memberSider.*` keys (17 keys).                                                                                                                                                                                                |
| `src/renderer/services/i18n/locales/zh-CN/dispatch.json`             | Added `memberSider.*` translations.                                                                                                                                                                                                  |
| `src/renderer/services/i18n/locales/ja-JP/dispatch.json`             | Added `memberSider.*` translations.                                                                                                                                                                                                  |
| `src/renderer/services/i18n/locales/ko-KR/dispatch.json`             | Added `memberSider.*` translations.                                                                                                                                                                                                  |
| `src/renderer/services/i18n/locales/tr-TR/dispatch.json`             | Added `memberSider.*` translations.                                                                                                                                                                                                  |
| `src/renderer/services/i18n/locales/zh-TW/dispatch.json`             | Added `memberSider.*` translations (using zh-TW terms: 預設 for default, 儲存 for save, 臨時 for temporary).                                                                                                                         |

## Key Implementation Decisions

1. **`mouseEnterDelay` on Popover**: Arco `Popover` does not directly expose `mouseEnterDelay`; it is passed via `triggerProps={{ mouseEnterDelay: 200 }}`.

2. **`isPermanent` computed in bridge**: One `ProcessConfig.get('acp.customAgents')` call per `getGroupChatInfo` request, building a `Set<string>` keyed by agent name. O(1) lookup per child. Non-fatal on error (defaults to false).

3. **Auto-collapse on narrow viewport**: `useEffect` fires when `selectedChildTaskId` changes; if `window.innerWidth < 900` the member sider auto-collapses.

4. **Dispatcher row**: Clicking opens `GroupChatSettingsDrawer` (passes `onDispatcherClick` → `setSettingsVisible(true)`). Shows Crown badge only when `leaderAgentId` is set; sub-label reads "Leader" or "Orchestrator".

5. **`useGroupChatInfo` fix**: The hook was previously dropping `modelName`, `workspace`, `leaderAgentId`, `seedMessages`, and `maxConcurrentChildren` from the response mapping. These are now correctly mapped.

## Quality

- `bun run format`: passed (1578 files)
- `bun run lint:fix`: 0 errors (1258 warnings pre-existing)
- `bunx tsc --noEmit`: 0 new errors introduced by S3 changes (4 pre-existing errors in `DispatchAgentManager.ts`, `conversationBridge.ts`, `useTaskPanelTranscript.ts`)
- `bun run i18n:types`: unchanged (keys already in type definitions)
- `node scripts/check-i18n.js`: passed (35 pre-existing warnings, all 6 locales complete)
