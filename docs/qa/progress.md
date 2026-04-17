# QA Sprint 进度

> 目标：对 `docs/product/requirements.md` 全部 20 个模块补全 E2E 覆盖；消灭所有因无数据/无配置导致的非法 `test.skip`。  
> 更新日期：2026-04-17（深夜更新）
>
> **其他文件**：
>
> - [`decisions.md`](decisions.md) — 技术决策记录
> - [`sessions/`](sessions/) — 每日过程留痕（每天一个文件）
> - [`reviews/`](reviews/) — 每模块 PM review 往来记录
> - [`/docs/product/bug-reports.md`](../product/bug-reports.md) — Bug 台账（BUG-001 ～ BUG-005）

---

## 一、全局状态速览

| 指标                                    | 数值                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------- |
| 模块总数                                | 20                                                                        |
| E2E 文件已完成（无非法 skip）           | 2（Module 1、2）                                                          |
| E2E 文件部分覆盖                        | 1（Module 5，仅 3/16 AC）                                                 |
| E2E 文件进行中                          | 1（Module 13）                                                            |
| E2E 文件未开始                          | 16                                                                        |
| conversation-core.e2e.ts 通过数         | 58 passed / 4 合法 skip；含攻击测试 Section 24-28；PM [TEST-APPROVED] ✅  |
| 攻击性 E2E（Module 2）                  | ✅ 11 passed（AC7 双向 includes 修复、AC25 时间窗口修正）commit aa984e431 |
| conversation-race-conditions.e2e.ts     | ✅ 8 passed / 2 skip；B3 150ms 竞态回归守护；PM [TEST-APPROVED] ✅        |
| 攻击性 E2E（Module 1）                  | ✅ 11 passed / 1 expected-fail（BUG-005 M1-A2）；PM [TEST-APPROVED] ✅ commit 8eadb15ec |
| 单元测试新增                            | 64 个全绿（qa-whitebox 38 + R1/R5 26）                                    |
| 已发现 bug                              | 5 个（B1/B3/B4 已修 ✅、B2 P2 已修 ✅、BUG-005 P2 Open 待 dev-2 修复）    |
| mcp-settings.e2e.ts TODO 选择器         | 待确认                                                                    |

---

## 二、各模块 E2E 覆盖状态

| #   | 模块                    | 对应 spec 文件                   | 状态        | 备注                                                                                     |
| --- | ----------------------- | -------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| 1   | 首页导航（Guid 页）     | `guid-page.e2e.ts` + `guid-page-attack.e2e.ts` | ✅ 完成 | 正规：29 passed / 2 合法 skip；攻击：11 passed / 1 expected-fail（BUG-005）；PM ✅ |
| 2   | 对话核心流程            | `conversation-core.e2e.ts`       | ✅ 完成     | 47 passed / 4 合法 skip（AC3e/f cron、AC23 待实现、AC28 streaming）；2026-04-17 全量清理 |
| 3   | 对话管理操作            | `conversation-operations.e2e.ts` | ⬜ 未评估   |                                                                                          |
| 4   | 消息输入框（SendBox）   | `sendbox-ui.e2e.ts`              | ⬜ 未评估   |                                                                                          |
| 5   | 工作区面板（Workspace） | `workspace-panel.e2e.ts`         | ⚠️ 部分覆盖 | 0 skip，但仅覆盖 AC2/AC4b/AC6（3/16 AC），其余 AC 未写；待后续 sprint 补全               |
| 6   | 预览面板（Preview）     | —                                | ⬜ 未开始   |                                                                                          |
| 7   | Agent 管理              | `agents-management.e2e.ts`       | ⬜ 未评估   |                                                                                          |
| 8   | 助手（Assistant）管理   | —                                | ⬜ 未开始   |                                                                                          |
| 9   | 团队模式（Team）        | `team-*.e2e.ts`                  | ⬜ 未评估   |                                                                                          |
| 10  | 定时任务（Cron）        | `cron-tasks.e2e.ts`              | ⬜ 未评估   |                                                                                          |
| 11  | WebUI 远程访问          | `webui.e2e.ts`                   | ⬜ 未评估   |                                                                                          |
| 12  | 消息渠道集成            | `channels.e2e.ts`                | ⬜ 未评估   |                                                                                          |
| 13  | MCP 工具管理            | `mcp-settings.e2e.ts`            | 🔄 进行中   | TODO 选择器未确认，7 处 skip，beforeAll 数据构造缺失                                     |
| 14  | 技能库（Skills Hub）    | `hub-backend-install.e2e.ts`     | ⬜ 未评估   |                                                                                          |
| 15  | 设置 - 模型配置         | `system-settings.e2e.ts`         | ⬜ 未评估   |                                                                                          |
| 16  | 设置 - 显示与主题       | `display-settings.e2e.ts`        | ⬜ 未评估   |                                                                                          |
| 17  | 设置 - 系统与宠物       | —                                | ⬜ 未开始   |                                                                                          |
| 18  | 扩展系统（Extensions）  | `ext-*.e2e.ts`                   | ⬜ 未评估   |                                                                                          |
| 19  | Agent 市场（Hub）       | —                                | ⬜ 未开始   |                                                                                          |
| 20  | 多语言支持              | —                                | ⬜ 未开始   |                                                                                          |

---

## 三、当前待办（优先级排序）

### P0 — 必须完成才能进入下轮 PM review

- [x] **conversation-core.e2e.ts**：✅ 已完成（47 passed / 4 合法 skip）
  - AC1 修复：Guid 页用 `.guid-input-card-shell textarea` 而非 `.sendbox-panel textarea`
  - AC3 修复：桌面全量模式用 `span.text-15px.font-semibold`，compact 模式用 `.agent-mode-compact-pill`
  - 视觉基线已更新（`--update-snapshots`）

### P1 — 本 sprint 覆盖

- [ ] **mcp-settings.e2e.ts**：
  - 用 CDP 截图确认 MCP 设置页真实 DOM 结构
  - 修正 `ADD_SERVER_BTN`、`JSON_TEXTAREA`、`DIALOG_ERROR` 等 TODO 选择器
  - 加 `beforeAll` 数据构造（如需要）

- [ ] **guid-page.e2e.ts**：清理 29 处 skip

### P2 — 后续 sprint

- [ ] 评估 conversation-operations、sendbox-ui、cron-tasks、agents-management 的 skip 情况
- [ ] 扩展模块（`ext-*.e2e.ts`）skip 评估

---

## 四、已完成里程碑

| 日期       | 事项                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| 2026-04-16 | 团队 v2.0 建立（PM + QA-黑盒 + QA-白盒 + Dev + Arch）                      |
| 2026-04-16 | Module 1 E2E 编写 + PM 多轮 review 通过                                    |
| 2026-04-16 | Module 2 E2E 编写 + PM 多轮 review 通过                                    |
| 2026-04-17 | `inject-test-messages` IPC 扩展 `withAiTypes=true`（6 种 AI 消息类型注入） |
| 2026-04-17 | conversation-core AC8–12、AC17–18 skip 消除（改用 IPC 数据构造）           |
| 2026-04-17 | workspace-panel.e2e.ts 全量重写，0 skip                                    |
| 2026-04-17 | team 规则从 memory 归位到 `aionui-quality-team.json`                       |
| 2026-04-17 | 对抗式测试团队启动：qa-blackbox/qa-whitebox/dev-2/arch/pm-2-2              |
| 2026-04-17 | conversation-core 新增 9 攻击用例（AC7/AC19/AC25/AC30/AC32），PM ✅        |
| 2026-04-17 | conversation-race-conditions.e2e.ts 新建（R1/R2/R5 15 passed），PM ✅     |
| 2026-04-17 | B1 P3 修复（AC7 复制无视觉反馈）✅                                          |
| 2026-04-17 | B2 P2 修复（useWorkspaceEvents 跨会话误刷新，6 单元测试 FAIL→PASS）✅       |
| 2026-04-17 | B3/R2 全链路关闭：cancelled flag + 150ms 竞态测试 + baseCount 稳定化（预热切换）✅ |
| 2026-04-17 | guid-page 12处选择器 skip 消除（AC15/AC16/AC16a/AC16c/AC17/VR3），PM ✅        |
| 2026-04-17 | guid-page 15处数据依赖 skip 消除（ConfigStorage IPC 构造 custom agent），PM ✅  |
| 2026-04-17 | **Module 1 完成**：29 passed / 2 合法 skip，消除率 93%                          |
| 2026-04-17 | 新增单元测试 64 个全绿（autoTitle 17 + useAutoTitle 6 + historyPanel 10 + useWorkspaceEvents.r1 6 + race 26） |
| 2026-04-17 | bug-reports.md BUG-001～BUG-004 录入完成                                    |
| 2026-04-17 | guid-page-attack.e2e.ts 新建（M1-A1～A5，10 用例）；PM [TEST-APPROVED] ✅       |
| 2026-04-17 | BUG-005 P2 发现（AC12 快速连点竞态）；test.fail() 标记；已通知 dev-2           |
