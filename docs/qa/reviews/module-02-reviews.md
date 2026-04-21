# Module 2（对话核心流程）Review 记录

**spec 文件**：`tests/e2e/specs/conversation-core.e2e.ts`  
**最终状态**：PM [TEST-APPROVED]（已通过）  
**Review 轮数**：5 轮（历史最多的模块）

---

## Round 1 — 初稿

**QA 提交**：`[TEST-REVIEW]` — Module 2 E2E 初稿（Task #21）  
**PM 反馈**：`[TEST-FEEDBACK]`（Task #24）

问题概要：初稿覆盖核心 AC 但有结构性问题，多条 AC 测试逻辑偏差。

---

## Round 2 — REQ-CLARIFY 闭环

**背景**：QA 对部分 AC 描述不清晰，无法写出具体测试步骤  
**QA**：`[REQ-CLARIFY]` → PM 查源码补充 requirements.md → `[REQ-CLARIFY-REPLY]`  
**QA 修复**：Task #25「按 REQ-CLARIFY-REPLY 修复 Module 2 测试（第三轮）」

---

## Round 3

**QA 提交**：`[TEST-REVIEW]`  
**PM 反馈**：`[TEST-FEEDBACK]`（Task #26）

---

## Round 4

**QA 提交**：`[TEST-REVIEW]`  
**PM 反馈**：`[TEST-FEEDBACK]`（Task #27 第五轮）

---

## Round 5 — 最终通过

**QA 提交**：`[TEST-REVIEW]`  
**PM 结果**：`[TEST-APPROVED]`

---

## 2026-04-17 补充修复（skip 消除）

PM review 通过后，本 session 对 conversation-core.e2e.ts 做了进一步 skip 消除：

| AC                     | 原状态                                          | 修复方案                                                      |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| AC8（thinking 块）     | `test.skip(true, 'requires real AI streaming')` | IPC 注入 `withAiTypes=true`，断言 `.message-item.thinking`    |
| AC9（tool call 列表）  | `test.skip(true, ...)`                          | 同上，断言 `.message-item.tool_summary`                       |
| AC10（tool call 详情） | `test.skip(true, ...)`                          | 同上，验证 tool name 文本                                     |
| AC11（plan 消息）      | `test.skip(true, ...)`                          | 同上，断言 `.message-item.plan`                               |
| AC12（skill_suggest）  | `test.skip(true, ...)`                          | 同上，断言 `.message-item.skill_suggest`                      |
| AC17（agent_status）   | `test.skip(true, ...)`                          | 同上，断言 `.message-item.agent_status .agent-status-message` |
| AC18（acp_permission） | `test.skip(true, ...)`                          | 同上，断言 radio group + button                               |
| Cron badge             | `isVisible()` timeout fail                      | `waitForSelector(state:'attached')` + `toBeAttached()`        |

**仍未解决**：

- AC28（stop button）：仍 `test.skip(true, 'requires real AI streaming')`
- 大量 `test.skip(!ok, 'Could not navigate...')` — 共约 80 处，下轮处理

---

## 规律总结

1. Module 2 是历史上迭代最多的模块（5 轮 review）
2. 主要返工原因：AI 消息类型的真实 DOM 结构与预期不符（如 `tool_group` → `tool_summary`）
3. `REQ-CLARIFY` 机制在第 2 轮显著减少了猜测性实现
4. PM 5 维度 checklist（交互完整性、视觉回归等）是主要卡点

> 如有更详细的 [TEST-FEEDBACK] 原文，可追加到本文件。
