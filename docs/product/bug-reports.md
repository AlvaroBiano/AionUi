# Bug 报告记录

> 由 QA Agent 维护。记录所有 bug 的状态和仲裁结果。

## 格式说明

每条 bug 格式：

```
### [BUG-XXX] 标题
- **严重级别**: P0 / P1 / P2 / P3
- **状态**: Open / Fixed / Disputed / Invalid / Closed
- **报告方**: QA
- **复现命令**: `E2E_DEV=1 bunx playwright test ... --grep "..."`
- **描述**:
- **预期结果**:
- **实际结果**:
- **修复**: （Dev 填写）
- **仲裁**: （用户裁定，如有争议）
```

---

## P0 — 崩溃 / 数据丢失

（暂无）

## P1 — 核心功能失效

（暂无）

## P2 — 功能异常

### [BUG-005] AC12 快速连点不同卡片时 agent 选择竞态 — 最后一次点击的 agent 未生效
- **严重级别**: P2
- **状态**: Fixed ✅
- **报告方**: QA-黑盒（攻击性 E2E M1-A2，2026-04-17）
- **复现命令**: `E2E_DEV=1 bunx playwright test tests/e2e/specs/guid-page-attack.e2e.ts --grep "M1-A2"`
- **描述**: `AssistantSelectionArea.tsx` 的卡片 `onClick` 触发 agent 选中时存在竞态。快速连点 card[0]→card[1]（间隔 ≤40ms），card[0] 的异步状态更新在 card[1] 的更新之后完成，导致最终 selector 显示 card[0] 的 agent，而非用户最后点击的 card[1]。
- **预期结果**: 最后一次点击（card[1]）的 agent 应生效，selector 显示 card[1] 的 agent（last click wins）。
- **实际结果**: selector 显示 card[0] 的 agent（"财务建模助手"），而非 card[1]（"路演 PPT 助手"）。
  ```
  Expected: "路演 PPT 助手"（card[1]，第二次点击）
  Received: "财务建模助手"（card[0]，第一次点击）
  ```
- **根因**: card 的 React key 含 `idx` 后缀（`a-${id}-${idx}` / `g-${agentKey}-${idx}`），第一次 click 触发 re-render 后 cards 数组重排，旧 DOM 节点被销毁重建，40ms 后第二次点击打到已卸载节点，其 handler 调用了旧 agent 的 `onSelectAssistant`，覆盖了 last-click 结果。
- **修复**: 移除 key 中的 `-${idx}` 后缀，改为稳定 key `a-${id}` / `g-${agentKey}`，DOM 节点在 re-render 后保持稳定。commit `eba307349`
- **验证**: `tests/e2e/specs/guid-page-attack.e2e.ts` M1-A2 `test.fail()` 已移除（commit `03535dfd2`）；12 passed / 0 failed

### [BUG-002] useWorkspaceEvents 跨会话误刷新 — workspace 在切换后继续闪烁
- **严重级别**: P2
- **状态**: Fixed ✅
- **报告方**: QA-黑盒（R1 架构风险测试暴露，2026-04-17）
- **复现命令**: `E2E_DEV=1 bunx playwright test tests/e2e/specs/conversation-race-conditions.e2e.ts --grep "R1"`
- **描述**: `useWorkspaceEvents.ts` 的 `handleAcpResponse`、`handleGeminiResponse`、`handleCodexResponse` 订阅了全局 IPC 流，未过滤 `conversation_id`。任意会话产生 tool_call 事件时，都会触发当前显示会话的 workspace `throttledRefresh()`，导致 workspace 文件树在无关会话的 AI 响应时持续闪烁/重置。
- **预期结果**: workspace 刷新只响应当前会话的事件，切换到其他会话后不再收到前一个会话的 IPC 事件影响。
- **实际结果**: 切换会话后，前一会话 AI 在后台继续响应时，当前会话的 workspace 面板仍持续触发刷新（`throttledRefresh()`）。
- **修复**: `src/renderer/hooks/useWorkspaceEvents.ts` — 三个 handler 首行加 `if (data.conversation_id && data.conversation_id !== conversation_id) return`
- **验证**: `tests/unit/useWorkspaceEvents.r1.dom.test.ts` — 6 个单元测试 FAIL→PASS

### [BUG-003] useMessageLstCache DB 加载无取消机制 — 快速切换时消息串台
- **严重级别**: P2
- **状态**: Fixed ✅（cancelled flag 修复 + 150ms 竞态回归测试已补，commit 09dfb88ff）
- **报告方**: Arch（架构风险 R2，2026-04-17）+ QA-黑盒 验证
- **复现命令**: `E2E_DEV=1 bunx playwright test tests/e2e/specs/conversation-race-conditions.e2e.ts --grep "R2"`
- **描述**: `useMessageLstCache` 在加载消息时未实现取消机制。快速 A→B→C→D 四连跳场景下，A 会话的 DB 查询（30 条消息）耗时较长，可能在 D 已渲染（0 条消息）后才 resolve 并通过 `update()` 写入，导致 D 的消息列表短暂出现 A 的 30 条消息（0.1~0.5s 窗口，即 UX 可见的消息列表跳动）。
- **预期结果**: 切换到新会话后，旧会话的 DB 查询结果不应写入新会话的消息列表。
- **实际结果**: 快速切换后，目标会话（D，0 条）界面短暂显示来源会话（A，30 条）的消息内容。
- **修复**: `useMessageLstCache` 添加 `cancelled` flag：加载前重置为 `false`，会话切换/组件卸载时设为 `true`，写入前 check `if (cancelled) return`
- **争议**: Dev 使用 3000ms 等待的测试，修复前后均通过 → `[DISPUTE]`；用户仲裁：保留修复（防御性代码），QA 重写 ≤150ms 窗口或 mock IPC 延迟测试

## P3 — UI / 体验问题

### [BUG-004] AC7 复制按钮点击后无视觉反馈
- **严重级别**: P3
- **状态**: Fixed ✅
- **报告方**: QA-黑盒（攻击性 E2E 测试，2026-04-17）
- **复现命令**: `E2E_DEV=1 bunx playwright test tests/e2e/specs/conversation-core.e2e.ts --grep "AC7"`
- **描述**: 消息操作栏中的「复制」按钮，点击后剪贴板内容虽正确写入，但按钮本身无任何视觉状态变化（无颜色变化、无图标切换至勾号、无 "已复制" tooltip 出现）。用户无法通过视觉确认复制操作已完成。
- **预期结果**: 复制按钮点击后应有短暂状态反馈（如按钮变色、图标切换为 ✓、tooltip 显示「已复制」），持续 1.5~2s 后恢复。
- **实际结果**: 按钮样式无变化，用户不知道复制是否成功。
- **修复**: Dev 在复制 handler 中添加 `copied` 状态，配合 CSS 过渡动画实现视觉反馈

### [BUG-001] minimap trigger 被绝对定位覆盖层拦截，键盘 / 辅助技术无法激活
- **严重级别**: P3
- **状态**: Open
- **报告方**: QA（E2E 测试编写过程中发现，PM [TEST-APPROVED] 时确认）
- **文件**: `src/renderer/pages/conversation/` — ChatTitleEditor 或相关 header 组件
- **描述**: 会话搜索 minimap 的触发按钮（`.conversation-minimap-trigger`）上方有一层 `div.absolute.size-full` 覆盖整个 header 区域。Playwright 坐标点击被该层拦截，必须用 `page.evaluate(() => trigger.click())` 绕过。这意味着：1) 键盘 Tab 焦点可能无法到达 trigger；2) 屏幕阅读器可能无法激活该按钮；3) 触屏设备点击区域可能被覆盖。
- **预期结果**: minimap trigger 应可通过正常坐标点击、Tab 键聚焦后 Enter 激活、屏幕阅读器调用。
- **实际结果**: 必须调用 `HTMLElement.click()` 绕过 Playwright 可交互性检查才能触发，说明覆盖层阻挡了正常指针事件。
- **复现方法**: 在 Playwright 测试中对 `.conversation-minimap-trigger` 使用 `.click()` → 超时；改用 `page.evaluate(() => document.querySelector('.conversation-minimap-trigger').click())` → 成功。
- **修复建议**: 检查 header 中 `div.absolute.size-full` 的 `pointer-events` 设置，确保 trigger 区域 `pointer-events: auto` 或将 trigger 移出覆盖层的 z-index 层级。
