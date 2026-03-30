# Phase 2b — 技术设计文档

## 1. PRD 评审（self-debate）

### 反对意见

**反对 1: F-1 Leader Agent Selector 数据来源不正确**

PRD 指定从 `ConfigStorage.get('acp.customAgents')` 获取 assistant 列表。但 `acp.customAgents` 中的 `AcpBackendConfig` 是 ACP 后端配置（包含 Claude、Codex 等后端 agent），它们本身绑定了特定的 ACP backend（claude、openai-compatible 等）。将一个 ACP agent（例如 Claude Code agent）设置为 dispatch orchestrator 的 "leader" 在语义上有歧义——dispatch 系统的 orchestrator 使用的是 Gemini worker（`workerType='gemini'`），leader agent 的 `presetRules` 会被注入为系统提示词，但 agent 的 `backend` 信息（例如 claude）会被完全忽略。用户可能误以为选择了一个 Claude agent 后 orchestrator 就会使用 Claude 模型。

**反对 2: F-2 Model Selector 未处理 function_calling 兼容性**

PRD 的 R-2 风险中提到了"过滤掉不具备 function_calling capability 的模型"，但 AC 列表中没有明确要求这个过滤。当前 `IProvider.capabilities` 是可选字段，很多用户配置的 provider 根本没有填写 capabilities。如果按 capabilities 过滤，可能导致大部分模型被隐藏。如果不过滤，用户选择了不支持 tool use 的模型后 dispatch 会失败且没有友好提示。

**反对 3: F-3 TaskPanel 5 秒轮询策略过于粗糙**

PRD 要求 TaskPanel 在子任务 running 时每 5 秒轮询 `getChildTranscript`。但现有的 `useGroupChatMessages` 已经通过 `responseStream` 订阅获取实时 dispatch_event（task_progress、task_completed 等）。TaskPanel 的 transcript 来自子任务的数据库消息，这些消息不会通过 responseStream 推送。5 秒轮询意味着用户看到的 transcript 总是落后于实际执行。同时，如果多个 TaskPanel 同时打开（虽然 PRD 只允许一个），轮询逻辑需要在面板切换时正确清理。

### 回应与决策

**回应 1 (Leader Agent):**

支持者观点正确——leader agent 仅注入 `presetRules`（系统提示词/人设），不改变底层模型。这是合理的设计，因为用户的核心需求是让 orchestrator 具有某种"专家人设"来指导任务分解策略。

**决策**: 在 UI 上明确标注这是"人设/Persona"选择，不是模型选择。使用 `presetRules` 注入时在 prompt 中明确标注这是额外人设信息。过滤条件改为：显示所有 `enabled !== false` 的 customAgents，不限制 backend 类型，因为我们只使用其 `presetRules` 和展示信息（name/avatar）。在 Renderer 层直接从 `ConfigStorage.get('acp.customAgents')` 读取即可。

**回应 2 (Model + function_calling):**

当前 dispatch 系统依赖 MCP tools（start_task、read_transcript 等），这些通过 Gemini CLI 的 function calling 实现。如果模型不支持 function calling，整个 dispatch 会静默失败。

**决策**: 不在 UI 层过滤 capabilities（因为数据不可靠），而是在两处做防护：(1) UI 层在模型选项旁加 tooltip 提示"dispatch 需要 function calling 支持"；(2) Main process 在 `createBootstrap` 时如果首次 tool call 失败，通过 dispatch_event 向 UI 发送明确的错误提示。这是更务实的方案。

**回应 3 (TaskPanel 轮询):**

5 秒轮询确实粗糙，但 Phase 2b 的目标是提供可用的 transcript 查看器，不是实时流。更高级的 responseStream 集成属于 Phase 3 的 "Transcript 实时流式更新" 范畴。

**决策**: 保持 5 秒轮询，但增加以下优化：(1) 仅在 TaskPanel 可见（组件 mounted）且子任务 running 时轮询；(2) 面板关闭或子任务完成时立即清除 interval；(3) 当 `responseStream` 收到该子任务的 `task_completed`/`task_failed`/`task_cancelled` 事件时，触发一次最终刷新并停止轮询。这样既简单又不会遗漏最终状态。

### 最终调整

1. F-1: Leader Agent 选择不限制 backend 类型，仅取 `presetRules`/`name`/`avatar`
2. F-2: 不按 capabilities 过滤模型，改为 UI 提示 + 运行时错误反馈
3. F-3: 5 秒轮询 + responseStream 事件触发最终刷新的混合策略
4. F-4: 保持 PRD 设计不变

---

## 2. 架构决策

### AD-1: Leader Agent 数据获取方式

**决策**: Renderer 层使用 `ConfigStorage.get('acp.customAgents')` 获取 agent 列表，不新增 IPC channel。

**理由**: `acp.customAgents` 已有成熟的读取模式（见 `useCustomAgentsLoader.ts`）。Renderer 层直接读取 ConfigStorage 是项目既有模式。不需要经过 IPC bridge 再从 ProcessConfig 读取，因为这只是展示层数据。Main process 在 `createGroupChat` provider 中用 `ProcessConfig.get('acp.customAgents')` 查找（避免死锁）。

### AD-2: Model Selector 使用 `useSWR` + `ipcBridge.mode.getModelConfig`

**决策**: 复用 `GuidModelSelector` 的数据获取模式——`useSWR('model.config', () => ipcBridge.mode.getModelConfig.invoke())`。

**理由**: 这是项目中获取 model config 的标准方式（见 `GuidModelSelector.tsx` L49）。不需要额外的 hook，直接在 `CreateGroupChatModal` 中使用 useSWR。

### AD-3: TaskPanel 作为 GroupChatView 的内部组件

**决策**: TaskPanel 是 `GroupChatView` 的子组件，通过 `selectedChildTaskId` 状态控制显示。不使用路由或全局状态。

**理由**: TaskPanel 是 GroupChatView 的上下文功能，不需要独立路由。使用组件内部状态管理更简单，且避免了全局状态管理的复杂性。

### AD-4: `buildDispatchSystemPrompt` 签名扩展

**决策**: 扩展 `buildDispatchSystemPrompt` 的参数，新增可选的 `leaderProfile` 和 `customInstructions`。

**理由**: 将 prompt 组装逻辑集中在 `dispatchPrompt.ts` 中，而不是散落在 `DispatchAgentManager` 的 `createBootstrap` 中。这样 prompt 的优先级和格式在一处定义，便于维护。

### AD-5: IPC 参数扩展而非新增 channel

**决策**: 扩展 `createGroupChat` 的现有 IPC channel 参数，新增 `leaderAgentId`、`modelOverride`、`seedMessages` 三个可选字段。不新建 IPC channel。

**理由**: 这些参数都是创建流程的一部分，语义上属于同一个操作。新增 channel 会增加不必要的复杂度。

### AD-6: conversation.extra 存储 leader 信息的快照策略

**决策**: 创建时将 leader agent 的 `presetRules`、`name`、`avatar` 快照存入 `conversation.extra`，而非仅存 `leaderAgentId`。

**理由**: 如果仅存 ID，当用户后续修改或删除该 assistant 时，已创建的 dispatch conversation 会丢失 leader 信息。快照策略确保 conversation 自包含。`leaderAgentId` 也同时存储，用于 UI 回显"选择了哪个 agent"。

### AD-7: Select 组件而非 Dropdown/Menu

**决策**: F-1 和 F-2 的选择器使用 Arco `Select` 组件（带 `Select.OptGroup`），而非 `Dropdown` + `Menu`。

**理由**: `CreateGroupChatModal` 是表单场景，`Select` 是标准表单控件，支持 `allowClear`、`placeholder`、受控 value 等表单特性。`Dropdown` + `Menu` 更适合工具栏场景（如 GuidModelSelector 那样的按钮触发），不适合 Modal 内的表单。

---

## 3. 文件变更清单

### 新建文件

| 路径                                                                       | 类型 | 说明                                          |
| -------------------------------------------------------------------------- | ---- | --------------------------------------------- |
| `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`                   | NEW  | 子任务详情侧面板组件                          |
| `src/renderer/pages/conversation/dispatch/TaskPanel.module.css`            | NEW  | TaskPanel 样式（滑入/滑出动画，布局）         |
| `src/renderer/pages/conversation/dispatch/hooks/useTaskPanelTranscript.ts` | NEW  | TaskPanel 数据获取 hook（轮询 + stream 联动） |

### 修改文件

| 路径                                                                   | 类型   | 说明                                                                                                            |
| ---------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `src/renderer/pages/conversation/dispatch/CreateGroupChatModal.tsx`    | MODIFY | 新增 Leader Agent Select、Model Select、Seed Messages（Advanced Settings 折叠）                                 |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`           | MODIFY | 新增 `selectedChildTaskId` 状态、TaskPanel 集成、flex 布局适配                                                  |
| `src/renderer/pages/conversation/dispatch/ChildTaskCard.tsx`           | MODIFY | 移除内联展开逻辑，"View Details" 改为触发 `onViewDetail` 回调                                                   |
| `src/renderer/pages/conversation/dispatch/types.ts`                    | MODIFY | 新增/更新类型定义（TaskPanelProps, CreateGroupChat 参数等）                                                     |
| `src/renderer/pages/conversation/dispatch/hooks/useChildTaskDetail.ts` | MODIFY | 微调：保留基础逻辑供 useTaskPanelTranscript 复用                                                                |
| `src/process/bridge/dispatchBridge.ts`                                 | MODIFY | `createGroupChat` 支持新参数；`getChildTranscript` 支持 offset                                                  |
| `src/process/task/dispatch/DispatchAgentManager.ts`                    | MODIFY | `createBootstrap` 从 extra 读取 leaderPresetRules + seedMessages 传给 prompt builder                            |
| `src/process/task/dispatch/dispatchPrompt.ts`                          | MODIFY | `buildDispatchSystemPrompt` 扩展参数签名                                                                        |
| `src/common/config/storage.ts`                                         | MODIFY | dispatch extra 类型新增 `leaderAgentId`、`leaderPresetRules`、`leaderName`、`leaderAvatar`、`seedMessages` 字段 |
| i18n locale 文件 (6 languages)                                         | MODIFY | 新增 dispatch.create._ 和 dispatch.taskPanel._ 相关 key                                                         |

### 目录子项数量验证

- `src/renderer/pages/conversation/dispatch/`: 当前 7 项，新增 2 项（TaskPanel.tsx + TaskPanel.module.css）= 9 项 (< 10)
- `src/renderer/pages/conversation/dispatch/hooks/`: 当前 3 项，新增 1 项 = 4 项 (< 10)

---

## 4. 接口设计

### 4.1 IPC 参数变更

#### `dispatch.createGroupChat` 请求参数扩展

```typescript
// 现有参数
type CreateGroupChatParams = {
  name?: string;
  workspace?: string;
  // --- 新增 (Phase 2b) ---
  /** 选中的 leader agent ID（来自 acp.customAgents） */
  leaderAgentId?: string;
  /** 模型覆盖，优先于 gemini.defaultModel */
  modelOverride?: {
    providerId: string;
    useModel: string;
  };
  /** 用户自定义系统提示词 */
  seedMessages?: string;
};
```

#### `dispatch.getChildTranscript` 请求参数扩展

```typescript
type GetChildTranscriptParams = {
  childSessionId: string;
  limit?: number;
  // --- 新增 (Phase 2b) ---
  offset?: number;
};
```

### 4.2 新增/更新 Renderer 类型

```typescript
// types.ts 新增

/** Props for the TaskPanel component */
export type TaskPanelProps = {
  /** 当前选中的子任务 ID */
  childTaskId: string;
  /** 子任务基本信息（来自 GroupChatInfoVO.children） */
  childInfo: ChildTaskInfoVO;
  /** 父会话 ID（用于取消操作） */
  conversationId: string;
  /** 关闭面板回调 */
  onClose: () => void;
  /** 取消子任务回调 */
  onCancel: (childTaskId: string) => void;
};

/** TaskPanel transcript 消息 */
export type TranscriptMessage = {
  role: string;
  content: string;
  timestamp: number;
};

/** useTaskPanelTranscript hook 返回值 */
export type UseTaskPanelTranscriptResult = {
  transcript: TranscriptMessage[];
  status: ChildTaskInfoVO['status'];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};
```

```typescript
// types.ts 更新

/** ChildTaskCardProps 新增 onViewDetail */
export type ChildTaskCardProps = {
  message: GroupChatTimelineMessage;
  onCancel?: (childTaskId: string) => void;
  conversationId?: string;
  // --- 新增 ---
  /** 点击 "View Details" 时触发，打开 TaskPanel */
  onViewDetail?: (childTaskId: string) => void;
  /** 当前是否被选中（高亮显示） */
  isSelected?: boolean;
};

/** GroupChatTimelineProps 新增 onViewDetail */
export type GroupChatTimelineProps = {
  messages: GroupChatTimelineMessage[];
  isLoading: boolean;
  dispatcherName: string;
  dispatcherAvatar?: string;
  onCancelChild?: (childTaskId: string) => void;
  conversationId?: string;
  // --- 新增 ---
  onViewDetail?: (childTaskId: string) => void;
  selectedChildTaskId?: string | null;
};
```

### 4.3 conversation.extra 类型扩展

```typescript
// storage.ts 中 dispatch extra 新增字段
{
  // ... 现有字段 ...
  /** Leader agent ID（快照源标识） */
  leaderAgentId?: string;
  /** Leader agent 系统规则快照 */
  leaderPresetRules?: string;
  /** Leader agent 名称快照 */
  leaderName?: string;
  /** Leader agent 头像快照 */
  leaderAvatar?: string;
  /** 用户自定义系统提示词 */
  seedMessages?: string;
}
```

### 4.4 dispatchPrompt.ts 签名变更

```typescript
/** 扩展后的签名 */
export function buildDispatchSystemPrompt(
  dispatcherName: string,
  options?: {
    leaderProfile?: string;
    customInstructions?: string;
  }
): string;
```

---

## 5. 组件设计

### 5.1 CreateGroupChatModal（MODIFY）

**职责**: 群聊创建表单，包含名称、Leader Agent 选择、Model 选择、Workspace、高级设置（Seed Messages）。

**新增状态**:

```typescript
const [leaderAgentId, setLeaderAgentId] = useState<string | undefined>();
const [selectedModel, setSelectedModel] = useState<{ providerId: string; useModel: string } | undefined>();
const [seedMessage, setSeedMessage] = useState('');
const [advancedExpanded, setAdvancedExpanded] = useState(false);
```

**数据获取**:

```typescript
// Leader Agent 列表
const [customAgents, setCustomAgents] = useState<AcpBackendConfig[]>([]);
useEffect(() => {
  ConfigStorage.get('acp.customAgents').then((agents) => {
    setCustomAgents((agents || []).filter((a) => a.enabled !== false));
  });
}, []);

// Model 列表
const { data: modelConfig } = useSWR<IProvider[]>('model.config', () => ipcBridge.mode.getModelConfig.invoke());
const enabledProviders = useMemo(() => (modelConfig || []).filter((p) => p.enabled !== false), [modelConfig]);
```

**关键实现逻辑**:

- Leader Agent: `Select` with `allowClear`，选项渲染显示 avatar(emoji) + name
- Model: `Select` with `Select.OptGroup` 按 provider.name 分组，每个 Option 显示 model name + health dot
- Seed Messages: 在 "Advanced Settings" 折叠区内，`Input.TextArea` with maxLength=2000 + 字符计数
- 提交时将新增参数传入 `ipcBridge.dispatch.createGroupChat.invoke()`
- 重置时清空所有新增状态

**布局顺序**: Name -> Leader Agent -> Model -> Workspace -> Advanced Settings (Seed Messages) -> 按钮

### 5.2 TaskPanel（NEW）

**文件**: `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`

**职责**: 子任务详情侧面板，显示完整 transcript、状态、操作按钮。

**Props**: `TaskPanelProps`（见 4.2 节）

**关键实现逻辑**:

- Header: agent avatar + name + title + status Tag（复用 `getTagColor`）+ 创建时间
- Transcript 区: 滚动容器（flex-1 overflow-y-auto），消息列表 `[role] content`
- assistant 消息使用 Markdown 渲染（如项目中有 MarkdownRenderer 则复用，否则 whitespace-pre-wrap）
- 自动滚动到底部：当 transcript 变化时 scrollIntoView
- Actions: Cancel 按钮（running/pending 时显示）+ Refresh 按钮
- ESC 键关闭：useEffect 监听 keydown
- 入口动画：CSS transform translateX(100%) -> translateX(0)

**样式**: CSS Module `TaskPanel.module.css`

```css
.panel {
  width: 360px;
  transition: transform 0.25s ease;
}
.panelEnter {
  transform: translateX(0);
}
.panelExit {
  transform: translateX(100%);
}
```

### 5.3 useTaskPanelTranscript（NEW）

**文件**: `src/renderer/pages/conversation/dispatch/hooks/useTaskPanelTranscript.ts`

**职责**: 为 TaskPanel 提供 transcript 数据，带自动刷新逻辑。

**参数**: `(childSessionId: string, isRunning: boolean)`

**返回**: `UseTaskPanelTranscriptResult`

**关键实现逻辑**:

```typescript
// 1. 初始加载
useEffect(() => {
  fetchTranscript();
}, [childSessionId]);

// 2. 5 秒轮询（仅 running 状态）
useEffect(() => {
  if (!isRunning) return;
  const interval = setInterval(fetchTranscript, 5000);
  return () => clearInterval(interval);
}, [childSessionId, isRunning]);

// 3. responseStream 事件触发最终刷新
useEffect(() => {
  const unsub = ipcBridge.conversation.responseStream.on((msg) => {
    if (msg.type !== 'dispatch_event') return;
    const data = msg.data as GroupChatMessageData;
    if (data.childTaskId !== childSessionId) return;
    if (['task_completed', 'task_failed', 'task_cancelled'].includes(data.messageType)) {
      // 延迟 500ms 确保 DB 写入完成后再拉取
      setTimeout(fetchTranscript, 500);
    }
  });
  return unsub;
}, [childSessionId]);
```

### 5.4 ChildTaskCard（MODIFY）

**变更**:

1. 移除 `expanded` 状态和内联 transcript 渲染（L100-L193 的展开区域）
2. 移除 `useChildTaskDetail` hook 的使用
3. "View Details" 按钮改为调用 `props.onViewDetail?.(message.childTaskId!)`
4. 新增 `isSelected` prop，选中时添加高亮样式（border-color 变化）
5. 保留卡片头部（avatar + name + content + status tag）和 cancel 按钮

### 5.5 GroupChatView（MODIFY）

**新增状态**:

```typescript
const [selectedChildTaskId, setSelectedChildTaskId] = useState<string | null>(null);
```

**新增逻辑**:

- `handleViewDetail`: toggle 逻辑（点击同一个关闭，不同则切换）
- `selectedChildInfo`: 从 `info.children` 中查找选中子任务的信息
- 布局变为 flex-row：左侧 Timeline 区域（flex-1）+ 右侧 TaskPanel（条件渲染，固定宽度 360px）
- `GroupChatTimeline` 传入 `onViewDetail` 和 `selectedChildTaskId`
- TaskPanel 的 `onClose` 设置 `selectedChildTaskId` 为 null

---

## 6. 数据流

### F-1: Leader Agent Selector 数据流

```
用户在 CreateGroupChatModal 选择 Leader Agent
  ↓
Renderer: ConfigStorage.get('acp.customAgents') → 获取列表 → 用户选择 → leaderAgentId
  ↓
Renderer: ipcBridge.dispatch.createGroupChat.invoke({ ..., leaderAgentId })
  ↓
Main (dispatchBridge.ts):
  1. ProcessConfig.get('acp.customAgents') → 查找 agent by ID
  2. 提取 presetRules, name, avatar
  3. 存入 conversation.extra: { leaderAgentId, leaderPresetRules, leaderName, leaderAvatar }
  4. 使用 leaderName 作为 dispatcherName
  ↓
Main (DispatchAgentManager.createBootstrap):
  1. 从 conversation.extra 读取 leaderPresetRules
  2. buildDispatchSystemPrompt(leaderName, { leaderProfile: leaderPresetRules })
  3. 组合后的 prompt 作为 presetRules 传给 worker
  ↓
Worker: Gemini CLI 使用含 leader profile 的 system prompt
```

### F-2: Model Selector 数据流

```
用户在 CreateGroupChatModal 选择 Model
  ↓
Renderer: useSWR('model.config') → 获取 IProvider[] → 用户选择 → selectedModel
  ↓
Renderer: ipcBridge.dispatch.createGroupChat.invoke({
  ..., modelOverride: { providerId, useModel }
})
  ↓
Main (dispatchBridge.ts):
  1. 如果 modelOverride 存在:
     - ProcessConfig.get('model.config') → 查找 provider by providerId
     - 构建 TProviderWithModel: { ...provider, useModel: modelOverride.useModel }
  2. 如果不存在: 保持现有逻辑（gemini.defaultModel → 查找 provider）
  3. 最终 model 存入 conversation.model
  ↓
Main (DispatchAgentManager): 使用 conversation.model 初始化 worker
  ↓
Worker: 使用用户指定的模型
```

### F-3: Task Panel 数据流

```
用户点击 ChildTaskCard 的 "View Details"
  ↓
GroupChatView: setSelectedChildTaskId(childTaskId)
  → 从 info.children 查找 childInfo
  → 渲染 TaskPanel
  ↓
TaskPanel 挂载 → useTaskPanelTranscript(childSessionId, isRunning)
  ↓
Hook 初始加载:
  ipcBridge.dispatch.getChildTranscript.invoke({ childSessionId, limit: 50, offset: 0 })
  ↓
Main (dispatchBridge.ts):
  conversationRepo.getMessages(childSessionId, offset, limit) → 返回消息列表
  ↓
Hook 轮询 (isRunning === true):
  每 5 秒: getChildTranscript → 更新 transcript 状态
  ↓
Hook stream 监听:
  responseStream.on → 匹配 childTaskId → task_completed/failed/cancelled → 最终刷新
  ↓
TaskPanel: 渲染 transcript 列表，自动滚动到底部
  ↓
用户点击 Close / ESC / 再次点击同一卡片
  → setSelectedChildTaskId(null) → TaskPanel 卸载 → 轮询自动清理
```

### F-4: Seed Messages 数据流

```
用户在 CreateGroupChatModal 展开 Advanced Settings → 输入 System Prompt
  ↓
Renderer: seedMessage state (max 2000 chars)
  ↓
Renderer: ipcBridge.dispatch.createGroupChat.invoke({
  ..., seedMessages: seedMessage.trim() || undefined
})
  ↓
Main (dispatchBridge.ts):
  存入 conversation.extra.seedMessages
  ↓
Main (DispatchAgentManager.createBootstrap):
  1. 从 conversation.extra 读取 seedMessages
  2. buildDispatchSystemPrompt(name, {
       leaderProfile: extra.leaderPresetRules,
       customInstructions: extra.seedMessages
     })
  ↓
Prompt 组装结果:
  {核心 dispatch 指令}

  ## Leader Agent Profile
  {leaderPresetRules}  (如果存在)

  ## User Custom Instructions
  {seedMessages}  (如果存在)
  ↓
Worker: Gemini CLI 使用含自定义指令的 system prompt
```

---

## 7. 实现顺序

### Step 1: 类型定义与接口 (预估: S)

**涉及文件**:

- `src/common/config/storage.ts` (MODIFY) — dispatch extra 新增 5 个字段
- `src/renderer/pages/conversation/dispatch/types.ts` (MODIFY) — 新增 TaskPanelProps, TranscriptMessage, 更新 ChildTaskCardProps/GroupChatTimelineProps

**改动量**: ~40 行新增

### Step 2: 后端 — Prompt 扩展 (预估: S)

**涉及文件**:

- `src/process/task/dispatch/dispatchPrompt.ts` (MODIFY) — 扩展 `buildDispatchSystemPrompt` 签名和实现

**改动量**: ~20 行修改

### Step 3: 后端 — IPC Bridge 扩展 (预估: M)

**涉及文件**:

- `src/process/bridge/dispatchBridge.ts` (MODIFY) — createGroupChat 支持新参数；getChildTranscript 支持 offset

**改动量**: ~60 行修改

**依赖**: Step 1（类型），Step 2（prompt 函数）

### Step 4: 后端 — DispatchAgentManager 集成 (预估: S)

**涉及文件**:

- `src/process/task/dispatch/DispatchAgentManager.ts` (MODIFY) — createBootstrap 读取 extra 并传给 buildDispatchSystemPrompt

**改动量**: ~15 行修改

**依赖**: Step 2（prompt 函数签名）

### Step 5: 前端 — CreateGroupChatModal 增强 (预估: L)

**涉及文件**:

- `src/renderer/pages/conversation/dispatch/CreateGroupChatModal.tsx` (MODIFY) — 新增 3 个选择器/输入区

**改动量**: ~150 行新增

**依赖**: Step 1（类型），Step 3（IPC 参数）

### Step 6: 前端 — ChildTaskCard 改造 (预估: S)

**涉及文件**:

- `src/renderer/pages/conversation/dispatch/ChildTaskCard.tsx` (MODIFY) — 移除内联展开，新增 onViewDetail

**改动量**: ~30 行删除 + ~10 行修改

### Step 7: 前端 — TaskPanel + Hook (预估: L)

**涉及文件**:

- `src/renderer/pages/conversation/dispatch/TaskPanel.tsx` (NEW) — ~200 行
- `src/renderer/pages/conversation/dispatch/TaskPanel.module.css` (NEW) — ~40 行
- `src/renderer/pages/conversation/dispatch/hooks/useTaskPanelTranscript.ts` (NEW) — ~80 行

**依赖**: Step 1（类型），Step 6（ChildTaskCard 提供 onViewDetail）

### Step 8: 前端 — GroupChatView 集成 (预估: M)

**涉及文件**:

- `src/renderer/pages/conversation/dispatch/GroupChatView.tsx` (MODIFY) — 集成 TaskPanel

**改动量**: ~40 行修改

**依赖**: Step 7（TaskPanel 组件）

### Step 9: i18n (预估: M)

**涉及文件**:

- 6 个语言的 locale JSON 文件

**改动量**: 每个语言 ~20 个 key

**依赖**: 可在 Step 5-8 同步进行

### 建议并行策略

```
Step 1 (类型) + Step 2 (prompt)
       ↓
Step 3 (bridge) + Step 4 (agent manager)
       ↓
Step 5 (Modal) || Step 6 (Card) + Step 7 (Panel)
       ↓
Step 8 (GroupChatView 集成)
       ↓
Step 9 (i18n — 可全程并行)
```

---

## 8. 风险点

| #   | 风险                                                       | 影响                                                                                    | 缓解方案                                                                                                                                |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | Leader presetRules 与 dispatch 核心 prompt 冲突            | Orchestrator 不执行 dispatch 职责，例如 leader 规则说"你是一个代码审查员，直接给出建议" | prompt 组装时核心 dispatch 指令在最前面且不可覆盖；leaderProfile 段落显式标注"以下是你的额外身份信息，不改变你的核心 dispatch 职责"     |
| R-2 | 用户选择不支持 function calling 的模型                     | MCP tool 调用失败，子任务无法创建                                                       | UI 层在 Model selector 旁加提示"dispatch 依赖 tool calling"；运行时首次 tool call 失败时通过 dispatch_event 发送明确错误消息到 timeline |
| R-3 | TaskPanel 轮询与组件生命周期不同步                         | 内存泄漏或对已卸载组件 setState                                                         | useEffect cleanup 严格清除 interval；使用 `isMounted` ref guard                                                                         |
| R-4 | seedMessages 过长导致 token 超限                           | API 报错                                                                                | UI 层硬限制 2000 字符；dispatch prompt 整体估算约 1500 tokens，加上 seedMessages 约 2500，留足 context 空间                             |
| R-5 | `ProcessConfig.get('acp.customAgents')` 可能返回 undefined | createGroupChat 中 leaderAgentId 查找失败                                               | 查找失败时 graceful fallback：忽略 leader 选择，使用默认 dispatch prompt，不阻断创建流程                                                |
| R-6 | dispatch 目录将有 9 个子项（接近 10 限制）                 | 后续 Phase 3 新增文件可能超限                                                           | Phase 3 时考虑将 TaskPanel 及相关组件提取到 `dispatch/panel/` 子目录                                                                    |
