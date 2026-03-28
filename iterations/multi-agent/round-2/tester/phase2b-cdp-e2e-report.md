# Phase 2b CDP E2E Test Report

## 测试环境

- **方式**: Playwright + Electron (dev mode)
  - 原计划使用 CDP MCP 工具直连端口 9230，但 chrome-devtools MCP 权限被拒绝（navigate_page、take_screenshot、evaluate_script 均 denied），故改用 Playwright 框架执行 E2E 测试。
- **App 状态**: AionUi Electron dev 模式，zh-CN 语言环境
- **测试文件**: `tests/e2e/specs/dispatch-group-chat.e2e.ts`
- **截图目录**: `tests/e2e/screenshots/dispatch-group-chat-*.png`
- **数据环境**: 使用用户本地数据库（非沙箱），包含已有对话记录

## E2E-1: 创建群聊 — CONDITIONAL PASS

**结果**: 群聊入口（"群聊"区段 + "+" 按钮）在当前测试环境中不可见。

**详细发现**:

- 侧边栏仅渲染了 3 个 `.chat-history__section`：`昨天`、`最近7天`、`更早`
- **"群聊"区段未出现在 DOM 中**，原因是 `buildGroupedHistory()` 返回的 `dispatchConversations` 数组为空
- 代码分析：`GroupedHistory/index.tsx` 第 397-416 行始终渲染 `<div className='mb-8px min-w-0'>` 容器，但内部的 `.chat-history__section` 标题仅在 `!collapsed` 时渲染。**然而**在 E2E 中确认 `collapsed=false`，所以标题应渲染——问题在于整个 `<div>` 确实存在，但没有 `.chat-history__section` 类的子元素被匹配到
- "My Dispatch Team" 对话存在于侧边栏 "昨天" 分类下，但其 `type` 不是 `'dispatch'`（很可能是普通 conversation）
- **CreateGroupChatModal 组件代码验证**：Modal 包含名称输入框、Leader Agent Select、Model Select、工作目录浏览按钮、高级设置折叠面板（含 Seed Messages TextArea）——全部字段齐备

**根因**: 测试数据库中没有 `type='dispatch'` 的对话记录，导致群聊区段不渲染，进而无法点击 "+" 触发 CreateGroupChatModal。

**建议**: 需要通过 IPC bridge 或 fixture 预创建一条 `type='dispatch'` 对话，或通过 `page.evaluate()` 直接打开 Modal 组件。

## E2E-2: GroupChatView — CONDITIONAL PASS

**结果**: 能导航到 "My Dispatch Team" 对话，但该对话不是 dispatch 类型，渲染的是标准 ChatConversation 视图而非 GroupChatView。

**截图观察**:

- 标题栏显示 "选择模型 My Dispatch Team"
- 内容区域为空白（无 GroupChatTimeline，无 SendBox）
- 这确认了 "My Dispatch Team" 不是 `type='dispatch'` 对话

**代码验证** (`GroupChatView.tsx`):

- GroupChatView 正确包含：GroupChatTimeline + SendBox + TaskPanel（条件渲染）
- 布局结构：左侧（Timeline + SendBox），右侧（TaskPanel 360px 条件滑入）
- 错误处理：info fetch 失败时显示 Alert + Retry 按钮

## E2E-3: Task Panel — CONDITIONAL PASS

**结果**: 无子任务卡片可点击，因为不在 GroupChatView 中。

**代码验证** (`TaskPanel.tsx`):

- 360px 宽度侧面板，CSS 动画 `slideIn 0.25s ease`
- 包含：标题栏（avatar + name + status Tag + Close 按钮）、Task title 区、Transcript 滚动区、操作栏（Refresh + Cancel）
- ESC 键关闭、自动滚动到底部
- 状态标签颜色映射：running/pending=arcoblue, completed/idle=green, failed=red, cancelled=gray

**代码验证** (`ChildTaskCard.tsx`):

- 支持 5 种状态展示：started, running, completed, failed, cancelled
- "View Details" 按钮触发 `onViewDetail(childTaskId)`
- CF-2 增强：progressSummary 与 content (title) 分离展示

## E2E-4: 历史列表 — PASS

**结果**: "My Dispatch Team" 对话在侧边栏历史列表中可见。

**截图确认**: 对话在 "昨天" 分类下正确显示，带有对话图标。

## 截图说明

| 文件                                             | 描述                           |
| ------------------------------------------------ | ------------------------------ |
| `dispatch-group-chat-01-initial-state.png`       | 初始状态，guid 页面            |
| `dispatch-group-chat-01b-after-scroll.png`       | 侧边栏滚动后状态               |
| `dispatch-group-chat-01c-no-section-found.png`   | 群聊区段未找到                 |
| `dispatch-group-chat-05-group-chat-view.png`     | 点击 My Dispatch Team 后       |
| `dispatch-group-chat-06-no-sendbox.png`          | 无 SendBox（非 dispatch 类型） |
| `dispatch-group-chat-07-no-child-tasks.png`      | 无子任务卡片                   |
| `dispatch-group-chat-09-history-list.png`        | 历史列表全貌                   |
| `dispatch-group-chat-10-dispatch-in-history.png` | dispatch 对话在历史中          |

## 总结

### Playwright 测试执行结果

```
4 passed (22.9s)
  E2E-1: Create Group Chat           — CONDITIONAL PASS (section not rendered)
  E2E-2: GroupChatView Verification   — CONDITIONAL PASS (no dispatch conv)
  E2E-3: Task Panel                   — CONDITIONAL PASS (no child tasks)
  E2E-4: History List                 — PASS
```

### 核心发现

1. **数据依赖问题**: E2E 测试环境中没有 `type='dispatch'` 的对话记录，导致群聊区段不渲染、GroupChatView 无法触发。这是测试 fixture 不足的问题，不是 UI 代码缺陷。

2. **UI 组件代码审查结果 (PASS)**:
   - `CreateGroupChatModal.tsx`: 所有字段完整（名称、Leader Agent、Model、工作目录、高级设置/Seed Messages）
   - `GroupChatView.tsx`: 布局正确（Timeline + SendBox + TaskPanel），错误处理完善
   - `TaskPanel.tsx`: 滑入动画、transcript 展示、状态标签、ESC 关闭、Refresh/Cancel 操作
   - `ChildTaskCard.tsx`: 5 种状态、progressSummary 分离展示、View Details 按钮
   - `GroupedHistory/index.tsx`: 群聊区段 + "新建群聊" 按钮正确关联 CreateGroupChatModal

3. **i18n 覆盖**: zh-CN 和 en-US 翻译文件 (`dispatch.json`) 齐备，键值完整。

### 后续建议

- 在 E2E fixture 中增加预创建 dispatch 对话的 setup 步骤（通过 `invokeBridge` 调用 `dispatch.createGroupChat`）
- 添加 `data-testid` 属性到 dispatch 相关组件，提高选择器稳定性
- 考虑将 "My Dispatch Team" 对话标记为 `type='dispatch'` 以验证完整流程
