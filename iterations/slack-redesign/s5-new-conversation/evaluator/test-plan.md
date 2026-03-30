# S5: New Conversation Flow — Evaluator Test Plan

**Phase**: S5 — New Conversation flow (agent selection modal + GuidPage prefill)
**Evaluator role**: test_writing (spec-first, Vitest + React Testing Library)
**Status**: [DONE]

---

## 1. Scope

Two test files cover all Acceptance Criteria from the tech design:

| File                                          | Component under test                           | ACs covered                |
| --------------------------------------------- | ---------------------------------------------- | -------------------------- |
| `tests/unit/AgentSelectionModal.dom.test.tsx` | `AgentSelectionModal` component                | AC-2, 3, 4, 5, 6, 7, 8, 17 |
| `tests/unit/DMSectionHeader.dom.test.tsx`     | DM section header in `WorkspaceGroupedHistory` | AC-1, 2, 6, 9, 10, 17, 21  |

> AC-11 to AC-15 (GuidPage + useGuidAgentSelection prefill) are covered by the
> existing `tests/unit/guidAgentHooks.dom.test.ts` and `guidAgentSelection.dom.test.ts`
> suites. The S5 architect specifies these as modifications to existing hooks, so the
> correct evaluator action is to note that new tests must be added to those files once
> the implementation lands, not to create new top-level files that duplicate the hook
> test harness.

---

## 2. Test IDs and AC traceability

### AgentSelectionModal.dom.test.tsx (31 tests)

| Test ID | AC    | Description                                       |
| ------- | ----- | ------------------------------------------------- |
| ASM-001 | AC-2  | Modal renders when visible=true                   |
| ASM-002 | AC-2  | Modal absent when visible=false                   |
| ASM-003 | AC-17 | Modal title uses i18n key                         |
| ASM-004 | AC-3  | "Saved Assistants" section header via i18n        |
| ASM-005 | AC-3  | "CLI Agents" section header via i18n              |
| ASM-006 | AC-3  | All permanent agents rendered                     |
| ASM-007 | AC-3  | All temporary agents rendered                     |
| ASM-008 | AC-3  | Permanent section appears before temporary in DOM |
| ASM-009 | AC-4  | Emoji avatar rendered                             |
| ASM-010 | AC-4  | Letter fallback for agents without avatar         |
| ASM-011 | AC-4  | Source badge rendered per agent card              |
| ASM-012 | AC-5  | Search input present                              |
| ASM-013 | AC-17 | Search placeholder uses i18n key                  |
| ASM-014 | AC-5  | Search filters by name (case-insensitive)         |
| ASM-015 | AC-5  | Search is case-insensitive (uppercase query)      |
| ASM-016 | AC-5  | Search filters by agent id prefix                 |
| ASM-017 | AC-5  | Clearing search restores all agents               |
| ASM-018 | —     | No agents visible when query matches nothing      |
| ASM-019 | AC-6  | Clicking card calls onSelect(agentId)             |
| ASM-020 | AC-6  | Clicking CLI agent calls onSelect with CLI id     |
| ASM-021 | AC-7  | Cancel button calls onClose                       |
| ASM-022 | AC-7  | onSelect not called when modal dismissed          |
| ASM-023 | AC-8  | Search resets after modal close/reopen cycle      |
| ASM-024 | —     | No crash when agents array is empty               |
| ASM-025 | —     | Renders with only permanent agents                |
| ASM-026 | —     | Renders with only temporary agents                |
| ASM-027 | —     | onSelect/onClose not called on initial render     |
| ASM-028 | AC-17 | "Select an agent" not hardcoded English           |
| ASM-029 | AC-17 | "Search agents..." not hardcoded English          |
| ASM-030 | AC-17 | "Saved Assistants" not hardcoded English          |
| ASM-031 | AC-17 | "CLI Agents" not hardcoded English                |

### DMSectionHeader.dom.test.tsx (13 tests)

| Test ID | AC    | Description                                                        |
| ------- | ----- | ------------------------------------------------------------------ |
| DM-001  | AC-9  | DM section header renders with 0 DM groups                         |
| DM-002  | AC-9  | "+" button present in expanded DM section header                   |
| DM-003  | AC-2  | Clicking "+" opens AgentSelectionModal                             |
| DM-004  | AC-2  | Modal closes when onClose fires                                    |
| DM-005  | AC-6  | onSelect triggers navigate('/guid', { state: { prefillAgentId } }) |
| DM-006  | AC-10 | "No conversations yet" shown when empty + expanded                 |
| DM-007  | AC-10 | Empty-state not shown when DM groups exist                         |
| DM-008  | AC-9  | DM section label hidden when sidebar collapsed                     |
| DM-009  | AC-9  | "+" hidden when sidebar collapsed                                  |
| DM-010  | AC-17 | "Direct Messages" not hardcoded English                            |
| DM-011  | AC-17 | "No conversations yet" not hardcoded English                       |
| DM-012  | —     | Modal not open on initial render                                   |
| DM-013  | —     | navigate not called on initial render                              |

---

## 3. ACs NOT covered by these two files

| AC    | Reason                                                    | Where to add tests                                            |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------- |
| AC-11 | GuidPage reads `location.state.prefillAgentId = 'claude'` | `guidAgentSelection.dom.test.ts` (add after hook is modified) |
| AC-12 | GuidPage reads `prefillAgentId = 'preset:word-creator'`   | `guidAgentSelection.dom.test.ts`                              |
| AC-13 | GuidPage reads `prefillAgentId = 'custom:abc123'`         | `guidAgentSelection.dom.test.ts`                              |
| AC-14 | No `prefillAgentId` → loads from storage (regression)     | `guidAgentSelection.dom.test.ts`                              |
| AC-15 | Unknown `prefillAgentId` → graceful fallback to storage   | `guidAgentSelection.dom.test.ts`                              |
| AC-16 | AgentProfilePage "Start conversation" end-to-end          | Already covered by `agent/AgentProfile.dom.test.tsx` AP-014   |
| AC-18 | Arco components used for all interactive elements         | Structural (lint/import verification, not RTL)                |
| AC-19 | Icons from `@icon-park/react`                             | Structural (lint verification)                                |
| AC-20 | TypeScript strict mode, no `any`                          | TypeScript compiler check (`bunx tsc --noEmit`)               |
| AC-22 | Directory child count                                     | File system check (architect responsibility)                  |

---

## 4. Mock strategy

All tests follow the project's spec-first, mock-everything convention:

- **`react-i18next`**: `t(key) => key` — hardcoded strings cause instant test failures.
- **`@arco-design/web-react`**: Thin wrappers rendering `data-testid` attributes. `Modal` renders children when `visible=true` only.
- **`@icon-park/react`**: Stub `<span data-testid='icon-*' />` elements.
- **`useGroupedHistory`**: `vi.fn()` returns controlled `AgentDMGroupData[]`.
- **`useAgentRegistry`**: Returns empty `Map` by default.
- **`AgentSelectionModal`** (in DM header tests): Thin mock that records props via `vi.fn()`.
- **CSS Modules**: `Proxy` returning class name as string.
- **`swr`**: Returns `{ data: undefined }` to suppress async fetching.

---

## 5. Risk areas and failure paths covered

| Risk                                         | Test(s)                 |
| -------------------------------------------- | ----------------------- |
| Modal opens when it should not (on render)   | ASM-027, DM-012         |
| navigate fires without user action           | DM-013                  |
| Search state persists across close/reopen    | ASM-023                 |
| Empty agent list causes crash                | ASM-024                 |
| Hardcoded English bypasses i18n              | ASM-028–031, DM-010–011 |
| Dismissing modal triggers navigation         | ASM-022                 |
| DM header disappears with 0 conversations    | DM-001, DM-002          |
| Permanent/temporary ordering broken          | ASM-008                 |
| Letter fallback missing for no-avatar agents | ASM-010                 |
| Search includes id matching                  | ASM-016                 |

---

## 6. Notes for implementation team

1. The `AgentSelectionModal` component is expected at:
   `src/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.tsx`

2. The `AgentSelectionModalProps` type must be exported from:
   `src/renderer/pages/conversation/GroupedHistory/types.ts`

3. The DM section header "+" must use `data-testid='new-dm-btn'` on the clickable
   container (or the tests fall back to `icon-plus.parentElement` — either works, but
   an explicit testid is more robust).

4. Each agent card should use `data-testid={`agent-card-${agent.id}`}` for reliable
   click targeting. Test ASM-019 falls back to `parentElement` if missing.

5. Source badge i18n key expected pattern: `dispatch.sidebar.source{Source}` where
   `{Source}` is `Preset` | `Custom` | `Cli` | `Dispatch`. Adjust ASM-011 if the
   actual key differs.
