# S3 Group Chat Member Sidebar — Evaluator Test Plan

**Phase**: S3 — Group Chat Member Sidebar
**Evaluator role**: test_writing (spec-first, skeptical)
**Written against**: `architect/tech-design.md` Acceptance Criteria
**Status**: [DONE]

---

## Test Files

| File                                                | Tests | ACs Covered                                |
| --------------------------------------------------- | ----- | ------------------------------------------ |
| `tests/unit/dispatch/GroupMemberSider.dom.test.tsx` | 24    | AC-1, AC-2, AC-3, AC-7, AC-9, AC-10, AC-11 |
| `tests/unit/dispatch/MemberCard.dom.test.tsx`       | 31    | AC-2, AC-3, AC-4, AC-5, AC-9, AC-10        |

---

## AC Coverage Matrix

| AC    | Description                                                    | Test IDs                                                   | Status   |
| ----- | -------------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| AC-1  | Member count in header = N children + 1 dispatcher             | GMS-001, GMS-002, GMS-003                                  | Covered  |
| AC-2  | Crown icon (leader badge) on dispatcher row                    | GMS-004, GMS-005, GMS-020, MC-004, MC-005                  | Covered  |
| AC-3  | CheckOne (permanent) / Timer (temporary) type badge            | GMS-007, GMS-008, GMS-009, MC-006, MC-007, MC-008, MC-008b | Covered  |
| AC-4  | Hover popover: model, workspace last segment, rules ≤100 chars | MC-010–MC-019, MC-030, MC-031                              | Covered  |
| AC-5  | Click selects member / triggers onClick                        | MC-020, MC-021, MC-029                                     | Covered  |
| AC-6  | Mutual exclusion on narrow viewports                           | Not covered (CSS/integration test needed)                  | Deferred |
| AC-7  | Toggle button collapses/expands sider                          | GMS-010, GMS-011, GMS-012, GMS-013                         | Covered  |
| AC-8  | Bridge returns enriched member data                            | Not covered (bridge integration test needed)               | Deferred |
| AC-9  | No emoji in badges                                             | GMS-006, GMS-009, MC-009                                   | Covered  |
| AC-10 | i18n compliance — no hardcoded English strings                 | GMS-016, GMS-017, MC-026, MC-027, MC-028                   | Covered  |
| AC-11 | Dispatcher row click triggers settings callback                | GMS-018, GMS-019                                           | Covered  |
| AC-12 | TypeScript strict compliance                                   | Not a unit test — verified by `bunx tsc --noEmit`          | Deferred |

---

## Deferred ACs

- **AC-6** (narrow viewport auto-collapse): Requires viewport resize simulation; better tested as a CSS integration or e2e test via CDP.
- **AC-8** (bridge enrichment): Requires main-process bridge test; recommend adding to `tests/integration/` against `dispatchBridge.ts` mock.
- **AC-12** (TypeScript): Run `bunx tsc --noEmit` as part of CI — not a Vitest test.

---

## Test Design Decisions

### 1. Spec-first stance

All tests were written from the tech-design AC spec, not by reading implementation code. The components (`GroupMemberSider.tsx`, `MemberCard.tsx`) did not exist at test-writing time. This ensures the tests are not tautologically coupled to implementation details.

### 2. Mock strategy

- **`react-i18next`**: `t()` returns the i18n key string directly. Any hardcoded English in the component will fail the i18n compliance tests.
- **`@icon-park/react`**: Each icon renders a `<span data-testid='icon-*'>`. Tests verify icon presence by `testid`, making badge tests resilient to SVG implementation changes.
- **`@arco-design/web-react`**: `Popover` renders its `content` prop in a `<div data-testid='popover-content'>`. This allows tests to inspect popover content without triggering hover timers. `Tooltip` renders its `content` prop inline.
- **CSS Modules**: Proxy that returns class name strings as-is, preserving class-based assertions.

### 3. Popover content approach

The Arco `Popover` in the mock always renders content immediately (no hover delay). This is intentional — unit tests should not rely on hover timing (200ms delay from AC-4). The hover interaction timing is acceptable to omit at the unit level; it belongs in e2e or integration tests.

### 4. Edge cases covered

- `presetRules` exactly 100 chars (no ellipsis)
- `presetRules` > 100 chars (truncate at 100 + `...`)
- `presetRules` undefined (`rulesNone` i18n key shown)
- Workspace with trailing slash (last non-empty segment)
- Workspace with no path separator (show as-is)
- `leaderAgentId` undefined (Crown hidden)
- `members` array empty (empty-state message + count = 1)
- All optional member fields undefined (no crash)

### 5. Failure paths

Every `describe` block contains at least one failure path:

- Crown NOT shown when `isLeader=false`
- Timer NOT shown when `isPermanent=true` (mutual exclusion)
- `onToggleCollapse` NOT called on render
- `onClick` NOT called on render
- No hardcoded English strings

---

## Risk Assessment

| Risk                                                               | Severity | Mitigation                                           |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------- |
| Workspace last-segment extraction has off-by-one on trailing slash | High     | MC-031 specifically tests this boundary              |
| presetRules truncation off-by-one at exactly 100 chars             | High     | MC-016 tests exactly-100 boundary                    |
| Crown icon accidentally rendered for non-leader members            | Medium   | MC-005 guards this                                   |
| Timer/CheckOne swapped                                             | Medium   | MC-008, MC-008b test mutual exclusion                |
| i18n key typos in component                                        | Medium   | GMS-016, GMS-017, MC-026–028 catch hardcoded strings |
| Member count formula wrong (missing +1 for dispatcher)             | Medium   | GMS-001, GMS-002, GMS-003 all verify the N+1 formula |
