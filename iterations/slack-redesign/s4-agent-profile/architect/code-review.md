# S4: Agent Profile — Code Review

## Status: [DONE]

## Summary

The implementation is clean, well-structured, and closely follows the tech design. The page module layout (`pages/agent/` with `index.tsx`, `components/`, `hooks/`, `types.ts`) is correct per project conventions. All 11 files reviewed. Six issues found — one high severity, the rest are low.

---

## Issues

### CR-1: Duplicated relative-time formatting logic (Medium)

**Files**: `AgentConversationList.tsx` line 15, `MemberCard.tsx` line 17, `TaskOverview.tsx` line 17

Three near-identical `formatRelativeTime` / `formatActivityTime` functions exist across three files. They differ only in the `>24h` branch (AgentConversationList adds a `>30d` date fallback, the others do not).

**Recommendation**: Extract to a shared utility in `src/renderer/utils/` (e.g., `formatRelativeTime.ts`). This is not blocking for S4 but should be addressed before the next sprint to avoid further drift. If deferred, add a `// TODO(S5): extract to shared utility` comment in AgentConversationList.tsx.

---

### CR-2: `member.agentId as string` type assertion in MemberCard (High)

**File**: `MemberCard.tsx` line 111

```typescript
onNavigateToProfile(member.agentId as string);
```

The `agentId` field on `GroupChatMemberVO` is `agentId?: string` (optional). The guard on line 108 (`member.agentId && onNavigateToProfile`) narrows it at runtime, but the `as string` cast bypasses the compiler instead of letting it verify the narrowing. If the guard is ever refactored (e.g., extracted to a variable), the cast silently hides the regression.

**Fix**: Use the non-null assertion operator `!` (which at least signals intent) or, better, store the narrowed value:

```typescript
const { agentId } = member;
if (agentId && onNavigateToProfile) {
  // agentId is narrowed to string here — no cast needed
  onNavigateToProfile(agentId);
}
```

This also eliminates the inline ternary in the JSX `onClick`, improving readability.

---

### CR-3: `AgentProfilePageParams` type is defined but never used (Low)

**File**: `types.ts` line 23-25

`AgentProfilePageParams` is exported but never imported anywhere. The page reads params via `useParams<{ agentId: string }>()` with an inline type literal instead. Either use the exported type or remove it to avoid dead code.

---

### CR-4: Generating badge shows raw status string instead of i18n label (Low)

**File**: `AgentConversationList.tsx` line 86

```tsx
{
  conversation.status;
}
```

This renders the literal string `"running"` to the user. Other components (e.g., `MemberCard.tsx` line 141) use i18n: `t('dispatch.taskPanel.status.${member.status}')`. The conversation list should do the same, or use a dedicated `agent.profile.generating` key for consistency with the Slack-like "generating" badge pattern.

---

### CR-5: `handleEditConfig` captures `profileData` in closure (Low)

**File**: `index.tsx` line 34-41

```typescript
const handleEditConfig = useCallback(() => {
  if (!profileData) return;
  const { identity } = profileData;
  if (identity.id.startsWith('custom:')) {
    navigate('/settings/agent');
  } else {
    navigate('/settings/assistants');
  }
}, [navigate, profileData]);
```

The callback depends on `profileData` (an object reference from `useMemo`). Since `useMemo` returns a new object every time `conversations` or `registry` changes, this callback is recreated on every conversation update — defeating the purpose of `useCallback`. Two options:

- **Option A (simpler)**: Drop `useCallback` here; it adds no value since `AgentConfigSection` is not memoized.
- **Option B**: Depend on `profileData?.identity.id` (a primitive) instead of the whole object.

Either approach is fine; Option A is more honest about the cost.

---

### CR-6: Avatar render logic in `AgentProfileHeader` filters on `.svg` extension (Low)

**File**: `AgentProfileHeader.tsx` line 40

```typescript
if (identity.avatar && !identity.avatar.endsWith('.svg')) {
```

This check assumes only SVG files are logo paths while everything else is an emoji. If a `.png` logo path is stored in `identity.avatar` (which `agentLogo.ts` does return for Cursor and Qoder), this condition would incorrectly treat it as an emoji and render a broken text node. The existing `AgentDMGroup` uses a separate `agentLogo` field to distinguish (avatar = emoji, agentLogo = image URL). The same pattern is used by the profile page's `agentLogo` prop, so the guard should be:

```typescript
if (identity.avatar) {
  // Emoji avatar
  return <span ...>{identity.avatar}</span>;
}
if (agentLogo) {
  // Logo image (SVG, PNG, etc.)
  return <img src={agentLogo} ... />;
}
```

The `agentLogo` prop already handles the image case. The `.svg` filter on `identity.avatar` is an unnecessary extra guard that could misfire.

---

## Non-Issues (Reviewed, No Action Needed)

| Area                           | Verdict                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Directory structure**        | `pages/agent/` with 4 children — correct per conventions                                                     |
| **Lazy loading**               | `React.lazy()` in Router.tsx, `withRouteFallback` wrapping — matches existing pattern                        |
| **Route placement**            | Inside `ProtectedLayout` routes block — correct                                                              |
| **URL encoding**               | `encodeURIComponent` on navigation, `decodeURIComponent` on read — correct                                   |
| **useMemo in useAgentProfile** | Dependencies are `[agentId, registry, conversations]` — correct; `toSorted` avoids mutating the source array |
| **i18n**                       | All user-facing strings use i18n keys; 17 keys added across 6 locales                                        |
| **Event propagation**          | `stopPropagation()` on avatar click in AgentDMGroup prevents toggle — correct                                |
| **Accessibility**              | Keyboard handlers on clickable divs (`role="button"`, `tabIndex={0}`, Enter/Space) — correct                 |
| **Type safety**                | No `any` usage; all types defined with `type` keyword; strict mode compatible                                |
| **Arco/Icon-park**             | All interactive elements use Arco; icons from icon-park — compliant                                          |
| **CSS**                        | UnoCSS utilities throughout; semantic color tokens used; no hardcoded colors                                 |
| **Design drift**               | Implementation matches tech design component hierarchy, data flow, and routing                               |

---

## Summary Table

| ID   | Severity | File                                                        | Description                                                              |
| ---- | -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| CR-1 | Medium   | AgentConversationList.tsx, MemberCard.tsx, TaskOverview.tsx | Duplicated relative-time formatting — extract to shared utility          |
| CR-2 | **High** | MemberCard.tsx:111                                          | `as string` type assertion bypasses narrowing — use destructured guard   |
| CR-3 | Low      | types.ts:23                                                 | `AgentProfilePageParams` exported but unused — remove or use             |
| CR-4 | Low      | AgentConversationList.tsx:86                                | Raw status string shown to user — use i18n key                           |
| CR-5 | Low      | index.tsx:34                                                | `useCallback` with object dep re-creates on every update — simplify      |
| CR-6 | Low      | AgentProfileHeader.tsx:40                                   | `.svg` extension guard on avatar may misfire for `.png` logos — simplify |
