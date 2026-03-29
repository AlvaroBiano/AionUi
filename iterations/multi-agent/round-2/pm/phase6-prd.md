# Phase 6: Workspace-Aware Dispatch, Configurable Limits, and Context Import

## 1. Gap Analysis

### 1.1 Methodology

Compared remaining gaps from Phase 5 "Out of Scope" list against user impact, implementation feasibility, and Claude Code parity. Reviewed current codebase state after Phase 5 completion to identify the highest-impact improvements.

### 1.2 Remaining Gaps (Post Phase 5)

| Gap | Impact | Feasibility | Phase 6? |
|---|---|---|---|
| Workspace-aware child tasks (children inherit or get custom workspace) | High — children all share parent workspace; no way to scope file operations | High — workspace already flows through `extra.workspace`; needs exposure in `start_task` tool and prompt | Yes (F-6.1) |
| Configurable concurrent task limit | Medium — hardcoded `MAX_CONCURRENT_CHILDREN = 3` cannot be tuned per session | High — single constant, add to Settings Drawer and conversation extra | Yes (F-6.2) |
| Context import into dispatch (single-chat upgrade alternative) | High — users cannot bring existing conversation context into a new dispatch session | Medium — copy messages as seed context rather than mutating conversation type | Yes (F-6.3) |
| Per-child MCP tool configuration | Medium — all children share same tool access | Low — requires per-agent MCP server management, significant plumbing | No (Phase 7+) |
| Multi-level child nesting | Low — current star topology handles most cases | Low — recursive dispatch architecture | No |
| Cross-child direct communication | Low — dispatcher-mediated approach works | Low — needs message bus | No |
| Real-time transcript streaming | Low — pull-based read_transcript is sufficient | Medium | No |

### 1.3 Key Observations

1. **Workspace propagation is silent.** Children inherit `this.workspace` from the parent (line 372 of `DispatchAgentManager.ts`), but the orchestrator has no visibility into this. The `start_task` tool has no `workspace` parameter, and the system prompt does not mention workspace at all. The orchestrator cannot direct a child to work in a specific subdirectory or a different project.

2. **Concurrent limit is invisible to users.** `MAX_CONCURRENT_CHILDREN = 3` is hardcoded in `dispatchTypes.ts` and referenced in `DispatchResourceGuard`, the system prompt, and the `start_task` tool description. Users who want more parallelism (or want to conserve resources with fewer) have no recourse.

3. **No path from existing conversation to dispatch.** Users who have built up context in a regular gemini/acp conversation and want to "upgrade" to multi-agent dispatch must start from scratch. The Phase 5 PRD noted this gap and suggested a "new dispatch + context import" approach, which is safer than mutating conversation types.

---

## 2. Phase 6 Feature List

### Priority Order

| ID | Feature | Priority | Complexity | Addresses Gap |
|---|---|---|---|---|
| F-6.1 | Workspace-Aware Child Tasks | P0 (Critical) | Medium | 1.2 row 1 |
| F-6.2 | Configurable Concurrent Task Limit | P1 (High) | Low | 1.2 row 2 |
| F-6.3 | Context Import into Dispatch | P1 (High) | Medium | 1.2 row 3 |

---

### F-6.1: Workspace-Aware Child Tasks

#### Problem

All child tasks inherit the parent dispatcher's workspace blindly. The orchestrator cannot:
- Direct a child to operate in a specific subdirectory (e.g., `frontend/` vs `backend/`)
- Assign a child to a different project entirely
- Communicate workspace context in child prompts

This limits the dispatch system's usefulness for multi-project or monorepo workflows where different subtasks target different directories.

#### Scope

1. **Add optional `workspace` parameter to `start_task` tool.** When provided, the child conversation uses this workspace instead of the parent's. When omitted, behavior is unchanged (inherit parent workspace).

2. **Add workspace info to system prompt.** The orchestrator should know its own workspace path and that it can override workspace per child.

3. **Validate workspace paths.** The provided workspace must be an existing directory on the filesystem. Reject invalid paths with a clear error.

4. **Show workspace in `list_sessions` output.** Include workspace path in the session listing so the orchestrator can track which child operates where.

5. **Show workspace in TaskPanel UI.** Display the child's workspace path in the ChildTaskCard so users can see where each agent is working.

#### Changes

| File | Change |
|---|---|
| `dispatchTypes.ts` | Add optional `workspace?: string` to `StartChildTaskParams` |
| `DispatchMcpServer.ts` | Add `workspace` property to `start_task` tool schema; parse in `handleToolCall` |
| `dispatchMcpServerScript.ts` | Add `workspace` property to `start_task` TOOL_SCHEMAS (keep in sync) |
| `DispatchAgentManager.ts` | `startChildSession`: use `params.workspace ?? this.workspace` for child conversation; validate path exists |
| `DispatchAgentManager.ts` | `listSessions`: include workspace in output format |
| `dispatchPrompt.ts` | Add workspace section: current workspace path, workspace override guidance |
| `dispatchTypes.ts` | Add optional `workspace?: string` to `ChildTaskInfo` |
| `DispatchSessionTracker.ts` | Store workspace in child info |
| Renderer: `ChildTaskCard.tsx` | Show workspace path (truncated) if different from parent |

#### Acceptance Criteria

- [ ] Orchestrator can call `start_task` with a `workspace` parameter pointing to a valid directory
- [ ] Child conversation's `extra.workspace` is set to the provided workspace
- [ ] Omitting `workspace` in `start_task` inherits the parent's workspace (backward compatible)
- [ ] Invalid workspace path (non-existent directory) returns a clear error to the orchestrator
- [ ] `list_sessions` output shows workspace path for each child
- [ ] System prompt includes current workspace and workspace override guidance
- [ ] ChildTaskCard shows workspace badge when child workspace differs from parent

#### Risk

Low-Medium. The workspace is already a string path stored in conversation extra. This feature adds a routing decision without changing how the workspace is consumed by the gemini worker. The main risk is the orchestrator providing invalid paths; validation mitigates this.

---

### F-6.2: Configurable Concurrent Task Limit

#### Problem

`MAX_CONCURRENT_CHILDREN = 3` is hardcoded. Users with powerful machines and high API quotas want more parallelism. Users on constrained resources or shared API keys want fewer concurrent tasks to avoid rate limits.

#### Scope

1. **Store concurrent task limit in conversation extra.** Add `maxConcurrentChildren?: number` to the dispatch conversation extra type. Default remains 3 if unset.

2. **Expose in GroupChatSettingsDrawer.** Add a numeric input (slider or input with min=1, max=10) for "Max Concurrent Tasks".

3. **Read from conversation extra in DispatchResourceGuard.** Replace `MAX_CONCURRENT_CHILDREN` constant usage with a dynamic lookup from conversation extra, falling back to the constant default.

4. **Update system prompt dynamically.** The constraint section should reflect the actual configured limit, not hardcoded "3".

5. **Update `start_task` tool description.** The "Maximum 3 concurrent tasks" text should reflect the configured limit.

#### Changes

| File | Change |
|---|---|
| `storage.ts` | Add `maxConcurrentChildren?: number` to dispatch conversation extra |
| `dispatchTypes.ts` | Keep `MAX_CONCURRENT_CHILDREN` as default, add `MIN_CONCURRENT_CHILDREN = 1`, `MAX_CONCURRENT_CHILDREN_LIMIT = 10` |
| `DispatchResourceGuard.ts` | Accept configurable limit; read from conversation extra; fallback to default |
| `DispatchAgentManager.ts` | Pass configured limit to ResourceGuard; read from conversation extra on bootstrap |
| `dispatchPrompt.ts` | Accept `maxConcurrentChildren` param; use in constraint text |
| `DispatchMcpServer.ts` | Update `start_task` description to use dynamic limit (or remove hardcoded "3") |
| `dispatchMcpServerScript.ts` | Update `start_task` schema description similarly |
| `GroupChatSettingsDrawer.tsx` | Add "Max Concurrent Tasks" control (InputNumber, min=1, max=10, default=3) |
| `dispatchBridge.ts` | Handle `maxConcurrentChildren` in `updateGroupChatSettings` |
| i18n files | Add keys for the new setting label, description, and validation messages |

#### Acceptance Criteria

- [ ] GroupChatSettingsDrawer shows "Max Concurrent Tasks" setting with range 1-10, default 3
- [ ] Saving a new limit persists to conversation extra
- [ ] DispatchResourceGuard enforces the configured limit (not hardcoded 3)
- [ ] System prompt reflects the configured limit (e.g., "Maximum 5 concurrent child tasks")
- [ ] Changing the limit takes effect on the next `start_task` call (cold swap, consistent with other settings)
- [ ] Omitting the setting defaults to 3 (backward compatible with existing conversations)

#### Risk

Low. The concurrency guard already exists; this just makes the threshold configurable. The only subtle point is that the MCP server script's tool description is static (compiled into the script). The description can use a generic phrasing like "Maximum concurrent tasks (see session config)" rather than a specific number, since the system prompt provides the actual limit.

---

### F-6.3: Context Import into Dispatch

#### Problem

Users build up valuable context in regular conversations (gemini/acp type) through multiple turns of discussion, code review, or analysis. When they decide the task needs multi-agent dispatch, they must start a completely new dispatch session and re-explain everything. This is frustrating and wastes tokens.

Direct "upgrade" of a conversation's type (gemini -> dispatch) is architecturally risky, as the Phase 5 PRD noted. The conversation type determines the worker type, message format, and extra schema. Mutating it mid-conversation would require handling all these schema differences.

#### Scope

Implement a **"Fork to Dispatch"** action available on regular (gemini/acp) conversations. This creates a new dispatch conversation with the source conversation's messages injected as seed context.

1. **"Fork to Dispatch" action.** Add a menu item (or button) in the conversation header / context menu of gemini and acp conversations. Clicking it creates a new dispatch group chat.

2. **Context extraction.** Read the last N messages (configurable, default 20) from the source conversation. Format them as a structured seed message that becomes the dispatch session's `seedMessages` in extra.

3. **Workspace inheritance.** The new dispatch conversation inherits the source conversation's workspace.

4. **Model inheritance.** The new dispatch conversation uses the source conversation's model as default.

5. **Navigation.** After creation, navigate the user to the new dispatch group chat.

6. **No mutation of original.** The source conversation remains untouched. This is a fork, not an upgrade.

#### Context Format

The seed context injected into the dispatch orchestrator's system prompt via `seedMessages`:

```
[Imported Context from conversation "Original Title"]
The user was working on the following topic. Use this context to inform your dispatch decisions.

--- Conversation Summary (last 20 messages) ---
[user] Can you review the authentication module...
[assistant] I've analyzed the auth module and found three issues...
[user] Let's fix issue #1 first...
[assistant] Here's my proposed fix for the token validation...
--- End of imported context ---
```

#### Changes

| File | Change |
|---|---|
| `dispatchBridge.ts` | Add `dispatch.forkFromConversation` IPC handler: reads source messages, creates dispatch conversation with seed context |
| `ipcBridge` type definitions | Add `dispatch.forkFromConversation` channel type |
| Renderer: conversation context menu or header | Add "Fork to Dispatch" action item |
| Renderer: navigation logic | Navigate to new dispatch conversation after fork |
| `dispatchPrompt.ts` | No change needed (seedMessages already injected via `customInstructions` path) |
| i18n files | Add keys for "Fork to Dispatch" label, confirmation, success message |

#### Acceptance Criteria

- [ ] "Fork to Dispatch" option is available in gemini and acp conversation menus
- [ ] Clicking it creates a new dispatch conversation with the source's last 20 messages as seed context
- [ ] New dispatch conversation inherits source workspace and model
- [ ] Source conversation is not modified
- [ ] User is navigated to the new dispatch group chat
- [ ] Orchestrator receives the imported context in its system prompt and can reference it
- [ ] Works correctly when source conversation has fewer than 20 messages (uses all available)
- [ ] Works correctly when source conversation has no workspace (uses system default)

#### Risk

Medium. The main complexity is in the context extraction and formatting — different conversation types (gemini vs acp) store messages differently, and message content can be complex (tool calls, images, etc.). The extraction should focus on text content only, stripping tool call artifacts and image references for a clean summary. Token budget is a concern: 20 messages of context could be substantial. A character limit (e.g., 8000 chars) on the seed context provides a safety valve.

---

## 3. Out of Scope (Phase 7+)

| Feature | Rationale |
|---|---|
| Per-child MCP tool configuration | Requires per-agent MCP server management. Significant plumbing across worker initialization, conversation extra schema, and Settings UI. Recommend as a standalone Phase 7 feature. |
| Git worktree isolation per child | Claude Code's worktree isolation requires deep git integration (create/checkout/merge worktrees). AionUi's workspace concept is directory-level, not git-branch-level. The complexity and maintenance burden outweigh the benefit for most users. F-6.1's workspace override covers the common case. |
| Multi-level child nesting | Recursive dispatch architecture with tree-state management. Current star topology handles most use cases. |
| Cross-child direct communication | Message bus / pub-sub architecture between children. Dispatcher-mediated communication remains adequate. |
| Real-time transcript streaming to parent | Push-based child output forwarding. Pull-based `read_transcript` with wait is sufficient for orchestration quality. |
| Seed message templates / presets | Pre-built prompt templates for common dispatch patterns (code review, research, etc.). UX enhancement that can layer on top of the current `seedMessages` field. |
| Conversation-to-child promotion | Converting a regular conversation into a child of an existing dispatch session. Inverse of F-6.3, more complex due to re-parenting. |

---

## 4. Success Criteria

### SC-6.1: Workspace-Aware Child Tasks

- [ ] Orchestrator creates a child with `workspace: "/path/to/frontend"` and the child operates in that directory
- [ ] Child created without `workspace` inherits parent workspace (regression check)
- [ ] Invalid workspace path returns error; no child created
- [ ] `list_sessions` output includes workspace per child
- [ ] System prompt mentions workspace and override capability
- [ ] ChildTaskCard shows workspace badge for children in non-default workspaces
- [ ] Existing dispatch conversations without workspace changes continue to work (backward compatible)

### SC-6.2: Configurable Concurrent Task Limit

- [ ] GroupChatSettingsDrawer shows "Max Concurrent Tasks" control
- [ ] Setting to 5 allows 5 concurrent children before the guard rejects
- [ ] Setting to 1 allows only 1 concurrent child
- [ ] System prompt reflects the configured limit
- [ ] Existing conversations without the setting default to 3
- [ ] Changing the limit mid-session takes effect on the next `start_task` (cold swap)

### SC-6.3: Context Import into Dispatch

- [ ] "Fork to Dispatch" appears in gemini conversation menu
- [ ] "Fork to Dispatch" appears in acp conversation menu
- [ ] New dispatch session contains seed context from source conversation
- [ ] Orchestrator references the imported context when dispatching tasks
- [ ] Source conversation is unmodified after fork
- [ ] User is navigated to the new dispatch conversation
- [ ] Context is truncated to 8000 characters if source messages are very long
- [ ] Non-text message content (images, tool calls) is gracefully excluded from the import

---

## 5. Technical Constraints

| ID | Constraint | Detail |
|---|---|---|
| TC-1 | Three-process isolation | All config read/write in main process via ProcessConfig. No IPC bridge calls inside provider handlers. |
| TC-2 | Backward compatibility | All new fields in conversation extra are optional with sensible defaults. Existing conversations must work unchanged. |
| TC-3 | Directory limit | `src/process/task/dispatch/` currently has 9 files (limit is 10). No new files in this directory. F-6.3's bridge handler goes in `dispatchBridge.ts`. |
| TC-4 | MCP script sync | Any changes to tool schemas in `DispatchMcpServer.ts` must be mirrored in `dispatchMcpServerScript.ts`. |
| TC-5 | i18n | All user-facing strings (Settings Drawer labels, menu items, messages) must use i18n keys. |
| TC-6 | Cold swap semantics | F-6.2 limit changes and F-6.1 workspace changes apply on next `start_task`, not retroactively to running children. Consistent with existing settings behavior (per the Alert in GroupChatSettingsDrawer). |

---

## 6. Risk Assessment

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | F-6.1: Orchestrator provides invalid or dangerous workspace paths | Medium | Medium | Validate path exists and is a directory. Do not allow paths outside the user's home directory or system paths. Log workspace overrides for debugging. |
| R-2 | F-6.1: Orchestrator over-uses workspace override, creating confusion | Low | Low | System prompt guidance: "Use workspace override only when the task clearly targets a different project or subdirectory. For most tasks, the default workspace is appropriate." |
| R-3 | F-6.2: User sets limit too high, exhausting API rate limits | Medium | Medium | Max cap at 10. Add helper text in Settings Drawer: "Higher values use more API quota. Recommended: 3-5." |
| R-4 | F-6.2: Dynamic limit in MCP script description | Low | Low | Use generic description text in MCP script. System prompt provides the actual number. |
| R-5 | F-6.3: Imported context is too large, bloating system prompt | Medium | Medium | Cap seed context at 8000 characters. Summarize if needed (truncate oldest messages first). |
| R-6 | F-6.3: Non-text messages in source conversation cause formatting issues | Medium | Low | Extract only `type: 'text'` messages. Skip tool calls, images, dispatch events. |
| R-7 | F-6.3: Different conversation types (gemini vs acp) have different message schemas | Low | Medium | Use the common `IMessageText` interface for extraction. Both types store text messages with `content.content`. |

---

## Appendix A: File Change Summary

| File | Features | Change Type |
|---|---|---|
| `src/process/task/dispatch/dispatchTypes.ts` | F-6.1, F-6.2 | Add `workspace` to `StartChildTaskParams` and `ChildTaskInfo`; add limit constants |
| `src/process/task/dispatch/DispatchMcpServer.ts` | F-6.1, F-6.2 | Add `workspace` to `start_task` schema; update description text |
| `src/process/task/dispatch/dispatchMcpServerScript.ts` | F-6.1, F-6.2 | Mirror schema changes |
| `src/process/task/dispatch/DispatchAgentManager.ts` | F-6.1, F-6.2 | Workspace override in `startChildSession`; configurable limit bootstrap |
| `src/process/task/dispatch/DispatchResourceGuard.ts` | F-6.2 | Accept dynamic limit parameter |
| `src/process/task/dispatch/DispatchSessionTracker.ts` | F-6.1 | Store workspace in child info |
| `src/process/task/dispatch/dispatchPrompt.ts` | F-6.1, F-6.2 | Workspace section; dynamic limit |
| `src/common/config/storage.ts` | F-6.2 | Add `maxConcurrentChildren` to dispatch extra |
| `src/process/bridge/dispatchBridge.ts` | F-6.2, F-6.3 | Handle `maxConcurrentChildren` in settings update; add `forkFromConversation` handler |
| `src/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer.tsx` | F-6.2 | Add "Max Concurrent Tasks" control |
| `src/renderer/pages/conversation/dispatch/components/ChildTaskCard.tsx` | F-6.1 | Show workspace badge |
| Renderer: conversation context menu | F-6.3 | Add "Fork to Dispatch" action |
| i18n JSON files | F-6.2, F-6.3 | New keys for settings, menu items, messages |

## Appendix B: Implementation Order

Recommended implementation sequence:

1. **F-6.2 (Configurable Limit)** — Lowest complexity, highest confidence. Unblocks users immediately. Pure configuration plumbing with no architectural changes.

2. **F-6.1 (Workspace-Aware Children)** — Medium complexity. Extends the existing `start_task` tool with a new parameter. Most changes are in the dispatch module (process side) with a small renderer touch for the workspace badge.

3. **F-6.3 (Context Import)** — Highest complexity of the three. Requires a new IPC channel, renderer menu changes, and message extraction logic. Benefits from F-6.1 and F-6.2 being stable first.
