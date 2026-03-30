# G1 Engine Unbind - Test Plan

**Date**: 2026-03-30
**Evaluator Role**: test_writing (Evaluator)
**Test File**: `tests/unit/dispatchEngineUnbind.test.ts`

---

## Overview

Spec-first tests written in parallel with Developer implementation.
These tests validate the Acceptance Criteria in `tech-design.md`.
Some import paths (e.g., `DispatchAgentManager` accepting `adminAgentType`)
may not resolve until the Developer lands the corresponding changes.

---

## Test Coverage by AC

### AC-1: Admin worker type is configurable
**Tests**:
- `DispatchAgentManager constructor - admin worker type`
  - accepts no `adminAgentType` (defaults to gemini)
  - accepts explicit `adminAgentType: 'gemini'`
  - accepts `adminAgentType: 'acp'`
  - accepts `adminAgentType: 'codex'`
  - stores `adminWorkerType` as instance field
- `workerTaskManagerSingleton dispatch factory`
  - reads `adminAgentType` from `conv.extra`
  - defaults to `'gemini'` when `extra.adminAgentType` absent
  - defaults to `'gemini'` when `extra` is absent (legacy DB rows)

**Verification strategy**: Constructor smoke tests + private field inspection via `(mgr as any).adminWorkerType`.

---

### AC-2: Child agent type configurable via start_task
**Tests**:
- `DispatchMcpServer.handleToolCall start_task - child agent_type parsing`
  - passes `agent_type: 'acp'` to `startChildSession` params
  - does NOT pass `agent_type` when omitted (backward compat)
  - passes `agent_type: 'codex'` correctly
  - passes `member_id` when provided
  - passes `isolation: 'worktree'` when provided
- `Child conversation type routing`
  - resolves to `'acp'` when `agent_type='acp'`
  - resolves to `'gemini'` when `agent_type` omitted
  - resolves to `'codex'` when `agent_type='codex'`
  - resolves to `'nanobot'` when `agent_type='nanobot'`

**Verification strategy**: Spy on `startChildSession` handler, assert called params.

---

### AC-3: MCP tool schema includes new parameters
**Tests**:
- `DispatchMcpServer.getToolSchemas includes new fields`
  - `start_task` schema has `agent_type` string property
  - `agent_type` enum includes all 6 engine types
  - schema has `member_id` string property
  - schema has `isolation` with `'worktree'` enum
  - new fields are NOT in `required` array
- `dispatchMcpServerScript TOOL_SCHEMAS` (advisory)
  - `TOOL_SCHEMAS[start_task]` has `agent_type` property (if exported)

**Verification strategy**: Static schema inspection via `DispatchMcpServer.getToolSchemas()`.

---

### AC-4: Backward compatibility
**Tests**:
- `Backward compatibility - defaults to gemini`
  - `startChildSession` defaults to `'gemini'` when no `agent_type`
  - `adminWorkerType` defaults to `'gemini'` when `adminAgentType` absent
  - `teammate.agentType` defaults to `'gemini'` in legacy calls

**Verification strategy**: Null-coalescing logic `|| 'gemini'` explicitly tested.

---

### AC-5: IPC bridge accepts adminAgentType
**Tests**:
- `IPC bridge createGroupChat params include adminAgentType`
  - params type accepts `adminAgentType: string`
  - `adminAgentType` is optional (backward compat)

**Verification strategy**: Type-level structural assertion on mock params object.

---

### AC-7: Event listener adapts to admin worker type
**Tests**:
- `Event listener uses dynamic adminWorkerType`
  - Default gemini: manager constructs without error, uses `'gemini.message'`
  - ACP admin: `(mgr as any).adminWorkerType === 'acp'`
  - Default `adminWorkerType` is `'gemini'` when not specified

**Verification strategy**: Private field inspection; full event emission requires integration test.

---

### AC-8: Graceful degradation
**Tests**:
- `isolation: 'worktree'` param accepted without throwing
- `member_id` param accepted in type system

**Verification strategy**: Type-level acceptance test; runtime behavior (warning log) not tested in unit scope.

---

### AC-9: Type definitions are correct
**Tests**:
- `AgentType` union includes all 7 engine types
- `StartChildTaskParams` can include `agent_type`, `member_id`, `isolation`
- `StartChildTaskParams` without `agent_type` (undefined — backward compat)
- `TemporaryTeammateConfig.agentType` accepts any `AgentType` (not just `'gemini'`)
- `ChildTaskInfo` includes optional `agentType` field

**Verification strategy**: TypeScript structural type assignment (compile-time + runtime shape).

---

### AC-10: DispatchAgentData includes adminAgentType
**Tests**:
- Constructor accepts `adminAgentType` in data object
- Constructor does not throw when `adminAgentType` absent

**Verification strategy**: Constructor instantiation smoke test.

---

## Not Covered (Out of Scope for Unit Tests)

| AC | Reason |
|----|--------|
| AC-2 (unregistered type → clear error) | Requires real `AgentFactory` with mock registry; integration test |
| AC-6 (non-Gemini child lifecycle) | End-to-end: needs real worker spin-up |
| AC-7 (event emission from non-Gemini worker) | Integration: requires forked ACP/Codex process |
| AC-8 (member_id returns error) | Requires `startChildSession` implementation to be landed first |
| AC-5 (dispatchBridge stores adminAgentType) | Covered by dispatchBridge integration test (not written here) |

---

## Test File Location

`/Users/veryliu/Documents/GitHub/AionUi/tests/unit/dispatchEngineUnbind.test.ts`

---

## Mock Strategy

| Dependency | Mock Approach |
|-----------|---------------|
| `IpcAgentEventEmitter` | `vi.fn()` class stub |
| `BaseAgentManager` | NOT mocked; real import (tests constructor wiring) |
| `DispatchSessionTracker` | `vi.fn()` class with stub methods |
| `DispatchNotifier` | `vi.fn()` class with stub methods |
| `DispatchResourceGuard` | `vi.fn()` with `checkConcurrencyLimit → null` |
| `DispatchMcpServer` (in constructor tests) | Real import for schema tests; mock for manager tests |
| `buildDispatchSystemPrompt` | Returns `'mock-system-prompt'` |
| `ProcessConfig` | Returns empty array |
| `@/common` (ipcBridge) | Stub with `responseStream.emit` |
| Node `fs.promises.stat` | Not mocked (workspace tests not included in this spec) |

---

## Run Command

```bash
bun run test tests/unit/dispatchEngineUnbind.test.ts
```

[DONE]
