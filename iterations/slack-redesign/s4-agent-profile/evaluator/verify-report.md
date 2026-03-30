# S4: Agent Profile — Evaluator Verification Report

**Date**: 2026-03-29
**Evaluator**: interactive_verify
**Phase**: S4 — Agent Profile + DM Chat Entry

---

## 1. Test Execution Summary

### Step 1: S4 Unit Tests (initial run)

```
bun run test -- tests/unit/agent/
```

**Initial result**: 21 failures (20 hook + 1 DOM)

**Root causes identified and fixed:**

| Fix                                  | File                                                     | Issue                                                                                                                     | Classification                               |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Rename `.test.ts` → `.dom.test.ts`   | `tests/unit/agent/useAgentProfile.test.ts`               | `renderHook` requires jsdom but file ran in node environment                                                              | Test environment mismatch                    |
| Update `getAgentLogo` mock signature | `tests/unit/agent/useAgentProfile.dom.test.ts` (UAP-003) | Mock expected `getAgentLogo(identity: AgentIdentity)` but implementation correctly calls `getAgentLogo(agentKey: string)` | Test mock mismatch with real API             |
| Add `react-router-dom` mock          | `tests/unit/dispatch/GroupMemberSider.dom.test.tsx`      | S4 added `useNavigate()` to `GroupMemberSider`; test lacked router mock                                                   | Test mock mismatch caused by S4 modification |

**After fixes**:

```
tests/unit/agent/         → 55 passed, 1 failed (AP-034 — real bug)
tests/unit/dispatch/GroupMemberSider.dom.test.tsx → 24 passed
```

### Step 2: Full Test Suite

**Final result**: 4 failures total

| Failure                                     | Classification              |
| ------------------------------------------- | --------------------------- |
| `weixinSystemActions` (2 tests)             | Pre-existing — ignore       |
| `SystemModalContent.dom.test.tsx` (1 test)  | Pre-existing flaky — ignore |
| `AgentProfile.dom.test.tsx` AP-034 (1 test) | Real S4 bug — see AC-15     |

**Net new failures from S4**: 1 (AP-034 / AC-15)

---

## 2. Acceptance Criteria Verification

### Routing

| AC   | Description                                                                | Status | Evidence                                                                                                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | `/agent/preset%3Aword-creator` renders without errors                      | PASS   | `index.tsx` renders `AgentProfilePage` with decoded `agentId` via `decodeURIComponent(rawAgentId)`. AP-001 passes.                                                                                                                                                                                                       |
| AC-2 | Unknown agentId shows "Agent not found" empty state **with a back button** | FAIL   | Empty state renders `<Empty description={t('agent.profile.notFound')} />` only. No back button in the not-found path (`index.tsx` lines 51–57). AP-003 passes vacuously: `screen.queryByTestId('icon-left')?.parentElement` evaluates to `undefined` (not null), satisfying `not.toBeNull()` even without a back button. |
| AC-3 | Back button calls `navigate(-1)`                                           | PASS   | `handleBack` in `index.tsx` line 27 calls `navigate(-1)`. Wired to `AgentProfileHeader.onBack`. AP-004 passes.                                                                                                                                                                                                           |

### Agent Profile Header

| AC   | Description                                                                      | Status | Evidence                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-4 | Avatar: emoji \| logo img \| letter fallback                                     | PASS   | `AgentProfileHeader.tsx` `renderAvatar()`: emoji if `identity.avatar && !endsWith('.svg')`; logo `<img>` if `agentLogo`; letter fallback otherwise. AP-006/007/008 pass. |
| AC-5 | Agent name as primary heading                                                    | PASS   | `<h2 className='text-24px font-semibold text-t-primary m-0 truncate'>{identity.name}</h2>`. AP-005 passes.                                                               |
| AC-6 | Tag badge: "Permanent" (green) or "Temporary" (gray)                             | PASS   | `<Tag color={isPermanent ? 'green' : 'gray'}>`. AP-009/010 pass.                                                                                                         |
| AC-7 | Second Tag badge for agent source                                                | PASS   | `getSourceLabel()` maps `preset/custom/cli_agent/dispatch_teammate/temporary_teammate` to i18n keys. AP-011/012 pass.                                                    |
| AC-8 | "Start new conversation" Button navigates to `/guid` with `state.prefillAgentId` | PASS   | `index.tsx` line 31: `navigate('/guid', { state: { prefillAgentId: agentId } })`. AP-014 passes.                                                                         |

### Agent Config Section

| AC    | Description                                                                              | Status | Evidence                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| AC-9  | "Edit config" button visible for permanent agents                                        | PASS   | `AgentConfigSection.tsx` line 41: `{isPermanent && <Button ... onClick={onEditConfig}>}`. AP-015 passes.                 |
| AC-10 | "Edit config" button hidden for temporary agents                                         | PASS   | Same condition: only renders when `isPermanent`. AP-016 passes.                                                          |
| AC-11 | Config section: backend type, description, workspaces                                    | PASS   | `descriptionData` array pushes `backendType`, `description`, `workspaces.join(', ')` conditionally. AP-017/018/019 pass. |
| AC-12 | Edit config routing: `custom:*` → `/settings/agent`, `preset:*` → `/settings/assistants` | PASS   | `index.tsx` lines 37–41 check `identity.id.startsWith('custom:')`. AP-020/021 pass.                                      |

### Agent Conversation List

| AC    | Description                                                         | Status       | Evidence                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-13 | Only conversations where `resolveAgentId(c) === agentId` are listed | PASS         | `useAgentProfile.ts` line 27: `.filter((c) => resolveAgentId(c) === agentId)`. UAP-006/007 pass.                                                                                                                                                                                                                        |
| AC-14 | Conversations sorted by `updatedAt` descending                      | PARTIAL PASS | Implementation sorts by `modifyTime` (line 28: `.toSorted((a, b) => (b.modifyTime ?? 0) - (a.modifyTime ?? 0))`), not `updatedAt`. Spec requires sorting by `updatedAt`. Tests pass only because fixtures set `modifyTime === updatedAt`. Functionally equivalent in current test data but semantically non-conformant. |
| AC-15 | Each row: title, relative time, **workspace path** if present       | FAIL         | `getWorkspaceDisplayName()` in `AgentConversationList.tsx` line 33 returns `.split('/').pop()                                                                                                                                                                                                                           |     | workspace`— only the last path segment (e.g.,`conv-2`), not the full path (e.g., `/projects/conv-2`). AP-034 fails: `screen.getByText('/projects/conv-2')`not found; actual rendered text is`conv-2`. |
| AC-16 | Clicking conversation row navigates to `/conversation/:id`          | PASS         | `AgentConversationList.tsx` row `onClick={() => onConversationClick(conversation)}`; `index.tsx` `handleConversationClick` navigates to `/conversation/${conversation.id}`. AP-024 passes.                                                                                                                              |
| AC-17 | Empty state when no conversations                                   | PASS         | `<Empty description={t('agent.profile.noConversations')}>` rendered when `conversations.length === 0`. AP-025 passes.                                                                                                                                                                                                   |

### Sidebar Navigation (AgentDMGroup)

| AC    | Description                                                                 | Status | Evidence                                                                                                                          |
| ----- | --------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| AC-18 | Avatar click in `AgentDMGroup` navigates to `/agent/:agentId` (URL-encoded) | PASS   | `AgentDMGroup.tsx` lines 50–56: `handleAvatarClick` calls `navigate('/agent/' + encodeURIComponent(group.agentId))`.              |
| AC-19 | Avatar click does NOT trigger expand/collapse                               | PASS   | `handleAvatarClick` calls `e.stopPropagation()` (line 52).                                                                        |
| AC-20 | Header row (name, chevron, count) still toggles expand/collapse             | PASS   | Header `div` at line 156–185 has `onClick={handleToggle}`. Avatar span nested inside with its own handler that stops propagation. |

### Member Sider Navigation (GroupMemberSider)

| AC    | Description                                                           | Status | Evidence                                                                                                                                  |
| ----- | --------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AC-21 | `GroupChatMemberVO` has optional `agentId?: string`                   | PASS   | `dispatch/types.ts` line 84: `agentId?: string`.                                                                                          |
| AC-22 | Member name click navigates to `/agent/:agentId` if `agentId` present | PASS   | `MemberCard.tsx` line 107–114: `onNavigateToProfile(member.agentId)` called when `member.agentId && onNavigateToProfile`. GMS tests pass. |
| AC-23 | No navigation if `agentId` absent                                     | PASS   | Click handler is `undefined` when `!member.agentId` (line 108: conditional).                                                              |

### General

| AC    | Description                                                      | Status | Evidence                                                                                                                                             |
| ----- | ---------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-24 | All user-facing strings use i18n keys                            | PASS   | All strings in all components use `t('agent.profile.*')` keys. i18n keys verified in `locales/en-US/agent.json`. No hardcoded English strings found. |
| AC-25 | All interactive elements use `@arco-design/web-react`            | PASS   | `Button`, `Tag`, `Empty`, `Descriptions`, `Tooltip` all used from arco-design. No raw `<button>` / `<input>` / `<select>` in new files.              |
| AC-26 | All icons use `@icon-park/react`                                 | PASS   | `Left`, `Edit`, `Crown`, `CheckOne`, `Timer`, `People`, `DoubleLeft`, `DoubleRight` all from `@icon-park/react`.                                     |
| AC-27 | UnoCSS utility classes; complex styles via CSS Modules           | PASS   | All new components use UnoCSS utility classes exclusively. No CSS Module files were created (not needed given complexity).                           |
| AC-28 | TypeScript strict mode — no `any`, all types with `type` keyword | PASS   | No `any` or `interface` found in any new/modified agent page files. All types use `type` keyword.                                                    |
| AC-29 | Page lazy-loaded via `React.lazy()`                              | PASS   | `Router.tsx` line 19: `const AgentProfile = React.lazy(() => import('@renderer/pages/agent'))`.                                                      |

---

## 3. Bug Summary

### BUG-1: Not-found state missing back button (AC-2)

**Severity**: Medium
**File**: `src/renderer/pages/agent/index.tsx` lines 51–57
**Issue**: When `useAgentProfile` returns null (agent not found), the component renders only `<Empty description={t('agent.profile.notFound')} />` without a back button. The AC requires "shows a 'Agent not found' empty state **with a back button**."
**Reproduction**: Navigate to `/#/agent/nonexistent-id`. No way to navigate back without the browser's back button.
**Fix**: Add a `Button type="text"` with `onClick={handleBack}` inside the not-found render path.

### BUG-2: Workspace path truncated in conversation list (AC-15)

**Severity**: Low
**File**: `src/renderer/pages/agent/components/AgentConversationList.tsx` line 33
**Issue**: `getWorkspaceDisplayName` returns `workspace.split('/').pop()` — only the last directory segment (e.g., `conv-2`) instead of the full path (e.g., `/projects/conv-2`).
**Test**: AP-034 fails: `screen.getByText('/projects/conv-2')` not found; actual rendered text is `conv-2`.
**Fix**: Return the full `workspace` string instead of only the last segment. Or document that only the basename is intended, and update the test + AC accordingly.

### BUG-3: Sort key is `modifyTime` instead of `updatedAt` (AC-14 semantic drift)

**Severity**: Low (currently non-breaking due to fixture equality, but diverges from spec)
**File**: `src/renderer/pages/agent/hooks/useAgentProfile.ts` line 28
**Issue**: `.toSorted((a, b) => (b.modifyTime ?? 0) - (a.modifyTime ?? 0))` sorts by `modifyTime`, not `updatedAt` as specified in AC-14 and the hook design sketch.
**Status**: Tests pass because all fixtures set `modifyTime === updatedAt`, masking the mismatch.
**Fix**: Change sort key to `updatedAt`.

---

## 4. Test Fix Log

| File                                                                                  | Change                                                                                                                                                                                                                 | Rationale                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/agent/useAgentProfile.test.ts` → renamed to `useAgentProfile.dom.test.ts` | File extension change                                                                                                                                                                                                  | `renderHook` from `@testing-library/react` requires jsdom. Original `.test.ts` ran in node environment, causing `ReferenceError: document is not defined` for all 20 tests.                                          |
| `tests/unit/agent/useAgentProfile.dom.test.ts` UAP-003                                | Mock signature updated: `(identity: AgentIdentity) => mockGetAgentLogo(identity)` → `(agentKey: string) => mockGetAgentLogo(agentKey)`, assertion changed to `expect(mockGetAgentLogo).toHaveBeenCalledWith('claude')` | Real `getAgentLogo(agent: string)` takes a string. Implementation calls `getAgentLogo(identity.backendType ?? identity.id)`. Test mock matched wrong API shape. Intent preserved: verifies correct string is passed. |
| `tests/unit/dispatch/GroupMemberSider.dom.test.tsx`                                   | Added `vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))`                                                                                                                                       | S4 added `useNavigate()` to `GroupMemberSider`. All 24 tests failed with "useNavigate() may only be used in a Router context". Mock added to satisfy new hook dependency while preserving all test assertions.       |

---

## 5. Verdict

| Category          | Pass                                     | Fail                    |
| ----------------- | ---------------------------------------- | ----------------------- |
| Routing           | AC-1, AC-3                               | AC-2                    |
| Header            | AC-4, AC-5, AC-6, AC-7, AC-8             | —                       |
| Config Section    | AC-9, AC-10, AC-11, AC-12                | —                       |
| Conversation List | AC-13, AC-16, AC-17                      | AC-14 (sort key), AC-15 |
| AgentDMGroup      | AC-18, AC-19, AC-20                      | —                       |
| MemberSider       | AC-21, AC-22, AC-23                      | —                       |
| General           | AC-24, AC-25, AC-26, AC-27, AC-28, AC-29 | —                       |

**Total**: 26 PASS / 3 FAIL

S4 is substantially complete. Two clear implementation bugs (AC-2, AC-15) and one semantic drift (AC-14). Recommend fixing before merge.

[DONE]
