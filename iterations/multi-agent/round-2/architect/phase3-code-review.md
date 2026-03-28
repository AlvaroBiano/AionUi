# Phase 3 Code Review

## Summary
- MUST-FIX: 1 item
- SHOULD-FIX: 4 items

## MUST-FIX Issues

### MF-1: State sync gap between TaskPanel save and ChildTaskCard saved indicator

- **File**: `src/renderer/pages/conversation/dispatch/GroupChatView.tsx:95-131` + `src/renderer/pages/conversation/dispatch/TaskPanel.tsx:180-189`
- **Issue**: Two independent save paths maintain separate state for "is this teammate saved":
  1. `GroupChatView` maintains `savedTeammateNames: Set<string>` (line 95) which is only updated when saving via the ChildTaskCard flow (`handleTeammateSaved`, line 123-131).
  2. `TaskPanel` has its own `useIsSavedTeammate` hook (line 49) which is only refreshed via `recheckSaved()` after saving from the panel (line 186).

  When a user saves a teammate via the TaskPanel's "Save as Assistant" button, `GroupChatView`'s `savedTeammateNames` is never updated. The corresponding ChildTaskCard in the timeline will still show a "Save" button even though the teammate has already been persisted. Clicking it again will result in a duplicate-name error from the backend.

  This is a logic error -- the two save entry points produce inconsistent UI state.

- **Fix**: Unify the saved-teammate tracking. Options:
  - **(Recommended)** Remove `savedTeammateNames` from `GroupChatView` entirely. Instead, pass `teammateName` per ChildTaskCard and have each card use `useIsSavedTeammate` individually (or lift a shared hook to GroupChatView that checks all teammate names at once). When either save path succeeds, call a shared `recheck()`.
  - **(Simpler)** Add an `onTeammateSaved` callback prop to `TaskPanel` so that when saving from the panel, `GroupChatView` can also update its `savedTeammateNames` set.

## SHOULD-FIX Issues

### SF-1: `text-danger-6` is not a defined semantic token

- **File**: `src/renderer/pages/conversation/dispatch/TaskPanel.tsx:141`
- **Issue**: The class `text-danger-6` is used for the error message display. The project's `uno.config.ts` defines `text-danger` (mapped to `var(--danger)`) as the semantic token, not `text-danger-6`. UnoCSS may still resolve `text-danger-6` via Arco's CSS variables, but this bypasses the project's semantic token layer.
- **Fix**: Replace `text-danger-6` with `text-danger` to use the project's defined semantic color.

### SF-2: Missing `dispatch.overview.lastActivity` i18n key from PRD

- **File**: i18n locale files (all 6 languages)
- **Issue**: The PRD Appendix A specifies `dispatch.overview.lastActivity` ("Last activity {time}") as a required i18n key. This key is not present in any locale file. The `TaskOverview` component instead uses a raw `formatActivityTime()` utility (line 17-26) that returns hardcoded strings like `<1m`, `3m`, `2h`. These are not localized.
- **Fix**: Either:
  - Add the `dispatch.overview.lastActivity` key and use `t('dispatch.overview.lastActivity', { time: formatActivityTime(child.lastActivityAt) })` for the display, or
  - Document that the raw relative-time format was chosen intentionally and update the PRD accordingly. The current approach (`<1m`, `3h`) is universally understood and arguably acceptable, but does not match the PRD specification.

### SF-3: `SaveTeammateModal` catch block silently swallows IPC errors

- **File**: `src/renderer/pages/conversation/dispatch/components/SaveTeammateModal.tsx:85-88`
- **Issue**: The `catch` block in `handleSave` is empty. If the IPC call `saveTeammate.invoke()` throws a network/serialization error (not a business-logic failure), the user sees no feedback -- the loading spinner stops and nothing happens.
- **Fix**: Add a `Message.error(t('dispatch.teammate.saveError'))` in the catch block for non-validation errors:
  ```typescript
  } catch (err) {
    // Only show error for non-form-validation failures
    if (err && typeof err !== 'object') {
      Message.error(t('dispatch.teammate.saveError'));
    }
  }
  ```
  Or distinguish Arco form validation errors from IPC errors by checking the error type.

### SF-4: `dispatch.teammate.cancel` key not in PRD Appendix A

- **File**: `src/renderer/pages/conversation/dispatch/components/SaveTeammateModal.tsx:105`, all 6 locale files
- **Issue**: The `dispatch.teammate.cancel` i18n key is used in `SaveTeammateModal` and exists in all locale files, but is not listed in the PRD's Appendix A i18n key inventory. This is a documentation gap -- the code is correct, but the PRD is incomplete.
- **Fix**: Update the PRD Appendix A to include `dispatch.teammate.cancel -> "Cancel"`, or use a shared `common.cancel` key if one exists to avoid duplication.

## Files Reviewed

- [x] `src/renderer/pages/conversation/dispatch/components/SaveTeammateModal.tsx` -- well-structured modal with proper form validation and IPC flow; catch block too silent (SF-3)
- [x] `src/renderer/pages/conversation/dispatch/components/TaskOverview.tsx` -- clean component, good a11y (aria-expanded, role, tabIndex, keyboard handler); missing localized lastActivity (SF-2)
- [x] `src/renderer/pages/conversation/dispatch/components/TaskOverview.module.css` -- correct use of semantic CSS variables, pulse animation as designed
- [x] `src/renderer/pages/conversation/dispatch/hooks/useIsSavedTeammate.ts` -- clean hook, reuses existing IPC, handles missing teammateName gracefully
- [x] `src/renderer/pages/conversation/dispatch/types.ts` -- all new types match design doc, proper use of `type` over `interface`
- [x] `src/renderer/pages/conversation/dispatch/ChildTaskCard.tsx` -- save button logic correct, proper condition checks for hasTeammateConfig
- [x] `src/renderer/pages/conversation/dispatch/TaskPanel.tsx` -- save integration works, but state not synced back to parent (MF-1); hardcoded color token (SF-1)
- [x] `src/renderer/pages/conversation/dispatch/GroupChatView.tsx` -- TaskOverview and SaveTeammateModal integration correct; state sync issue with TaskPanel save path (MF-1)
- [x] `src/renderer/pages/conversation/dispatch/GroupChatTimeline.tsx` -- clean pass-through of save props to ChildTaskCard
- [x] `src/renderer/pages/conversation/dispatch/hooks/useGroupChatInfo.ts` -- auto-refresh with terminal-state skip is well-implemented using useRef to avoid circular dependency
- [x] `src/common/adapter/ipcBridge.ts` -- two new channels correctly defined in dispatch namespace
- [x] `src/process/bridge/dispatchBridge.ts` -- uses ProcessConfig (not ConfigStorage), no IPC deadlock risk; duplicate-name check is correct; source marker approach is acceptable per design doc rationale
- [x] i18n files (6 languages) -- all keys consistent across locales; `cancel` key present but undocumented in PRD (SF-4); `lastActivity` key missing (SF-2)
- [x] Directory structure -- dispatch/ has exactly 10 direct children, within limit
