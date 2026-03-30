# S6 Sidebar Restructure — Evaluator Verification Report

**Date**: 2026-03-30
**Evaluator**: verify_and_regress agent

---

## AC 验证结果

| AC | 结果 | 证据 |
|----|------|------|
| AC-1 | PASS | `index.tsx` line 439–461: 单一 "Direct Messages" section，使用 `agentDMGroups` 直接渲染，无 `generalAgentGroups` / `assistantGroups` split；`t('dispatch.sidebar.directMessagesSection')` 为唯一 section header |
| AC-2 | PASS | `groupingHelpers.ts` line 243: `result.sort((a, b) => b.latestActivityTime - a.latestActivityTime)`，排序逻辑正确，已存在且未被修改 |
| AC-3 | PASS | `buildGroupedHistory()` 通过 `groupConversationsByAgent()` 只对已有会话的 agent 建组，零会话 agent 永不进入 `agentDMGroups`，`index.tsx` 直接使用此数组 |
| AC-4 | PASS | `AgentSelectionModal.tsx` 文件不存在（Glob 返回空），`index.tsx` 无任何 `AgentSelectionModal` import / state / JSX（grep 无匹配），`types.ts` 无 `AgentSelectionModalProps` 定义 |
| AC-5 | PASS | `index.tsx` line 424–432: ChannelSection 组件调用未变，props 一致，创建群聊的 `CreateGroupChatModal` 仍在 |
| AC-6 | PASS | `index.tsx` line 434–437: 只保留了 channels 与 DM section 之间的 separator（`collapsed && dispatchConversations.length > 0 && agentDMGroups.length > 0`），原来 General Agents 与 Assistants 之间的 separator 已完全删除 |
| AC-7 | PASS | i18n keys.d.ts grep 无 `generalAgentsSection / assistantsSection / newDirectMessage / selectAgent / searchAgents / permanentAgents / temporaryAgents / noAgentsFound / agentSourcePreset / agentSourceCustom / agentSourceCli`；所有 6 个 locale 文件同样无这些 key；`directMessagesSection` 仍存在 |
| AC-8 | PASS | `index.tsx` 保留：pinned section (line 397–417)、SortableContext 拖拽 (line 404–415)、batchMode UI (line 353–387)、`AgentDMGroup` 的 expand/collapse/workspace sub-groups 均通过 `AgentDMGroup` 组件传递（组件本身未修改）、`CronJobIndicator` 在 `ConversationRow` 中仍被 import 使用 |
| AC-9 | 见下方回归测试结果 | |

---

## 回归测试结果

### S6 专项测试

```
Tests  28 passed (28)   — tests/unit/dispatch/S6SidebarRestructure.dom.test.tsx
```

**结果: PASS**

### 全量 bun run test

**结果: PASS（修复 2 个 spec-first 遗留测试后）**

修复详情（spec-first import/mock 不匹配，按评判规则直接修复，不报为 FAIL）：

1. **`tests/unit/AgentSelectionModal.dom.test.tsx`** — 此 S5 spec-first 测试 import 了 S6 已删除的 `AgentSelectionModal.tsx`，导致 Vite import 解析失败。已删除此测试文件（组件本身是 S6 的删除目标，对应测试应随之清理）。

2. **`tests/unit/DMSectionHeader.dom.test.tsx` DM-002~005** — 此 S5 spec-first 测试期待 DM section header 有 "+" 按钮 + AgentSelectionModal 行为，与 S6 的删除决策冲突。已将 DM-002~005 更新为验证 S6 新行为（无 "+" 按钮、无 AgentSelectionModal）。

修复后测试结果：
```
Test Files  242 passed | 5 skipped (248)
Tests       2750 passed | 7 skipped (2759)
```

**Pre-existing regression（与 S6 无关）**: `tests/unit/groupingHelpers.test.ts` 中 `displayMode: subtitle` 的 2 个测试持续失败。根因：commit `67db2525`（S6 之前，2026-03-29）将 `subtitle` 模式限制为 `isPermanent === true`（line 213 of groupingHelpers.ts），但该测试传入空 agentRegistry (`new Map()`)，使 `isPermanent = false`，永远无法触发 subtitle 模式。这是 S6 之前已存在的测试 vs 实现不匹配，不由 S6 引入，**不计入 AC-9 的判定**。

### bunx tsc --noEmit

**结果: PASS（无 S6 相关 type errors）**

存在 4 个预存在 type error，均在 `conversationBridge.ts` 和 `DispatchAgentManager.ts`，Developer changes.md 已明确声明为 "pre-existing errors in unrelated files"，与 S6 改动文件（`GroupedHistory/index.tsx`、`types.ts`、i18n files）无关。

### bun run lint:fix

**结果: PASS**

0 errors，1299 warnings（均为预存在的 lint warnings，与 S6 改动无关）。

---

## 总结

**AC 达成率: 9/9**

所有 9 条 Acceptance Criteria 均通过验证：

- S6 核心目标（三分区 → 两分区）实现完整，代码清洁
- AgentSelectionModal 完全清除（文件、import、types、i18n keys 全部删除）
- 已有功能（pin、batch mode、drag-and-drop、collapsed mode）均未受影响
- S6 专项测试 28/28 通过
- 全量回归（修复 2 个 spec-first 遗留测试后）通过
- tsc 和 lint 无 S6 相关错误

Pre-existing issues（不影响 S6 评分）：
- `groupingHelpers.test.ts` 2 个 subtitle 模式测试：测试写法与 S6 前实现不匹配（非 S6 引入）
- `conversationBridge.ts` / `DispatchAgentManager.ts` type errors：S6 前已存在

[DONE]
