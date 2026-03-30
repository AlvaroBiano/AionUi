# Post-S5 UX Refinements Changelog

**Date**: 2026-03-29
**Trigger**: User acceptance testing after S1-S5 implementation

---

## 1. Collapsed Preview Leak

**Problem**: 折叠状态下最新会话的标题"泄露"显示在 agent 行下方，视觉干扰。
**Fix**: 移除 `AgentDMGroup.tsx` 中 `!isExpanded && latestConversation` 预览区块。

## 2. Expand/Collapse Chevron Removal

**Problem**: 展开/收起箭头 (Down/Right) 占用空间且冗余，count badge 已足够表意。
**Fix**: 从 `AgentDMGroup.tsx` 移除 `Down`、`Right` 图标 import 及渲染。

## 3. Count Badge Visibility (count=1)

**Problem**: 会话数=1 时不显示 count badge，用户无法感知该 agent 有可展开内容。
**Fix**: 条件从 `conversationCount > 1` 改为 `conversationCount > 0`。

## 4. DM Section Split

**Problem**: 单一"私信"section 混合显示通用 Agent 和助手，不够清晰。
**Fix**: 拆分为"通用 Agent"和"助手"两个 section，按 `isPermanent` 分组。新增 i18n keys `generalAgentsSection` / `assistantsSection`（6 个语言文件）。

## 5. ✓ Badge Removal

**Problem**: 助手行的 ✓ badge 冗余，section 标题已区分通用 Agent 和助手。
**Fix**: 移除 `AgentDMGroup.tsx` 中 subtitle 模式和 flat/grouped 模式两处的 ✓ badge。

## 6. Click Reliability Fix

**Problem**: Agent 行点击展开时而不灵敏，约 30% 点击无响应。
**Root Cause**: 20×20px avatar 上有独立的 `handleAvatarClick` + `e.stopPropagation()`，拦截了本应传播到父级 `handleToggle` 的点击事件。
**Fix**: 移除 avatar 上的 `handleAvatarClick` 及 `stopPropagation`，整行统一使用 `handleToggle`。Avatar 点击触发 AgentProfileSider 的功能移至后续 S4 重新设计中实现。

---

## S4 Design Change Decision

**Original S4**: Agent Profile 全页面 (`/agent/:id`)，独立路由，含完整配置和历史会话。
**Revised S4**: AgentProfileSider — 侧滑 Drawer 面板，从会话头部 agent 名称触发。

**变更原因**:

1. 全页面跳转打断对话流，用户体验不佳
2. 左侧边栏已展示会话列表，Profile 页面的"最近会话"功能冗余
3. 参考群聊的 GroupMemberSider 交互模式，侧滑面板更自然

**新 S4 面板内容**:

- **通用 Agent**: 头像+名称、开始新对话按钮、所在的群聊列表
- **助手**: 头像+名称、开始新对话按钮、Rule(只读)、Skills列表(名称)、挂载的通用Agent、所在的群聊列表
- **触发方式**: 仅从会话头部 (conversation header) agent 名称点击，侧边栏不触发

---

## S4 AgentProfileSider 实现记录 (2026-03-29 ~ 03-30)

### 已完成功能

**AgentProfileDrawer 核心** (commit `bebe2194`):
- Arco `Drawer` 组件，360px 宽，右侧滑出
- 通用 Agent 视图：头像+名称+类型 badge、所在群聊列表
- 助手视图：头像+名称+类型 badge、Rule(只读可折叠)、Skills 标签列表、挂载的通用 Agent 列表、所在群聊列表
- 新增 hook `useAgentProfileDrawer.ts` 解析 agent 注册表、预设、自定义 agent 数据
- 删除废弃的 `/agent/:agentId` 全页面路由及 `src/renderer/pages/agent/` 目录（6 个文件）
- 新增 `agent.drawer.*` 共 11 个 i18n key（6 语言）

**Drawer Bug 修复**:
- 预设助手 Rule 为空 → 使用 `ipcBridge.fs.readAssistantRule` + SWR 缓存获取 (commit `4c35dfdc`)
- CLI Agent（Gemini/Claude Code）缺少品牌头像 → 使用 `getAgentLogo()` (commit `696bca05`)
- 助手缺少编辑入口 → 添加"修改设置"按钮跳转 `/settings/assistants` (commit `a6484669`)

### Header 交互优化

- Agent 名称加 hover 态 `hover:bg-fill-3`（圆角 pill），提示可点击 (commit `a74cde93`)
- 定时任务图标加 hover 态 `hover:bg-3` (commit `a74cde93`)
- Hover 底色过浅 → 从 `bg-fill-2` 改为 `bg-fill-3` (commit `cfa806db`)

### 侧边栏显示逻辑修复

- Gemini 显示 "dispatch_system" 字幕 → 非 permanent agent 跳过 subtitle 模式 (commit `67db2525`)
- 修复过度限制：通用 Agent 也支持 grouped（文件夹）模式 (commit `67db2525`)
- 工作空间文件夹 count badge 与 agent 行 badge 右对齐 (commit `451498c8`)
- Agent 行高统一 `py-8px`，与 ConversationRow 一致 (commit `51d5a9f2`)
- DM 对话使用聊天气泡图标 `MessageOne`，区分于 agent 头像 (commit `2f8b3251`)

### 收起侧边栏优化 (commit `2250ff4f`)

- 收起态点击 agent 头像 → `Popover` 弹出对话列表，`position='right'`
- 头像 hover → `Tooltip` 显示 agent 名称
- Channels / 通用 Agent / 助手三个 section 之间加细分割线
- 清理无用 import：`useTranslation`、`useNavigate`、`handleAvatarClick`
