# Phase 5: Robustness, Resume-ability, and Tool Parity

## 1. Gap Analysis

### 1.1 Methodology

Compared the Claude Code (CC) dispatch_system reference capabilities (as described in Phase 2a PRD and inferred from the tool schemas, notifier patterns, and session tracker design) against the current AionUi implementation across all dispatch modules.

### 1.2 Feature Parity Summary

| CC Capability | AionUi Status | Gap |
|---|---|---|
| start_task (create child) | Implemented (Phase 2a) | None |
| read_transcript (wait + format) | Implemented (Phase 2a) | None |
| list_sessions (sorted, limited) | Implemented (Phase 2a) | None |
| send_message (follow-up to child) | Implemented (Phase 2a) | None |
| Hot/cold parent notification | Implemented (Phase 2a) | Cold-path reliability gap (see 1.3.1) |
| Concurrency guard (max 3) | Implemented (Phase 2a) | None |
| Cascade kill on dispose | Implemented (Phase 2a) | None |
| Transcript read releases child | Implemented (Phase 2a) | Premature release risk (see 1.3.2) |
| Session restore on restart | Implemented (Phase 2a) | Incomplete resume (see 1.3.3) |
| Leader agent / model selection | Implemented (Phase 2b + 4) | None |
| User direct message to child | Implemented (Phase 4) | None |
| Child model override | Implemented (Phase 4) | None |
| Settings panel (runtime edit) | Implemented (Phase 4) | None |
| Save teammate as assistant | Implemented (Phase 3) | None |
| Task overview panel | Implemented (Phase 3) | None |

### 1.3 Identified Gaps

#### 1.3.1 Cold Parent Notification Durability

**Current behavior**: When a child completes while the parent dispatcher is idle ("cold"), the notification is queued in memory and persisted to `conversation.extra.pendingNotifications`. On the next user message, `sendMessage` flushes the queue.

**Gap**: If the app crashes or restarts between the child completing and the user sending the next message, `restoreFromDb` in `DispatchNotifier` reads `pendingNotifications` from the DB correctly. However, the notification text is stored as raw strings without child session IDs, making it impossible to deduplicate or correlate them with specific children after restore. If the same child completes, gets restored as idle, and the user sends a message, the dispatcher may receive stale or duplicate notifications.

#### 1.3.2 Premature Child Resource Release

**Current behavior**: `DispatchResourceGuard.releaseChild` is called inside `readTranscript` when the child is no longer running. This kills the worker and removes the child from the tracker.

**Gap**: If the orchestrator calls `read_transcript` on a completed child, then later wants to `send_message` to resume it (e.g., "please also check tests"), the child worker is already killed and the session is removed from the tracker. The `sendMessageToChild` implementation rejects idle/finished children with "Start a new task instead." CC's dispatch system allows resume of idle sessions. AionUi's current "one-shot" model means the orchestrator cannot iteratively refine a completed child's work without starting a brand new task.

#### 1.3.3 Incomplete Session Resume After Restart

**Current behavior**: `DispatchSessionTracker.restoreFromDb` marks all previously running/pending children as `idle` after restart (correct, since worker processes are gone). `DispatchNotifier.restoreFromDb` reads pending notifications.

**Gap**: After restart, the orchestrator agent itself is not automatically restarted. If the user navigates to the group chat and sends a message, the agent is lazily started via `getOrBuildTask`. But the system prompt is rebuilt from scratch, losing the orchestrator's conversation context (it only has the DB message history, not the in-flight tool call state). This means:
- The orchestrator has no memory of which tasks were dispatched in the previous session unless it reads `list_sessions`.
- The system prompt is reconstructed correctly, but the orchestrator's reasoning state is lost.

This is an inherent limitation of process restart, but can be mitigated with a context injection strategy.

#### 1.3.4 MCP Server Script Tool Schema Drift

**Current behavior**: The MCP server script (`dispatchMcpServerScript.ts`) defines its own `TOOL_SCHEMAS` array with only `start_task` and `read_transcript`. The `list_sessions` and `send_message` tools are defined in `DispatchMcpServer.getToolSchemas()` but are NOT present in the script's `TOOL_SCHEMAS`.

**Gap**: When Gemini CLI calls `tools/list` on the MCP server script, it only sees `start_task` and `read_transcript`. The `list_sessions` and `send_message` tools are invisible to the Gemini CLI. Tool calls for these tools still work (the script forwards any `tools/call` to the main process regardless of schema), but the AI model cannot discover them through `tools/list`. This means the orchestrator relies entirely on the system prompt to know about these tools, rather than proper MCP tool discovery.

#### 1.3.5 No Error Recovery / Retry for Child Tasks

**Current behavior**: If a child task fails (worker crash, API error, etc.), it is marked as `failed` and a notification is sent to the parent. There is no automatic retry mechanism.

**Gap**: The orchestrator receives a "Task X failed" notification but has no built-in guidance on how to handle failures. It could start a new task with the same prompt, but this is wasteful and loses the partial context. A structured retry mechanism (or at least retry guidance in the system prompt) would improve robustness for transient failures.

#### 1.3.6 Child Completion Polling Inefficiency

**Current behavior**: `listenForChildCompletion` uses `setInterval` with a 2-second polling interval to check child task status. This is simple but creates N timers for N children, each doing a synchronous `taskManager.getTask()` lookup every 2 seconds.

**Gap**: For 3 concurrent children, this is 1.5 lookups/second. Not a performance problem at current scale, but the architecture doesn't scale and the polling approach means completion notification has up to 2-second latency. An event-driven approach (child emits completion event, parent listens) would be more efficient and responsive.

#### 1.3.7 No Transcript Streaming to Parent

**Current behavior**: The parent orchestrator can only read child transcripts via `read_transcript`, which is a pull-based mechanism with optional waiting. There is no push-based streaming of child output to the parent.

**Gap**: The orchestrator cannot observe child progress in real-time. It must explicitly poll. CC's system has a similar limitation, so this is not a strict parity gap, but it affects orchestration quality when the parent needs to make routing decisions based on partial child output.

---

## 2. Phase 5 Feature List

Based on the gap analysis, Phase 5 focuses on **robustness, resume-ability, and tool completeness** rather than new user-facing features.

### Priority Order

| ID | Feature | Priority | Complexity | Addresses Gap |
|---|---|---|---|---|
| F-5.1 | MCP Server Script Tool Schema Sync | P0 (Critical) | Low | 1.3.4 |
| F-5.2 | Child Session Resume (idle -> running) | P0 (Critical) | Medium | 1.3.2 |
| F-5.3 | Post-Restart Context Injection | P1 (High) | Medium | 1.3.3 |
| F-5.4 | Notification Deduplication & Correlation | P1 (High) | Low | 1.3.1 |
| F-5.5 | Failure Retry Guidance in System Prompt | P2 (Medium) | Low | 1.3.5 |
| F-5.6 | Event-Driven Child Completion | P2 (Medium) | Medium | 1.3.6 |

---

### F-5.1: MCP Server Script Tool Schema Sync

#### Scope

Synchronize the `TOOL_SCHEMAS` array in `dispatchMcpServerScript.ts` with the authoritative schema defined in `DispatchMcpServer.getToolSchemas()`. Currently the script only exposes `start_task` and `read_transcript` to the `tools/list` MCP method, while `list_sessions` and `send_message` are missing.

#### Changes

**File**: `src/process/task/dispatch/dispatchMcpServerScript.ts`

Add `list_sessions` and `send_message` to the `TOOL_SCHEMAS` array, matching the schemas in `DispatchMcpServer.getToolSchemas()`.

#### Rationale

This is a correctness bug. The AI model should discover all available tools via `tools/list`. Currently, the orchestrator only knows about `list_sessions` and `send_message` from the system prompt text, not from proper MCP tool registration. Some models may ignore tools not in the schema.

#### Risk

Low. Pure additive change to a static array. No behavioral change for models that already use the tools via prompt guidance.

---

### F-5.2: Child Session Resume (idle -> running)

#### Scope

Allow the orchestrator (and users via TaskPanel) to send messages to idle/finished child sessions, restarting the child agent worker if necessary. This replaces the current "reject with error" behavior.

#### Current Behavior

`DispatchAgentManager.sendMessageToChild` throws an error for `idle` and `finished` status:
```
Session "X" has completed (status: idle). Start a new task instead.
```

`DispatchResourceGuard.releaseChild` kills the worker and removes the child from the tracker after `readTranscript` is called on a non-running child.

#### Proposed Behavior

1. **Do not auto-release children on transcript read.** Remove the `releaseChild` call from `readTranscript`. Instead, children remain tracked until:
   - Explicitly cancelled by user
   - Parent dispatcher is disposed (cascade kill)
   - A new cleanup mechanism runs (see below)

2. **Allow send_message to idle children.** When `sendMessageToChild` is called on an `idle` or `finished` child:
   - Check if the worker process still exists via `taskManager.getTask(sessionId)`
   - If the worker is gone, re-create it via `taskManager.getOrBuildTask(sessionId, { ... })`
   - Re-attach the child completion listener
   - Send the message and update status to `running`

3. **Lazy cleanup.** Add a `cleanupStaleChildren` method to `DispatchResourceGuard` that is called when the concurrency limit is hit. It releases the oldest idle children (by `lastActivityAt`) that have had their transcripts read, freeing slots for new tasks.

#### Changes

| File | Change |
|---|---|
| `DispatchAgentManager.ts` | `sendMessageToChild`: remove rejection of idle/finished; add worker re-creation logic |
| `DispatchAgentManager.ts` | `readTranscript`: remove `releaseChild` call |
| `DispatchResourceGuard.ts` | Add `cleanupStaleChildren(parentId, keepCount)` method |
| `DispatchResourceGuard.ts` | `checkConcurrencyLimit`: call `cleanupStaleChildren` before rejecting |
| `dispatchPrompt.ts` | Update system prompt: `send_message` works on idle tasks too |
| `DispatchMcpServer.ts` | Update `send_message` tool description |
| `dispatchMcpServerScript.ts` | Update `send_message` schema description (after F-5.1) |

#### Risk

Medium. Re-creating a worker for an idle child means the child agent loses its in-memory state but retains DB message history. The child will see the full conversation context from DB when it restarts, so continuity should be preserved. Edge case: if the child's original `presetRules` came from a `TemporaryTeammateConfig`, they are stored in `conversation.extra.presetRules` and will be picked up by `getOrBuildTask`.

---

### F-5.3: Post-Restart Context Injection

#### Scope

When the orchestrator agent is restarted (app restart or lazy re-creation), inject a context summary so the orchestrator knows what happened in the previous session.

#### Proposed Behavior

In `DispatchAgentManager.createBootstrap`, after restoring tracker and notifier state from DB:

1. If the tracker has any children for this parent (i.e., this is a resumed session), build a context injection message:

```
[System Context — Session Resumed]
This dispatch session has been resumed after a restart. Here is the current state of your child tasks:

Sessions (3):
  - abc123 "Code Review" (idle, is_child: true)
  - def456 "Test Writer" (idle, is_child: true)
  - ghi789 "Doc Generator" (failed, is_child: true)

All previously running tasks have been paused (status: idle). You can:
- Use read_transcript to review their results
- Use send_message to resume an idle task with new instructions
- Use start_task to create new tasks

Pending notifications from before restart:
- Task "Code Review" completed.
```

2. Store this context as a pending system notification in the notifier, so it is injected on the next user message (same cold-parent path as child completion notifications).

#### Changes

| File | Change |
|---|---|
| `DispatchAgentManager.ts` | `createBootstrap`: after `restoreFromDb`, build and enqueue context injection if children exist |
| `DispatchNotifier.ts` | No change needed (reuse `enqueueNotification`) |

#### Risk

Low. The context injection is informational and uses the existing notification mechanism. The orchestrator may not perfectly reconstruct its reasoning, but having the task list and status is far better than starting blind.

---

### F-5.4: Notification Deduplication & Correlation

#### Scope

Improve the pending notification format to include structured metadata (child session ID, result type) so that notifications can be deduplicated and correlated after restore.

#### Current Format

Notifications are stored as plain strings:
```
["Task \"Code Review\" completed. Use read_transcript with session_id \"abc123\" to see the outcome."]
```

#### Proposed Format

Store notifications as structured objects:

```typescript
type PendingNotification = {
  childSessionId: string;
  childTitle: string;
  result: 'completed' | 'failed' | 'cancelled';
  message: string;
  timestamp: number;
};
```

Serialize to JSON for DB storage. On restore, deduplicate by `childSessionId` (keep latest). On flush, format into the same text output as before.

#### Changes

| File | Change |
|---|---|
| `DispatchNotifier.ts` | Change `pendingQueues` from `Map<string, string[]>` to `Map<string, PendingNotification[]>` |
| `DispatchNotifier.ts` | `enqueueNotification`: accept structured params, deduplicate by childSessionId |
| `DispatchNotifier.ts` | `flushPending`: format `PendingNotification[]` into text |
| `DispatchNotifier.ts` | `restoreFromDb` / `persistPendingQueue`: handle JSON serialization |
| `dispatchTypes.ts` | Add `PendingNotification` type |

#### Risk

Low. Internal data format change. The output to the orchestrator remains the same text format. Requires a migration-safe approach: `restoreFromDb` should handle both old string[] format and new object[] format for backward compatibility.

---

### F-5.5: Failure Retry Guidance in System Prompt

#### Scope

Add retry guidance to the orchestrator system prompt so the AI knows how to handle child task failures gracefully.

#### Changes

**File**: `src/process/task/dispatch/dispatchPrompt.ts`

Add a new section to the system prompt:

```
## Error Handling
- If a child task fails, read its transcript to understand the error.
- For transient errors (API timeout, rate limit), retry by starting a new task with the same prompt.
- For persistent errors (invalid instructions, unsupported operation), adjust the prompt before retrying.
- Do not retry more than 2 times for the same task. Inform the user if a task repeatedly fails.
- When reporting failures to the user, include a brief explanation and suggest next steps.
```

#### Risk

None. Prompt-only change. No code behavior changes.

---

### F-5.6: Event-Driven Child Completion

#### Scope

Replace the polling-based child completion detection (`setInterval` every 2 seconds) with an event-driven approach where the child agent emits a completion event that the parent listens for.

#### Proposed Approach

1. Define a dispatch event channel on `IpcAgentEventEmitter` or use the existing `gemini.message` event with a `finish` type.

2. In `DispatchAgentManager.startChildSession`, instead of `listenForChildCompletion` with `setInterval`:
   - Subscribe to the child agent's event emitter for `finish` events
   - On `finish`, determine final status (idle/failed) and call the same completion logic

3. Keep the polling as a fallback safety net with a longer interval (10 seconds) in case events are missed.

#### Changes

| File | Change |
|---|---|
| `DispatchAgentManager.ts` | `listenForChildCompletion`: replace primary polling with event listener; keep polling as 10s fallback |
| `IpcAgentEventEmitter.ts` or `BaseAgentManager.ts` | Ensure child finish events are accessible to the parent |

#### Risk

Medium. Requires understanding the event propagation path between child agent and parent. The child agent's `gemini.message` events are emitted on the child's own `IpcAgentEventEmitter`, which the parent doesn't currently subscribe to. Need to either:
- Pass the child's event emitter reference to the parent
- Use a shared event bus
- Have the child emit on a global channel with its session ID

The polling fallback ensures no behavior change if the event path has issues.

---

## 3. Out of Scope (Phase 6+)

| Feature | Rationale |
|---|---|
| Single-chat upgrade to dispatch mode | Architecture risk unchanged from Phase 4 assessment. Recommend "new dispatch + context import" approach if pursued. |
| Multi-level child nesting (child spawns grandchild) | Requires recursive dispatch architecture and tree-state management. Current star topology is sufficient for most use cases. |
| Cross-child direct communication | Requires message bus / pub-sub architecture. Current dispatcher-mediated communication is adequate. |
| Real-time transcript streaming to parent | Would require push-based child output forwarding. Pull-based `read_transcript` with wait is sufficient. |
| Per-child MCP tool configuration | Would need per-agent MCP server management. All children currently share the same tool access. |
| Seed message templates / presets | UX enhancement, not a robustness concern. |
| Concurrent task limit configurable by user | Currently hardcoded to 3. Could be exposed in GroupChatSettingsDrawer. |

---

## 4. Success Criteria

### SC-5.1: MCP Server Script Tool Schema Sync

- [ ] `tools/list` MCP response includes all 4 tools: `start_task`, `read_transcript`, `list_sessions`, `send_message`
- [ ] Tool schemas in `dispatchMcpServerScript.ts` match `DispatchMcpServer.getToolSchemas()` exactly
- [ ] Existing orchestrator behavior unchanged (regression check)

### SC-5.2: Child Session Resume

- [ ] Orchestrator can call `send_message` on an idle child and the child responds
- [ ] Worker is re-created transparently if it was previously killed
- [ ] Child retains full conversation context from DB after worker re-creation
- [ ] User can send messages to idle children from TaskPanel SendBox
- [ ] Concurrency limit still enforced: stale idle children are cleaned up when limit is hit
- [ ] Cancelled and failed children cannot be resumed (unchanged)

### SC-5.3: Post-Restart Context Injection

- [ ] After app restart, navigating to a group chat and sending a message results in the orchestrator receiving a context summary
- [ ] Context summary includes child session IDs, titles, statuses
- [ ] Context summary includes any pending notifications from before restart
- [ ] Orchestrator can successfully call `list_sessions` and `read_transcript` after restart

### SC-5.4: Notification Deduplication

- [ ] If the same child completes twice (edge case), only one notification is stored
- [ ] Notifications restored from DB after restart are correctly deduplicated
- [ ] Old-format string[] notifications in existing databases are handled gracefully (backward compatibility)
- [ ] Flushed notification text format is unchanged from the orchestrator's perspective

### SC-5.5: Failure Retry Guidance

- [ ] System prompt includes error handling section
- [ ] Orchestrator demonstrates retry behavior when a child task fails (manual QA)
- [ ] No regression in orchestrator's normal task delegation behavior

### SC-5.6: Event-Driven Child Completion

- [ ] Child completion is detected within 500ms (event-driven path)
- [ ] Polling fallback still works if events are missed (10s interval)
- [ ] No orphaned timers: all intervals are cleared on child completion or parent dispose
- [ ] Memory footprint unchanged or reduced compared to 2s polling

---

## 5. Technical Constraints

| ID | Constraint | Detail |
|---|---|---|
| TC-1 | Three-process isolation | All config read/write in main process via ProcessConfig. No IPC bridge calls inside provider handlers. |
| TC-2 | Backward compatibility | F-5.4 must handle both old string[] and new PendingNotification[] formats in DB. |
| TC-3 | No new IPC channels | All changes are internal to the main process dispatch modules. No renderer changes except F-5.2 TaskPanel SendBox enabling for idle children. |
| TC-4 | Directory limit | `src/process/task/dispatch/` has 9 files. No new files needed for Phase 5 (all changes modify existing files). |
| TC-5 | Worker re-creation safety | F-5.2 must ensure `getOrBuildTask` correctly restores child agent config (model, presetRules, workspace) from conversation extra. |

---

## 6. Risk Assessment

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | F-5.2 worker re-creation loses child agent context | Medium | High | Child conversation stores full message history in DB; `getOrBuildTask` reads `extra.presetRules` and `extra.workspace`. Verify re-created agent sees prior messages. |
| R-2 | F-5.3 context injection confuses orchestrator | Low | Medium | Context is clearly labeled as "[System Context -- Session Resumed]" and uses structured format. Test with multiple orchestrator models. |
| R-3 | F-5.4 backward compatibility failure | Low | Medium | `restoreFromDb` tries JSON.parse first; if it fails, falls back to treating entries as plain strings. |
| R-4 | F-5.6 event subscription creates memory leaks | Medium | Low | Use `once` listeners or explicit cleanup in `dispose()`. Polling fallback ensures correctness even if events leak. |
| R-5 | F-5.1 adding tools to schema changes orchestrator behavior | Low | Low | The orchestrator already knows about these tools from the system prompt. Adding them to `tools/list` may cause it to use them more reliably, which is the desired outcome. |

---

## Appendix A: File Change Summary

| File | Features | Change Type |
|---|---|---|
| `src/process/task/dispatch/dispatchMcpServerScript.ts` | F-5.1 | Add `list_sessions` and `send_message` to TOOL_SCHEMAS |
| `src/process/task/dispatch/DispatchMcpServer.ts` | F-5.2 | Update `send_message` tool description |
| `src/process/task/dispatch/DispatchAgentManager.ts` | F-5.2, F-5.3, F-5.6 | Resume idle children, context injection, event-driven completion |
| `src/process/task/dispatch/DispatchResourceGuard.ts` | F-5.2 | Add `cleanupStaleChildren`, remove auto-release from transcript read |
| `src/process/task/dispatch/DispatchNotifier.ts` | F-5.4 | Structured notifications, deduplication |
| `src/process/task/dispatch/dispatchTypes.ts` | F-5.4 | Add `PendingNotification` type |
| `src/process/task/dispatch/dispatchPrompt.ts` | F-5.2, F-5.5 | Update send_message guidance, add error handling section |
| `src/renderer/pages/conversation/dispatch/TaskPanel.tsx` | F-5.2 | Enable SendBox for idle children (remove status gate) |
