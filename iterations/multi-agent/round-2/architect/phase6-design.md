# Phase 6: Architecture Design

## 1. Design Decisions (Self-Debate)

### D-1: Workspace parameter — Add to `start_task` tool vs separate `set_workspace` tool

**Option A: Add optional `workspace` param to `start_task`**
- Pro: Atomic — workspace is set at creation time, no race conditions.
- Pro: Aligns with existing `model` override pattern (already an optional object param on `start_task`).
- Pro: No new tool to register in MCP schema (simpler surface area).
- Con: Slightly overloads `start_task` with yet another optional field.

**Option B: Separate `set_workspace` tool**
- Pro: Separation of concerns; workspace could be changed mid-session.
- Con: Two-step flow creates a window where the child runs in the wrong workspace.
- Con: Adds a 5th MCP tool — more schema surface, more code in `handleToolCall`.
- Con: Mid-session workspace change is dangerous (file operations in progress).

**Decision: Option A.** The `model` override precedent makes this natural. Workspace is a creation-time decision, not a runtime one. Adding to `start_task` keeps the API atomic and consistent.

### D-2: Workspace validation — Validate on main process vs trust AI

**Option A: Validate directory exists on main process (fs.stat)**
- Pro: Prevents child from starting with an invalid workspace, clear error.
- Pro: Consistent with PRD requirement; security boundary against path traversal.
- Con: Adds an async fs call in the hot path of `startChildSession`.

**Option B: Trust AI, validate lazily in the worker**
- Pro: Simpler main process code.
- Con: Error surfaces deep in the worker, confusing error messages.
- Con: The worker (gemini CLI) may silently fall back to home directory.

**Option C: Validate on main process with allowlist (home directory restriction)**
- Pro: Maximum safety — reject system paths, paths outside `$HOME`.
- Con: Over-restrictive; legitimate use cases like `/opt/project` or external drives.

**Decision: Option A with a lightweight check.** Use `fs.stat` to verify the path exists and is a directory. Do NOT restrict to `$HOME` — that's overly paternalistic for a desktop app. Log workspace overrides for debugging. The validation cost is negligible compared to the worker spawn.

### D-3: Configurable limit storage — Conversation extra vs global config

**Option A: Store in conversation extra (`maxConcurrentChildren`)**
- Pro: Per-session granularity — different dispatch sessions can have different limits.
- Pro: Consistent with other dispatch-specific settings (seedMessages, leaderAgent).
- Pro: PRD specifies this approach.
- Con: Requires plumbing through Settings Drawer and dispatchBridge.

**Option B: Store in global config (like `model.config`)**
- Pro: One setting applies everywhere.
- Con: Users can't tune per session. A code review session may want 5 agents while a translation session wants 1.
- Con: Breaks the pattern — all other dispatch settings are per-conversation.

**Decision: Option A.** Per-conversation storage is the right granularity for a dispatch-specific setting. It follows the existing pattern where `seedMessages`, `leaderAgentId`, etc. live in conversation extra.

### D-4: Context import — Fork action placement

**Option A: Add "Fork to Dispatch" to sidebar conversation context menu**
- Pro: Discoverable — users right-click any conversation and see the option.
- Pro: No changes needed to conversation header (which varies by type).
- Con: The sidebar `ConversationRow` dropdown menu already has 4 items (pin, rename, export, delete); adding a 5th is acceptable but starts to get long.
- Con: Must conditionally hide for dispatch-type conversations (forking dispatch to dispatch is nonsensical).

**Option B: Add button in conversation header**
- Pro: Visible while actively working in the conversation.
- Con: Headers differ per conversation type (gemini, acp, codex, etc.) — must add to multiple components.
- Con: More intrusive UI change.

**Option C: Both sidebar menu AND header action**
- Pro: Maximum discoverability.
- Con: Duplicated code; confusing UX (two places to do the same thing).

**Decision: Option A.** The sidebar context menu is the canonical place for conversation-level actions. Adding a `Menu.Item` with key `'forkToDispatch'` is minimal code, conditional on `conversation.type !== 'dispatch'`. This avoids touching multiple header components.

### D-5: Context extraction — Last N messages vs AI summary

**Option A: Extract last N messages as-is (text only)**
- Pro: Simple, deterministic, fast (no API call).
- Pro: User sees exactly what context was imported.
- Con: May include irrelevant early messages; token budget concern.
- PRD specifies this approach with N=20, 8000 char cap.

**Option B: Summarize via AI call**
- Pro: More compact, contextually rich.
- Con: Adds latency (API round-trip before dispatch session starts).
- Con: Requires an available model/API key at fork time — complex error handling.
- Con: Summary may lose critical details.

**Decision: Option A.** Deterministic extraction with truncation. The 8000-character cap provides a safety valve. AI summarization is a future enhancement that can layer on top.

---

## 2. File Change List

### F-6.1: Workspace-Aware Child Tasks

#### `src/process/task/dispatch/dispatchTypes.ts`

1. Add `workspace?: string` to `StartChildTaskParams`.
2. Add `workspace?: string` to `ChildTaskInfo`.

#### `src/process/task/dispatch/DispatchMcpServer.ts`

1. In `handleToolCall` `start_task` case: parse `args.workspace` as optional string, assign to `params.workspace`.
2. In `getToolSchemas` `start_task` entry: add `workspace` property to `inputSchema.properties`:
   ```
   workspace: {
     type: 'string',
     description: 'Optional working directory for the child agent. Must be an existing directory. Omit to inherit parent workspace.',
   }
   ```

#### `src/process/task/dispatch/dispatchMcpServerScript.ts`

Mirror the `workspace` property addition in `TOOL_SCHEMAS[0]` (start_task).

#### `src/process/task/dispatch/DispatchAgentManager.ts`

1. In `startChildSession`:
   - After model resolution, add workspace resolution:
     ```ts
     const childWorkspace = params.workspace ?? this.workspace;
     ```
   - Before creating conversation, validate workspace if overridden:
     ```ts
     if (params.workspace) {
       const stat = await fs.promises.stat(params.workspace);
       if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${params.workspace}`);
     }
     ```
     Wrap in try/catch — `ENOENT` becomes `"Workspace directory does not exist: ..."`.
   - In `childConversation` creation (line 372): change `workspace: this.workspace` to `workspace: childWorkspace`.
   - In `childInfo` creation: add `workspace: childWorkspace`.

2. In `listSessions`:
   - Include workspace in the formatted line:
     ```ts
     const workspaceLabel = c.workspace ? `, workspace: ${c.workspace}` : '';
     `  - ${c.sessionId} "${c.title}" (${statusLabel(c.status)}, is_child: true${workspaceLabel})`
     ```

#### `src/process/task/dispatch/DispatchSessionTracker.ts`

No code change needed. `ChildTaskInfo` already flows through `registerChild` — once the type has `workspace`, it's automatically stored.

#### `src/process/task/dispatch/dispatchPrompt.ts`

1. Add `workspace?: string` to the `options` parameter.
2. Add a "Workspace" section to the prompt:
   ```
   ## Workspace
   Your current workspace is: ${options.workspace}
   You can override the workspace for child tasks by passing a "workspace" parameter to start_task.
   Use this when the task targets a specific subdirectory or a different project.
   For most tasks, omit workspace to let children inherit your workspace.
   ```
3. Update the Constraints section: dynamic max concurrent reference (shared with F-6.2).

#### `src/process/task/dispatch/DispatchAgentManager.ts` (bootstrap)

Pass `workspace: this.workspace` to `buildDispatchSystemPrompt` options.

#### Renderer: `src/renderer/pages/conversation/dispatch/ChildTaskCard.tsx`

Add optional workspace badge. Requires the workspace to flow through the `GroupChatTimelineMessage` or `ChildTaskInfoVO`.

**Approach**: Add `workspace?: string` to `ChildTaskInfoVO` (renderer types.ts). The `get-group-chat-info` bridge already reads child conversation extra — add `workspace` to the mapped output. In `ChildTaskCard`, show a small `<Tag>` with truncated workspace path when workspace differs from... actually, since ChildTaskCard renders from timeline messages, and workspace is a static property of the child, the better place is `TaskOverview` child chips. Add workspace tooltip on child chip in `TaskOverview.tsx`.

**Revised approach**: Show workspace in `ChildTaskInfoVO` via `get-group-chat-info`, display in `TaskOverview` child list as a tooltip or subtitle.

#### Renderer: `src/renderer/pages/conversation/dispatch/types.ts`

Add `workspace?: string` to `ChildTaskInfoVO`.

#### `src/process/bridge/dispatchBridge.ts`

In `get-group-chat-info` handler, include `workspace` from child conversation extra in the mapped output.

#### `src/common/adapter/ipcBridge.ts`

Add `workspace?: string` to the `children` array type in `getGroupChatInfo` response.

---

### F-6.2: Configurable Concurrent Task Limit

#### `src/common/config/storage.ts`

Add `maxConcurrentChildren?: number` to the dispatch conversation extra type (after `seedMessages`).

#### `src/process/task/dispatch/dispatchTypes.ts`

Add constants:
```ts
export const MIN_CONCURRENT_CHILDREN = 1;
export const MAX_CONCURRENT_CHILDREN_LIMIT = 10;
export const DEFAULT_CONCURRENT_CHILDREN = 3;
```
Rename existing `MAX_CONCURRENT_CHILDREN = 3` to `DEFAULT_CONCURRENT_CHILDREN = 3` for clarity. Keep `MAX_CONCURRENT_CHILDREN` as an alias for backward compat (or just update all references).

#### `src/process/task/dispatch/DispatchResourceGuard.ts`

1. Add a `maxConcurrent` property, defaulting to `DEFAULT_CONCURRENT_CHILDREN`.
2. Add a `setMaxConcurrent(limit: number)` method.
3. Replace all `MAX_CONCURRENT_CHILDREN` references with `this.maxConcurrent`.

#### `src/process/task/dispatch/DispatchAgentManager.ts`

1. In `createBootstrap`: read `maxConcurrentChildren` from conversation extra and call `this.resourceGuard.setMaxConcurrent(limit)`.
2. Pass the limit to `buildDispatchSystemPrompt`.

#### `src/process/task/dispatch/dispatchPrompt.ts`

1. Add `maxConcurrentChildren?: number` to options.
2. In Constraints section, replace hardcoded "3" with `${options.maxConcurrentChildren ?? DEFAULT_CONCURRENT_CHILDREN}`.

#### `src/process/task/dispatch/DispatchMcpServer.ts`

In `getToolSchemas`, change `start_task` description from "Maximum 3 concurrent tasks" to "Maximum concurrent tasks (see session constraints)". The actual limit is conveyed via the system prompt.

#### `src/process/task/dispatch/dispatchMcpServerScript.ts`

Mirror the description change: "Max 3 concurrent" -> generic phrasing.

#### `src/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer.tsx`

1. Add state: `const [maxConcurrent, setMaxConcurrent] = useState(currentSettings.maxConcurrentChildren ?? 3)`.
2. Add `InputNumber` form item: label = i18n key `dispatch.settings.maxConcurrentLabel`, min=1, max=10, default=3.
3. Add helper text below: i18n key `dispatch.settings.maxConcurrentHelp`.
4. Include `maxConcurrentChildren: maxConcurrent` in the save payload.

#### `src/renderer/pages/conversation/dispatch/types.ts`

1. Add `maxConcurrentChildren?: number` to `GroupChatSettingsDrawerProps.currentSettings`.
2. Add `maxConcurrentChildren?: number` to `GroupChatInfoVO`.

#### `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`

Pass `maxConcurrentChildren` from `info` to `currentSettings` for the settings drawer.

#### `src/common/adapter/ipcBridge.ts`

1. Add `maxConcurrentChildren?: number` to `updateGroupChatSettings` params.
2. Add `maxConcurrentChildren?: number` to `getGroupChatInfo` response.

#### `src/process/bridge/dispatchBridge.ts`

1. In `updateGroupChatSettings` handler: persist `maxConcurrentChildren` to conversation extra.
2. In `getGroupChatInfo` handler: include `maxConcurrentChildren` in response.

#### i18n files

Add keys:
- `dispatch.settings.maxConcurrentLabel`: "Max Concurrent Tasks"
- `dispatch.settings.maxConcurrentHelp`: "Higher values use more API quota. Recommended: 3-5."
- Chinese equivalents.

---

### F-6.3: Context Import into Dispatch

#### `src/common/adapter/ipcBridge.ts`

Add new channel:
```ts
forkToDispatch: bridge.buildProvider<
  IBridgeResponse<{ conversationId: string }>,
  {
    sourceConversationId: string;
    maxMessages?: number;
  }
>('dispatch.fork-from-conversation'),
```

#### `src/process/bridge/dispatchBridge.ts`

Add `dispatch.fork-from-conversation` handler:

1. Read source conversation from DB (validate it exists and is gemini/acp type).
2. Read last N messages (default 20) from source conversation via `conversationRepo.getMessages`.
3. Extract text-only messages, format as seed context string.
4. Apply 8000-character truncation (drop oldest messages first until under limit).
5. Read source workspace and model from conversation extra.
6. Create new dispatch conversation using the same logic as `createGroupChat`, passing:
   - `workspace` from source conversation
   - `seedMessages` = formatted context string
   - `name` = `"Fork: ${sourceConversation.name}"`
7. Return new conversation ID.

**Context format**:
```
[Imported Context from conversation "${sourceTitle}"]
The user was working on the following topic. Use this context to inform your dispatch decisions.

--- Conversation Summary (last ${count} messages) ---
[user] ...
[assistant] ...
--- End of imported context ---
```

**Message extraction logic**:
- Filter `type === 'text'` messages only (skip tool calls, dispatch events, images).
- Map `position === 'right'` to `[user]`, else `[assistant]`.
- Extract `content.content` (the text string).
- Skip messages with empty content.

#### `src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx`

Add a `Menu.Item` with key `'forkToDispatch'` in the dropdown, conditionally rendered when `conversation.type !== 'dispatch'`:

```tsx
{!isDispatchConversation && (
  <Menu.Item key='forkToDispatch'>
    <div className='flex items-center gap-8px'>
      <People theme='outline' size='14' />
      <span>{t('conversation.history.forkToDispatch')}</span>
    </div>
  </Menu.Item>
)}
```

#### `src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts`

Add `onForkToDispatch` handler:

1. Call `ipcBridge.dispatch.forkToDispatch.invoke({ sourceConversationId: conversation.id })`.
2. On success, navigate to the new dispatch conversation.
3. Show `Message.success(t('conversation.history.forkSuccess'))`.

Wire this into the `onClickMenuItem` handler in `ConversationRow`.

#### `src/renderer/pages/conversation/GroupedHistory/types.ts`

Add `onForkToDispatch` to `ConversationRowProps` if actions are passed as props (check pattern).

#### i18n files

Add keys:
- `conversation.history.forkToDispatch`: "Fork to Dispatch"
- `conversation.history.forkSuccess`: "Dispatch session created with imported context"
- Chinese equivalents.

---

## 3. Implementation Order

### Phase 6.2 (Configurable Limit) — Implement First

**Rationale**: Lowest complexity, highest confidence. Pure configuration plumbing with no architectural changes. Changes are isolated to the concurrency path.

**Steps**:
1. `dispatchTypes.ts`: Add constants (`DEFAULT_CONCURRENT_CHILDREN`, `MIN_CONCURRENT_CHILDREN`, `MAX_CONCURRENT_CHILDREN_LIMIT`).
2. `storage.ts`: Add `maxConcurrentChildren` to dispatch extra type.
3. `DispatchResourceGuard.ts`: Accept dynamic limit.
4. `DispatchAgentManager.ts`: Read limit from conversation extra in bootstrap, pass to guard.
5. `dispatchPrompt.ts`: Accept and use dynamic limit.
6. `DispatchMcpServer.ts` + `dispatchMcpServerScript.ts`: Update description text.
7. `ipcBridge.ts`: Add `maxConcurrentChildren` to settings update params and info response.
8. `dispatchBridge.ts`: Handle `maxConcurrentChildren` in settings update and info retrieval.
9. Renderer types + `GroupChatSettingsDrawer.tsx` + `GroupChatView.tsx`: Add UI control.
10. i18n files.

**Estimated file touches**: 10 files. No new files.

### Phase 6.1 (Workspace-Aware Children) — Implement Second

**Rationale**: Medium complexity. Extends `start_task` with workspace param. Most changes in process layer. Small renderer touch for display.

**Steps**:
1. `dispatchTypes.ts`: Add `workspace` to `StartChildTaskParams` and `ChildTaskInfo`.
2. `DispatchMcpServer.ts`: Parse workspace in `handleToolCall`, add to schema.
3. `dispatchMcpServerScript.ts`: Mirror schema change.
4. `DispatchAgentManager.ts`: Workspace resolution + validation in `startChildSession`; workspace in `listSessions` output; pass workspace to prompt builder.
5. `dispatchPrompt.ts`: Add workspace section.
6. `ipcBridge.ts`: Add workspace to `getGroupChatInfo` children.
7. `dispatchBridge.ts`: Include workspace in info response.
8. Renderer `types.ts`: Add workspace to `ChildTaskInfoVO`.
9. Renderer `TaskOverview.tsx` or `ChildTaskCard.tsx`: Display workspace.
10. i18n files (optional — workspace display may not need i18n if it's just a path).

**Estimated file touches**: 9-10 files. No new files.

### Phase 6.3 (Context Import) — Implement Third

**Rationale**: Highest complexity. Requires new IPC channel, message extraction logic, and sidebar menu changes. Benefits from F-6.1 and F-6.2 being stable.

**Steps**:
1. `ipcBridge.ts`: Add `forkToDispatch` channel.
2. `dispatchBridge.ts`: Implement `dispatch.fork-from-conversation` handler with message extraction.
3. `ConversationRow.tsx`: Add "Fork to Dispatch" menu item.
4. `useConversationActions.ts`: Add fork handler with navigation.
5. i18n files.

**Estimated file touches**: 5 files. No new files.

---

## 4. Risk Assessment

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | **F-6.1: Invalid workspace paths from orchestrator** | Medium | Medium | `fs.stat` validation before child creation. Clear error message returned to orchestrator. |
| R-2 | **F-6.1: Path traversal / security** | Low | Medium | Desktop app context — user already has full file access. No home-directory restriction needed. Log all workspace overrides for debugging. |
| R-3 | **F-6.1: MCP script description sync** | Low | Low | Description uses generic text ("see session constraints") rather than a specific number. Validation is server-side. |
| R-4 | **F-6.2: User sets limit too high, API rate limit exhaustion** | Medium | Medium | Max cap at 10. Helper text warns about API quota. System prompt reflects actual limit. |
| R-5 | **F-6.2: Dynamic limit inconsistency during running session** | Low | Low | Cold swap semantics — limit changes apply to the next `start_task`, not retroactively. Consistent with existing settings behavior (documented in Alert banner). |
| R-6 | **F-6.2: `DispatchResourceGuard` references stale limit** | Low | Medium | `setMaxConcurrent` is called during bootstrap, before any tool calls. No race condition because bootstrap awaits before `sendMessage`. |
| R-7 | **F-6.3: Different conversation types have different message schemas** | Low | Medium | Extract only `type === 'text'` messages via `content.content`. Both gemini and acp types use `IMessageText` for text messages. Skip all non-text types (tool calls, images, dispatch events). |
| R-8 | **F-6.3: Imported context exceeds token budget** | Medium | Medium | Hard cap at 8000 characters. Truncation drops oldest messages first. Character count is checked after formatting. |
| R-9 | **F-6.3: Source conversation has zero messages** | Low | Low | Handle gracefully — create dispatch session with no seed context. Show info message to user. |
| R-10 | **F-6.3: Fork of dispatch conversation** | Low | Low | Menu item conditionally hidden for `type === 'dispatch'`. Even if triggered, the handler can reject dispatch-type sources. |
| R-11 | **Directory limit (TC-3)**: dispatch/ currently has 9 files (limit 10) | N/A | N/A | No new files in `src/process/task/dispatch/`. All changes modify existing files. F-6.3 handler goes in `dispatchBridge.ts`. |
| R-12 | **F-6.2: `DispatchResourceGuard` constructor change breaks existing callers** | Low | Low | `setMaxConcurrent` is a new method, not a constructor change. Existing constructor signature stays the same. Default limit is set in the class property initializer. |

---

## Appendix: Complete File Change Matrix

| File | F-6.1 | F-6.2 | F-6.3 | Change Summary |
|---|---|---|---|---|
| `src/process/task/dispatch/dispatchTypes.ts` | X | X | | Add workspace to types; add limit constants |
| `src/process/task/dispatch/DispatchMcpServer.ts` | X | X | | Parse workspace; update description text |
| `src/process/task/dispatch/dispatchMcpServerScript.ts` | X | X | | Mirror schema + description changes |
| `src/process/task/dispatch/DispatchAgentManager.ts` | X | X | | Workspace resolution/validation; read limit from extra |
| `src/process/task/dispatch/DispatchResourceGuard.ts` | | X | | Dynamic limit via `setMaxConcurrent` |
| `src/process/task/dispatch/dispatchPrompt.ts` | X | X | | Workspace section; dynamic limit |
| `src/process/task/dispatch/DispatchSessionTracker.ts` | X | | | No code change (type flows through) |
| `src/common/config/storage.ts` | | X | | Add `maxConcurrentChildren` to dispatch extra |
| `src/common/adapter/ipcBridge.ts` | X | X | X | workspace in info response; limit in settings; fork channel |
| `src/process/bridge/dispatchBridge.ts` | X | X | X | workspace in info; limit in settings update; fork handler |
| `src/renderer/pages/conversation/dispatch/types.ts` | X | X | | workspace + maxConcurrent in VO types |
| `src/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer.tsx` | | X | | InputNumber for max concurrent |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx` | | X | | Pass maxConcurrent to settings drawer |
| `src/renderer/pages/conversation/dispatch/components/TaskOverview.tsx` | X | | | Workspace tooltip on child chips |
| `src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx` | | | X | "Fork to Dispatch" menu item |
| `src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts` | | | X | Fork handler with navigation |
| i18n JSON files (en-US, zh-CN) | | X | X | New keys for settings and fork action |

**Total unique files**: 17 (including i18n). **New files**: 0.
