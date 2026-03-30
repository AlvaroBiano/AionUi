# 群聊体验重设计

**Date**: 2026-03-30
**Status**: 设计讨论中
**Context**: S6 侧边栏重组的一部分，重新审视群聊（频道）的完整体验

---

## 一、创建群聊

### 三要素，极简创建

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| 群聊名称 | 否 | "新群聊" | 用户可改 |
| 群管理员 | **是** | 无 | 所有 agent 均可选（通用 Agent + 助手） |
| 工作空间 | 否 | 临时目录 | 不指定则使用默认临时目录 |

### 去掉的字段

| 字段 | 原位置 | 去掉原因 |
|------|--------|---------|
| 模型选择 | 创建弹窗 | 管理员使用其默认模型，想改在成员 Profile 里改 |
| 种子消息 | 高级设置 | 进群后直接发消息，不需要在创建流程里预填 |

### 原则

> 零配置能跑，想调再调。

---

## 二、进群后的欢迎体验

### 管理员主动打招呼

创建群聊后，系统给管理员注入一条 system 指令，管理员基于自身 persona **真实生成**（非模板）欢迎消息：

```
[系统指令]:
你是这个群的管理员。请向用户打招呼，询问需要完成什么任务。
告知用户你可以：
1. 自动创建临时成员来协作完成任务
2. 用户也可以手动拉人进群，由你来分派任务
```

**效果**：

```
🤖 Claude Code (管理员):
  你好！我是这个群的管理员。
  请告诉我你需要完成什么任务？

  我可以通过两种方式帮你：
  1. 🤖 自动创建临时成员来协作完成任务
  2. 👥 你也可以手动拉人进群，由我来分派任务

  直接告诉我你的需求就行。
```

不同 agent 担任管理员时，语气风格自然不同（Gemini vs Claude vs 自定义助手）。

---

## 三、两种拉人模式

### 模式 1：管理员自动创建临时 teammate

用户只描述任务，管理员自主决定拉谁。

```
用户: "帮我重构侧边栏的分组逻辑"

🤖 管理员 (思考):
  → 评估复杂度 → M 级
  → 需要 architect + developer + evaluator
  → 调用 start_task × 3

🤖 管理员:
  这是一个中等复杂度的任务，我来安排：
  - 📋 Architect → 技术设计
  - 💻 Developer → 代码实现
  - 🧪 Evaluator → 测试验证
  开始吗？
```

临时成员任务结束即消失。

### 模式 2：用户手动拉人

用户从侧边面板添加已有 agent 为群成员。

**添加成员后，系统自动给管理员注入消息**：

```
[系统]: 用户将「路演PPT助手」添加为群成员。
  - 擅长：制作演示文稿
  - 模型：gemini-3.1-pro
  - Skills：officecli, image-gen
请询问用户希望安排该成员做什么任务。
```

**管理员真实生成回复**：

```
🤖 管理员: 看到你拉了 🎯 路演PPT助手 进群，你希望安排它做什么？
```

**连续拉多个人**：

```
用户: [添加 Gemini]
🤖 管理员: 看到你拉了 ✦ Gemini 进群，你希望安排它做什么？

用户: [添加 财务建模助手]
🤖 管理员: 好的，💰 财务建模助手 也加入了。
  目前群里有 ✦ Gemini 和 💰 财务建模助手，
  你想让他们分别负责什么？

用户: "Gemini 负责数据分析，财务建模助手负责出报告"
🤖 管理员: 收到，我来分派任务...
```

### 两种模式对比

| | 自动创建 | 手动拉人 |
|--|---------|---------|
| 谁决定角色 | 管理员 AI 自主决定 | 用户指定 |
| 成员配置来源 | 管理员临时编造 | 已有 agent 的真实 profile |
| 生命周期 | 任务结束消失 | 留在群里，可反复调度 |
| 适合场景 | 用户不关心谁来做 | 用户明确知道要用哪些 agent |

两种模式可以混用：用户手动拉了几个人，管理员觉得还需要其他角色，再自动创建补充。

---

## 四、跨引擎协作

### 临时 teammate 支持选择基底 Agent

Teammate 本质是一份配置，可以指定不同的基底 Agent（通用 Agent）：

```
用户: "用 Claude Code 做规划，Codex 写代码，帮我重构侧边栏"

🤖 管理员: 收到，我来安排：
  - 📋 规划师 (Claude Code) → 负责技术设计
  - 💻 开发者 (Codex) → 负责代码实现
  开始吗？
```

管理员调用 `start_task` 时指定不同的 `agent_type`：

```
start_task({
  title: "技术设计",
  prompt: "阅读需求，产出技术设计...",
  teammate: { name: "规划师", presetRules: "..." },
  agent_type: "acp:claude",
  workspace: "/path/to/project"
})

start_task({
  title: "代码实现",
  prompt: "按技术设计实现代码...",
  teammate: { name: "开发者", presetRules: "..." },
  agent_type: "codex",
  workspace: "/path/to/project"
})
```

### `start_task` 扩展参数

| 参数 | 现有 | 新增/变更 |
|------|------|----------|
| prompt | ✅ | - |
| title | ✅ | - |
| teammate (name/avatar/rules) | ✅ | - |
| model | ✅ | - |
| workspace | ✅ | - |
| member_id | ❌ | 新增：引用手动拉入的群成员，自动填充其配置 |
| agent_type | ❌ | 新增：指定基底 Agent 类型（gemini/acp/codex/openclaw/nanobot） |

---

## 五、架构变更：Dispatch 从 gemini 特殊模式 → session 之上的调度层

### 现状问题

```
DispatchAgentManager → 绑死在 gemini worker
  → 管理员固定是 gemini agent
  → start_task 创建的子 agent 固定是 gemini
```

### 目标架构

```
Session Manager (调度层)
  → 管理 sessions，不关心底下跑什么引擎
  ├─ session A (管理员) → 可以是任意 agent type
  ├─ session B (子任务) → gemini worker
  ├─ session C (子任务) → acp/claude worker
  └─ session D (子任务) → codex worker
```

### 核心变化

> **Dispatch 从 "gemini 的特殊模式" 变成 "session 之上的调度层"**

MCP 工具（`start_task`、`read_transcript`、`send_message`、`list_sessions`）已经按 `session_id` 操作，概念上是 session 维度的。实现层面需要解绑 gemini 依赖：

| 模块 | 现在 | 改为 |
|------|------|------|
| DispatchAgentManager | 继承 gemini 逻辑 | 抽象为通用调度层，底层接不同 worker type |
| start_task handler | 固定创建 gemini 子 conversation | 根据 agent_type 创建对应类型的 conversation + worker |
| 管理员 conversation | type = 'dispatch'（内部复用 gemini） | type = 'dispatch'，底层 worker 由选择的管理员 agent 决定 |

---

## 六、成员状态指示

### 成员列表结构

```
┌─ 群成员 ──────────────────────┐
│                                │
│  👑 Claude Code (管理员)  🟢   │  ← 永远在线
│                                │
│  ── 固定成员 ──                │
│  🎯 路演PPT助手          🟢   │  ← 用户手动拉的，常驻
│  ✦ Gemini               ⚫   │  ← 待命中
│                                │
│  ── 临时成员 ──                │
│  📋 Architect            🔵   │  ← 管理员创建的，正在工作
│  💻 Developer            🔵   │  ← 正在工作
│  🧪 Evaluator            ⚫   │  ← 等待中
│                                │
│  + 添加成员                    │
└────────────────────────────────┘
```

### 状态定义

| 图标 | 状态 | 说明 |
|------|------|------|
| 🟢 | 在线/待命 | 管理员常驻；固定成员空闲可调度 |
| 🔵 | 工作中 | 正在执行任务（running） |
| ⚫ | 离线/等待 | 未激活或等待分配（pending/idle） |
| 🔴 | 异常 | 执行出错（failed） |

### 管理员状态

管理员始终 🟢 在线，作为群的核心调度者。

### 成员分类

| 类型 | 来源 | 生命周期 | 列表位置 |
|------|------|---------|---------|
| 管理员 | 创建群聊时指定 | 永久 | 最顶部，👑 标识 |
| 固定成员 | 用户手动添加 | 常驻，可反复调度 | 中间 |
| 临时成员 | 管理员 `start_task` 创建 | 任务结束后变灰/消失 | 底部 |

---

## 七、Teammate 工作视图：Tab 切换（Claude Code 没有的能力）

### 问题

Claude Code 的群聊是"管理员黑箱" — 用户只能看到管理员的汇报，无法直接观察子 agent 的实际工作过程。

### 方案：顶部 Tab 切换

点击成员 → 切换到该成员的工作对话流，实时查看。

```
┌─ # 新群聊 ──────────────────────────────────────────────┐
│  [群聊] [📋 Architect 🔵] [💻 Developer 🔵] [🧪 Evaluator ⚫] │
│─────────────────────────────────────────────────────────│
│                                                         │
│  (当前选中 tab 的对话内容)                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Teammate Tab = 只读观察窗口

用户在 teammate tab 里 **不能发消息**，只观察。展示的是管理员与该 teammate 之间的对话：

```
┌─ [群聊] [💻 Developer 🔵] ──────────────────┐
│                                               │
│  👑 管理员 → 💻 Developer:                    │
│  "请按技术设计重构侧边栏的分组逻辑，            │
│   涉及 AgentDMGroup.tsx 和 index.tsx..."       │
│                                               │
│  💻 Developer:                                │
│  ▶ Thinking...                                │
│  正在分析当前代码结构...                        │
│                                               │
│  🔧 Read(AgentDMGroup.tsx)                    │
│  🔧 Edit(index.tsx)                           │
│  🔧 Bash(bun run lint:fix)                    │
│                                               │
│  💻 Developer:                                │
│  重构完成，主要改动：...                        │
│                                               │
│  👑 管理员 → 💻 Developer:                    │
│  "补充一下，收起态也需要处理..."                 │
│                                               │
│  (输入框禁用 / 不显示)                          │
└───────────────────────────────────────────────┘
```

对话体验（Thinking 展开收起、Tool Call 渲染、代码高亮、流式输出）**完全复用单聊的对话组件**，零特殊处理。每个 teammate session 本质就是一个独立的 conversation，只是入口从侧边栏变成了群聊里的 tab。

### Teammate Session 生命周期

Session **不会做完一个任务就关闭**，是持续会话。管理员可以反复给同一个 teammate 发指令：

```
管理员: start_task("重构侧边栏")     → session 创建，teammate 开始工作
管理员: read_transcript              → 检查进度
管理员: send_message("补充需求...")   → 追加指令，session 继续
管理员: read_transcript              → 再次检查
...
管理员: (不再发消息)                  → session 变为 idle 待命
管理员: send_message("新任务...")     → 重新激活，继续工作
```

### Tab 行为

| 行为 | 说明 |
|------|------|
| 群聊 tab | 始终在最左边，管理员主对话，用户可发消息 |
| Teammate tab | 有任务时自动出现，**只读**，不可发消息 |
| 状态指示 | tab 上带状态标识（见下表） |
| 未读提示 | 当前不在该 tab 时，有新输出冒小红点 |
| 关闭 | 完成的 tab 可手动关闭 |

### Tab 状态

| 图标 | 状态 | 含义 |
|------|------|------|
| 🔵 | 工作中 | teammate 正在执行，对话实时更新 |
| 🟢 | 完成待命 | 当前任务做完，管理员可继续派活 |
| 🔴 | 异常 | 执行出错 |
| 灰色 | 已释放 | 临时 teammate 被管理员释放，session 结束 |

### 价值

> 群聊从 Claude Code 的"管理员黑箱"变成 **全透明的团队协作空间**。
> 用户是老板（在群聊 tab 发任务），也是观察者（在 teammate tab 看过程）。
> 想干预时回到群聊 tab 告诉管理员，由管理员转达。

---

## 八、群聊 UI 布局：单聊 + 两行

### 核心原则

> 群聊比单聊只多两行（成员横条 + Tab 栏），其他完全复用单聊组件。

### 布局对比

**单聊（现有）：**
```
┌─ header ─────────────────────────────────────┬─────────────────┐
│  gemini-3.1-pro   对话标题...          ☀🌙  │  🎯 学术论文助手  │
│                                              │  工作空间         │
│                                              │  文件    变更     │
```

**群聊（在单聊基础上 +2 行）：**
```
┌─ header ─────────────────────────────────────┬─────────────────┐
│  gemini-3.1-pro   # 新群聊             ☀🌙  │  👑 Claude Code  │
│                                              │  工作空间         │
│  👑Claude 🟢  🎯路演 🟢  📋Arch 🟢  💻Dev 🔵  🧪Eval ⚫  [+]  │
│  [群聊] [📋 Arch 🟢] [💻 Dev 🔵] [🧪 Eval ⚫]│  文件    变更     │
```

| 行 | 内容 | 群聊独有 |
|----|------|---------|
| 第一行 | 单聊 header：模型、标题、主题切换、管理员头像+名字 | 否，复用 |
| 第二行 | 群成员横条：头像 + 状态点 + [+] 添加 | **是** |
| 第三行 | Tab 栏：群聊 + 各 teammate 工作视图 | **是** |

### 完整界面

```
┌───────────────┬──────────────────────────────────────────┬─────────────────────┐
│               │                                          │                     │
│ + 新对话  🔍  │  gemini-3.1   # 新群聊            ☀🌙   │  👑 Claude Code     │
│               │                                          │  工作空间            │
│ ⭐ 收藏       │  👑Claude🟢 🎯路演🟢 📋Arch🟢 💻Dev🔵 🧪Eval⚫ [+]            │
│ # 新群聊      │  [群聊] [📋 Arch 🟢] [💻 Dev 🔵] [🧪 Eval ⚫]                 │
│               │                                          │  文件    变更        │
│ 📢 频道    +  │  ┌──────────────────────────────────┐    │  ────────────────── │
│ # 瓦砾群聊    │  │                                  │    │  ├─ src/            │
│ # Test v3     │  │  🤖 Claude Code (管理员):         │    │  │  └─ renderer/    │
│               │  │  收到，我来安排：                  │    │  ├─ tests/          │
│ 💬 私信       │  │  - 📋 Architect → 技术设计        │    │  └─ package.json    │
│ ✦ Gemini  刚刚│  │  - 💻 Developer → 代码实现        │    │                     │
│ 🐙 Claude 30m│  │  - 🧪 Evaluator → 测试验证       │    │  ────────────────── │
│ 🎯 路演   2h │  │                                  │    │                     │
│               │  │  📋 Architect 完成了技术设计。     │    │  Scratchpad     ▾  │
│ ── 更多(3) ── │  │  💻 Developer 正在实现代码...      │    │  📄 tech-design.md │
│               │  │                                  │    │  📄 changes.md     │
│               │  └──────────────────────────────────┘    │                     │
│               │  ┌──────────────────────────────┐  ⏎    │                     │
│ ⚙️ 设置       │  │ 输入消息...                   │       │                     │
│               │  └──────────────────────────────┘       │                     │
├───────────────┴──────────────────────────────────────────┴─────────────────────┤
```

### 切到 Teammate Tab（只读观察）

```
│               │                                          │                     │
│               │  gemini-3.1   # 新群聊            ☀🌙   │  👑 Claude Code     │
│               │                                          │  工作空间            │
│               │  👑Claude🟢 🎯路演🟢 📋Arch🟢 💻Dev🔵 🧪Eval⚫ [+]            │
│               │  [群聊] [📋 Arch 🟢] [💻 Dev 🔵●] [🧪 Eval ⚫]               │
│               │                          ▲ 选中          │  文件    变更        │
│               │  ┌──────────────────────────────────┐    │  ────────────────── │
│               │  │                                  │    │                     │
│               │  │  👑 管理员 → 💻 Developer:        │    │  (Developer 的      │
│               │  │  "请按技术设计重构侧边栏..."       │    │   worktree 文件树)  │
│               │  │                                  │    │                     │
│               │  │  💻 Developer:                    │    │  ├─ src/            │
│               │  │  ▶ Thinking                       │    │  │  └─ GroupedHis.. │
│               │  │  🔧 Read(AgentDMGroup.tsx)        │    │  └─ package.json    │
│               │  │  🔧 Edit(index.tsx)               │    │                     │
│               │  │  🔧 Bash(bunx tsc --noEmit) ✅    │    │  ────────────────── │
│               │  │                                  │    │                     │
│               │  │  💻 Developer:                    │    │  变更               │
│               │  │  重构完成，主要改动：...            │    │  M AgentDMGroup.tsx │
│               │  │                                  │    │  M index.tsx        │
│               │  └──────────────────────────────────┘    │                     │
│               │                                          │                     │
│               │  (无输入框 — 只读观察模式)                 │                     │
```

### 交互细节

- 成员横条：点击头像 → 打开 AgentProfileSider（查看/修改配置）
- Tab 栏：点击 tab → 切换对话视图，群聊 tab 有输入框，teammate tab 无输入框
- 右侧面板：切到 teammate tab 时，工作空间自动切换为该 teammate 的 worktree（如有）
- 点击文件：中间区域弹出文件渲染层（复用单聊行为）

---

## 九、工作空间与并行隔离

### 群级别共享工作空间

创建群聊时指定的工作空间是群级别的，所有 teammate 默认继承：

```
群聊 (# 新群聊)
  工作空间: /Users/veryliu/Documents/GitHub/AionUi    ← 群级别
  ├─ 主会话：用户 ↔ 管理员    → 同一工作空间
  ├─ 子会话：管理员 ↔ Architect  → 同一工作空间
  ├─ 子会话：管理员 ↔ Developer  → worktree 隔离副本
  └─ 子会话：管理员 ↔ Evaluator  → 同一工作空间或 Developer 的 worktree
```

### 并行隔离：Git Worktree

多个 teammate 并行修改代码时，使用 git worktree 提供隔离副本，避免文件冲突：

```
/Users/veryliu/Documents/GitHub/AionUi              ← 主工作空间
/Users/veryliu/Documents/GitHub/AionUi/.worktrees/
  ├─ developer-abc123/    ← Developer A 的隔离副本
  └─ developer-def456/    ← Developer B 的隔离副本
```

每个 worktree 是一个独立的 git branch，改完后由管理员合并回主分支。**对用户透明**：用户只看到"工作空间：AionUi"，worktree 的创建和合并由系统自动处理。

### 隔离策略

不是所有 teammate 都需要 worktree，管理员根据任务性质决定：

| 场景 | 策略 | 原因 |
|------|------|------|
| Architect 做设计 | 直接读主工作空间 | 只读代码，不修改 |
| 单个 Developer 写代码 | worktree 隔离 | 需要写文件，避免影响主分支 |
| 多个 Developer 并行 | 每人一个 worktree | 互不冲突 |
| Evaluator 跑测试 | 在 Developer 的 worktree 或独立 worktree | 需要测试 Developer 的改动 |

### `start_task` 隔离参数

```
start_task({
  title: "代码实现",
  prompt: "...",
  workspace: "/path/to/AionUi",
  isolation: "worktree"          ← 需要写代码的，给 worktree
})

start_task({
  title: "技术设计",
  prompt: "...",
  workspace: "/path/to/AionUi"   ← 只读的，直接用主工作空间
})
```

---

## 十、成员 Profile 面板

### 触发方式

点击成员横条上的头像 → 打开 AgentProfileSider（复用单聊的 Drawer 组件）。

### 管理员面板

```
┌─ 👑 Claude Code ────────────────┐
│                                  │
│  🟢 在线 · 管理员                 │
│                                  │
│  基底 Agent                      │
│  Claude Code                     │
│                                  │
│  模型                            │
│  claude-sonnet-4            [改] │
│                                  │
│  当前指令                         │
│  协调 Architect、Developer...    │
│                                  │
│  当前任务 · ⏱ 12分30秒           │
│  等待 Developer 完成代码实现      │
│                                  │
└──────────────────────────────────┘
```

### 固定成员面板（用户手动拉的）

```
┌─ 🎯 路演PPT助手 ────────────────┐
│                                  │
│  🟢 待命 · 固定成员               │
│                                  │
│  基底 Agent                      │
│  Gemini CLI                      │
│                                  │
│  模型                            │
│  gemini-3.1-pro             [改] │
│                                  │
│  Rule                        ▾  │
│  你是一个专业的路演PPT制作顾问...  │
│                                  │
│  Skills                          │
│  [officecli] [image-gen]         │
│                                  │
│  挂载 Agent                      │
│  🐙 Claude Code                  │
│                                  │
│  当前指令                         │
│  暂无                            │
│                                  │
│  当前任务                         │
│  暂无                            │
│                                  │
│  [从群聊移除]                     │
└──────────────────────────────────┘
```

### 临时成员面板（管理员创建的）

```
┌─ 💻 Developer ──────────────────┐
│                                  │
│  🔵 工作中 · 临时成员             │
│                                  │
│  基底 Agent                      │
│  Codex                           │
│                                  │
│  模型                            │
│  codex-mini                 [改] │
│                                  │
│  当前指令                     ▾  │
│  请按技术设计重构侧边栏分组逻辑   │
│  涉及 AgentDMGroup.tsx...        │
│                                  │
│  当前任务 · ⏱ 3分12秒            │
│  重构侧边栏分组逻辑              │
│                                  │
└──────────────────────────────────┘
```

### 字段汇总

| 字段 | 管理员 | 固定成员 | 临时成员 | 可编辑 |
|------|--------|---------|---------|--------|
| 状态 | ✅ | ✅ | ✅ | 只读 |
| 基底 Agent | ✅ | ✅ | ✅ | **只读** — 换引擎 = 销毁重建，上下文丢失 |
| 模型 | ✅ | ✅ | ✅ | **可改** — 同引擎换模型，上下文兼容 |
| Rule | - | ✅ | - | 只读 |
| Skills | - | ✅ | - | 只读 |
| 挂载 Agent | - | ✅ | - | 只读 |
| 当前指令 | ✅ | ✅ | ✅ | 只读 |
| 当前任务 + 耗时 | ✅ | ✅ | ✅ | 只读 |
| 从群聊移除 | - | ✅ | - | 操作按钮 |

### 操作权限设计

- **唯一的用户直接操作**：修改模型、移除固定成员
- **移除成员时**：系统自动通知管理员（"用户将 xxx 移出了群聊"），管理员重新调整计划
- **终止任务**：用户不直接操作，通过群聊 tab 告诉管理员，由管理员执行
- **想换基底 Agent**：告诉管理员重新创建一个 teammate

---

## 十一、助手配置扩充（对齐 Claude Code Agent 能力）

### 背景

Claude Code 的 `.claude/agents/*.md` 定义可复用的 agent 角色（name、description、model、tools + system prompt）。AionUi 的"助手"本质上是同一个概念，但配置字段不完整。

### 现有 vs 需要扩充

| 字段 | Claude Code agent.md | AionUi 助手现状 | 动作 |
|------|---------------------|----------------|------|
| name | ✅ | ✅ | - |
| description | ✅ 一句话描述 | ❌ | **新增** |
| avatar | - | ✅ | - |
| model | ✅ 指定默认模型 | ❌ 创建对话时选 | **新增** |
| tools / permissions | ✅ 工具权限列表 | ❌ | **新增** |
| system prompt | ✅ markdown 正文 | ✅ context 字段 | - |
| base agent type | - | ✅ presetAgentType | - |
| skills | - | ✅ enabledSkills | - |
| 挂载 agent | - | ✅ | - |

### 扩充方案

```typescript
type AcpBackendConfig = {
  // ...现有字段保留
  name: string;
  avatar?: string;
  context?: string;            // system prompt / rules
  presetAgentType?: string;    // 基底 agent (gemini/acp/codex/...)
  enabled?: boolean;
  isPreset?: boolean;
  source?: string;

  // ← 新增字段
  description?: string;        // 一句话描述，管理员和用户快速了解角色能力
  defaultModel?: string;       // 默认模型，不用每次创建对话时手动选
  allowedTools?: string[];     // 工具权限列表 (Read/Edit/Bash/Grep/Write...)
}
```

### 在群聊中的作用

管理员 `start_task` 引用已有助手时，自动加载完整配置：

```
管理员引用"路演PPT助手" →
  基底 Agent: gemini        (presetAgentType)
  模型: gemini-3.1-pro      (defaultModel)
  指令: "你是专业路演顾问..."  (context)
  工具: [Read, Bash, officecli]  (allowedTools)
  Skills: [officecli, image-gen]  (enabledSkills)
```

管理员自动创建临时 teammate 时，也可以参考已有助手的配置模式，而不是从零编造。

### 保存 teammate 时支持多引擎

当前 `SaveTeammateModal` 保存时 `presetAgentType` 写死 `'gemini'`，需要改为保存实际使用的基底 Agent 类型：

```typescript
// 现在：
{ presetAgentType: 'gemini' }  // 写死

// 改为：
{ presetAgentType: childConversation.type }  // 从实际 session 读取
```

### 助手 = 人才库

统一后的概念：

```
助手 (Assistants) = 可复用的 agent 角色配置
  ├─ 预设助手 (isPreset=true)     → 系统内置
  ├─ 自定义助手                    → 用户在设置里创建
  └─ 保存的 teammate (source='dispatch_teammate') → 从群聊中保存
```

三种来源，同一个数据结构，在群聊中都可以作为"人才"被管理员调度。

---

## 十二、团队配置注入管理员 Prompt

### 现状问题

`.claude/teams/aionui-ui-dev.json` 存在但未被 dispatch 系统读取。管理员"裸奔"，没有流程指导。

### 方案

创建群聊时可选择关联一个团队配置（或不选，让管理员自由发挥）：

```
创建群聊：
  群聊名称: 新群聊
  群管理员: Claude Code       ← 必选
  工作空间: ~/GitHub/AionUi   ← 可选
  团队配置: aionui-ui-dev     ← 可选（新增）
```

选择后，团队配置的关键信息注入管理员的 system prompt：
- 角色定义（有哪些角色可用）
- 任务分级规则（S/M/L）
- 工作流程（不同级别走什么流程）
- 成本控制（tool call 上限、timeout）
- 质量门禁（type check、lint、test）

不选择团队配置 → 管理员按自己的判断自由组织，更灵活但更不可控。

---

## 十三、对齐 Claude Code 能力：缺口分析与改造方向

### P0：权限审批模型（群聊中谁审批危险操作）

#### 问题

单聊中用户直接审批 tool call（如 `Bash(rm -rf)`、`Edit` 等）。群聊中多个 teammate 并行工作，如果每个都弹审批，用户会被淹没。

#### Claude Code 现状

Claude Code 的 agent team 中，用户只和管理员交互，子 agent 的权限由 `allowedTools` 配置控制，超出范围的直接拒绝。

#### AionUi 改造方向

**分级审批机制**：

| 级别 | 操作类型 | 处理方式 |
|------|---------|---------|
| 安全 | Read、Grep、Glob | 自动放行，无需审批 |
| 普通 | Edit、Write | 管理员自主决定（基于 `allowedTools` 配置） |
| 危险 | Bash(rm/git push/...)、外部 API 调用 | **上报用户审批** |

**实现要点**：

- 每个 teammate 创建时，管理员根据角色设定 `allowedTools`
- 超出 `allowedTools` 范围的操作 → 管理员拦截，决定上报还是拒绝
- 危险操作（匹配黑名单模式）→ 必须上报用户
- 审批 UI：群聊 tab 中弹出卡片式审批请求，用户一键批准/拒绝

```
┌─ 审批请求 ────────────────────────────┐
│  💻 Developer 请求执行：               │
│  Bash: git push origin feat/sidebar   │
│                                        │
│  [批准]  [拒绝]  [批准并记住此类操作]   │
└────────────────────────────────────────┘
```

- 「批准并记住」→ 该 teammate 后续同类操作自动放行（session 级别）

---

### P1：实时 Token/Cost 追踪

#### 问题

群聊中多个 teammate 并行消耗 token，用户无法感知成本。Claude Code 有 `--cost` 参数和实时显示。

#### 改造方向

**群聊级别成本面板**（右侧面板或底部状态栏）：

```
┌─ 成本追踪 ──────────────────────┐
│  群聊总计: $1.24 / 128K tokens  │
│                                  │
│  👑 管理员    $0.35  42K tokens  │
│  📋 Architect $0.28  31K tokens  │
│  💻 Developer $0.45  38K tokens  │
│  🧪 Evaluator $0.16  17K tokens  │
│                                  │
│  ⏱ 运行时间: 8分32秒            │
└──────────────────────────────────┘
```

**数据来源**：

- 每个 session 的 worker 已有 token 消耗数据（LLM API 返回的 usage）
- 需要在 session manager 层汇总，通过 IPC 推送到渲染进程
- 不同引擎（gemini/acp/codex）的计费模型不同，需要统一的成本计算抽象

**AionUi 改动**：

| 模块 | 改动 |
|------|------|
| Session Manager | 新增 `getSessionCostSummary(groupId)` 接口 |
| Worker 基类 | 统一上报 `{ inputTokens, outputTokens, model, provider }` |
| 右侧面板 | 新增 CostTracker 组件（可折叠） |
| 成员 Profile | 显示该成员累计消耗 |

---

### P1：任务进度可视化

#### 问题

Claude Code 是终端 UI，进度靠 streaming 文本。AionUi 是 GUI，可以做得更直观。

#### 改造方向

**方案 A：管理员消息内嵌进度卡片**

管理员在群聊中发送的进度汇报，自动渲染为卡片：

```
🤖 管理员:
┌─ 任务进度 ──────────────────────┐
│  重构侧边栏分组逻辑             │
│  ████████████░░░░░░ 65%         │
│                                  │
│  ✅ 技术设计 (Architect)         │
│  🔵 代码实现 (Developer) 进行中  │
│  ⚫ 测试验证 (Evaluator) 等待中  │
└──────────────────────────────────┘
```

**方案 B：独立的 Task Board 视图**

Tab 栏新增一个「任务面板」tab，看板式展示：

```
[群聊] [任务面板] [📋 Arch] [💻 Dev] [🧪 Eval]

┌─ 待办 ──────┬─ 进行中 ─────┬─ 已完成 ──────┐
│              │              │               │
│ 🧪 测试验证 │ 💻 代码实现  │ 📋 技术设计   │
│   Evaluator  │   Developer  │   Architect   │
│              │   ⏱ 3:12    │   ⏱ 2:45     │
└──────────────┴──────────────┴───────────────┘
```

**建议**：先实现方案 A（成本低，复用消息渲染），后续按需加方案 B。

**AionUi 改动**：

- 管理员 system prompt 中约定进度汇报的结构化格式（JSON 或 markdown）
- 渲染层识别特定格式的消息，渲染为进度卡片组件
- 无需后端改动，纯前端渲染优化

---

### P2：嵌套子 Agent 创建

#### 问题

Claude Code 支持 agent 内部再 spawn sub-agent（如 Developer 发现需要 lint 修复，自己创建一个 lint-fixer sub-agent）。当前设计中只有管理员能创建 teammate。

#### 改造方向

**受限嵌套**（最多 2 层）：

```
管理员 (L0)
  ├─ Architect (L1) — 不能创建子 agent
  ├─ Developer (L1)
  │   └─ Lint Fixer (L2) — Developer 自动创建，受 Developer 调度
  └─ Evaluator (L1)
```

**规则**：

- L1 teammate 可以创建 L2 子 agent，但需要管理员审批
- L2 子 agent 的 `allowedTools` 不能超过其父 L1 的权限
- L2 子 agent 在 Tab 栏中不单独出现，归入其父 teammate 的 tab（作为嵌套会话展示）
- 嵌套深度上限 = 2，防止失控

**AionUi 改动**：

- `start_task` 支持 `parent_session_id` 参数
- Tab 渲染支持嵌套（L2 agent 的对话在 L1 tab 中以折叠块展示）
- 权限继承逻辑：`L2.allowedTools ⊆ L1.allowedTools`

---

### P2：MCP Server 访问权限

#### 问题

Claude Code 支持 MCP Server（如 filesystem、GitHub、Slack），不同 agent 可以连接不同的 MCP Server。AionUi 的 Skills 机制类似，但在群聊中缺乏 per-teammate 的访问控制。

#### 改造方向

**Per-Teammate MCP/Skill 配置**：

```typescript
start_task({
  title: "制作PPT",
  teammate: { name: "PPT制作师" },
  agent_type: "gemini",
  // 该 teammate 可访问的 MCP Server / Skills
  allowedSkills: ["officecli", "image-gen"],
  // 该 teammate 可连接的 MCP Server
  mcpServers: ["filesystem", "image-generation"]
})
```

**规则**：

- 助手（固定成员）的 Skills 从其 profile 继承（`enabledSkills`）
- 临时 teammate 的 Skills 由管理员指定
- 管理员自身拥有所有 Skills 的访问权
- Teammate 请求未授权的 MCP/Skill → 拒绝并告知管理员

**AionUi 改动**：

| 模块 | 改动 |
|------|------|
| `start_task` handler | 支持 `allowedSkills` / `mcpServers` 参数 |
| Session worker | 根据配置过滤可用工具列表 |
| 成员 Profile 面板 | 显示已授权的 Skills/MCP 列表 |

---

### P2：Agent 间文件协作模式

#### 问题

多个 teammate 在同一项目上工作时，需要明确的文件交接协议。Claude Code 通过 `read_transcript` + `send_message` 实现信息传递，但文件层面的协作（如 Architect 的设计文档 → Developer 的实现）缺乏显式支持。

#### 改造方向

**Scratchpad（共享草稿区）**：

群聊级别的共享文件区域，teammate 之间通过 scratchpad 交换文档：

```
右侧面板：
┌─ 工作空间 ──────────────────────┐
│  /Users/.../AionUi              │
│  ├─ src/                        │
│  └─ ...                         │
│                                  │
│  ── Scratchpad ──               │
│  📄 tech-design.md   (Architect) │
│  📄 test-plan.md     (Evaluator) │
│  📄 changes.md       (Developer) │
└──────────────────────────────────┘
```

**机制**：

- Scratchpad 是群聊工作空间下的一个特殊目录（如 `.aion-scratchpad/`）
- Teammate 写入 scratchpad 的文件对所有成员可见
- 管理员在分派任务时，可以引用 scratchpad 中的文件作为上下文
- 任务结束后 scratchpad 可选择性清理

**管理员 Prompt 注入**：

```
[系统指令]:
Scratchpad 目录: {workspace}/.aion-scratchpad/
当需要与其他成员共享文档时，写入 scratchpad 目录。
引用其他成员产出时，从 scratchpad 读取。
```

**AionUi 改动**：

- 创建群聊时自动创建 scratchpad 目录
- 右侧面板增加 Scratchpad section（文件列表 + 作者标记）
- 管理员 system prompt 模板中加入 scratchpad 路径

---

## 十四、记忆与上下文持久化（对齐 Claude Code Memory 体系）

### Claude Code 的三层记忆

| 层 | 机制 | 加载时机 | 作用域 |
|----|------|---------|--------|
| L1 | `CLAUDE.md` | 每次会话自动 | 项目级 — 代码规范、构建命令、架构约束 |
| L2 | `.claude/projects/{hash}/memory/` | 每次会话自动加载索引 | 用户×项目级 — 偏好、反馈、项目上下文 |
| L3 | `.claude/agents/*.md` | 指定 agent 时 | 角色级 — 可复用的 agent 配置 |

### AionUi 现状

| Claude Code 能力 | AionUi 现状 | 差距 |
|-----------------|------------|------|
| CLAUDE.md 自动加载 | ❌ 不读取项目级配置 | 管理员/teammate 不了解项目规范 |
| Memory 跨会话记忆 | ❌ 每次从零开始 | agent 不记得用户偏好和历史决策 |
| Agent .md 配置 | ✅ 助手 `context` 字段 | 已有，需扩充（见第十一章） |

### P1：工作空间感知（对应 CLAUDE.md）

#### 问题

管理员和 teammate 被分配到一个工作空间后，对项目一无所知。不知道技术栈、构建工具、测试框架、代码规范。导致管理员的任务分派缺乏针对性，teammate 的代码风格不统一。

#### 方案：自动扫描并注入项目上下文

创建群聊指定工作空间后，系统自动扫描以下文件并注入管理员 system prompt：

```
扫描优先级（按顺序，找到即读取）：
1. CLAUDE.md / AGENTS.md        → 项目指令（如果存在）
2. .gemini/                     → Gemini 原生配置
3. package.json scripts         → 可用命令
4. README.md 前 200 行          → 项目概述
5. tsconfig.json / pyproject.toml → 技术栈信号
```

**注入效果**：

```
[系统指令 - 项目上下文]:
这是一个 TypeScript + React 项目（Electron 应用）。

构建工具: bun
可用命令:
- bun run dev → 启动开发服务器
- bun run lint:fix → 自动修复 lint 问题
- bun run test → 运行测试
- bunx tsc --noEmit → 类型检查

项目规范（来自 CLAUDE.md）:
- 组件使用 @arco-design/web-react
- CSS 优先 UnoCSS utility classes
- 严格模式，禁止 any
- commit 格式: <type>(<scope>): <subject>
...
```

**管理员 → teammate 传递**：

管理员给 teammate 分派任务时，自动附带相关的项目上下文片段：

```
管理员 → Developer:
"请重构侧边栏分组逻辑。
[项目上下文]: TypeScript strict mode, 使用 @arco-design, UnoCSS,
lint 命令: bun run lint:fix, 类型检查: bunx tsc --noEmit"
```

不是全量注入（太长），而是管理员根据任务类型**智能摘取**相关段落。

#### AionUi 改动

| 模块 | 改动 |
|------|------|
| `dispatchPrompt.ts` | `buildDispatchSystemPrompt` 新增 `projectContext` 参数 |
| 新增 `projectContextScanner.ts` | 扫描工作空间，提取项目上下文 |
| `DispatchAgentManager.ts` | 创建群聊时调用 scanner，结果存入 `conversation.extra.projectContext` |
| `start_task` handler | 支持 `projectContextSnippet` 参数，管理员摘取传递 |

#### 单聊同样受益

不仅群聊，单聊也可以使用此机制。用户和某个助手聊天时，如果指定了工作空间，自动扫描项目上下文注入 system prompt。

```
单聊创建时：
  workspace = "/Users/.../AionUi"
  → scanProjectContext(workspace)
  → 注入 conversation.extra.projectContext
  → agent 启动时作为 system prompt 前缀
```

---

### P2：跨会话记忆（对应 Memory 文件）

#### 问题

用户反复跟同一个 agent 合作，agent 每次都从零开始：
- 不记得用户偏好（"中文回复"、"不要加 emoji"）
- 不记得项目上下文（"这个项目在做 Slack 化改造"）
- 不记得过去的决策和踩坑（"migration 编号冲突过"）

#### 方案：Per-Agent 记忆目录

每个助手可选绑定一个记忆目录：

```
{workspace}/.aion/memory/
  ├─ MEMORY.md                    ← 索引文件，每次会话自动加载
  ├─ user_preferences.md          ← 用户偏好
  ├─ project_context.md           ← 项目上下文
  └─ feedback_testing.md          ← 反馈记忆
```

**记忆生命周期**：

```
会话开始
  → 读取 {workspace}/.aion/memory/MEMORY.md
  → 作为 system prompt 附加段注入

会话中
  → agent 识别到值得记住的信息
  → 调用 save_memory 工具写入记忆文件
  → 更新 MEMORY.md 索引

下次会话
  → 自动加载更新后的记忆
```

**记忆类型**（与 Claude Code 对齐）：

| 类型 | 说明 | 示例 |
|------|------|------|
| user | 用户角色、偏好 | "用户是全栈工程师，偏好中文回复" |
| feedback | 用户的反馈和纠正 | "不要在 PR 标题里加 emoji" |
| project | 项目状态和决策 | "S6 在设计讨论中，不要动侧边栏代码" |
| reference | 外部资源指引 | "设计文档在 iterations/ 目录" |

**与群聊的关系**：

- 群聊管理员共享工作空间级别的记忆（`{workspace}/.aion/memory/`）
- 固定成员（助手）可以有自己的记忆（`{助手配置目录}/memory/`）
- 临时 teammate 不写入持久记忆（任务结束消失）
- 管理员可以决定是否将某次群聊的重要结论写入项目记忆

#### AionUi 改动

| 模块 | 改动 |
|------|------|
| 新增 `memoryManager.ts` | 记忆文件的 CRUD 操作 |
| 新增 MCP 工具 `save_memory` | Agent 可调用写入记忆 |
| Agent 初始化流程 | 启动时扫描并加载 MEMORY.md |
| 助手配置 (`AcpBackendConfig`) | 新增 `memoryDir?: string` 字段 |
| 设置界面 | 助手编辑页可查看/管理记忆文件 |

#### 记忆存储位置策略

```
记忆目录优先级：
1. 助手配置中指定的 memoryDir     → 助手专属记忆
2. {workspace}/.aion/memory/      → 工作空间级共享记忆
3. ~/.aion/memory/                → 全局记忆（跨项目）
```

多个层级的记忆**合并加载**，冲突时低级覆盖高级（专属 > 工作空间 > 全局）。

---

### P3：Teammate 间的上下文共享

#### 方案：复用 Scratchpad + 管理员中转

不需要独立的 teammate 间记忆系统。通过两个已有机制覆盖：

1. **Scratchpad**（第十三章）— 文件层面的共享
2. **管理员 `send_message`** — 信息层面的中转

管理员作为"记忆中枢"，在分派任务时将相关上下文（包括其他 teammate 的产出摘要）注入 prompt。

```
管理员 → Evaluator:
"请测试 Developer 的改动。
[上下文]: Developer 在 worktree-abc123 中修改了 AgentDMGroup.tsx 和 index.tsx，
主要改动是将 section 分组从技术类型改为交互形式。
技术设计见 scratchpad/tech-design.md"
```

这比给每个 teammate 独立记忆更可控，避免记忆不一致。

---

## 十五、Claude Code vs AionUi 技术方案对比

### 架构对比

| 维度 | Claude Code | AionUi 现状 | 差距级别 |
|------|------------|------------|---------|
| 调度模型 | Frame-based 委派（`delegate_to`），异步通知驱动 | MCP 工具调用（`start_task`），自适应轮询检测 | ✅ 可接受 |
| 引擎绑定 | 引擎无关 — 每个 frame 可指定不同 model/provider | **绑死 Gemini** — `workerType='gemini'`，子会话 `type='gemini'` | 🔴 核心差距 |
| 隔离模型 | VM 进程隔离 + 挂载文件系统（`/sessions/{id}/mnt/`） | 无隔离，所有 teammate 共享同一工作空间 | 🔴 核心差距 |
| 权限模型 | per-frame 权限 + `on_behalf_of` 上报 + `allowedTools` | 全局 `yoloMode=true`，子任务无审批 | 🔴 核心差距 |
| 通信工具 | `send_message` + `wait_for_notification` + `get_child_trace` + `stop_child` | `send_message` + `read_transcript` + `list_sessions` | 🟡 缺 stop_child |
| 结构化输出 | `delegate_subtask` 支持 `output_schema`（JSON Schema） | 无 | 🟡 中等差距 |
| 成本追踪 | per-frame `{input_tokens, output_tokens, total_cost}` 自动汇总 | 无 | 🟡 中等差距 |
| Memory | 自动加载 CLAUDE.md + MEMORY.md，agent 可调用 `save_memory` | 无 | 🟡 中等差距 |
| Agent 定义 | `.claude/agents/*.md` frontmatter（name/model/tools/prompt） | `assistantPresets` + `customAgents`，缺 description/model/tools | 🟢 小差距 |
| Team 配置 | `.claude/teams/*.json` 自动加载注入管理员 prompt | 文件存在但未被 dispatch 读取 | 🟢 小差距 |

### 工具对比

| Claude Code 工具 | AionUi 对应 | 差异 |
|-----------------|------------|------|
| `delegate_to(agent, task, model, effort)` | `start_task(prompt, title, teammate, model)` | CC 有 `required_capabilities`、`effort` 级别 |
| `delegate_subtask(output_schema)` | 无 | CC 可要求子 agent 返回结构化 JSON |
| `send_message(child_frame_id, message)` | `send_message(session_id, message)` | ✅ 基本一致 |
| `wait_for_notification()` | 轮询 `listenForChildCompletion` | AionUi 用自适应轮询替代，可接受 |
| `get_child_trace(frame_id)` | `read_transcript(session_id)` | ✅ 功能一致 |
| `list_running_children()` | `list_sessions()` | ✅ 功能一致 |
| `stop_child(frame_id)` | **无** | 🔴 缺失：无法主动停止子任务 |
| `generate_plan()` | 无 | 🟡 CC 有多阶段任务规划工具 |
| `search_agents()` | 无 | 🟡 CC 可搜索可用 agent 能力 |
| `ask_user()` | 无 | 🟡 CC 子 agent 可上报问题给用户 |

### AionUi 现有的独特优势

AionUi 并非全面落后，以下能力是 Claude Code **没有**的：

| 能力 | AionUi | Claude Code |
|------|--------|------------|
| GUI 可视化 | ✅ Tab 切换观察 teammate 工作、成员面板、进度卡片 | ❌ 纯终端，管理员黑箱 |
| 多引擎混用 | ✅ 设计中（gemini + acp + codex 同群协作） | ❌ 只用 Claude 自己的模型 |
| 助手市场 | ✅ 预设助手 + 自定义助手 + 从群聊保存 | ❌ 只有 .claude/agents/ 文件 |
| Skills 生态 | ✅ officecli、image-gen 等可复用 skill | ⚠️ 有 MCP Server 但生态不同 |
| 成员 Profile | ✅ 可视化面板，实时查看/修改配置 | ❌ 无 UI，纯配置文件 |
| 实时观察 | ✅ teammate tab 实时流式输出 | ❌ 只能 `read_transcript` 拉取文本 |

---

## 十六、群聊实施方案

### 总体策略

> **复刻 Claude Code 的调度内核，发挥 AionUi 的 GUI 优势。**

分 4 个大阶段（G1-G4），每阶段内含多个可独立交付的子任务。优先解决 🔴 核心差距，再补齐 🟡 中等差距，最后加 AionUi 独有能力。

---

### G1：引擎解绑 + 调度层抽象（基础工程）

> 解除 Gemini 绑定，让 dispatch 成为引擎无关的调度层。这是所有后续工作的前提。

#### G1.1 抽象 Worker 基类

**现状**：`DispatchAgentManager` 内部 `workerType='gemini'`，子会话 `type='gemini'`。

**改造**：

```typescript
// 现在：
class DispatchAgentManager extends BaseAgentManager {
  constructor() {
    super('dispatch', {...}, emitter, true, 'gemini'); // hardcode
  }
}

// 改为：
class DispatchAgentManager extends BaseAgentManager {
  constructor(data: DispatchAgentData) {
    const adminWorkerType = data.adminAgentType || 'gemini';
    super('dispatch', {...}, emitter, true, adminWorkerType);
  }
}
```

| 文件 | 改动 |
|------|------|
| `DispatchAgentManager.ts` | `workerType` 从构造参数读取，不 hardcode |
| `startChildSession()` | 子会话 `type` 从 `start_task` 的 `agent_type` 参数决定 |
| `workerTaskManagerSingleton.ts` | `agentFactory` 根据 `agent_type` 路由到不同 worker creator |
| `dispatchBridge.ts` | `createGroupChat` 增加 `adminAgentType` 参数 |

#### G1.2 start_task 扩展参数

```typescript
type StartChildTaskParams = {
  prompt: string;
  title: string;
  teammate?: { name, avatar, presetRules };
  model?: { providerId, modelName };
  workspace?: string;
  // ← 新增
  agent_type?: string;     // 'gemini' | 'acp' | 'codex' | 'openclaw' | 'nanobot'
  member_id?: string;      // 引用已有群成员，自动填充配置
  isolation?: 'worktree';  // 隔离模式
};
```

#### G1.3 Agent Worker 注册表

```typescript
// workerTaskManagerSingleton.ts
const AGENT_WORKER_REGISTRY: Record<string, WorkerCreator> = {
  gemini: (conv, opts) => new GeminiAgentManager(conv, opts),
  acp:    (conv, opts) => new AcpAgentManager(conv, opts),
  codex:  (conv, opts) => new CodexAgentManager(conv, opts),
  // 未来扩展...
};

// start_task 时：
const workerCreator = AGENT_WORKER_REGISTRY[agentType] || AGENT_WORKER_REGISTRY.gemini;
```

#### G1.4 管理员引擎可选

创建群聊时，管理员不再固定是 Gemini，由选择的 agent 决定：

```
创建群聊：
  群管理员: Claude Code  → adminAgentType = 'acp'
  群管理员: Gemini       → adminAgentType = 'gemini'
  群管理员: 路演PPT助手   → adminAgentType = 助手的 presetAgentType
```

**交付标准**：
- [ ] 管理员可选择非 Gemini 的 agent
- [ ] `start_task` 可创建不同引擎的子任务
- [ ] 不同引擎的子任务能正常运行和完成通知
- [ ] 向后兼容：不指定 `agent_type` 时默认 `'gemini'`

---

### G2：隔离 + 权限 + 核心工具补齐

> 让并行 agent 安全地工作在同一个项目上。

#### G2.1 Git Worktree 隔离

**实现**：

```typescript
// 新增 worktreeManager.ts
async function createWorktree(
  mainWorkspace: string,
  sessionId: string
): Promise<string> {
  const branchName = `aion-teammate-${sessionId.slice(0, 8)}`;
  const worktreePath = path.join(mainWorkspace, '.worktrees', branchName);

  await execAsync(`git worktree add ${worktreePath} -b ${branchName}`);
  return worktreePath;
}

async function mergeWorktree(
  mainWorkspace: string,
  worktreePath: string
): Promise<MergeResult> {
  // 切回主分支，合并 worktree 分支
  // 返回冲突信息（如有）
}

async function cleanupWorktree(worktreePath: string): Promise<void> {
  await execAsync(`git worktree remove ${worktreePath} --force`);
}
```

| 文件 | 改动 |
|------|------|
| 新增 `dispatch/worktreeManager.ts` | worktree 创建/合并/清理 |
| `startChildSession()` | `isolation='worktree'` 时调用 `createWorktree` |
| `DispatchResourceGuard.ts` | cascadeKill 时清理 worktree |
| 子会话 `extra` | 存储 `worktreePath` 供前端展示 |

#### G2.2 权限分级

```typescript
// 新增 dispatch/permissionPolicy.ts

type ToolPermissionLevel = 'safe' | 'normal' | 'dangerous';

const TOOL_CLASSIFICATION: Record<string, ToolPermissionLevel> = {
  'Read': 'safe', 'Grep': 'safe', 'Glob': 'safe',
  'Edit': 'normal', 'Write': 'normal',
  'Bash': 'dangerous',  // 需进一步检查命令内容
};

// 危险命令模式
const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/, /\bgit\s+push\b/, /\bgit\s+reset\s+--hard\b/,
  /\bcurl\b.*\|\s*bash/, /\bsudo\b/,
];

function classifyToolCall(toolName: string, args: any): ToolPermissionLevel {
  if (toolName === 'Bash') {
    const cmd = args.command || '';
    if (DANGEROUS_BASH_PATTERNS.some(p => p.test(cmd))) return 'dangerous';
    return 'normal';
  }
  return TOOL_CLASSIFICATION[toolName] || 'normal';
}
```

**审批流程**：

```
子 agent tool call
  → classifyToolCall()
  ├─ safe    → 自动放行
  ├─ normal  → 检查 allowedTools，在列表内放行，否则拒绝
  └─ dangerous → 上报用户审批（通过管理员 ask_user 中转）
```

| 文件 | 改动 |
|------|------|
| 新增 `dispatch/permissionPolicy.ts` | 工具分级逻辑 |
| `DispatchAgentManager.ts` | 子任务 tool call 拦截层 |
| `start_task` params | 新增 `allowedTools?: string[]` |
| 前端群聊 tab | 审批请求卡片 UI |

#### G2.3 stop_child 工具

```typescript
// DispatchMcpServer 新增工具
{
  name: 'stop_child',
  description: 'Stop a running child task',
  properties: {
    session_id: { type: 'string' },
    reason?: { type: 'string' }
  }
}

// DispatchAgentManager 实现
async stopChild(sessionId: string, reason?: string): Promise<void> {
  const childInfo = this.tracker.getChildInfo(sessionId);
  if (!childInfo) throw new Error('Session not found');

  this.taskManager.kill(sessionId);
  this.tracker.updateChildStatus(sessionId, 'cancelled');

  // 如果有 worktree，清理
  if (childInfo.worktreePath) {
    await cleanupWorktree(childInfo.worktreePath);
  }
}
```

#### G2.4 ask_user 工具

子 agent 遇到无法决策的问题时，上报到群聊 tab 让用户回答：

```typescript
// 子 agent 调用 ask_user
// → 消息通过 DispatchNotifier 上报到父 session
// → 父 session 转发到群聊 UI
// → 用户在群聊 tab 中回复
// → 管理员 send_message 将答案传回子 agent
```

**交付标准**：
- [ ] 写代码的 teammate 在独立 worktree 中工作
- [ ] 危险操作弹出审批请求，用户可批准/拒绝
- [ ] 管理员可主动 `stop_child` 终止卡住的子任务
- [ ] 子 agent 可通过 `ask_user` 上报问题

---

### G3：UI 体验层（AionUi 独有优势）

> 在调度内核之上，构建 Claude Code 没有的可视化体验。

#### G3.1 群聊创建流程简化

```
CreateGroupChatModal 改造：
  ├─ 群聊名称（默认"新群聊"）
  ├─ 群管理员（从所有 agent 中选择，必填）
  ├─ 工作空间（可选，默认临时目录）
  └─ 团队配置（可选，选择已有 .claude/teams/*.json）

  去掉：模型选择、种子消息
```

| 文件 | 改动 |
|------|------|
| `CreateGroupChatModal.tsx` | 简化字段，新增管理员选择器 |
| `dispatchBridge.ts` | `createGroupChat` 参数调整 |
| `dispatchPrompt.ts` | 注入团队配置 + 项目上下文 |

#### G3.2 管理员欢迎消息

创建群聊后，注入 system 指令触发管理员真实生成欢迎消息：

```typescript
// dispatchPrompt.ts 追加
const welcomeInstruction = `
你是这个群的管理员。请向用户打招呼，询问需要完成什么任务。
告知用户你可以：
1. 自动创建临时成员来协作完成任务
2. 用户也可以手动拉人进群，由你来分派任务
`;
```

#### G3.3 成员横条 + Tab 栏

群聊比单聊多两行 UI：

```
行 1: 成员横条 — 头像 + 状态点 + [+] 添加
行 2: Tab 栏 — [群聊] [📋 Arch 🟢] [💻 Dev 🔵] ...
```

| 文件 | 改动 |
|------|------|
| 新增 `dispatch/components/MemberBar.tsx` | 成员横条组件 |
| 新增 `dispatch/components/TeammateTabBar.tsx` | Tab 栏组件 |
| `GroupChatView.tsx` | 集成两个组件到聊天布局 |
| 新增 `dispatch/components/TeammateTabView.tsx` | Teammate 只读对话视图 |

#### G3.4 Teammate 工作视图（只读 Tab）

复用单聊的对话组件，展示管理员与 teammate 的对话流：

```typescript
// TeammateTabView.tsx
// 本质是一个只读的 ChatTimeline，数据源是子会话的消息
<ChatTimeline
  conversationId={childSessionId}
  readonly={true}           // 无输入框
  showToolCalls={true}      // 展示 thinking/tool call
  showStreaming={true}      // 实时流式输出
/>
```

右侧面板同步切换为该 teammate 的 worktree 文件树。

#### G3.5 成员 Profile 面板

点击成员横条头像 → 打开 AgentProfileSider Drawer：

| 字段 | 管理员 | 固定成员 | 临时成员 |
|------|--------|---------|---------|
| 状态 | 🟢 在线 | 动态 | 动态 |
| 基底 Agent | 只读 | 只读 | 只读 |
| 模型 | **可改** | **可改** | **可改** |
| Rule/Skills/挂载 | - | 只读 | - |
| 当前指令 + 任务 | 只读 | 只读 | 只读 |
| 从群聊移除 | - | ✅ | - |

#### G3.6 手动拉人进群

用户在侧边面板添加已有 agent → 系统通知管理员：

```typescript
// 前端: MemberBar 的 [+] 按钮
// → 弹出 agent 选择器（从 AgentRegistry 读取）
// → 选择后调用 ipcBridge.dispatch.addMember(groupId, agentId)
// → dispatchBridge: 注入系统消息给管理员
//   "[系统]: 用户将「路演PPT助手」添加为群成员。擅长：制作演示文稿..."
// → 管理员真实生成回复，询问用户安排
```

**交付标准**：
- [ ] 创建群聊流程简化为 3 个字段
- [ ] 管理员自动发送欢迎消息
- [ ] 成员横条 + Tab 栏正常渲染
- [ ] 点击 teammate tab 可实时观察工作过程
- [ ] 成员 Profile 面板展示正确信息
- [ ] 用户可手动拉人进群

---

### G4：增强能力（对齐 + 超越）

> 补齐剩余差距，加入 AionUi 独有能力。

#### G4.1 工作空间感知

自动扫描项目上下文（CLAUDE.md、package.json、README），注入管理员 prompt。

| 文件 | 改动 |
|------|------|
| 新增 `dispatch/projectContextScanner.ts` | 工作空间扫描器 |
| `dispatchPrompt.ts` | 注入 `projectContext` |
| `DispatchAgentManager.ts` | bootstrap 时调用 scanner |

#### G4.2 团队配置加载

创建群聊时可选关联 `.claude/teams/*.json`，注入管理员 prompt：

| 文件 | 改动 |
|------|------|
| 新增 `dispatch/teamConfigLoader.ts` | 团队配置解析 |
| `CreateGroupChatModal.tsx` | 团队配置选择器 |
| `dispatchPrompt.ts` | 注入角色定义、工作流程、质量门禁 |

#### G4.3 助手配置扩充

`AcpBackendConfig` 新增 `description`、`defaultModel`、`allowedTools`，对齐 `.claude/agents/*.md`。

#### G4.4 成本追踪

per-session token 统计，右侧面板展示群聊级成本汇总。

| 文件 | 改动 |
|------|------|
| Session worker 基类 | 统一上报 `{ inputTokens, outputTokens, model }` |
| 新增 `dispatch/costTracker.ts` | 成本汇总计算 |
| 新增 `dispatch/components/CostPanel.tsx` | 成本展示组件 |

#### G4.5 任务进度卡片

管理员消息中的进度汇报自动渲染为可视化卡片。

#### G4.6 generate_plan 工具

管理员拆解任务前先生成结构化计划：

```typescript
{
  name: 'generate_plan',
  description: 'Generate a structured plan before delegating tasks',
  properties: {
    task: { type: 'string' },
    constraints?: { type: 'string' }
  }
}
// 返回: { phases: [{ title, agent_type, dependencies, estimated_effort }] }
```

#### G4.7 跨会话记忆

per-agent 记忆目录，自动加载 MEMORY.md，agent 可调用 `save_memory`。

**交付标准**：
- [ ] 管理员了解项目技术栈和规范
- [ ] 团队配置可注入管理员
- [ ] 助手配置包含 description/model/tools
- [ ] 实时查看群聊成本
- [ ] 任务进度可视化
- [ ] 管理员有 plan 工具
- [ ] agent 可跨会话记忆

---

### 阶段依赖关系

```
G1 引擎解绑（基础）
 ├─→ G2 隔离 + 权限（安全）
 │    └─→ G4 增强能力（对齐+超越）
 └─→ G3 UI 体验层（可视化）
      └─→ G4 增强能力（对齐+超越）
```

G1 是一切的前提。G2 和 G3 可并行推进。G4 依赖 G2 + G3。

### 里程碑定义

| 里程碑 | 阶段 | 标志 |
|--------|------|------|
| **M1: 多引擎调度可用** | G1 完成 | 管理员用 Claude，子任务用 Codex，能跑通 |
| **M2: 安全并行** | G2 完成 | 多个 teammate worktree 隔离，危险操作有审批 |
| **M3: 可视化群聊** | G3 完成 | 用户能看到每个 teammate 的实时工作过程 |
| **M4: 完整对齐** | G4 完成 | 工作空间感知、成本追踪、记忆系统全部就位 |

### 与现有代码的兼容

所有改造基于 `feat/dispatch` 分支的现有实现，**增量修改**而非重写：

| 现有模块 | 处理方式 |
|---------|---------|
| `DispatchAgentManager` | 保留主体，解绑 gemini 依赖 |
| `DispatchMcpServer` | 保留协议，扩展工具列表 |
| `DispatchSessionTracker` | 保留追踪逻辑，增加 worktree 信息 |
| `DispatchNotifier` | 保留通知机制，增加 ask_user 路由 |
| `DispatchResourceGuard` | 保留并发控制，增加 worktree 清理 |
| `dispatchPrompt.ts` | 扩展注入内容（项目上下文、团队配置） |
| `GroupChatView.tsx` | 增加成员横条 + Tab 栏，保留对话区 |
| `SaveTeammateModal.tsx` | 修改 `presetAgentType` 不写死 `'gemini'` |

---

## 待讨论

- [ ] 群成员列表的持久化方案（跟 conversation extra 存一起？独立表？）
- [ ] 子 agent 之间是否需要直接通信，还是全部通过管理员中转
- [ ] session 调度层的详细技术设计
- [ ] Tab 数量过多时的处理（滚动？折叠？上限？）
- [ ] 右侧工作空间面板是否支持中途修改路径（当前不支持，后续迭代）
- [ ] 团队配置的 UI 管理界面（创建/编辑/删除团队配置）
- [ ] allowedTools 的粒度：工具级别 vs 权限级别（read/write/bash）
- [ ] 审批模型的具体黑名单规则（哪些命令模式算"危险"）
- [ ] 成本追踪的计费精度（按 session 还是按 tool call）
- [ ] 嵌套子 agent 是否需要在 MVP 中支持
- [ ] Scratchpad 的生命周期管理（群聊删除时是否清理）
- [ ] 项目上下文扫描的 token 预算（注入太多会挤占对话 context window）
- [ ] 记忆文件的最大容量限制（防止无限增长）
- [ ] 单聊是否也自动加载工作空间上下文（当前仅群聊讨论了）
- [ ] save_memory 工具是否需要用户审批（防止 agent 写入不恰当内容）
- [ ] 非 Gemini 引擎的 MCP 协议适配方案（ACP/Codex 是否支持 MCP stdio？）
- [ ] worktree 合并冲突时的用户交互设计
- [ ] ask_user 的超时机制（子 agent 等待用户回复时不能无限阻塞）
