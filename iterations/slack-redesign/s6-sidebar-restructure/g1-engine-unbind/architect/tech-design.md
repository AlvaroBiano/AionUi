# G1: Engine Unbind + Dispatch Abstraction - Technical Design

**Date**: 2026-03-30
**Status**: Design
**Scope**: Decouple Dispatch system from Gemini, make it engine-agnostic

---

## 1. Problem Statement

The current Dispatch system is hardcoded to Gemini at three layers:

1. **Admin worker**: `DispatchAgentManager` constructor passes `workerType='gemini'` to `BaseAgentManager` (line 102).
2. **Child conversations**: `startChildSession()` creates child conversations with `type: 'gemini'` (line 403).
3. **Teammate config**: `TemporaryTeammateConfig.agentType` is typed as literal `'gemini'` (dispatchTypes.ts line 37).

This prevents using ACP (Claude), Codex, OpenClaw, NanoBotAgent, or Remote agents as either the admin or child workers within a group chat.

---

## 2. Change File Manifest

### 2.1 `src/process/task/dispatch/dispatchTypes.ts`

| Change | Detail |
|--------|--------|
| `TemporaryTeammateConfig.agentType` | Change from `'gemini'` literal to `AgentType` union |
| `StartChildTaskParams` | Add `agent_type?: AgentType`, `member_id?: string`, `isolation?: 'worktree'` |
| `ChildTaskInfo` | Add `agentType?: AgentType` for tracking |
| `DispatchAgentData` (new export) | Add `adminAgentType?: AgentType` field |

**Concrete diff for `TemporaryTeammateConfig`:**

```typescript
// BEFORE
export type TemporaryTeammateConfig = {
  // ...
  agentType: 'gemini';
  // ...
};

// AFTER
export type TemporaryTeammateConfig = {
  // ...
  agentType: AgentType;
  // ...
};
```

**Concrete diff for `StartChildTaskParams`:**

```typescript
// BEFORE
export type StartChildTaskParams = {
  prompt: string;
  title: string;
  teammate?: TemporaryTeammateConfig;
  model?: { providerId: string; modelName: string };
  workspace?: string;
};

// AFTER
export type StartChildTaskParams = {
  prompt: string;
  title: string;
  teammate?: TemporaryTeammateConfig;
  model?: { providerId: string; modelName: string };
  workspace?: string;
  /** Engine type for the child worker. Defaults to 'gemini'. */
  agent_type?: AgentType;
  /** Reference an existing group member; auto-fills config from their profile. */
  member_id?: string;
  /** Isolation mode. Declared here for forward-compat; G2 implements 'worktree'. */
  isolation?: 'worktree';
};
```

**Concrete addition to `ChildTaskInfo`:**

```typescript
export type ChildTaskInfo = {
  // ... existing fields ...
  /** Engine type of this child worker */
  agentType?: AgentType;
};
```

### 2.2 `src/process/task/dispatch/DispatchAgentManager.ts`

| Change | Detail |
|--------|--------|
| `DispatchAgentData` type | Add `adminAgentType?: AgentType` field |
| Constructor (line 102) | Read `adminAgentType` from data, default to `'gemini'`; pass as `workerType` |
| `init()` event listener (line 262) | Replace hardcoded `'gemini.message'` with dynamic event name based on `adminWorkerType` |
| `startChildSession()` (line 399-403) | Read `agent_type` from `StartChildTaskParams`; use it for child conversation `type` and `getOrBuildTask` |
| `startChildSession()` child conversation creation | Replace hardcoded `type: 'gemini'` with resolved `agentType` |
| `startChildSession()` tracker registration | Store `agentType` in `ChildTaskInfo` |
| `addOrUpdateMessage()` calls (line 299) | Replace hardcoded `'gemini'` source label with dynamic `this.adminWorkerType` |

**Key constructor change:**

```typescript
// BEFORE
constructor(data: DispatchAgentData) {
  super('dispatch', { ...data, model: data.model }, new IpcAgentEventEmitter(), true, 'gemini');
  // ...
}

// AFTER
private readonly adminWorkerType: AgentType;

constructor(data: DispatchAgentData) {
  const adminWorkerType = data.adminAgentType || 'gemini';
  super('dispatch', { ...data, model: data.model }, new IpcAgentEventEmitter(), true, adminWorkerType);
  this.adminWorkerType = adminWorkerType;
  // ...
}
```

**Key child creation change:**

```typescript
// BEFORE (line 401-403)
const childConversation: TChatConversation = {
  // ...
  type: 'gemini',
  // ...
};

// AFTER
const childAgentType = params.agent_type || 'gemini';
const childConversation: TChatConversation = {
  // ...
  type: childAgentType,
  // ...
};
```

**Event listener adaptation:**

```typescript
// BEFORE (line 262)
this.on('gemini.message', (data: Record<string, unknown>) => {

// AFTER
// The worker emits events as `{workerType}.message`.
// Admin could be gemini, acp, codex, etc.
this.on(`${this.adminWorkerType}.message`, (data: Record<string, unknown>) => {
```

NOTE: This requires investigation. `BaseAgentManager` forwards events from the fork worker using the worker type prefix. If admin is ACP, the event will be `acp.message`, not `gemini.message`. We need to confirm that `ForkTask` emits events with the resolved `workerType` prefix. If the event name is always determined by the worker script's own emission pattern, we may need a mapping layer. **Risk mitigation**: Add a fallback listener on `*.message` or normalize event names in `BaseAgentManager.init()`.

### 2.3 `src/process/task/dispatch/DispatchMcpServer.ts`

| Change | Detail |
|--------|--------|
| `handleToolCall('start_task')` (line 74) | Parse `args.agent_type` and pass to `StartChildTaskParams` |
| `handleToolCall('start_task')` teammate default | Change `agentType: 'gemini'` to `agentType: args.agent_type || 'gemini'` |
| `getToolSchemas()` start_task schema (line 202+) | Add `agent_type`, `member_id`, `isolation` properties |

**Schema addition for `start_task`:**

```typescript
agent_type: {
  type: 'string',
  description:
    'Engine type for the child agent. Options: gemini, acp, codex, openclaw-gateway, nanobot, remote. ' +
    'Defaults to gemini if omitted.',
  enum: ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote'],
},
member_id: {
  type: 'string',
  description: 'Reference an existing group member by ID. Auto-fills config from their profile.',
},
isolation: {
  type: 'string',
  description: 'Isolation mode for the child workspace. Currently only "worktree" is planned (G2).',
  enum: ['worktree'],
},
```

### 2.4 `src/process/task/dispatch/dispatchMcpServerScript.ts`

| Change | Detail |
|--------|--------|
| `TOOL_SCHEMAS[0]` (start_task) | Add `agent_type`, `member_id`, `isolation` properties (mirror DispatchMcpServer) |

Must stay in sync with `DispatchMcpServer.getToolSchemas()`.

### 2.5 `src/process/task/workerTaskManagerSingleton.ts`

| Change | Detail |
|--------|--------|
| `dispatch` factory (line 86-100) | Pass `adminAgentType` from conversation extra to `DispatchAgentManager` |

**Concrete diff:**

```typescript
// BEFORE
agentFactory.register('dispatch', (conv, opts) => {
  const c = conv as any;
  const manager = new DispatchAgentManager({
    // ...
    dispatcherName: c.name || 'Dispatcher',
  });
  return manager;
});

// AFTER
agentFactory.register('dispatch', (conv, opts) => {
  const c = conv as any;
  const manager = new DispatchAgentManager({
    // ... existing fields ...
    dispatcherName: c.name || 'Dispatcher',
    adminAgentType: c.extra?.adminAgentType || 'gemini',
  });
  return manager;
});
```

No changes needed to the AgentFactory routing itself -- child conversations already use `conv.type` to route to the correct creator. Since we change child `type` from hardcoded `'gemini'` to the actual `agent_type`, the existing factory registry naturally routes to the right worker creator.

### 2.6 `src/process/bridge/dispatchBridge.ts`

| Change | Detail |
|--------|--------|
| `createGroupChat` handler | Accept `adminAgentType` param; store in `conversation.extra.adminAgentType` |
| `createGroupChat` handler | When `leaderAgentId` is specified, read leader's `presetAgentType` as `adminAgentType` |

**Concrete diff in createGroupChat:**

```typescript
// AFTER resolving leader agent...
const adminAgentType = params.adminAgentType
  || (leaderAgent ? leaderAgent.presetAgentType : undefined)
  || 'gemini';

await conversationService.createConversation({
  id,
  type: 'dispatch',
  name: displayName,
  model: defaultModel,
  extra: {
    workspace,
    dispatchSessionType: 'dispatcher',
    adminAgentType,          // <-- NEW
    // ... existing fields ...
  },
});
```

### 2.7 `src/common/adapter/ipcBridge.ts`

| Change | Detail |
|--------|--------|
| `dispatch.createGroupChat` params type | Add `adminAgentType?: string` |

```typescript
createGroupChat: bridge.buildProvider<
  IBridgeResponse<{ conversationId: string }>,
  {
    name?: string;
    workspace?: string;
    leaderAgentId?: string;
    modelOverride?: { providerId: string; useModel: string };
    seedMessages?: string;
    adminAgentType?: string;  // <-- NEW
  }
>('dispatch.create-group-chat'),
```

### 2.8 `src/process/task/agentTypes.ts`

No changes needed. The existing `AgentType` union already includes all target types: `'gemini' | 'acp' | 'codex' | 'openclaw-gateway' | 'nanobot' | 'remote' | 'dispatch'`.

---

## 3. Interface Changes Summary

| Type / Interface | Field | Before | After |
|-----------------|-------|--------|-------|
| `TemporaryTeammateConfig.agentType` | type | `'gemini'` (literal) | `AgentType` (union) |
| `StartChildTaskParams` | `agent_type` | -- | `AgentType?` (new) |
| `StartChildTaskParams` | `member_id` | -- | `string?` (new) |
| `StartChildTaskParams` | `isolation` | -- | `'worktree'?` (new, declared only) |
| `ChildTaskInfo` | `agentType` | -- | `AgentType?` (new) |
| `DispatchAgentData` | `adminAgentType` | -- | `AgentType?` (new) |
| IPC `createGroupChat` params | `adminAgentType` | -- | `string?` (new) |
| MCP `start_task` schema | `agent_type` | -- | `string` enum (new) |
| MCP `start_task` schema | `member_id` | -- | `string` (new) |
| MCP `start_task` schema | `isolation` | -- | `string` enum (new) |

---

## 4. Backward Compatibility Strategy

All new parameters are **optional** with defaults that preserve current behavior:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `DispatchAgentData.adminAgentType` | `'gemini'` | Existing dispatchers remain Gemini-based |
| `StartChildTaskParams.agent_type` | `'gemini'` | Existing `start_task` calls create Gemini children |
| `StartChildTaskParams.member_id` | `undefined` | No member reference, same as today |
| `StartChildTaskParams.isolation` | `undefined` | No isolation, same as today |
| IPC `adminAgentType` | `'gemini'` (resolved in bridge) | Existing createGroupChat callers unaffected |

**Database compatibility**: Existing dispatch conversations in the database have no `adminAgentType` in `extra`. The code reads `c.extra?.adminAgentType || 'gemini'`, so they continue to work as Gemini dispatchers.

**MCP schema compatibility**: The `start_task` tool adds optional fields. Existing orchestrator prompts that do not specify `agent_type` will produce Gemini children as before.

---

## 5. Event Listener Adaptation Detail

This is the most subtle aspect of the change. Currently:

1. `DispatchAgentManager` extends `BaseAgentManager` with `workerType='gemini'`.
2. `BaseAgentManager` starts a fork worker from `{workerType}.js` (e.g., `gemini.js`).
3. The fork worker emits events that get forwarded as `{workerType}.message` by `ForkTask`.
4. `DispatchAgentManager.init()` listens on `'gemini.message'`.

When the admin is ACP, the worker script is `acp.js`, and events arrive as `acp.message`. The listener in `DispatchAgentManager.init()` must be updated to listen on the correct event name.

**Approach**: Store `adminWorkerType` as an instance field; use it in `init()`:

```typescript
this.on(`${this.adminWorkerType}.message`, (data) => { ... });
```

The message handling logic (status tracking, tool call phase, message persistence) is generic and works regardless of which worker emits the events. The only worker-specific detail is the event name prefix.

**Caveat**: The `addOrUpdateMessage` call on line 299 passes `'gemini'` as a source identifier. This should become `this.adminWorkerType` for correct source attribution.

---

## 6. Child Agent Type Routing

When `startChildSession()` creates a child with `agent_type: 'acp'`:

1. Child conversation is created with `type: 'acp'` in DB.
2. `taskManager.getOrBuildTask(childId, opts)` reads the conversation from DB.
3. `WorkerTaskManager` calls `agentFactory.create(conversation, opts)`.
4. `AgentFactory` looks up `conversation.type` ('acp') in its registry.
5. The registered ACP creator builds an `AcpAgentManager`.

This already works because `workerTaskManagerSingleton.ts` registers creators for all agent types (gemini, acp, codex, openclaw-gateway, nanobot, remote). No changes to `AgentFactory` or `WorkerTaskManager` are needed.

**Graceful degradation for unregistered types**: If `agent_type` is not in the registry (e.g., a future engine not yet implemented), `AgentFactory.create()` throws `UnknownAgentTypeError`. We should catch this in `startChildSession()` and return a clear error to the orchestrator:

```typescript
try {
  const childTask = await this.taskManager.getOrBuildTask(childId, { ... });
} catch (err) {
  if (err instanceof UnknownAgentTypeError) {
    // Clean up: remove conversation from DB, unregister from tracker
    this.tracker.updateChildStatus(childId, 'failed');
    throw new Error(`Agent type "${childAgentType}" is not available. Available types: gemini, acp, codex, ...`);
  }
  throw err;
}
```

---

## 7. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Event name mismatch when admin is non-Gemini | High | Use `${this.adminWorkerType}.message` dynamic listener; add integration test |
| Non-Gemini workers may not support MCP stdio protocol | High | Validate: ACP/Codex workers need to support the `mcpServers` config passed in `start()`. If not, the dispatch MCP tools will not be available to the admin. **Mitigation**: G1 only enables non-Gemini admin if the worker supports MCP. For workers that don't, the admin falls back to Gemini with a warning. |
| `member_id` resolution not implemented in G1 | Low | Declare the parameter; `startChildSession()` returns error if `member_id` is used but resolution is not yet implemented. G3 implements the full resolution logic. |
| Existing dispatch conversations in DB lack `adminAgentType` | Low | Default to `'gemini'` when field is missing |
| `isolation: 'worktree'` passed but not implemented | Low | Parameter is accepted but ignored in G1. Log a warning. G2 implements. |
| Non-Gemini child agents may have different message formats | Medium | The `readTranscript()` method reads from DB, where messages are already in the unified `TMessage` format. The `listenForChildCompletion()` polling checks `task.status`, which is a standard `AgentStatus` field on all `IAgentManager` implementations. Both are engine-agnostic. |
| MCP server config injection for non-Gemini admin | Medium | Not all agents support `mcpServers` in their `start()` data. ACP uses a different mechanism. Need to verify each agent type's MCP support and adapt the config injection in `createBootstrap()`. |

---

## 8. Self-Debate

### Objection 1: "Why not create a DispatchSessionManager abstraction layer instead of modifying DispatchAgentManager directly?"

**Argument**: A new `DispatchSessionManager` class that sits above `DispatchAgentManager` and manages engine-agnostic sessions would provide cleaner separation. `DispatchAgentManager` would remain Gemini-specific, and new engine adapters would be siblings.

**Response**: This would be a significant refactor (new class, new interfaces, migration of state management) with high risk and no immediate functional benefit. The current design already has the right abstraction boundary: `BaseAgentManager` accepts `workerType` as a parameter, `AgentFactory` routes by `type`, and `WorkerTaskManager` orchestrates. We only need to stop hardcoding `'gemini'` in three places. The proposed change is minimal, surgical, and preserves the existing architecture. A larger abstraction can be considered in G4 if the dispatch system grows significantly.

### Objection 2: "The MCP dispatch tools (start_task, read_transcript, etc.) are served via a Gemini CLI-specific MCP server. Non-Gemini admins may not support MCP stdio."

**Argument**: The dispatch MCP server (`dispatchMcpServerScript.ts`) communicates via stdio JSON-RPC, which is consumed by Gemini CLI. ACP agents use a different protocol (ACP protocol with sessions). Codex uses its own CLI. These agents may not have MCP client support, making the dispatch tools unavailable when the admin is non-Gemini.

**Response**: This is a valid concern. The G1 scope should be explicit:

- **Admin engine**: G1 enables the `adminAgentType` parameter and stores it, but the admin MCP tool injection only works for engines that support MCP stdio (currently only Gemini CLI). For non-Gemini admins, the dispatch MCP tools cannot be injected. This means non-Gemini admins cannot orchestrate child tasks via `start_task`. **Practical implication**: In G1, non-Gemini admin support is "declared but limited" -- the admin conversation works, but without dispatch tools, it functions as a regular chat, not an orchestrator.
- **Child engine**: Fully functional in G1. Children can be any registered agent type because they don't need MCP tools -- they just receive a prompt and execute.
- **Full non-Gemini admin orchestration** requires each engine to support MCP or an alternative tool injection mechanism, which is a G4+ concern.

This is acceptable because the primary G1 value is **child engine diversity** (e.g., Gemini admin dispatching to ACP/Codex workers), not admin engine diversity.

### Objection 3: "Adding `agent_type` to the MCP tool schema pollutes the orchestrator's decision space. The AI may pick wrong engine types or hallucinate unsupported ones."

**Argument**: Giving the orchestrator AI the ability to choose engine types adds complexity. The AI might specify `agent_type: 'codex'` when Codex credentials are not configured, leading to runtime failures.

**Response**: Three mitigations:

1. **Schema enum constraint**: The `agent_type` field uses `enum: ['gemini', 'acp', 'codex', ...]`, limiting AI choices to valid values.
2. **Runtime validation**: `startChildSession()` validates the agent type against the factory registry and returns a clear error if the type is unavailable or credentials are missing.
3. **Prompt guidance**: `buildDispatchSystemPrompt()` already injects available models. We extend this to inject available agent types, so the orchestrator AI knows which engines are actually configured and usable.
4. **Default behavior**: If `agent_type` is omitted, Gemini is used. Most orchestrator prompts generated before G1 will not specify `agent_type`, so behavior is unchanged.

---

## 9. Implementation Order

1. **Phase A** (types): Update `dispatchTypes.ts` -- widen `TemporaryTeammateConfig.agentType`, add fields to `StartChildTaskParams` and `ChildTaskInfo`.
2. **Phase B** (admin unbind): Update `DispatchAgentManager` constructor to accept `adminAgentType`; update event listener; update `workerTaskManagerSingleton.ts` dispatch factory.
3. **Phase C** (child unbind): Update `startChildSession()` to use `agent_type` for child conversation type; add `UnknownAgentTypeError` catch.
4. **Phase D** (MCP schema): Update `DispatchMcpServer.ts` and `dispatchMcpServerScript.ts` tool schemas and parsing.
5. **Phase E** (IPC + bridge): Update `ipcBridge.ts` and `dispatchBridge.ts` to pass `adminAgentType`.
6. **Phase F** (prompt): Update `buildDispatchSystemPrompt()` to inject available agent types.

---

## 10. Acceptance Criteria

### AC-1: Admin worker type is configurable
- Creating a dispatch conversation with `extra.adminAgentType = 'gemini'` starts a Gemini worker (same as today).
- Creating with `extra.adminAgentType = 'acp'` starts an ACP worker.
- Omitting `adminAgentType` defaults to `'gemini'`.

### AC-2: Child agent type is configurable via start_task
- Calling `start_task` with `agent_type: 'acp'` creates a child conversation with `type: 'acp'` and starts an ACP worker.
- Calling `start_task` without `agent_type` creates a Gemini child (backward compatible).
- Calling `start_task` with an unregistered `agent_type` returns a clear error message (not a crash).

### AC-3: MCP tool schema includes new parameters
- `start_task` MCP tool schema includes `agent_type` (string enum), `member_id` (string), and `isolation` (string enum).
- Both `DispatchMcpServer.getToolSchemas()` and `dispatchMcpServerScript.ts TOOL_SCHEMAS` are in sync.

### AC-4: Backward compatibility - existing group chats work unchanged
- Existing dispatch conversations in the database (with no `adminAgentType` in extra) continue to function as Gemini dispatchers.
- Existing `start_task` calls (without `agent_type`) continue to create Gemini children.
- No database migration required.

### AC-5: IPC bridge accepts adminAgentType
- `dispatch.createGroupChat` IPC channel accepts optional `adminAgentType` parameter.
- `dispatchBridge.ts` stores it in `conversation.extra.adminAgentType`.
- When `leaderAgentId` is specified and the leader has a `presetAgentType`, that type is used as `adminAgentType` automatically.

### AC-6: Child task lifecycle works for non-Gemini children
- A non-Gemini child (e.g., ACP) can be started, polled for completion, have its transcript read, and receive follow-up messages.
- `listenForChildCompletion()` correctly detects completion for non-Gemini workers via the universal `task.status` check.

### AC-7: Event listener adapts to admin worker type
- `DispatchAgentManager.init()` listens on `${adminWorkerType}.message` instead of hardcoded `'gemini.message'`.
- Admin messages from a non-Gemini worker (if supported) are correctly captured and persisted.

### AC-8: Graceful degradation for unsupported engines
- If `agent_type` refers to a registered but non-functional engine (e.g., missing credentials), the error propagates as a task failure with a descriptive message, not an unhandled exception.
- `isolation: 'worktree'` is accepted but produces a log warning and is ignored in G1.
- `member_id` is accepted but returns an error in G1 ("member_id resolution not yet implemented").

### AC-9: Type definitions are correct
- `TemporaryTeammateConfig.agentType` accepts all values in the `AgentType` union.
- No TypeScript compilation errors after changes (`bunx tsc --noEmit` passes).

### AC-10: DispatchAgentData type includes adminAgentType
- The `DispatchAgentData` type used by the constructor includes `adminAgentType?: AgentType`.
- The `workerTaskManagerSingleton.ts` dispatch factory reads and passes this field.

---

## 11. Out of Scope (explicitly excluded)

| Item | Owner |
|------|-------|
| Worktree isolation implementation | G2 |
| Permission/approval model | G2 |
| `stop_child` / `ask_user` tools | G2 |
| CreateGroupChatModal UI changes | G3 |
| Member bar / Tab bar UI | G3 |
| Welcome message injection | G3 |
| Manual member addition UI | G3 |
| Cost tracking | G4 |
| Project context scanning | G4 |
| Team config loading | G4 |
| Cross-session memory | G4 |

[DONE]
