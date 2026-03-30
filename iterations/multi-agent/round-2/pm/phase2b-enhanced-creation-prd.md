# Phase 2b — 增强创建流程 + 子任务面板 + 种子消息

## 1. Overview

### 目标

Phase 2b 在 Phase 2a 的 dispatch 多 agent 协作基础上，补全创建流程中延后的两个核心选择器（Leader Agent、Model），新增子任务详情面板和种子消息定制能力。完成后，用户可以：

- 创建群聊时选择 leader agent（而非固定使用默认 Gemini agent）
- 创建群聊时选择模型/provider（而非固定使用 `gemini.defaultModel`）
- 查看子任务完整对话记录（独立面板，替代 ChildTaskCard 内联展开）
- 为 dispatcher 配置系统提示词/种子消息

### 范围

| 编号 | 功能                  | 类型        |
| ---- | --------------------- | ----------- |
| F-1  | Leader Agent Selector | 2a 遗留补全 |
| F-2  | Model Selector        | 2a 遗留补全 |
| F-3  | Task Panel UI         | 新增        |
| F-4  | Seed Messages         | 新增        |

### 不在范围

- Save teammate as reusable assistant（Phase 3）
- Parent-child visualization tree（Phase 3）
- Single-chat upgrade to dispatch mode（Phase 3）
- Child agent 独立模型选择（Phase 3）

---

## 2. User Stories

### US-1: Leader Agent 选择

> 作为用户，我在创建群聊时希望能选择哪个 agent 作为 Orchestrator leader，以便利用已有的自定义 assistant 人设和能力来协调任务。

### US-2: Model 选择

> 作为用户，我在创建群聊时希望能选择具体的模型和 provider，而不是始终使用全局默认模型，以便针对不同任务选择最合适的模型。

### US-3: 子任务详情查看

> 作为用户，当 orchestrator 创建了子任务后，我希望能在独立的侧面板中查看子任务的完整对话记录（transcript），包括实时流式更新，而不是在卡片内挤压显示。

### US-4: 系统提示词定制

> 作为用户，我希望在创建群聊时能配置 dispatcher 的系统提示词（seed messages），以便控制 orchestrator 的行为风格、任务分解策略或领域约束。

---

## 3. Feature Specs

### F-1: Leader Agent Selector

#### 3.1.1 概述

在 `CreateGroupChatModal` 中新增 Leader Agent 选择区域，允许用户从已配置的 assistant（`acp.customAgents`）中选择一个作为 Orchestrator leader。选中的 assistant 的 `presetRules`、`name`、`avatar` 将注入到 dispatcher 的系统提示词和展示信息中。

#### 3.1.2 数据来源

- **自定义 Assistants**: 从 `ConfigStorage.get('acp.customAgents')` 获取 `AcpBackendConfig[]`
- **过滤条件**: 仅显示 `enabled !== false` 的 assistant
- **默认值**: 不选择任何 assistant 时，使用当前的默认行为（`dispatchPrompt.ts` 中的通用 dispatch prompt）

#### 3.1.3 UI 规格

- **位置**: 在 Name 输入框下方、Workspace 选择器上方
- **标签**: `dispatch.create.leaderLabel`（"Leader Agent"）
- **组件**: 使用 Arco `Select` 组件，`allowClear` 允许取消选择
- **选项渲染**: 每个选项显示 avatar（emoji 或图片）+ name，使用 `Select.Option` 的 `label` 自定义渲染
- **空状态**: 如果没有可用的 assistant，显示提示文本 + 跳转到设置页面的链接
- **图标**: 使用 `@icon-park/react` 的 `People` 图标作为 label 前缀图标

#### 3.1.4 状态管理

```
新增 state:
  leaderAgentId: string | undefined  // 选中的 assistant ID，undefined 表示使用默认
```

#### 3.1.5 数据传递

选中的 `leaderAgentId` 通过 `createGroupChat` IPC 参数传递到 main process：

```
ipcBridge.dispatch.createGroupChat.invoke({
  name,
  workspace,
  leaderAgentId,   // 新增
  modelOverride,   // 新增 (F-2)
  seedMessages,    // 新增 (F-4)
})
```

#### 3.1.6 Main Process 处理

在 `dispatchBridge.ts` 的 `createGroupChat` provider 中：

1. 如果 `leaderAgentId` 存在，从 `ProcessConfig.get('acp.customAgents')` 查找对应 assistant
2. 将 assistant 的 `presetRules` 存入 `conversation.extra.leaderPresetRules`
3. 将 assistant 的 `name` 存入 `conversation.extra.leaderName`
4. 将 assistant 的 `avatar` 存入 `conversation.extra.leaderAvatar`
5. 将 `leaderAgentId` 存入 `conversation.extra.leaderAgentId`

在 `DispatchAgentManager` 构建时：

1. 从 `conversation.extra` 读取 `leaderPresetRules`
2. 将其追加到 `buildDispatchSystemPrompt` 的输出中（作为额外上下文，不替换核心 dispatch 指令）
3. 使用 `leaderName` 替代默认的 `dispatcherName`

---

### F-2: Model Selector

#### 3.2.1 概述

在 `CreateGroupChatModal` 中新增 Model 选择器，允许用户为当前群聊选择具体的模型和 provider，而非始终使用 `gemini.defaultModel`。

#### 3.2.2 数据来源

- **Provider 列表**: 通过 `ipcBridge.mode.getModelConfig.invoke()` 获取 `IProvider[]`
- **默认值**: 使用 `gemini.defaultModel` 作为初始选中值（与 Phase 2a 行为一致）
- **Google Auth Models**: 通过 `useGeminiGoogleAuthModels` hook 获取 Google Auth 模式下的可用模型

#### 3.2.3 UI 规格

- **位置**: 在 Leader Agent Selector 下方、Workspace 选择器上方
- **标签**: `dispatch.create.modelLabel`（"Model"）
- **组件**: 复用 `GuidModelSelector` 的交互模式，但适配为 Modal 内的 `Select` 形态
  - 使用 Arco `Select` 组件
  - `Select.OptGroup` 按 provider name 分组
  - 每个 `Select.Option` 显示模型名称 + 健康状态指示点
  - 禁用的 provider（`enabled === false`）不显示
  - 模型级别禁用（`modelEnabled[modelName] === false`）的模型不显示
- **图标**: 使用 `@icon-park/react` 的 `Brain` 图标作为 label 前缀图标

#### 3.2.4 状态管理

```
新增 state:
  selectedModel: TProviderWithModel | undefined  // 选中的模型，undefined 表示使用默认
```

使用 `useSWR` 获取 `model.config` 数据，与 `GuidModelSelector` 保持一致的获取方式。

#### 3.2.5 数据传递

在 IPC 调用中传递 `modelOverride`:

```
modelOverride: selectedModel
  ? { providerId: selectedModel.id, useModel: selectedModel.useModel }
  : undefined
```

#### 3.2.6 Main Process 处理

在 `dispatchBridge.ts` 的 `createGroupChat` provider 中：

1. 如果 `modelOverride` 存在：
   - 从 `ProcessConfig.get('model.config')` 查找 `providerId` 对应的完整 provider
   - 构建 `TProviderWithModel`，使用 `modelOverride.useModel` 作为 `useModel`
2. 如果 `modelOverride` 不存在：保持现有行为（读取 `gemini.defaultModel`）
3. 将最终的 `TProviderWithModel` 存入 `conversation.model`

---

### F-3: Task Panel UI

#### 3.3.1 概述

将 `ChildTaskCard` 内联展开的 transcript 查看器升级为独立的侧面板（Task Panel），提供更好的阅读体验和更丰富的子任务详情。

#### 3.3.2 UI 布局

```
┌──────────────────────────────────────────────────────────────┐
│  GroupChatView                                               │
│  ┌───────────────────────────────┬──────────────────────────┐│
│  │  Timeline (主区域)            │  Task Panel (侧面板)     ││
│  │                               │                          ││
│  │  [Orchestrator message]       │  ┌─ Header ────────────┐ ││
│  │  [ChildTaskCard] ← 点击      │  │ Agent Name  Status   │ ││
│  │  [User message]               │  │ Task Title           │ ││
│  │  ...                          │  └──────────────────────┘ ││
│  │                               │  ┌─ Transcript ─────────┐ ││
│  │                               │  │ [user] prompt...     │ ││
│  │                               │  │ [assistant] resp...  │ ││
│  │                               │  │ ...                  │ ││
│  │                               │  └──────────────────────┘ ││
│  │                               │  ┌─ Actions ────────────┐ ││
│  │                               │  │ [Cancel] [Refresh]   │ ││
│  │                               │  └──────────────────────┘ ││
│  ├───────────────────────────────┴──────────────────────────┤│
│  │  SendBox                                                  ││
│  └───────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

#### 3.3.3 组件设计

##### TaskPanel 组件

- **文件**: `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`
- **触发方式**: 点击 `ChildTaskCard` 的 "View Details" 按钮打开，替代现有的内联展开
- **位置**: `GroupChatView` 右侧，使用 CSS flex 布局，宽度 `360px`，可拖拽调整
- **关闭**: 点击 Panel 右上角关闭按钮（`@icon-park/react` 的 `Close` 图标）或按 ESC

##### TaskPanel Header

- Agent 头像（emoji 或默认 `People` 图标）
- Agent 名称 + 任务标题
- 状态 Tag（复用 `ChildTaskCard` 的 `getTagColor` 逻辑）
- 创建时间（相对时间格式）

##### TaskPanel Transcript

- 滚动容器，`max-height` 充满剩余空间
- 消息格式：role badge（`[user]` / `[assistant]`）+ 内容
- assistant 消息支持 Markdown 渲染（使用现有的 Markdown 渲染组件）
- 自动滚动到底部（新消息时）
- 空状态提示：`dispatch.taskPanel.noTranscript`

##### TaskPanel Actions

- **Cancel 按钮**: 仅在 `status === 'running' || status === 'pending'` 时显示，复用 `ChildTaskCard` 的取消逻辑
- **Refresh 按钮**: 手动刷新 transcript，使用 `@icon-park/react` 的 `Refresh` 图标
- **Auto-refresh**: 当子任务处于 `running` 状态时，每 5 秒自动刷新 transcript

#### 3.3.4 数据获取

##### 新增 Hook: `useTaskPanelTranscript`

- **文件**: `src/renderer/pages/conversation/dispatch/hooks/useTaskPanelTranscript.ts`
- 基于 `useChildTaskDetail` 扩展，增加：
  - 自动刷新逻辑（running 状态下 5 秒间隔）
  - 与 `responseStream` 的实时订阅集成，监听子任务的 `dispatch_event` 更新状态
  - transcript 增量加载（offset/limit 分页）

```typescript
type UseTaskPanelTranscriptResult = {
  transcript: TranscriptMessage[];
  status: ChildTaskInfoVO['status'];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};
```

#### 3.3.5 ChildTaskCard 改造

- 移除现有的内联展开区域（`expanded` 状态和 transcript 渲染代码）
- "View Details" 按钮改为触发 `onViewDetail(childTaskId)` 回调
- 保留卡片本身的状态显示、进度摘要、取消按钮

#### 3.3.6 GroupChatView 改造

- 新增 `selectedChildTaskId: string | null` 状态
- 当 `selectedChildTaskId` 不为 null 时，右侧显示 `TaskPanel`
- Timeline 区域宽度自适应（Panel 打开时缩窄）
- 使用 CSS transition 实现 Panel 滑入/滑出动画

#### 3.3.7 IPC 变更

无新增 IPC channel。复用现有 `dispatch.getChildTranscript` channel，但增加可选参数 `offset`:

```
dispatch.getChildTranscript.invoke({
  childSessionId: string;
  limit?: number;
  offset?: number;   // 新增：分页偏移
})
```

`dispatchBridge.ts` 中的 provider 需要将 `offset` 传递给 `conversationRepo.getMessages(childSessionId, offset, limit)`。

---

### F-4: Seed Messages

#### 3.4.1 概述

允许用户在创建群聊时配置系统提示词（seed messages），作为 dispatcher 系统提示的额外上下文注入。

#### 3.4.2 UI 规格

- **位置**: 在 `CreateGroupChatModal` 中，位于 Model Selector 下方、Workspace 选择器下方（Modal 底部区域）
- **标签**: `dispatch.create.seedLabel`（"System Prompt"）
- **组件**: Arco `Input.TextArea`，`autoSize={{ minRows: 2, maxRows: 6 }}`
- **Placeholder**: `dispatch.create.seedPlaceholder`（"Optional: customize the orchestrator's behavior..."）
- **展开/收起**: 默认收起状态，显示为可点击的 "Advanced Settings" 折叠区域
  - 使用 `@icon-park/react` 的 `SettingTwo` 图标 + `Down`/`Up` 箭头
  - 点击展开后显示 TextArea
- **字符限制**: 最大 2000 字符，显示字符计数器
- **可选性**: 此字段完全可选，留空则使用默认 dispatch prompt

#### 3.4.3 状态管理

```
新增 state:
  seedMessage: string        // 用户输入的系统提示词
  advancedExpanded: boolean  // 高级设置折叠状态
```

#### 3.4.4 数据传递

通过 `createGroupChat` IPC 参数传递：

```
seedMessages: seedMessage.trim() || undefined
```

#### 3.4.5 Main Process 处理

在 `dispatchBridge.ts`:

1. 将 `seedMessages` 存入 `conversation.extra.seedMessages`

在 `DispatchAgentManager` 构建时（`createBootstrap`）:

1. 从 `conversation.extra` 读取 `seedMessages`
2. 将其追加到 `buildDispatchSystemPrompt` 的输出末尾
3. 格式：在系统提示词最后追加 `\n\n## User Custom Instructions\n{seedMessages}`

#### 3.4.6 Prompt 组装优先级

最终系统提示词组装顺序：

```
1. buildDispatchSystemPrompt(dispatcherName)    — 核心 dispatch 指令
2. leaderPresetRules（F-1）                     — Leader agent 的人设规则
3. seedMessages（F-4）                          — 用户自定义提示词
```

如果 leaderPresetRules 和 seedMessages 都存在，则用明确的分隔线分隔：

```
{corePrompt}

## Leader Agent Profile
{leaderPresetRules}

## User Custom Instructions
{seedMessages}
```

---

## 4. Interaction Design

### 4.1 CreateGroupChatModal 完整流程

```
用户点击 "New Group Chat"
  ↓
Modal 打开
  ↓
┌─────────────────────────────────────┐
│ Create Group Chat                    │
│                                      │
│ Name                                 │
│ [___________________] (Input)        │
│                                      │
│ Leader Agent                         │
│ [Select an agent...       ▼]        │
│                                      │
│ Model                                │
│ [gemini-2.0-flash         ▼]        │
│                                      │
│ Workspace                            │
│ [/path/to/workspace  ] [Browse]      │
│                                      │
│ ▶ Advanced Settings                  │
│   (展开后)                            │
│   System Prompt                      │
│   [________________________]         │
│   [________________________]         │
│   [____________] 0/2000              │
│                                      │
│            [Cancel]  [Create]        │
└─────────────────────────────────────┘
```

### 4.2 Task Panel 交互流程

```
1. 用户在 Timeline 中看到 ChildTaskCard
2. 点击卡片的 "View Details" 按钮
3. 右侧滑入 TaskPanel（360px）
4. TaskPanel 显示子任务的完整 transcript
5. 如果子任务正在运行，transcript 每 5 秒自动刷新
6. 用户可以手动点击 Refresh 刷新
7. 用户可以在 TaskPanel 内取消正在运行的子任务
8. 点击 Close 或 ESC 关闭面板
9. 点击另一个 ChildTaskCard 的 "View Details" 切换面板内容
```

### 4.3 TaskPanel 与 Timeline 的联动

- 当 Timeline 中的 ChildTaskCard 状态更新时（通过 `responseStream`），TaskPanel 应同步更新 Header 中的状态 Tag
- 当子任务完成/失败/取消时，TaskPanel 中的 Cancel 按钮自动隐藏
- 点击 ChildTaskCard 时，如果 TaskPanel 已打开且显示的是同一个子任务，则关闭 Panel（toggle 行为）

---

## 5. Data Flow

### 5.1 F-1 + F-2: 创建流程数据流

```
Renderer                          Main Process
   │                                   │
   │  createGroupChat({                 │
   │    name, workspace,               │
   │    leaderAgentId,                 │
   │    modelOverride,                 │
   │    seedMessages                   │
   │  })                               │
   │ ──────────────────────────────► │
   │                                   │ 1. 解析 leaderAgentId
   │                                   │    → ProcessConfig.get('acp.customAgents')
   │                                   │    → 查找 assistant → 提取 presetRules/name/avatar
   │                                   │
   │                                   │ 2. 解析 modelOverride
   │                                   │    → ProcessConfig.get('model.config')
   │                                   │    → 查找 provider → 构建 TProviderWithModel
   │                                   │    (fallback: gemini.defaultModel)
   │                                   │
   │                                   │ 3. 创建 conversation
   │                                   │    → type='dispatch', model=resolved
   │                                   │    → extra: { workspace, leaderAgentId,
   │                                   │       leaderPresetRules, leaderName,
   │                                   │       leaderAvatar, seedMessages, ... }
   │                                   │
   │                                   │ 4. 启动 DispatchAgentManager
   │                                   │    → buildDispatchSystemPrompt(leaderName)
   │                                   │    → 追加 leaderPresetRules
   │                                   │    → 追加 seedMessages
   │                                   │
   │  ◄──────────────────────────────  │ { success: true, conversationId }
   │                                   │
   │  navigate(/conversation/{id})     │
```

### 5.2 F-3: Task Panel 数据流

```
Renderer                          Main Process
   │                                   │
   │  (用户点击 ChildTaskCard)          │
   │  → setSelectedChildTaskId(id)     │
   │  → TaskPanel 挂载                  │
   │                                   │
   │  getChildTranscript({             │
   │    childSessionId, limit, offset  │
   │  })                               │
   │ ──────────────────────────────► │
   │                                   │ → conversationRepo.getMessages(id, offset, limit)
   │  ◄──────────────────────────────  │ { messages, status }
   │                                   │
   │  (如果 status === 'running')       │
   │  → 每 5 秒自动调用                 │
   │    getChildTranscript             │
   │                                   │
   │  responseStream.on(event)         │
   │  → 如果 event.childTaskId         │
   │    匹配当前面板                    │
   │  → 更新 status Tag                 │
```

---

## 6. Acceptance Criteria

### AC-F1: Leader Agent Selector

- [ ] CreateGroupChatModal 中显示 Leader Agent 下拉选择器
- [ ] 下拉列表显示所有 `enabled !== false` 的自定义 assistant
- [ ] 每个选项显示 avatar + name
- [ ] 可以清空选择（恢复默认行为）
- [ ] 选中 assistant 后创建的群聊，dispatcher 使用该 assistant 的 presetRules + name
- [ ] 未选中时，行为与 Phase 2a 完全一致
- [ ] 无可用 assistant 时显示空状态提示

### AC-F2: Model Selector

- [ ] CreateGroupChatModal 中显示 Model 下拉选择器
- [ ] 下拉列表按 provider name 分组显示可用模型
- [ ] 默认选中 `gemini.defaultModel` 对应的模型
- [ ] 禁用的 provider 和模型不显示
- [ ] 模型健康状态以彩色圆点指示
- [ ] 选中模型后创建的群聊使用该模型
- [ ] 无可用模型时显示空状态 + 跳转设置页面链接

### AC-F3: Task Panel UI

- [ ] 点击 ChildTaskCard 的 "View Details" 按钮打开右侧 TaskPanel
- [ ] TaskPanel 显示完整的子任务 transcript
- [ ] Header 显示 agent 名称、任务标题、状态 Tag
- [ ] running 状态下每 5 秒自动刷新 transcript
- [ ] 支持手动 Refresh
- [ ] Panel 内可取消运行中的子任务
- [ ] Panel 打开/关闭有滑入/滑出动画
- [ ] ESC 键可关闭 Panel
- [ ] 再次点击同一卡片可 toggle 关闭
- [ ] ChildTaskCard 移除内联展开逻辑

### AC-F4: Seed Messages

- [ ] CreateGroupChatModal 中显示 "Advanced Settings" 折叠区域
- [ ] 展开后显示 System Prompt 文本域
- [ ] 文本域有 2000 字符限制和计数器
- [ ] 输入的 seed message 追加到 dispatcher 系统提示词末尾
- [ ] 留空时不影响默认行为
- [ ] seed message 持久化到 conversation.extra.seedMessages

### AC-通用

- [ ] 所有新增用户可见文本走 i18n，6 种语言全覆盖
- [ ] 所有 UI 组件使用 `@arco-design/web-react`
- [ ] 所有图标使用 `@icon-park/react`
- [ ] 无 hardcoded 字符串
- [ ] TypeScript strict mode 无报错
- [ ] 新增功能有对应的 Vitest 测试文件

---

## 7. Risks & Open Questions

### 风险

| #   | 风险                                                       | 影响                                        | 缓解方案                                                                                                                 |
| --- | ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| R-1 | Leader Agent 的 presetRules 与 dispatch system prompt 冲突 | Orchestrator 行为异常，不执行 dispatch 职责 | 在 prompt 组装中将核心 dispatch 指令置于最高优先级，明确告知 AI "以下是你的额外身份信息，但你的核心职责是 dispatch 协调" |
| R-2 | Model Selector 中选择了不支持 function calling 的模型      | MCP 工具调用失败，子任务无法创建            | 在 UI 层过滤掉不具备 `function_calling` capability 的模型，或在 provider 列表中标记兼容性                                |
| R-3 | TaskPanel 高频轮询对性能的影响                             | DB 查询频繁，UI 卡顿                        | 使用 5 秒间隔（非实时），且仅在 Panel 可见 + 子任务 running 时轮询；增加 debounce                                        |
| R-4 | seedMessages 注入导致 prompt 过长                          | Token 超限，API 报错                        | 限制 seedMessages 为 2000 字符；在 UI 层显示字符计数                                                                     |

### 待定问题

| #    | 问题                                                 | 决策建议                                                                                                                  |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Leader Agent 的 presetRules 是否应该传递给子 agent？ | Phase 2b 建议不传递，仅影响 orchestrator。Phase 3 可考虑继承选项。                                                        |
| OQ-2 | Model Selector 是否应该支持 Google Auth 模式？       | 建议支持：复用 `useGeminiGoogleAuthModels` hook，与 GuidModelSelector 一致。                                              |
| OQ-3 | TaskPanel 是否需要支持发送消息给子任务？             | Phase 2b 暂不支持，发送消息的入口由 orchestrator 通过 `send_message` MCP 工具控制。Phase 3 可考虑用户直接对子任务发消息。 |
| OQ-4 | seedMessages 是否支持创建后修改？                    | Phase 2b 仅支持创建时设置。Phase 3 可考虑在群聊设置中修改（需要重启 dispatcher agent）。                                  |
| OQ-5 | 是否需要 seed message 模板/预设？                    | Phase 2b 仅提供自由文本输入。Phase 3 可考虑预设模板（如 "Code Review 专家"、"架构设计师" 等）。                           |

---

## 8. Deferred Items (Phase 3)

| 功能                                 | 说明                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| Save teammate as reusable assistant  | 将 orchestrator 创建的临时 teammate 保存为持久化 assistant |
| Parent-child visualization tree      | 以树形图展示 dispatcher-child 关系                         |
| Single-chat upgrade to dispatch mode | 将普通对话升级为 dispatch 群聊                             |
| Child agent 独立模型选择             | 子 agent 使用不同于 dispatcher 的模型                      |
| TaskPanel 内发消息给子任务           | 用户在 TaskPanel 中直接向子 agent 发送消息                 |
| seedMessages 创建后修改              | 在群聊设置面板中修改系统提示词                             |
| seed message 预设模板                | 提供常用的系统提示词模板                                   |
| Transcript 实时流式更新              | 通过 `responseStream` 实时推送子任务 transcript，替代轮询  |

---

## Appendix A: i18n Key 清单

以下是 Phase 2b 需要新增的 i18n key（命名空间: `dispatch`）:

```
dispatch.create.leaderLabel           → "Leader Agent"
dispatch.create.leaderPlaceholder     → "Default (no specific agent)"
dispatch.create.leaderEmpty           → "No assistants configured"
dispatch.create.leaderEmptyAction     → "Go to Settings"
dispatch.create.modelLabel            → "Model"
dispatch.create.modelPlaceholder      → "Use default model"
dispatch.create.modelEmpty            → "No models available"
dispatch.create.modelEmptyAction      → "Configure Models"
dispatch.create.seedLabel             → "System Prompt"
dispatch.create.seedPlaceholder       → "Optional: customize the orchestrator's behavior, task strategy, or domain focus..."
dispatch.create.advancedSettings      → "Advanced Settings"
dispatch.create.seedCharCount         → "{count}/2000"
dispatch.taskPanel.title              → "Task Details"
dispatch.taskPanel.noTranscript       → "No conversation record yet"
dispatch.taskPanel.refresh            → "Refresh"
dispatch.taskPanel.autoRefresh        → "Auto-refreshing every 5s"
dispatch.taskPanel.createdAt          → "Created {time}"
dispatch.taskPanel.close              → "Close"
```

## Appendix B: 文件变更清单

### 新建文件

| 文件                                                                       | 说明                         |
| -------------------------------------------------------------------------- | ---------------------------- |
| `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`                   | 子任务详情侧面板组件         |
| `src/renderer/pages/conversation/dispatch/TaskPanel.module.css`            | TaskPanel 样式（滑入动画等） |
| `src/renderer/pages/conversation/dispatch/hooks/useTaskPanelTranscript.ts` | TaskPanel 数据获取 hook      |

### 修改文件

| 文件                                                                   | 变更内容                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/renderer/pages/conversation/dispatch/CreateGroupChatModal.tsx`    | 新增 Leader Agent Select、Model Select、Seed Messages TextArea、Advanced Settings 折叠                         |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`           | 新增 `selectedChildTaskId` 状态、TaskPanel 集成、flex 布局调整                                                 |
| `src/renderer/pages/conversation/dispatch/ChildTaskCard.tsx`           | 移除内联展开，"View Details" 触发 `onViewDetail` 回调                                                          |
| `src/renderer/pages/conversation/dispatch/types.ts`                    | 新增 `TaskPanelProps`、更新 `GroupChatCreationModalProps`、更新 `ChildTaskCardProps` 增加 `onViewDetail`       |
| `src/renderer/pages/conversation/dispatch/hooks/useChildTaskDetail.ts` | 扩展为支持自动刷新和状态同步（或由新 hook 替代）                                                               |
| `src/process/bridge/dispatchBridge.ts`                                 | `createGroupChat` 支持 `leaderAgentId`/`modelOverride`/`seedMessages` 参数；`getChildTranscript` 支持 `offset` |
| `src/process/task/dispatch/DispatchAgentManager.ts`                    | `createBootstrap` 中组装 leaderPresetRules + seedMessages                                                      |
| `src/process/task/dispatch/dispatchPrompt.ts`                          | `buildDispatchSystemPrompt` 支持可选的 `leaderProfile` 和 `customInstructions` 参数                            |
| `src/process/task/dispatch/dispatchTypes.ts`                           | 无需修改（已有必要类型）                                                                                       |
| i18n locale 文件 (6 languages)                                         | 新增上述 i18n key                                                                                              |
