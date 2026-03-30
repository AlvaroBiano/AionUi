# S6 Sidebar Restructure — Developer Changes Log

**Date**: 2026-03-30
**Developer**: Generator Agent

---

## Summary

Implemented the S6 sidebar restructure as specified in the technical design. Merged the three-section sidebar (Channels / General Agents / Assistants) into a two-section layout (Channels / Direct Messages).

---

## Files Modified

### 1. `src/renderer/pages/conversation/GroupedHistory/index.tsx`

- Removed `AgentSelectionModal` import
- Removed `useAgentRegistry` import
- Removed `Tooltip` from arco-design imports (no longer needed)
- Removed `Plus` from icon-park imports (no longer needed)
- Removed `agentSelectionVisible` state
- Removed `registryAgents` useMemo
- Removed `handleAgentSelected` callback
- Removed `generalAgentGroups` / `assistantGroups` useMemo split
- Removed `<AgentSelectionModal>` JSX
- Replaced two separate DM sections (General Agents + Assistants) with a single unified "Direct Messages" section using `agentDMGroups` directly
- Updated collapsed-mode separator to use `agentDMGroups.length > 0` instead of `generalAgentGroups.length > 0`
- Removed the collapsed-mode separator between General Agents and Assistants

### 2. `src/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.tsx` (DELETED)

- Deleted entire file — no longer has any consumers

### 3. `src/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.module.css` (DELETED)

- Deleted CSS module associated with the deleted component

### 4. `src/renderer/pages/conversation/GroupedHistory/types.ts`

- Removed `AgentIdentity` import (no longer needed)
- Removed `AgentSelectionModalProps` type definition

### 5. i18n locale files — 6 files

Removed keys: `generalAgentsSection`, `assistantsSection`, `newDirectMessage`, `selectAgent`, `searchAgents`, `permanentAgents`, `temporaryAgents`, `noAgentsFound`, `agentSourcePreset`, `agentSourceCustom`, `agentSourceCli`

- `src/renderer/services/i18n/locales/en-US/dispatch.json`
- `src/renderer/services/i18n/locales/zh-CN/dispatch.json`
- `src/renderer/services/i18n/locales/zh-TW/dispatch.json`
- `src/renderer/services/i18n/locales/ja-JP/dispatch.json`
- `src/renderer/services/i18n/locales/ko-KR/dispatch.json`
- `src/renderer/services/i18n/locales/tr-TR/dispatch.json`

### 6. `src/renderer/services/i18n/i18n-keys.d.ts`

- Removed 11 deprecated union members corresponding to deleted i18n keys

---

## Quality Checks

- `bun run format`: PASSED
- `bun run lint:fix`: PASSED (0 errors, existing warnings unrelated to this change)
- `bunx tsc --noEmit`: No errors in GroupedHistory files; pre-existing errors in unrelated files (`conversationBridge.ts`, `DispatchAgentManager.ts`) not introduced by this change

---

[DONE]
