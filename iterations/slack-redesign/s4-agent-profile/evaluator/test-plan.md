# S4: Agent Profile — Evaluator Test Plan

**Phase**: S4 Agent Profile + DM Chat Entry
**Evaluator role**: test_writing (spec-first, parallel with Developer)
**Status**: [DONE]

---

## Test Files Written

| File                                         | Tests    | Environment       |
| -------------------------------------------- | -------- | ----------------- |
| `tests/unit/agent/AgentProfile.dom.test.tsx` | 36 tests | jsdom (DOM)       |
| `tests/unit/agent/useAgentProfile.test.ts`   | 20 tests | node (renderHook) |

---

## Coverage by Acceptance Criteria

| AC    | Description                                                             | Test IDs                          |
| ----- | ----------------------------------------------------------------------- | --------------------------------- |
| AC-1  | Route renders without errors                                            | AP-001                            |
| AC-2  | Unknown agentId shows "Agent not found" empty state + back button       | AP-002, AP-003, UAP-001, UAP-008  |
| AC-3  | Back button calls navigate(-1)                                          | AP-004                            |
| AC-4  | Avatar: emoji / logo img / letter fallback                              | AP-006, AP-007, AP-008            |
| AC-5  | Agent name as primary heading                                           | AP-005                            |
| AC-6  | Tag badge: "Permanent" (green) or "Temporary" (gray)                    | AP-009, AP-010                    |
| AC-7  | Source badge: Preset / Custom / CLI / Dispatch Teammate                 | AP-011, AP-012                    |
| AC-8  | "Start new conversation" navigates to /guid with prefillAgentId         | AP-013, AP-014                    |
| AC-9  | "Edit config" visible for permanent agents                              | AP-015                            |
| AC-10 | "Edit config" hidden for temporary agents                               | AP-016                            |
| AC-11 | Config section displays backend, description, workspaces                | AP-017, AP-018, AP-019            |
| AC-12 | Edit config routes: custom→/settings/agent, preset→/settings/assistants | AP-020, AP-021                    |
| AC-13 | Conversation list filtered by agentId                                   | AP-022, UAP-006, UAP-007          |
| AC-14 | Conversations sorted by updatedAt desc                                  | AP-023, UAP-009, UAP-010, UAP-011 |
| AC-15 | Row shows title, time, workspace                                        | AP-034                            |
| AC-16 | Click conversation row → navigate /conversation/:id                     | AP-024                            |
| AC-17 | Empty state when no conversations                                       | AP-025                            |
| AC-24 | i18n compliance — no hardcoded English strings                          | AP-026–AP-031                     |

---

## Approach

### Written Spec-First

Tests are written against `tech-design.md` Acceptance Criteria before implementation exists. All source paths referenced (`@/renderer/pages/agent/*`) are the _intended_ implementation paths from the tech design file list.

### Mock Strategy

**`AgentProfile.dom.test.tsx`**:

- `react-router-dom` — mocked fully; `useParams` returns encoded agentId, `useNavigate` returns spy
- `react-i18next` — mock `t()` returns key, exposing any hardcoded strings
- `@icon-park/react` — stub components with `data-testid`
- `@arco-design/web-react` — partial mock: Button, Tag, Empty, Descriptions rendered as testable HTML; rest uses real Arco
- `useAgentProfile` hook — fully mocked via `vi.mock()`; tests drive data via `mockUseAgentProfile.mockReturnValue(...)`
- CSS Modules — Proxy returning property name as string

**`useAgentProfile.test.ts`**:

- `useAgentRegistry` — mocked; tests mutate `mockRegistry` Map directly
- `useConversationHistoryContext` — mocked; tests mutate `mockConversations` array directly
- `getAgentLogo` — mocked with `vi.fn()` to verify it is called with correct identity
- `resolveAgentId` — NOT mocked; real implementation is used (pure function, no side effects)

### Risk-First Test Order

Riskiest scenarios tested first per testing skill:

1. Null/not-found agent → empty state (AC-2, AP-002, UAP-001)
2. URL decoding of agentId before hook call (AP-032)
3. Conversation sort order stability (UAP-009–UAP-011)
4. Edit config routing by agent source (AP-020, AP-021)
5. i18n regression guards (AP-026–AP-031)

### Failure Paths Covered

Each describe block includes at least one failure path:

- `useAgentProfile` returns `null` → empty state, not crash
- `navigate` not called on initial render (AP-033)
- `onClick` / `navigate` not triggered without interaction
- Temporary agent has no "Edit config" button (AP-016)
- Conversations from other agents excluded from list (UAP-006)
- Workspace deduplication (UAP-013)
- `updatedAt` undefined does not throw (UAP-019)

---

## What is NOT Tested Here

These are left to integration/e2e tests or out-of-scope for S4 unit tests:

- `AgentDMGroup` avatar click navigation (AC-18–AC-20) — covered by existing GroupedHistory tests
- `MemberCard` / `GroupMemberSider` navigation changes (AC-21–AC-23) — covered by existing `tests/unit/dispatch/MemberCard.dom.test.tsx`
- Lazy loading of the route via `React.lazy` (AC-29) — routing infrastructure, e2e scope
- UnoCSS / CSS Modules visual correctness (AC-27) — visual regression scope

---

## Instructions for Developer

The test files are already written and waiting. When implementation is ready:

```bash
bun run test tests/unit/agent/
```

Expected: all tests pass. If a test fails, check:

1. The `data-testid` attributes match those used in the tests
2. Navigation calls match the exact paths in AC-12 and AC-8
3. i18n keys match those listed in tech-design.md § Implementation Notes
4. The hook exports exactly `useAgentProfile` from `@/renderer/pages/agent/hooks/useAgentProfile`
5. The page default-exports `AgentProfilePage` from `@/renderer/pages/agent/index.tsx`
