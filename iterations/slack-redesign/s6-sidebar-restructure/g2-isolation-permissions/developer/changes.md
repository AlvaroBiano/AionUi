# G2: Isolation + Permissions + Core Tool Completion - Developer Changes

**Date**: 2026-03-30
**Branch**: feat/dispatch
**Status**: Complete

---

## Files Created

### `src/process/task/dispatch/worktreeManager.ts` (NEW)
- `isGitRepo(dirPath)` — detects git repo via `git rev-parse`
- `createWorktree(mainWorkspace, sessionId)` — creates `.aion-worktrees/aion-wt-{id}` branch
- `mergeWorktree(mainWorkspace, branchName)` — merges with conflict detection + abort
- `cleanupWorktree(mainWorkspace, worktreePath, branchName)` — idempotent remove + branch delete

### `src/process/task/dispatch/permissionPolicy.ts` (NEW)
- `TOOL_CLASSIFICATION` map: Read/Grep/Glob=safe, Edit/Write/NotebookEdit=normal, Bash=dangerous
- `DANGEROUS_BASH_PATTERNS` — 10 regex patterns (rm -rf, git push, sudo, npm publish, etc.)
- `classifyToolCall(toolName, args)` — classifies with Bash sub-classification
- `checkPermission(toolName, args, allowedTools?)` — soft enforcement check
- `getDangerousDescription(command)` — returns human-readable danger reason

---

## Files Modified

### `src/process/task/dispatch/dispatchTypes.ts`
- `StartChildTaskParams` += `allowedTools?: string[]`
- `ChildTaskInfo` += `worktreePath?: string`, `worktreeBranch?: string`, `allowedTools?: string[]`

### `src/process/task/dispatch/DispatchMcpServer.ts`
- `DispatchToolHandler` type += `stopChild()` + `askUser()` methods
- `handleToolCall()` += `stop_child` case + `ask_user` case
- `start_task` handler: parses `allowed_tools` array from args
- `getToolSchemas()` += `allowed_tools` property in `start_task`; added `stop_child` schema; added `ask_user` schema

### `src/process/task/dispatch/dispatchMcpServerScript.ts`
- `TOOL_SCHEMAS` += `allowed_tools` property in `start_task`
- `TOOL_SCHEMAS` += `stop_child` schema
- `TOOL_SCHEMAS` += `ask_user` schema

### `src/process/task/dispatch/DispatchAgentManager.ts`
- Added imports: `createWorktree`, `cleanupWorktree`, `checkPermission`
- `constructor` toolHandler: wired `stopChild` + `askUser` handlers
- `startChildSession()`:
  - Removed G1 "not implemented" warning
  - Added G2.1 worktree creation block with graceful degradation
  - Stores `worktreePath`, `worktreeBranch`, `allowedTools` in childConversation.extra + childInfo
- Added `stopChild(sessionId, reason?)` — kills worker, cleans worktree, updates tracker, emits `task_cancelled`
- Added `handleAskUser(params)` — emits group chat event, hot-injects to running admin, non-blocking return
- Added `handleChildToolCallReport(childId, toolName, args)` — soft permission enforcement via `checkPermission()`
- `dispose()` — passes `this.workspace` to `cascadeKill()`

### `src/process/task/dispatch/DispatchResourceGuard.ts`
- Added imports: `mainWarn`, `cleanupWorktree`
- `cascadeKill(parentId, parentWorkspace?)` — added `parentWorkspace` param; iterates full `ChildTaskInfo` objects; fires `cleanupWorktree()` for children with worktree info (async fire-and-forget with error catch)

---

## Quality Checks

| Check | Result |
|-------|--------|
| `bun run format` | ✅ 0 errors |
| `bun run lint:fix` | ✅ 0 new errors (1325 pre-existing warnings) |
| `bunx tsc --noEmit` | ✅ 0 new errors (4 pre-existing errors unchanged) |

Pre-existing type errors (not introduced by G2):
- `src/process/bridge/conversationBridge.ts:300` — pre-existing
- `src/process/task/dispatch/DispatchAgentManager.ts:1061,1073` — pre-existing (line numbers shifted due to added code)
- `src/renderer/pages/conversation/dispatch/hooks/useTaskPanelTranscript.ts:12` — pre-existing

---

## Key Design Decisions

1. **Worktree graceful degradation**: Non-git workspace logs `mainWarn` and falls back to shared workspace — no hard throw to user.

2. **`cascadeKill` stays synchronous**: Worktree cleanup is fire-and-forget (`.catch()`) to preserve sync call signature used by `dispose()`.

3. **`stopChild` vs `cancelChild`**: Both exist — `cancelChild` is triggered by UI, `stopChild` by MCP admin. They share similar logic but with different callers and event content. Refactoring into a shared `_terminateChild()` is deferred (low-risk duplication).

4. **`handleChildToolCallReport` not yet wired to child message stream**: The method is implemented but the call site (wiring into child worker message events) requires G3+ work on child worker tool-call reporting. The infrastructure is ready.

[DONE]
