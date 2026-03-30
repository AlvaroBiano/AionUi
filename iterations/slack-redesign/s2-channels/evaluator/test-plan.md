# S2 Channels Area Redesign — Evaluator Test Plan

**Phase:** S2 — Channels Area Redesign
**Evaluator role:** Spec-first; tests were written against `tech-design.md` before implementation.
**Test framework:** Vitest 4 + React Testing Library (jsdom environment)
**Written:** 2026-03-29

---

## 1. Files Produced

| File                                                           | Purpose                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| `tests/unit/ChannelSection.dom.test.tsx`                       | Unit tests for the new `ChannelSection` component             |
| `tests/unit/ConversationRowChannel.dom.test.tsx`               | Tests for S2 changes to `ConversationRow` (icon + unread dot) |
| `iterations/slack-redesign/s2-channels/evaluator/test-plan.md` | This document                                                 |

---

## 2. AC Coverage Matrix

| AC ID      | Description                                                                                            | Test ID(s)                                         | File                   |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------- |
| AC-1       | Dispatch rows show `#` (Pound) icon; no People icon; no emoji avatar                                   | CRC-001, CRC-002, CRC-003, CRC-004                 | ConversationRowChannel |
| AC-2       | Section header text comes from i18n key `dispatch.sidebar.channelsSection`                             | CS-001                                             | ChannelSection         |
| AC-3       | "+" button triggers `onCreateChannel` callback                                                         | CS-002                                             | ChannelSection         |
| AC-4       | Active task count badge renders when `childTaskCount > 0`                                              | CS-012, CRC-010, CRC-011, CRC-012                  | Both                   |
| AC-5       | Unread dot visible for dispatch conversations; absent when selected / generating / batch               | CRC-005, CRC-006, CRC-007, CRC-008, CRC-009        | ConversationRowChannel |
| AC-6       | Collapsed sidebar: no section text, no `+` button                                                      | CS-006, CS-007, CS-011                             | ChannelSection         |
| AC-7       | Chevron toggle; default expanded; collapse/expand cycle; correct chevron icon                          | CS-003, CS-004, CS-005, CS-015, CS-016, CS-017     | ChannelSection         |
| AC-12      | No hardcoded English strings — all text via `t()`                                                      | CS-013, CS-014                                     | ChannelSection         |
| AC-19      | Empty state: header + `+` button still render; empty-state i18n message shown; no rows                 | CS-008, CS-009, CS-010                             | ChannelSection         |
| Regression | Non-dispatch rows unaffected: no Pound icon, correct fallback icon, unread dot unchanged, badge absent | CRC-REG-001, CRC-REG-002, CRC-REG-003, CRC-REG-004 | ConversationRowChannel |

**ACs deliberately not covered here** (covered by other test layers or out of unit-test scope):

| AC ID | Reason not in unit tests                                                                        |
| ----- | ----------------------------------------------------------------------------------------------- |
| AC-8  | File-existence check — covered by regression test or CI type-check                              |
| AC-9  | Type export check — covered by TypeScript compiler (`tsc --noEmit`)                             |
| AC-10 | Structural check that `index.tsx` uses `<ChannelSection>` — covered by code review / regression |
| AC-11 | No `any` — covered by oxlint and tsc                                                            |
| AC-13 | i18n JSON keys present — covered by `i18n` skill validation script                              |
| AC-14 | Icons from @icon-park only — covered by oxlint / code review                                    |
| AC-15 | UnoCSS utilities — covered by code review                                                       |
| AC-16 | Click navigates to `/conversation/{id}` — integration / e2e scope                               |
| AC-17 | Context menu still works — existing ConversationRow tests + regression                          |
| AC-18 | Batch mode checkboxes — existing ConversationRow tests                                          |

---

## 3. Test Design Decisions

### 3.1 ChannelSection tests: spec-first, not implementation-first

`ChannelSection.tsx` does not exist yet at the time these tests are written. Tests import from the expected path:

```
@/renderer/pages/conversation/GroupedHistory/ChannelSection
```

If the developer names the file differently, the import will fail — which is the correct signal to coordinate.

### 3.2 Mock strategy for i18n

`react-i18next` is mocked so `t(key)` returns the key itself. This is the same pattern as all existing S1 and dispatch tests. The AC-12 / AC-13 tests rely on this: if a developer hardcodes `"Channels"` rather than `t('dispatch.sidebar.channelsSection')`, the test `CS-013` will catch it because the text `"Channels"` will not be present (only the key would be).

### 3.3 `@icon-park/react` mock scope

`ConversationRowChannel.dom.test.tsx` mocks both `Pound` and `People`. The S2 implementation replaces `People` with `Pound` for dispatch rows. Both icons are mocked so tests can assert presence/absence by `data-testid`.

The `ChannelSection.dom.test.tsx` mocks `Down`, `Right`, `Plus`, and `Add` since the section header uses a collapse chevron and a create button icon. The exact icon name for the `+` button is implementation-defined; the tests locate the interactive element by either `data-testid='create-channel-btn'` or by traversing the icon's parent.

### 3.4 Unread dot detection

The unread dot has no `data-testid` in the current implementation. It is identified by its unique CSS class `bg-#2C7FFF`. This is a structural dependency on the existing implementation. If the class changes, the tests must be updated accordingly. This is an acceptable tradeoff since the dot has no semantic ARIA role.

### 3.5 renderConversation render-prop

`ChannelSection` takes a `renderConversation` prop (established by `AgentDMGroup` pattern). Tests use a simple render spy that outputs `data-testid='channel-row-{id}'` divs, making row presence/absence easy to assert.

---

## 4. Risk Register

| Risk                                                                            | Likelihood | Impact                                      | Mitigation                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Pound` icon does not exist under that name in `@icon-park/react`               | Medium     | CRC-001 through CRC-004 fail                | Tech design lists fallbacks (`NumberSymbol`, `Hashtag`). Update mock name to match actual import.                                                              |
| Developer names create button icon differently from `Plus`/`Add`                | Medium     | CS-002 may fail to locate button            | CS-002 has multi-strategy fallback. If it fails, add explicit `data-testid='create-channel-btn'` to the component.                                             |
| `ChannelSection` not extracting collapse state but delegating to parent         | Low        | CS-004, CS-005, CS-015, CS-016, CS-017 fail | Component spec says local `useState` for expansion. If parent manages it, add the `isExpanded` prop to `ChannelSectionProps` and update tests.                 |
| Unread dot CSS class changes                                                    | Low        | CRC-005 through CRC-009 fail                | Add `data-testid='unread-dot'` to the dot span to make it testable without CSS coupling.                                                                       |
| `ChannelSection` not rendering the section when `collapsed=true` vs hiding text | Low        | CS-006 may behave differently               | If the component renders but hides text via `collapsed-hidden` class, switch assertion to check for `collapsed-hidden` class presence rather than DOM absence. |

---

## 5. What to Do When Tests Fail

1. **Import not found** (`ChannelSection`): Coordinate with developer — component may not be created yet or path differs.
2. **Icon testid mismatch** (e.g., `icon-pound` not found): Verify actual icon name used in implementation; update the mock in both test files.
3. **Hardcoded string found** (CS-013 / CS-014 fail): Developer used a hardcoded string; must move to `t()`.
4. **Unread dot absent for dispatch** (CRC-005 fails): The `!isDispatchConversation` guard in `renderCompletionUnreadDot` was not removed; this is the core AC-5 change.
5. **People icon still present** (CRC-002 fails): `renderLeadingIcon()` still returns `<People>` for dispatch; S2 change not applied.

---

## 6. How to Run

```bash
# Run only the S2 channel tests (dom environment)
bun run test -- --project dom --reporter=verbose tests/unit/ChannelSection.dom.test.tsx tests/unit/ConversationRowChannel.dom.test.tsx

# Run all dom tests
bun run test -- --project dom

# Full test suite
bun run test
```

Do NOT run these tests until the developer signals the implementation is ready (or to deliberately observe the red baseline).
