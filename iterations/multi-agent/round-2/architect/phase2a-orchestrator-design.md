# Phase 2a — Architect Design: Orchestrator Auto-Start

## Decision Summary

Reuse the existing `DispatchAgentManager` + `WorkerTaskManager` infrastructure. The Orchestrator is just a Gemini agent with dispatch-specific MCP tools, managed by `DispatchAgentManager`.

## Key Design Decisions

### 1. Eager Startup (5-line change)

Add `_workerTaskManager.getOrBuildTask(id)` immediately after `conversationService.createConversation()` in `dispatchBridge.ts`. This pre-warms the worker fork + MCP server so the first user message has no cold-start latency.

```typescript
// Eager Orchestrator startup
try {
  await _workerTaskManager.getOrBuildTask(id);
  mainLog('[DispatchBridge:createGroupChat]', 'Orchestrator agent started for ' + id);
} catch (err) {
  mainWarn('[DispatchBridge:createGroupChat]', 'Orchestrator warm-start failed', err);
}
```

Non-fatal: if warm-start fails, the agent will be lazily created on first `sendMessage`.

### 2. Model Config Resolution

**Problem**: `ProcessConfig.get('gemini.defaultModel')` returns only `{ id, useModel }` — a reference, not the full provider config. Passing this incomplete object causes "OpenAI API key is required" errors.

**Solution**: Two-step resolution:

1. Read `gemini.defaultModel` for the `{ id, useModel }` reference
2. Read `model.config` (IProvider[]) and find the matching provider by `id`
3. Merge: `{ ...provider, useModel: modelRef.useModel }`

**Critical**: Use `ProcessConfig` (direct file I/O), never `ConfigStorage` (IPC bridge) — the latter deadlocks when called from inside a main-process provider handler.

### 3. No IPC Contract Changes

The existing `dispatch.createGroupChat` channel already accepts `{ name?, workspace? }`. No new channels needed for Phase 2a beyond what was already defined.

### 4. Database Migration Strategy

SQLite cannot ALTER CHECK constraints. Must recreate the table:

1. CREATE conversations_new with updated CHECK
2. INSERT...SELECT from old table
3. DROP old table
4. RENAME new → conversations
5. Recreate all indexes

Status CHECK must include all `AgentStatus` values: `'pending' | 'running' | 'idle' | 'finished' | 'failed' | 'cancelled'`

### 5. Architecture Boundaries

- `dispatchBridge.ts` lives in `src/process/bridge/` (main process)
- `DispatchAgentManager` lives in `src/process/task/dispatch/` (main process)
- Renderer components in `src/renderer/pages/conversation/dispatch/`
- Cross-process communication only through IPC bridge channels

## Risk Assessment

| Risk                              | Severity | Mitigation                                              |
| --------------------------------- | -------- | ------------------------------------------------------- |
| Cold-start latency                | Medium   | Eager startup on creation                               |
| Model config incomplete           | High     | Full provider resolution from model.config              |
| DB CHECK constraint blocks INSERT | High     | Migration v18 adds 'dispatch' type                      |
| IPC deadlock in main process      | High     | Use ProcessConfig (file I/O) not ConfigStorage (bridge) |
| Child agent cleanup on crash      | Medium   | DispatchResourceGuard monitors and reclaims             |

## Code Review Findings (Post-Implementation)

### MUST-FIX (resolved)

1. ✅ Migration v18 status CHECK missing idle/failed/cancelled — fixed
2. ✅ cancelChild type assertion without runtime guard — fixed, added typeof check
3. ✅ console.log in renderer production code — removed
4. ✅ Implicit any[] type in getChildTranscript — fixed

### Deferred

- Workspace path validation (security) — defer to Phase 2b
- Migration rollback data loss risk — acceptable for feature branch
