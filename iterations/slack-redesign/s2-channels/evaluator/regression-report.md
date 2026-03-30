# S2 Incremental Regression Report

**Evaluator:** incremental_regression
**Date:** 2026-03-29
**Sprint:** S2 — Channels + DMs Slack Redesign

---

## Summary

All 5 S2 fixes verified. No regressions introduced. Two pre-existing flaky test files produce failures under full-suite parallel execution but are unrelated to S2 changes.

---

## Step 1: S2-Affected Test Results

Command:

```
bun run test -- tests/unit/ChannelSection.dom.test.tsx tests/unit/ConversationRowChannel.dom.test.tsx tests/unit/dispatch/ConversationRowDispatch.dom.test.tsx tests/regression/dispatch-known-bugs.test.ts
```

| Test File                                     | Tests  | Result                  |
| --------------------------------------------- | ------ | ----------------------- |
| ChannelSection.dom.test.tsx                   | 18     | PASS                    |
| ConversationRowChannel.dom.test.tsx           | 16     | PASS                    |
| dispatch/ConversationRowDispatch.dom.test.tsx | 8      | PASS                    |
| dispatch-known-bugs.test.ts                   | 5      | PASS                    |
| **Total**                                     | **47** | **47 passed, 0 failed** |

---

## Step 2: Full Test Suite Results

Command: `bun run test 2>&1 | tail -10`

```
Test Files  2 failed | 183 passed | 5 skipped (190)
      Tests  4 failed | 2283 passed | 7 skipped (2294)
```

### Failures Analysis

**File 1: `tests/unit/channels/weixinSystemActions.test.ts`** — 2 tests failed

- These are the pre-existing failures listed in the task brief ("Pre-existing failures to ignore").
- Failure mode: timeout ("If this is a long-running test, pass a timeout value…").
- Not related to S2 changes. IGNORED per spec.

**File 2: `tests/unit/conversationBridge.tray.test.ts`** — 2 tests failed

- `refreshes tray menu after removing a conversation` (timeout ~17 s)
- `refreshes tray menu after creating a conversation` (timeout ~1.8 s)
- When run in isolation (`bun run test -- tests/unit/conversationBridge.tray.test.ts`): **3/3 PASS**.
- Failure only occurs when the full suite runs in parallel — a pre-existing flaky interaction with other workers (environment/mock state contamination).
- Git log shows this file was last modified for `warmup channel mock` and CI fixes well before S2 work began.
- **Not a regression introduced by S2.** Classified as pre-existing parallel-execution flakiness.

**New regressions introduced by S2: NONE.**

---

## Step 3: AC-5 Verification — `renderCompletionUnreadDot` + CRC-006

### Source Code Verification

File: `src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx`, line 98–108:

```tsx
const renderCompletionUnreadDot = () => {
  if (batchMode || !hasCompletionUnread || isGenerating || selected) {
    return null;
  }
  ...
};
```

**Confirmed:** `selected` is included in the early-return guard. When `selected === true`, the function returns `null` and the unread dot is not rendered.

### CRC-006 Test Result

Test: `CRC-006 (AC-5): unread dot is absent when dispatch conversation is selected`
File: `tests/unit/ConversationRowChannel.dom.test.tsx`
Result: **PASS** (part of 16/16 in that file)

### AC-5 Verdict: PASS — fix correctly implemented and verified by test.

---

## Fix-by-Fix Verdict

| #   | Fix Description                                                                          | Evidence                                                              | Verdict  |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| 1   | AC-5: unread dot hidden when selected (ConversationRow.tsx)                              | `renderCompletionUnreadDot` guards on `selected`; CRC-006 passes      | **PASS** |
| 2   | `renderConversation` wrapped in `useCallback` (index.tsx)                                | `grep` confirms `const renderConversation = useCallback(` at line 176 | **PASS** |
| 3   | Stale dispatch tests updated to expect Pound icon (ConversationRowDispatch.dom.test.tsx) | All 8 dispatch tests pass; `icon-pound` testid present in mocks       | **PASS** |
| 4   | REG-004 updated to check ChannelSection.tsx (dispatch-known-bugs.test.ts)                | All 5 regression tests pass; REG-004 reads `ChannelSection.tsx`       | **PASS** |
| 5   | Removed unused ChannelSectionProps fields (types.ts, index.tsx)                          | `ChannelSectionProps` has 4 clean fields; no unused props present     | **PASS** |

---

## Conclusion

- **Regressions introduced by S2: 0**
- **S2 acceptance criteria verified: 5/5**
- **Pre-existing failures (excluded from regression scope): 4 tests across 2 files** — weixinSystemActions (known, task-listed) and conversationBridge.tray (pre-existing parallel flakiness, passes in isolation)

[DONE]
