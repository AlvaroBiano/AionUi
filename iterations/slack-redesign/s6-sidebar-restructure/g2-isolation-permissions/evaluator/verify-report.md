# G2 Verification Report

**Date**: 2026-03-30
**Evaluator**: Claude Opus 4.6
**Result**: PASS (with 2 spec-first test fixes + 1 schema test update)

---

## Fixes Applied During Verification

3 test issues found and fixed before final pass:

1. **`permissionPolicy.test.ts` line 45** -- `git clean -fd` was not matched as dangerous.
   - **Root cause**: Regex `\bgit\s+clean\s+-[a-zA-Z]*f\b` used `\b` after `f`, but `-fd` has `d` immediately after `f` so `\b` fails (word boundary between alphanumeric chars doesn't fire).
   - **Fix**: Removed trailing `\b` from the regex in `permissionPolicy.ts` line 42. Now `/\bgit\s+clean\s+-[a-zA-Z]*f/` matches `-f`, `-fd`, `-fdx`, etc.

2. **`permissionPolicy.test.ts` line 105** -- `cat package.json` expected `normal` but got `safe`.
   - **Root cause**: `cat` is listed in `SAFE_BASH_PATTERNS` (line 55), so it correctly classifies as `safe`. The spec-first test assumed `cat` was unrecognized.
   - **Fix**: Changed test input to `python3 script.py` (genuinely unrecognized, returns `normal`).

3. **`dispatchMcpToolSchemas.test.ts` line 68** -- Expected 4 tools but G2 added 2 new ones.
   - **Root cause**: Pre-existing test (F-5.1) expected exactly `[list_sessions, read_transcript, send_message, start_task]`. G2 correctly added `ask_user` and `stop_child` to `TOOL_SCHEMAS`.
   - **Fix**: Updated test to expect all 6 tools sorted: `[ask_user, list_sessions, read_transcript, send_message, start_task, stop_child]`.

---

## Test Results (Final)

| Suite | Result |
|-------|--------|
| G2 dispatch tests (96 tests) | 96/96 PASS |
| Full test suite (2895 tests) | 2886 pass, 2 fail (pre-existing), 7 skipped |
| `bunx tsc --noEmit` | 4 errors (all pre-existing, none in G2 files) |
| `bun run lint:fix` | 0 errors, 1325 warnings (pre-existing) |

### Pre-existing failures (NOT caused by G2):
- `groupingHelpers.test.ts`: 2 subtitle display mode tests
- TS errors: `conversationBridge.ts:300`, `DispatchAgentManager.ts:1061`, `DispatchAgentManager.ts:1073`, `useTaskPanelTranscript.ts:12`

---

## Acceptance Criteria Verification

### G2.1 Git Worktree Isolation

| AC | Status | Evidence |
|----|--------|----------|
| `start_task` with `isolation: 'worktree'` creates worktree under `.aion-worktrees/` | PASS | `worktreeManager.ts:58-59`: `worktreeDir = path.join(mainWorkspace, '.aion-worktrees')` |
| Child working directory set to worktree path | PASS | `DispatchAgentManager.ts:423`: `childWorkspace = wtInfo.worktreePath` |
| `extra.worktreePath` stored in child conversation | PASS | `DispatchAgentManager.ts:454` |
| `cascadeKill` cleans up worktrees | PASS | `DispatchResourceGuard.ts:117-122`: checks `child.worktreePath` and calls `cleanupWorktree` |
| Non-git-repo graceful degradation | PASS | `worktreeManager.ts:50-55` throws; `DispatchAgentManager.ts:428-430` catches and warns |
| `mergeWorktree()` succeeds for non-conflicting changes | PASS | `worktreeManager.ts:87`: `git merge --no-edit` |
| `mergeWorktree()` aborts and reports conflicts | PASS | `worktreeManager.ts:91-103`: detects conflicts, runs `merge --abort`, returns `conflictFiles` |
| `cleanupWorktree()` is idempotent | PASS | `worktreeManager.ts:123-131`: both `try/catch` blocks swallow errors |

### G2.2 Permission Policy

| AC | Status | Evidence |
|----|--------|----------|
| Classifies Read/Grep/Glob as safe; Edit/Write as normal; Bash(rm -rf) as dangerous | PASS | `permissionPolicy.ts:23-31` + `37-48` + `54-59`. 49 unit tests verify classification. |
| `start_task` accepts `allowed_tools` in MCP schema | PASS | `DispatchMcpServer.ts:327-333` + `dispatchMcpServerScript.ts` both include `allowed_tools` property |
| `allowedTools` stored in `ChildTaskInfo` and conversation `extra` | PASS | `DispatchAgentManager.ts:457` (extra) + `476` (tracker) |
| Dangerous tool calls emit group chat event | PASS | `DispatchAgentManager.ts:974-979` `handleChildToolCallReport` emits system event on requiresApproval |
| Violations logged via `mainWarn` | PASS | `DispatchAgentManager.ts` uses `mainWarn` for both violations and dangerous calls |
| No hard-blocking (soft enforcement) | PASS | `permissionPolicy.ts:131`: dangerous returns `allowed: true` with `requiresApproval: true` |
| Omitted `allowedTools` permits all (backward compat) | PASS | `permissionPolicy.ts:109-114`: undefined/empty allowedTools allows everything |

### G2.3 `stop_child` Tool

| AC | Status | Evidence |
|----|--------|----------|
| `stop_child` MCP tool available | PASS | `DispatchMcpServer.ts:198-213` case handler + schema at line 411-430 |
| Kills child worker process | PASS | `DispatchAgentManager.ts:897`: `this.taskManager.kill(sessionId)` |
| Worktree cleaned up on stop | PASS | `DispatchAgentManager.ts:900-906`: checks and calls `cleanupWorktree` |
| Status transitions to `'cancelled'` | PASS | `DispatchAgentManager.ts:910`: `this.tracker.updateChildStatus(sessionId, 'cancelled')` |
| `task_cancelled` group chat event emitted | PASS | `DispatchAgentManager.ts:913-921`: `messageType: 'task_cancelled'` |
| Already-cancelled returns message (not error) | PASS | `DispatchAgentManager.ts:890-892`: returns message string for cancelled/finished |
| Schema in both `getToolSchemas()` and script | PASS | `DispatchMcpServer.ts:411-430` + `dispatchMcpServerScript.ts` line 122-137 |

### G2.4 `ask_user` Tool

| AC | Status | Evidence |
|----|--------|----------|
| `ask_user` MCP tool available | PASS | `DispatchMcpServer.ts:216-232` case handler + schema at line 431-458 |
| Emits `system` group chat event | PASS | `DispatchAgentManager.ts:937-944`: `messageType: 'system'` |
| Hot injection to running admin | PASS | `DispatchAgentManager.ts:947-959`: checks `parentTask?.status === 'running'` then `sendMessage` |
| Returns immediately (non-blocking) | PASS | `DispatchAgentManager.ts:962-966`: returns string immediately, no await for user response |
| `options` array included in notification | PASS | `DispatchAgentManager.ts:933`: formats options into text |
| Schema in both `getToolSchemas()` and script | PASS | `DispatchMcpServer.ts:431-458` + `dispatchMcpServerScript.ts` line 140-163 |

### Cross-cutting

| AC | Status | Evidence |
|----|--------|----------|
| `bun run lint:fix` -- 0 new errors | PASS | 0 errors in lint output |
| `bunx tsc --noEmit` -- 0 new type errors | PASS | All 4 errors are pre-existing in non-G2 files |
| New files follow conventions | PASS | License headers, path aliases, no `any`, JSDoc on public functions |
| Existing dispatch tests pass | PASS | 96/96 dispatch tests pass |
| No UI/renderer changes | PASS | All changes in `src/process/task/dispatch/` (main process only) |

---

## Minor Deviations from Tech Design

1. **`cascadeKill` is sync, not async**: Tech design shows `async cascadeKill()` but implementation keeps it sync with `cleanupWorktree().catch()`. This is acceptable -- fire-and-forget cleanup avoids blocking the cascade kill. Not a defect.

2. **`handleAskUser` implementation differs slightly from design**: Design suggested using `DispatchNotifier` and `PendingNotification`. Actual implementation uses direct `emitGroupChatEvent` + hot injection via `parentTask.sendMessage`. This is a simplification that achieves the same result without adding a new notification type. Not a defect.

3. **`createWorktree` uses `uuid(8)` instead of `childId`**: Design shows `await createWorktree(childWorkspace, childId)` but implementation uses `uuid(8)` for the sessionId parameter. Both produce valid 8-char prefixes for branch naming. Not a defect.

---

## Verdict

**G2 PASSES all Acceptance Criteria.** Three test mismatches were found and fixed (regex bug in implementation, two spec-first test mismatches). No regression introduced. All pre-existing failures remain unchanged.
