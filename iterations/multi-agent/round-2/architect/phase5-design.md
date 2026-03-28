# Phase 5 Architecture Design: Robustness, Resume-ability, and Tool Parity

## 1. Design Decisions

### DD-1: Tool Schema Gap (P0) — F-5.1

**Problem**: `dispatchMcpServerScript.ts` defines `TOOL_SCHEMAS` with only `start_task` and `read_transcript`. The `list_sessions` and `send_message` schemas exist only in `DispatchMcpServer.getToolSchemas()`. When the MCP client calls `tools/list`, it sees only 2 of 4 tools.

#### Option A: Duplicate schemas into `dispatchMcpServerScript.ts`

- **For**: Minimal change (add 2 entries to a static array). No architectural refactoring. The script runs as a standalone child process and cannot import from the main process — it has no access to `DispatchMcpServer.getToolSchemas()` at runtime.
- **Against**: Two sources of truth. Future tool changes require updating both files. Already happened once (Phase 2a added `list_sessions`/`send_message` to `DispatchMcpServer` but missed the script).

#### Option B: Generate script schemas from `DispatchMcpServer.getToolSchemas()` at build time

- **For**: Single source of truth. Build step extracts schemas from `getToolSchemas()` and writes them into the script or a shared JSON file.
- **Against**: Adds build complexity. The script is a standalone process that communicates via stdio — it cannot dynamically import main-process modules. Would need a codegen step or a JSON file that both modules read.

#### Option C: Have the script request schemas from the main process via IPC at startup

- **For**: True runtime single source of truth. Script sends `{ type: 'get_schemas' }` via IPC on startup, main process responds with the canonical schema list.
- **Against**: Adds startup latency. Creates a chicken-and-egg issue: the MCP client may call `tools/list` before the IPC round-trip completes. Adds error handling complexity for IPC failures.

**Decision: Option A** (duplicate schemas).

**Rationale**: The script is a separate process with no module-level dependency on the main process. Options B and C add disproportionate complexity for a 4-tool schema. The real mitigation is a code review checklist item: "When adding/modifying dispatch tools, update both `DispatchMcpServer.getToolSchemas()` and `TOOL_SCHEMAS` in `dispatchMcpServerScript.ts`." A JSDoc cross-reference comment in both files will make this explicit.

**Risk**: Low. The schema strings are static and change infrequently. The cross-reference comments reduce the odds of future drift.

---

### DD-2: Child Session Resume (P0) — F-5.2

**Problem**: When `readTranscript` is called on a non-running child, `DispatchResourceGuard.releaseChild` kills the worker and removes the child from the tracker. Subsequent `sendMessageToChild` rejects idle children with an error. The orchestrator cannot iteratively refine a completed child's work.

#### Option A: Remove auto-release from `readTranscript`, allow `sendMessageToChild` to re-create workers

- **For**: Matches CC reference behavior (idle sessions are resumable). Clean separation: `readTranscript` reads, `sendMessageToChild` resumes. Worker re-creation via `getOrBuildTask` already reads conversation history from DB, so the child agent sees full context.
- **Against**: Workers for idle children stay alive longer (but see lazy cleanup below). Re-created workers have no in-memory state from the previous run — only DB message history. Edge case: if `getOrBuildTask` uses different config than the original creation.

#### Option B: Add a dedicated `resume_task` tool separate from `send_message`

- **For**: Explicit intent: `resume_task` means "bring back a dead worker", `send_message` means "talk to an active one". The orchestrator can distinguish between resume and follow-up.
- **Against**: Adds tool count (5 tools). The orchestrator must learn when to use `resume_task` vs `send_message`. In practice, the distinction is implementation detail — the AI just wants to "send a message to this session." CC's reference does not have a separate resume tool; `send_message` works on idle sessions.

**Decision: Option A** (remove auto-release, expand `sendMessageToChild`).

**Rationale**: From the orchestrator's perspective, sending a message to an idle child and sending to a running child are the same intent. The implementation detail of worker re-creation should be transparent. This matches CC's design where `send_message` works regardless of session state (except terminal states: cancelled/failed).

**Key implementation details**:

1. **`readTranscript`**: Remove the `this.resourceGuard.releaseChild(options.sessionId)` call at line 528 of `DispatchAgentManager.ts`. Children remain tracked after transcript read.

2. **`sendMessageToChild`**: Replace the idle/finished rejection (lines 625-629) with:
   - Check if worker exists via `this.taskManager.getTask(params.sessionId)`
   - If worker is gone, re-create via `this.taskManager.getOrBuildTask(sessionId, { yoloMode: true, dispatchSessionType: 'dispatch_child', parentSessionId: this.conversation_id })`
   - Re-attach the completion listener via `this.listenForChildCompletion()`
   - Send the message normally

3. **Lazy cleanup**: Add `cleanupStaleChildren()` to `DispatchResourceGuard`. Called when concurrency limit is hit in `checkConcurrencyLimit`. Finds the oldest idle children whose transcripts have been read and releases them to free slots. This prevents idle children from blocking new task creation.

4. **Terminal state behavior**: `cancelled` and `failed` children remain non-resumable. The orchestrator should start a new task instead. This is intentional — cancelled means user-initiated abort, failed means an error state that may recur.

**Risk**: Medium. The main risk is `getOrBuildTask` not correctly restoring child agent config. Mitigation: child conversations store `extra.presetRules`, `extra.workspace`, `extra.yoloMode`, and `extra.childModelName` in the DB. Verify that `getOrBuildTask` reads these fields when building the child agent.

---

### DD-3: Post-Restart Context Injection (P1) — F-5.3

**Problem**: After app restart, the orchestrator agent is lazily re-created with a fresh system prompt but no knowledge of previously dispatched tasks. It must call `list_sessions` to discover them, but has no prompt to do so.

#### Option A: Inject context summary as a pending notification on bootstrap

- **For**: Uses the existing notification mechanism (`DispatchNotifier.enqueueNotification`). The context is delivered on the next user message, same as cold-parent child completion notifications. No new infrastructure needed.
- **Against**: The context is only delivered when the user sends a message. If the user navigates to the group chat but doesn't send a message (just looks at history), the orchestrator remains unaware. However, this is acceptable because the orchestrator only acts on user messages anyway.

#### Option B: Inject context as an automatic first message on bootstrap

- **For**: The orchestrator sees the context immediately when the agent starts, before any user message. Guarantees the orchestrator knows the state.
- **Against**: Requires calling `super.sendMessage()` during bootstrap, which triggers a full agent turn. This agent turn has no user prompt, so the orchestrator may generate unsolicited output ("I see we have 3 previous tasks...") that clutters the chat. Also, calling `sendMessage` during bootstrap creates a race condition if the user sends a message at the same time.

#### Option C: Inject context into the system prompt itself (not as a message)

- **For**: The orchestrator sees the context in its system prompt, before any conversation turn. No timing issues.
- **Against**: The system prompt is built before `restoreFromDb` completes (in `createBootstrap`, `buildDispatchSystemPrompt` is called at line 156, but `tracker.restoreFromDb` happens at line 178). Would need to restructure bootstrap ordering. Also, the system prompt is static — it doesn't change after agent start. If children change status after the system prompt is built but before the user sends a message, the context is stale.

**Decision: Option A** (inject as pending notification on bootstrap).

**Rationale**: The notification path is battle-tested and handles the exact scenario: "orchestrator needs to learn something before processing the next user message." The implementation is ~15 lines of code in `createBootstrap`, using existing `notifier.enqueueNotification`. The stale-by-navigation concern is a non-issue because the orchestrator only acts when addressed.

**Implementation location**: In `DispatchAgentManager.createBootstrap()`, after both `tracker.restoreFromDb()` (line 178) and `notifier.restoreFromDb()` (line 183), check if the tracker has children. If yes, build the context summary string and call `this.notifier.enqueueNotification(this.conversation_id, contextSummary)` — but note that `enqueueNotification` is currently private. It needs to be exposed or the context injection logic placed inside `DispatchNotifier` itself.

**Refined approach**: Add a new method `DispatchNotifier.injectResumeContext(parentId: string, children: ChildTaskInfo[])` that builds the formatted context string and enqueues it. Call this from `createBootstrap` after restore. This keeps the formatting logic in the notifier where it belongs.

**Risk**: Low. The context injection is additive and informational. If it fails, the orchestrator still works — it just doesn't know about previous tasks until it calls `list_sessions`.

---

### DD-4: Notification Deduplication (P1) — F-5.4

**Problem**: Pending notifications are stored as plain strings without child session IDs. After restore, identical notifications cannot be deduplicated or correlated.

#### Option A: Structured `PendingNotification` objects with session ID deduplication

- **For**: Clean separation of data (session ID, result type) from presentation (formatted message string). Deduplication by `childSessionId` is O(1) lookup. Backward-compatible migration: try `JSON.parse`, fall back to treating as plain string.
- **Against**: Changes the internal data format of `pendingQueues`. Requires updating `enqueueNotification`, `flushPending`, `restoreFromDb`, and `persistPendingQueue`. The serialized format in `conversation.extra.pendingNotifications` changes from `string[]` to `PendingNotification[]`.

#### Option B: Use a `Set<string>` keyed by session ID to track "already notified" children

- **For**: Simpler: keep notifications as strings, add a separate `notifiedChildren: Set<string>` that prevents re-enqueue. No format migration needed.
- **Against**: The Set is in-memory only. After restart, the Set is lost and deduplication doesn't work — which is the exact scenario we're trying to fix. Would need to persist the Set too, which is effectively the same work as Option A but with two separate stores.

**Decision: Option A** (structured `PendingNotification` objects).

**Rationale**: The structured format solves both deduplication and correlation in one change. The backward-compatible migration (try JSON.parse, fall back to string) is a well-understood pattern. The `PendingNotification` type also enables the context injection feature (DD-3) to produce richer context summaries.

**Implementation details**:

1. Add `PendingNotification` type to `dispatchTypes.ts`:
   ```typescript
   export type PendingNotification = {
     childSessionId: string;
     childTitle: string;
     result: 'completed' | 'failed' | 'cancelled' | 'context_resume';
     message: string;
     timestamp: number;
   };
   ```

2. Change `DispatchNotifier.pendingQueues` from `Map<string, string[]>` to `Map<string, PendingNotification[]>`.

3. `enqueueNotification` signature changes to accept structured params. Before adding, check if a notification with the same `childSessionId` already exists; if so, replace it (keep latest).

4. `flushPending` formats `PendingNotification[]` into the same text output format (no behavior change from orchestrator's perspective).

5. `restoreFromDb` tries `JSON.parse` on each entry. If it produces an object with `childSessionId`, treat as `PendingNotification`. If not (plain string from old format), wrap in a synthetic `PendingNotification` with `childSessionId: 'legacy_' + index`.

6. `persistPendingQueue` serializes `PendingNotification[]` as JSON.

**Risk**: Low. The backward-compatible migration handles old databases. The output format to the orchestrator is unchanged.

---

### DD-5: Event-Driven Child Completion (P2) — F-5.6

**Problem**: `listenForChildCompletion` uses `setInterval(2000)` polling. This adds up to 2 seconds of latency and creates N timers for N children.

#### Option A: Subscribe to child agent's `gemini.message` events for `finish` type

- **For**: Near-instant completion detection. No polling needed for the happy path. The child agent already emits `gemini.message` with `type: 'finish'` when it completes (visible in `DispatchAgentManager.init()` line 241 — the parent listens for its own finish events).
- **Against**: The parent dispatcher's `init()` listens on `this.on('gemini.message', ...)` — its own event emitter. The child's events go to the child's own `IpcAgentEventEmitter`. The parent does not have a reference to the child's event emitter. Getting it requires either: (a) `IAgentManager` exposes an `on()` method, (b) a shared event bus, or (c) the child task reference from `getOrBuildTask` is cast to access internal events.

#### Option B: Use the `IAgentManager.status` property with optimized polling

- **For**: No architectural changes. Just reduce polling frequency (e.g., adaptive: 500ms for first 10s, then 2s, then 10s). The `status` property is already on `IAgentManager` (line 17 of `IAgentManager.ts`).
- **Against**: Still polling-based. Latency floor is the polling interval. But for P2 priority, this may be acceptable.

#### Option C: Hybrid — event-driven primary, polling fallback

- **For**: Best of both worlds. Events give instant detection; polling catches edge cases where events are missed. The fallback polling can use a longer interval (10s) since it's only a safety net.
- **Against**: More complex than either pure approach. Requires solving the event subscription problem from Option A AND keeping the polling from Option B.

**Decision: Option B** (optimized polling) for Phase 5, with **Option C** (hybrid) deferred to Phase 6.

**Rationale**: The event-driven approach (Options A/C) requires changes to `IAgentManager` interface or a shared event bus — both cross-cutting concerns that affect more than just the dispatch module. For a P2 item, the ROI doesn't justify the risk. Optimized polling achieves 80% of the benefit (500ms initial latency vs 2s) with zero architectural risk.

**Implementation**: Replace the fixed `setInterval(2000)` in `listenForChildCompletion` with an adaptive interval:
- First 30 seconds: poll every 500ms (fast detection for quick tasks)
- 30s to 5min: poll every 2s (current behavior)
- Beyond 5min: poll every 5s (long-running tasks don't need sub-second detection)

Additionally, when the parent dispatcher calls `readTranscript` with `maxWaitSeconds > 0`, the `waitForChildIdle` method already polls at 1s intervals. This provides a secondary fast-detection path for the "dispatch then immediately read" pattern.

**Risk**: None. Pure interval tuning, no behavioral change.

---

## 2. File Change List

### F-5.1: MCP Server Script Tool Schema Sync (P0)

| File | Change |
|---|---|
| `src/process/task/dispatch/dispatchMcpServerScript.ts` | Add `list_sessions` and `send_message` tool schemas to `TOOL_SCHEMAS` array (after line 59). Add JSDoc cross-reference comment pointing to `DispatchMcpServer.getToolSchemas()`. |
| `src/process/task/dispatch/DispatchMcpServer.ts` | Add JSDoc cross-reference comment on `getToolSchemas()` pointing to `dispatchMcpServerScript.ts`. |

**Lines of code**: ~45 added (schema entries + comments).

### F-5.2: Child Session Resume (P0)

| File | Change |
|---|---|
| `src/process/task/dispatch/DispatchAgentManager.ts` | **readTranscript**: Remove `this.resourceGuard.releaseChild()` call (line 528). **sendMessageToChild**: Replace idle/finished rejection (lines 625-629) with worker re-creation logic — call `getOrBuildTask`, re-attach completion listener, then `sendMessage`. Add `transcriptReadChildren: Set<string>` field to track which children have had transcripts read (for lazy cleanup). |
| `src/process/task/dispatch/DispatchResourceGuard.ts` | Add `cleanupStaleChildren(parentId: string, transcriptReadSet: Set<string>): number` method. In `checkConcurrencyLimit`, before returning the limit error, call `cleanupStaleChildren` to free slots from the oldest idle children whose transcripts have been read. |
| `src/process/task/dispatch/dispatchPrompt.ts` | Update `send_message` description in the Available Tools section: change "Only works on running tasks" to "Works on running and idle tasks. Idle tasks will be automatically resumed." |
| `src/process/task/dispatch/DispatchMcpServer.ts` | Update `send_message` tool description in `getToolSchemas()`: mention that it works on idle sessions. |
| `src/process/task/dispatch/dispatchMcpServerScript.ts` | Update `send_message` schema description (matches `DispatchMcpServer`). |

**Lines of code**: ~60 modified/added.

### F-5.3: Post-Restart Context Injection (P1)

| File | Change |
|---|---|
| `src/process/task/dispatch/DispatchNotifier.ts` | Add `injectResumeContext(parentId: string, children: ChildTaskInfo[], existingPending: boolean): void` public method. Builds a `[System Context -- Session Resumed]` formatted string with child session list and status, then enqueues it via the internal `enqueueNotification` path (which will need to accept `PendingNotification` objects after F-5.4; if F-5.4 is done first, use structured format; if not, use plain string). |
| `src/process/task/dispatch/DispatchAgentManager.ts` | In `createBootstrap`, after `tracker.restoreFromDb` and `notifier.restoreFromDb`, add: `const children = this.tracker.getChildren(this.conversation_id); if (children.length > 0) { this.notifier.injectResumeContext(this.conversation_id, children, this.notifier.hasPending(this.conversation_id)); }` |

**Lines of code**: ~35 added.

### F-5.4: Notification Deduplication & Correlation (P1)

| File | Change |
|---|---|
| `src/process/task/dispatch/dispatchTypes.ts` | Add `PendingNotification` type definition. |
| `src/process/task/dispatch/DispatchNotifier.ts` | Change `pendingQueues` type from `Map<string, string[]>` to `Map<string, PendingNotification[]>`. Update `enqueueNotification` to accept `PendingNotification` params and deduplicate by `childSessionId`. Update `flushPending` to format `PendingNotification[]` into text. Update `restoreFromDb` to handle both old `string[]` and new `PendingNotification[]` formats. Update `persistPendingQueue` for JSON serialization. Update `handleChildCompletion` to construct `PendingNotification` objects instead of plain strings. |

**Lines of code**: ~80 modified/added.

### F-5.5: Failure Retry Guidance (P2)

| File | Change |
|---|---|
| `src/process/task/dispatch/dispatchPrompt.ts` | Add `## Error Handling` section to the system prompt after the Constraints section. Content as specified in PRD. |

**Lines of code**: ~10 added.

### F-5.6: Event-Driven Child Completion (P2) — Optimized Polling

| File | Change |
|---|---|
| `src/process/task/dispatch/DispatchAgentManager.ts` | Replace `setInterval(2000)` in `listenForChildCompletion` with adaptive interval logic. Track elapsed time; use 500ms for first 30s, 2s for 30s-5min, 5s beyond 5min. Use `setTimeout` chain instead of `setInterval` for adaptive timing. |

**Lines of code**: ~25 modified.

---

## 3. Implementation Order

The ordering is driven by dependency chains and priority.

### Step 1: F-5.1 — Tool Schema Sync (P0, no dependencies)

Add `list_sessions` and `send_message` schemas to `dispatchMcpServerScript.ts`. Add cross-reference JSDoc comments in both files. This is the simplest change and immediately fixes the most critical correctness bug.

**Verification**: Start a group chat with the Gemini CLI, inspect `tools/list` response to confirm all 4 tools appear.

### Step 2: F-5.4 — Notification Deduplication (P1, foundation for F-5.3)

Implement structured `PendingNotification` format in `DispatchNotifier`. This must come before F-5.3 because the context injection feature (F-5.3) produces a `PendingNotification` with `result: 'context_resume'`.

**Verification**: Create a group chat, start a child task, close the app before reading the transcript, reopen. Verify the notification is restored correctly and no duplicates appear.

### Step 3: F-5.3 — Post-Restart Context Injection (P1, depends on F-5.4)

Implement `injectResumeContext` in `DispatchNotifier` and call it from `createBootstrap`. Uses the `PendingNotification` format from Step 2.

**Verification**: Create a group chat with 2 children, close the app, reopen, send a message. Verify the orchestrator receives the context summary with child session IDs and statuses.

### Step 4: F-5.2 — Child Session Resume (P0, largest change)

This is P0 but placed after Steps 2-3 because it's the most complex change and benefits from having F-5.4's structured notifications in place (the re-attached completion listener produces notifications). The implementation touches 4 files and changes core control flow.

**Verification**:
1. Start a child task, wait for completion, call `read_transcript`, then call `send_message` on the same session. Verify the child responds.
2. Start 3 children, let all complete, start a 4th. Verify that `cleanupStaleChildren` releases an idle child to make room.
3. Verify cancelled/failed children still reject `send_message`.

### Step 5: F-5.5 — Failure Retry Guidance (P2, independent)

Add error handling section to system prompt. No code dependencies.

**Verification**: Start a child task that will fail (e.g., invalid workspace), verify the orchestrator reads the transcript and attempts a retry.

### Step 6: F-5.6 — Optimized Polling (P2, independent)

Replace fixed-interval polling with adaptive timing. No code dependencies.

**Verification**: Start a quick child task (echo-like), measure time between child completion and parent notification. Should be under 1 second for tasks completing within 30 seconds.

---

## 4. Risk Assessment

### R-1: Worker Re-creation Config Mismatch (F-5.2, Probability: Medium, Impact: High)

**Risk**: When `getOrBuildTask` re-creates a child worker for an idle session, it reads config from the conversation's `extra` field. If the conversation was created with config that `getOrBuildTask` doesn't read (e.g., a future field), the re-created worker may behave differently.

**Mitigation**: Before implementing F-5.2, audit `getOrBuildTask`'s code path for dispatch children. Verify it reads: `extra.workspace`, `extra.presetRules`, `extra.yoloMode`, `extra.childModelName`, `extra.teammateConfig`. Add integration test that creates a child with a model override, lets it complete, resumes it, and verifies the same model is used.

### R-2: Notification Format Migration (F-5.4, Probability: Low, Impact: Medium)

**Risk**: Existing databases have `pendingNotifications` as `string[]`. The new code expects `PendingNotification[]`. If the migration code in `restoreFromDb` has a bug, pending notifications from before the update are lost.

**Mitigation**: The migration code uses a simple heuristic: `JSON.parse` each entry; if it has `childSessionId`, treat as `PendingNotification`; otherwise, wrap in a legacy object. Write a unit test with mixed old/new format arrays.

### R-3: Context Injection Confuses Orchestrator (F-5.3, Probability: Low, Impact: Medium)

**Risk**: The `[System Context -- Session Resumed]` message may confuse some orchestrator models into thinking it's a user request rather than system information.

**Mitigation**: The message is clearly labeled with a system prefix and uses the same `[System Notification]` injection path that child completion notifications use. The orchestrator already handles this pattern correctly. Test with multiple model providers.

### R-4: `readTranscript` Without Auto-Release Causes Worker Accumulation (F-5.2, Probability: Medium, Impact: Low)

**Risk**: Without auto-release on transcript read, idle child workers stay in the task manager indefinitely. With repeated task creation, memory grows.

**Mitigation**: Two layers of defense:
1. **Lazy cleanup**: `cleanupStaleChildren` releases idle children when concurrency limit is hit.
2. **Cascade kill on dispose**: When the parent dispatcher is disposed (user closes chat), all children are killed via `cascadeKill`.
3. Workers that have already exited (process ended but task entry remains) consume minimal memory — just the `IAgentManager` object in the task map.

### R-5: Concurrent Resume Race Condition (F-5.2, Probability: Low, Impact: Medium)

**Risk**: If the orchestrator sends two `send_message` calls to the same idle child in rapid succession, both may try to `getOrBuildTask` concurrently. The second call may fail or create a duplicate worker.

**Mitigation**: Add a `resumingChildren: Set<string>` guard in `sendMessageToChild`. Before calling `getOrBuildTask`, check if the child is already being resumed. If so, wait for the first resume to complete (use a `Map<string, Promise<void>>` for the in-flight promises). This is a standard concurrent-access guard pattern.

### R-6: Adaptive Polling Timer Leak (F-5.6, Probability: Low, Impact: Low)

**Risk**: Switching from `setInterval` to `setTimeout` chain means each iteration must schedule the next. If the scheduling logic has a bug (e.g., missing `return` on termination), the chain may never stop.

**Mitigation**: Keep the same termination conditions (child cancelled, task removed, status is terminal). Add a maximum lifetime (30 minutes) after which the polling stops regardless. Log a warning if the maximum is hit.

---

## 5. Appendix: Cross-Cutting Concerns

### A. `getOrBuildTask` Audit Requirements

Before implementing F-5.2, the implementer must verify that `getOrBuildTask` for dispatch children correctly restores:

- `workspace` from `extra.workspace`
- `presetRules` from `extra.presetRules`
- `yoloMode` from `extra.yoloMode` (should be `true`)
- Model from `conversation.model` (includes the provider override)
- `dispatchSessionType` = `'dispatch_child'`
- `parentSessionId` from `extra.parentSessionId`

If any of these are not read by `getOrBuildTask`, the field must be passed explicitly in the `sendMessageToChild` re-creation call.

### B. UI Change for F-5.2

The PRD mentions enabling TaskPanel SendBox for idle children. This is a renderer-side change in `TaskPanel.tsx` — remove the status gate that disables the send input for idle/finished children. The architect recommendation is to gate on terminal states only (`cancelled`, `failed`) and allow sending for all other states (`running`, `pending`, `idle`, `finished`).

### C. Directory Constraint Compliance

The `src/process/task/dispatch/` directory currently has 9 files:
1. `DispatchAgentManager.ts`
2. `DispatchMcpServer.ts`
3. `DispatchNotifier.ts`
4. `DispatchResourceGuard.ts`
5. `DispatchSessionTracker.ts`
6. `dispatchMcpServerScript.ts`
7. `dispatchPrompt.ts`
8. `dispatchTypes.ts`
9. (index or barrel file, if present)

Phase 5 modifies 7 of these 9 files but creates **zero new files**, staying within the 10-file directory limit per project conventions.
