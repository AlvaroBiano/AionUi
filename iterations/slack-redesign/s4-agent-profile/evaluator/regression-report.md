# S4 Incremental Regression Report

**Date:** 2026-03-29
**Evaluator:** incremental_regression
**Sprint:** S4 — Agent Profile Page
**Status:** [DONE]

---

## Test Execution Summary

### Step 1: S4 Agent Unit Tests

```
bun run test -- tests/unit/agent/
```

| Metric     | Result         |
| ---------- | -------------- |
| Test files | 2 passed (2)   |
| Tests      | 56 passed (56) |
| Duration   | 4.90s          |

**Result: PASS**

---

### Step 2: Dispatch Tests (MemberCard-related)

```
bun run test -- tests/unit/dispatch/MemberCard.dom.test.tsx tests/unit/dispatch/GroupMemberSider.dom.test.tsx
```

| Metric     | Result         |
| ---------- | -------------- |
| Test files | 2 passed (2)   |
| Tests      | 56 passed (56) |
| Duration   | 3.04s          |

**Result: PASS**

---

### Step 3: Full Test Suite

```
bun run test
```

| Metric     | Result                                        |
| ---------- | --------------------------------------------- |
| Test files | 1 failed, 188 passed, 5 skipped (194 total)   |
| Tests      | 2 failed, 2397 passed, 7 skipped (2406 total) |
| Duration   | 65.87s                                        |

**Failures:**

- `tests/unit/channels/weixinSystemActions.test.ts` — 2 failures

These match the **pre-existing known failures** documented in the regression brief (`weixinSystemActions (2)`). No new failures introduced.

**Result: PASS (no regressions introduced)**

---

## AC Verification

### AC-2: Not-found back button added (index.tsx)

**File:** `src/renderer/pages/agent/index.tsx`

The not-found state (lines 51–58) renders both an `<Empty>` description and a `<Button onClick={handleBack}>` with i18n key `agent.profile.back`:

```tsx
if (!profileData) {
  return (
    <div className='w-full h-full flex flex-col items-center justify-center gap-16px'>
      <Empty description={t('agent.profile.notFound')} />
      <Button onClick={handleBack}>{t('agent.profile.back')}</Button>
    </div>
  );
}
```

**Result: CONFIRMED**

---

### AC-15: Workspace shows meaningful path (AgentConversationList.tsx)

**File:** `src/renderer/pages/agent/components/AgentConversationList.tsx`

The `getWorkspaceDisplayName` function (lines 28–36) returns the full path when `segments.length <= 3`, or a truncated `…/last/three/segments` form for longer paths. The full workspace string is preserved, not just the basename:

```ts
function getWorkspaceDisplayName(conversation: TChatConversation): string | null {
  const extra = conversation.extra as Record<string, unknown> | undefined;
  if (!extra) return null;
  const workspace = extra.workspace;
  if (typeof workspace !== 'string' || !workspace) return null;
  const segments = workspace.split('/').filter(Boolean);
  if (segments.length <= 3) return workspace;
  return '…/' + segments.slice(-3).join('/');
}
```

**Result: CONFIRMED**

---

## Additional Fix Verification

### AC-3: Sort uses updatedAt with modifyTime fallback (useAgentProfile.ts)

**File:** `src/renderer/pages/agent/hooks/useAgentProfile.ts`

Sort comparator (lines 28–32) uses `updatedAt` with `modifyTime` fallback:

```ts
.toSorted((a, b) => {
  const bTime = (b as { updatedAt?: number }).updatedAt ?? b.modifyTime ?? 0;
  const aTime = (a as { updatedAt?: number }).updatedAt ?? a.modifyTime ?? 0;
  return bTime - aTime;
})
```

**Result: CONFIRMED**

---

### AC-4: `as string` replaced with type narrowing (MemberCard.tsx)

**File:** `src/renderer/pages/conversation/dispatch/components/MemberCard.tsx`

The `agentId` is safely narrowed at line 111 using destructuring + guard, avoiding `as string` cast:

```tsx
const { agentId } = member;
if (agentId) onNavigateToProfile(agentId);
```

**Result: CONFIRMED**

---

### AC-5: Raw "running" string replaced with i18n (AgentConversationList.tsx)

**File:** `src/renderer/pages/agent/components/AgentConversationList.tsx`

Line 85–88: The `isGenerating` badge renders `{t('agent.profile.generating')}` — no hardcoded "running" string in the JSX:

```tsx
{
  isGenerating && (
    <span className='text-11px text-arcoblue-6 bg-arcoblue-1 px-6px py-2px rd-full'>
      {t('agent.profile.generating')}
    </span>
  );
}
```

**Result: CONFIRMED**

---

## Regression Summary

| Test Suite                     | Pre-existing Failures   | New Failures | Result |
| ------------------------------ | ----------------------- | ------------ | ------ |
| S4 agent unit tests (56)       | 0                       | 0            | PASS   |
| Dispatch MemberCard tests (56) | 0                       | 0            | PASS   |
| Full suite (2406)              | weixinSystemActions (2) | 0            | PASS   |

**All 5 S4 ACs verified. Zero new test regressions.**
