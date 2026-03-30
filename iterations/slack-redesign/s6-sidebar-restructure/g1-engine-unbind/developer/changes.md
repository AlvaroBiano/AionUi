# G1: Engine Unbind - Developer Changes Log

**Date**: 2026-03-30
**Branch**: feat/dispatch
**Status**: Complete

---

## Summary

Implemented G1 engine unbind per tech-design. Decoupled Dispatch system from Gemini hardcoding across 7 files.

---

## Changed Files

### 1. `src/process/task/dispatch/dispatchTypes.ts`
- Imported `AgentType` union from `agentTypes.ts`
- Widened `TemporaryTeammateConfig.agentType` from literal `'gemini'` to `AgentType`
- Added `agent_type?: AgentType`, `member_id?: string`, `isolation?: 'worktree'` to `StartChildTaskParams`
- Added `agentType?: AgentType` to `ChildTaskInfo`

### 2. `src/process/task/dispatch/DispatchAgentManager.ts`
- Added `AgentType` import
- Added `adminAgentType?: AgentType` to `DispatchAgentData` type
- Added `private readonly adminWorkerType: AgentType` instance field
- Constructor: reads `data.adminAgentType || 'gemini'` and passes as `workerType` to `BaseAgentManager`
- `init()`: event listener changed from hardcoded `'gemini.message'` to `${this.adminWorkerType}.message`
- `addOrUpdateMessage` call: removed hardcoded `'gemini'` backend arg (pre-existing type error; param unused in impl)
- `startChildSession()`: added `member_id` error (G3 stub), `isolation` warning (G2 stub)
- `startChildSession()`: resolves `childAgentType = params.agent_type || 'gemini'`; uses it for child conversation `type`
- Child conversation creation: cast to `TChatConversation as unknown` to support dynamic type
- `ChildTaskInfo` registration: includes `agentType: childAgentType`

### 3. `src/process/task/dispatch/DispatchMcpServer.ts`
- `handleToolCall('start_task')`: parses `agent_type`, `member_id`, `isolation` from args
- Teammate `agentType` now uses `params.agent_type || 'gemini'` instead of hardcoded `'gemini'`
- `getToolSchemas()`: added `agent_type` (enum), `member_id` (string), `isolation` (enum) to `start_task` schema

### 4. `src/process/task/dispatch/dispatchMcpServerScript.ts`
- `TOOL_SCHEMAS[0]` (start_task): added `agent_type`, `member_id`, `isolation` properties to mirror `DispatchMcpServer.getToolSchemas()`

### 5. `src/process/task/workerTaskManagerSingleton.ts`
- `dispatch` factory: passes `adminAgentType: c.extra?.adminAgentType || 'gemini'` to `DispatchAgentManager`

### 6. `src/process/bridge/dispatchBridge.ts`
- Leader lookup: extended inline type to include `presetAgentType?: string`; captured as `leaderPresetAgentType`
- Resolves `adminAgentType = params.adminAgentType || leaderPresetAgentType || 'gemini'`
- Stores `adminAgentType` in `conversation.extra.adminAgentType`

### 7. `src/common/adapter/ipcBridge.ts`
- `dispatch.createGroupChat` params: added `adminAgentType?: string`

---

## Quality Checks

- `bun run format`: passed (0 errors)
- `bun run lint:fix`: passed (0 errors, 1321 pre-existing warnings)
- `bunx tsc --noEmit`: 4 pre-existing errors, 0 new errors introduced

Pre-existing TS errors (not introduced by G1):
- `src/process/bridge/conversationBridge.ts(300)`
- `src/process/task/dispatch/DispatchAgentManager.ts(911,923)` — pre-existing `TMessage`/`AcpBackendAll` issues
- `src/renderer/pages/conversation/dispatch/hooks/useTaskPanelTranscript.ts(12)`

---

## Backward Compatibility

All new parameters are optional with `'gemini'` defaults. Existing dispatch conversations and start_task calls are unaffected.

[DONE]
