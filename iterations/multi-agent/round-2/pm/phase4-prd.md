# Phase 4: Interactive Child Agents + Dispatch Enhancements

## 1. 目标

Phase 4 在 Phase 2a/2b/3 完成的 dispatch 多 agent 协作基础上，解决两个核心体验痛点：

1. **用户无法与子 agent 直接交互**：当前用户只能通过 dispatcher 间接控制子任务，无法向特定子 agent 发送追加指令或修正方向。Phase 4 在 TaskPanel 中增加用户向子 agent 发消息的能力，形成「用户 -> 子 agent」直通通道。

2. **子 agent 模型受限**：当前所有子 agent 继承 dispatcher 的模型配置，无法针对不同任务特性选择最优模型（如推理任务用更强模型，简单翻译用更快模型）。Phase 4 支持 orchestrator 创建子任务时指定独立模型。

3. **运行时可调参数缺失**：Seed messages 和 leader agent 在创建群聊后不可变更。Phase 4 增加群聊设置面板，支持编辑部分运行时参数。

### 为什么不做 Single-chat Upgrade

Single-chat upgrade to dispatch 在 Phase 3 中被评估为高风险，经过 Phase 4 评估风险未降低，原因：

- **Conversation type 迁移**：从 `gemini`/`acp`/`codex` 等类型切换到 `dispatch` 需要修改 `TChatConversation` 的 extra schema，存在数据兼容问题
- **Agent 热切换**：正在运行的 agent 需要从单 agent 模式切换到 orchestrator 模式，涉及 worker 进程的销毁重建和 MCP server 重启
- **消息格式不兼容**：单聊消息（`position: left/right`）与 dispatch 消息（`GroupChatTimelineMessage`）使用完全不同的数据结构
- **路由切换**：`ChatConversation` 通过 `conversation.type === 'dispatch'` 分支到 `GroupChatView`，运行时切换会导致整个 UI 树重建和状态丢失
- **回退困难**：一旦 upgrade，无法安全回退为单聊

建议在独立的 Phase 5 中专门处理，采用「新建 dispatch 会话 + 导入上下文」的安全路径代替原地 upgrade。

### 成功指标

- 用户可以在 TaskPanel 中向子 agent 发送追加消息，子 agent 正确响应
- Orchestrator 可以为不同子任务分配不同模型
- 用户可以在群聊创建后修改 seed messages 和切换 leader agent

## 2. 范围

### In Scope

| 编号  | 功能                              | 类型 |
| ----- | --------------------------------- | ---- |
| F-4.1 | TaskPanel User-to-Child Messaging | 新增 |
| F-4.2 | Child Agent Model Selection       | 新增 |
| F-4.3 | Group Chat Settings Panel         | 新增 |

### Out of Scope

- Single-chat upgrade to dispatch mode -- 架构风险仍然过高，延后至 Phase 5 以独立方案处理
- 完整的多层级子任务嵌套（子任务再创建子任务）-- 需要递归 dispatch 架构，复杂度极高
- 子 agent 的 MCP tool 独立配置 -- 需要 per-agent MCP server 管理，延后
- 子任务之间的直接通信（跨子 agent 消息传递）-- 需要 message bus 架构
- 实时协同编辑（多个子 agent 同时写同一文件）-- 需要冲突解决机制

---

## 3. 用户故事

### US-4.1: 向子 Agent 发消息

> 作为用户，当我在 TaskPanel 中查看子 agent 的对话记录时，我希望能直接向该子 agent 发送追加指令（如"请重点关注性能问题"或"请换一种实现方式"），子 agent 应当在其现有上下文中响应我的消息，而不需要我通过 dispatcher 转达。

### US-4.2: 为子任务指定模型

> 作为用户（高级场景），当 orchestrator 创建子任务时，我希望它能根据任务特性为不同子 agent 选择不同的模型。例如，代码审查任务用 `gemini-2.5-pro`，文档翻译任务用 `gemini-2.0-flash`，以优化成本和速度。

### US-4.3: 编辑群聊设置

> 作为用户，在群聊创建后，我希望能修改 seed messages（追加新的系统指令）和切换 leader agent，以便在不重建群聊的情况下调整 orchestrator 的行为。

---

## 4. 功能需求

### F-4.1: TaskPanel User-to-Child Messaging

#### 4.1.1 概述

在 TaskPanel 底部新增 SendBox，允许用户直接向子 agent 发送消息。消息通过现有的 `conversation.sendMessage` IPC channel 发送（子任务本质上是独立的 conversation），无需新增 IPC channel。

#### 4.1.2 UI 变更

在 TaskPanel 的 Actions 栏上方（transcript 区域下方）新增 SendBox：

```
┌─ TaskPanel ──────────────────────────┐
│  Header: 🔍 Code Reviewer ● running  │
│  ──────────────────────────────────── │
│  Task title                           │
│  ──────────────────────────────────── │
│  Transcript:                          │
│  [assistant] Reviewing file...        │
│  [user] Please also check tests       │ ← 新增消息显示
│  [assistant] Sure, checking tests...  │
│  ──────────────────────────────────── │
│  [Send message to Code Reviewer... ]  │ ← 新增 SendBox
│  ──────────────────────────────────── │
│  [Refresh]              [Cancel]      │
└──────────────────────────────────────┘
```

#### 4.1.3 SendBox 行为

- **Placeholder**: `t('dispatch.taskPanel.sendPlaceholder', { name: childInfo.teammateName || childInfo.title })`
- **可用条件**: 子任务状态为 `running` 或 `idle` 时启用；`completed`/`failed`/`cancelled` 时禁用
- **发送逻辑**: 调用 `ipcBridge.conversation.sendMessage.invoke({ input, msg_id, conversation_id: childTaskId })`
- **发送后行为**:
  - 清空 SendBox
  - 触发 transcript 刷新
  - 子任务状态可能从 `idle` 变为 `running`

#### 4.1.4 消息路由安全

子任务是独立的 conversation（`type: 'dispatch'`, `dispatchSessionType: 'dispatch_child'`），直接通过 `conversation.sendMessage` 发送消息在架构上安全，因为：

- Worker task manager 已经为每个子任务维护独立的 agent instance
- 子任务的 agent 有独立的消息历史和上下文
- 无需经过 dispatcher 中转

唯一需要注意的是：用户直接发消息可能导致 dispatcher 的任务状态记录与子 agent 的实际进度不同步。解决方案：用户直接发送消息时，向父 dispatcher 的消息队列中插入一条 `system` 类型的通知消息，告知 dispatcher 用户已直接干预子任务。

#### 4.1.5 Dispatcher 通知机制

用户向子 agent 发消息后，新增一条 `GroupChatTimelineMessage`（`messageType: 'system'`）到父 dispatcher 的 timeline：

```
[System] User sent a direct message to "Code Reviewer": "Please also check tests"
```

实现方式：在 `TaskPanel.handleSendToChild` 中，发送子 agent 消息成功后，再调用新增的 IPC channel `dispatch.notify-parent` 插入系统通知。

#### 4.1.6 新增 IPC Channel

```typescript
// ipcBridge.ts - dispatch namespace
notifyParent: bridge.buildProvider<
  IBridgeResponse<void>,
  {
    parentConversationId: string;
    childSessionId: string;
    childName: string;
    userMessage: string;
  }
>('dispatch.notify-parent'),
```

在 `dispatchBridge.ts` 中处理：将通知作为 `system` 消息插入父 dispatcher 的消息列表。

#### 4.1.7 Transcript 实时更新

当前 `useTaskPanelTranscript` 在 `isRunning=true` 时每 3 秒轮询。用户发消息后：

- 立即触发一次 `refresh()`
- 轮询机制自动拾取后续子 agent 的响应

无需修改现有轮询逻辑。

#### 4.1.8 组件变更清单

| 组件/文件           | 类型 | 说明                                       |
| ------------------- | ---- | ------------------------------------------ |
| `TaskPanel.tsx`     | 修改 | 新增 SendBox + sendToChild 逻辑            |
| `types.ts`          | 修改 | 更新 `TaskPanelProps` 增加发送回调         |
| `dispatchBridge.ts` | 修改 | 新增 `dispatch.notify-parent` handler      |
| `ipcBridge.ts`      | 修改 | 新增 `dispatch.notify-parent` channel 定义 |

---

### F-4.2: Child Agent Model Selection

#### 4.2.1 概述

允许 orchestrator 在创建子任务时为其指定独立的模型配置，而非强制继承 dispatcher 的模型。这通过扩展子任务创建的 dispatch tool schema 实现。

#### 4.2.2 Dispatch Tool Schema 扩展

在 orchestrator 的 dispatch tool（`create_child_task`）参数中新增可选的 `model` 字段：

```typescript
// dispatchTypes.ts
type CreateChildTaskParams = {
  title: string;
  instruction: string;
  teammateName?: string;
  teammateAvatar?: string;
  // Phase 4: Optional model override for child agent
  model?: {
    providerId: string;
    modelName: string;
  };
};
```

#### 4.2.3 模型解析逻辑

在 `DispatchAgentManager.createChild` 中：

1. 如果 `params.model` 存在，从 `ProcessConfig.get('model.config')` 查找对应 provider
2. 如果找到，使用该 provider + modelName 作为子任务的 `model`
3. 如果未找到或 `params.model` 为空，回退到 dispatcher 的 model（现有行为）

#### 4.2.4 Orchestrator System Prompt 扩展

在 orchestrator 的 system prompt 中补充模型选择指导：

```
Available models for child tasks (optional, omit to use default):
- provider_id: "xxx", models: ["gemini-2.5-pro", "gemini-2.0-flash"]
- provider_id: "yyy", models: ["claude-sonnet-4"]

Guidelines: Use stronger models (e.g., gemini-2.5-pro) for complex reasoning tasks.
Use faster models (e.g., gemini-2.0-flash) for simple translation or formatting tasks.
```

模型列表从 `ProcessConfig.get('model.config')` 动态生成。

#### 4.2.5 TaskOverview 模型显示

在 TaskOverview 的子任务行中，如果子任务使用了非默认模型，显示模型名称标签：

```
├─ 🔍 Code Reviewer    ● running    [gemini-2.5-pro]    12:03
├─ 📝 Doc Writer       ✓ completed  [flash]             12:01
```

#### 4.2.6 数据流变更

```
Orchestrator                    DispatchAgentManager              Child Conversation
   │                                   │                               │
   │  create_child_task({              │                               │
   │    title, instruction,            │                               │
   │    model: { providerId, name }    │                               │
   │  })                               │                               │
   │ ──────────────────────────────►   │                               │
   │                                   │  resolve model from config    │
   │                                   │  create conversation with     │
   │                                   │  resolved model override      │
   │                                   │ ─────────────────────────►    │
```

#### 4.2.7 ChildTaskInfoVO 扩展

```typescript
type ChildTaskInfoVO = {
  // ...existing fields
  /** Model used by this child agent (if different from dispatcher) */
  modelName?: string;
};
```

#### 4.2.8 组件变更清单

| 组件/文件                        | 类型 | 说明                                      |
| -------------------------------- | ---- | ----------------------------------------- |
| `dispatchTypes.ts`（process 层） | 修改 | 扩展 `CreateChildTaskParams` 增加 `model` |
| `DispatchAgentManager`           | 修改 | 子任务创建时解析 model override           |
| `dispatchBridge.ts`              | 修改 | `getGroupChatInfo` 返回子任务的 modelName |
| `types.ts`                       | 修改 | `ChildTaskInfoVO` 增加 `modelName`        |
| `TaskOverview.tsx`               | 修改 | 显示子任务模型标签                        |
| orchestrator system prompt       | 修改 | 注入可用模型列表                          |

---

### F-4.3: Group Chat Settings Panel

#### 4.3.1 概述

在 GroupChatView 的 header 区域新增「设置」按钮，打开 Drawer 面板，允许用户编辑群聊的运行时参数。

#### 4.3.2 可编辑参数

| 参数            | 说明              | 编辑方式                 |
| --------------- | ----------------- | ------------------------ |
| Seed Messages   | 附加系统指令      | TextArea，追加模式       |
| Leader Agent    | 切换 leader agent | Select（同 CreateModal） |
| Group Chat Name | 群聊名称          | Input                    |

注意：Leader Agent 切换**不会**热重启 orchestrator agent。变更在下一次 orchestrator 处理用户消息时生效（通过更新 conversation extra 中的 `leaderPresetRules`）。

#### 4.3.3 UI 设计

```
┌──────────────────────────────────────────────┐
│  GroupChatView Header                         │
│  🤖 Dispatcher Name  [3 tasks]  [⚙ Settings] │ ← 新增 Settings 按钮
└──────────────────────────────────────────────┘

Settings Drawer (右侧滑出):
┌─────────────────────────────┐
│  Group Chat Settings   [×]   │
│  ─────────────────────────── │
│  Group Chat Name             │
│  [My Project Team____]       │
│  ─────────────────────────── │
│  Leader Agent                │
│  [▼ Code Review Expert    ]  │
│  ─────────────────────────── │
│  Seed Messages               │
│  [Your existing seeds...  ]  │
│  [________________________]  │
│  [________] 0/2000           │
│  ─────────────────────────── │
│           [Cancel]  [Save]   │
└─────────────────────────────┘
```

#### 4.3.4 新增 IPC Channel

```typescript
// ipcBridge.ts - dispatch namespace
updateGroupChatSettings: bridge.buildProvider<
  IBridgeResponse<void>,
  {
    conversationId: string;
    groupChatName?: string;
    leaderAgentId?: string;
    seedMessages?: string;
  }
>('dispatch.update-group-chat-settings'),
```

#### 4.3.5 Main Process 处理

在 `dispatchBridge.ts` 中新增 handler：

1. 读取 conversation extra
2. 如果 `leaderAgentId` 变更，从 `acp.customAgents` 查找新 agent，更新 `leaderPresetRules`/`leaderName`/`leaderAvatar`
3. 如果 `seedMessages` 变更，更新 `extra.seedMessages`
4. 如果 `groupChatName` 变更，更新 `extra.groupChatName` 和 `conversation.name`
5. 写回 conversation
6. emit `conversation.listChanged` 通知侧边栏刷新

注意：leader agent 变更后，orchestrator 的 system prompt 需要在下次消息发送时动态重建。这依赖于现有的 system prompt 构建逻辑是否每次都从 conversation extra 读取（需要验证）。

#### 4.3.6 组件清单

| 组件/文件                                | 类型 | 说明                                    |
| ---------------------------------------- | ---- | --------------------------------------- |
| `components/GroupChatSettingsDrawer.tsx` | 新建 | 群聊设置 Drawer 面板                    |
| `GroupChatView.tsx`                      | 修改 | header 新增 Settings 按钮 + Drawer      |
| `types.ts`                               | 修改 | 新增 `GroupChatSettingsDrawerProps`     |
| `dispatchBridge.ts`                      | 修改 | 新增 update-group-chat-settings handler |
| `ipcBridge.ts`                           | 修改 | 新增 IPC channel 定义                   |

---

## 5. 非功能需求

| 编号  | 要求     | 说明                                                                                            |
| ----- | -------- | ----------------------------------------------------------------------------------------------- |
| NFR-1 | 性能     | TaskPanel SendBox 发送不阻塞 UI；子 agent 响应延迟由 worker 决定，UI 层最大等待超时 30s 后提示  |
| NFR-2 | 响应性   | Settings Drawer 打开/关闭使用 Arco Drawer 组件自带动画，save 操作 500ms 内完成                  |
| NFR-3 | 无障碍   | 新增 SendBox 有 `aria-label`；Drawer 有正确的 `aria-modal` 和 focus trap                        |
| NFR-4 | i18n     | 所有用户可见文本走 i18n，覆盖 6 种语言                                                          |
| NFR-5 | 测试覆盖 | 新增组件覆盖率 >= 80%，包含 send-to-child 流程、model selection 和 settings save 的 Vitest 测试 |
| NFR-6 | 目录规范 | dispatch 目录当前 10 个直接子项（含 hooks/ 和 components/），新增文件放入 `components/` 子目录  |

---

## 6. 验收标准

### AC-4.1: TaskPanel User-to-Child Messaging -- 发送入口

- [ ] TaskPanel 底部显示 SendBox（transcript 与 actions 之间）
- [ ] 子任务状态为 `running` 或 `idle` 时 SendBox 启用
- [ ] 子任务状态为 `completed`/`failed`/`cancelled` 时 SendBox 禁用
- [ ] Placeholder 文本包含子 agent 名称

### AC-4.2: TaskPanel User-to-Child Messaging -- 发送逻辑

- [ ] 用户输入消息并回车/点击发送后，消息通过 `conversation.sendMessage` 发送到子 agent
- [ ] 发送成功后 SendBox 清空
- [ ] 发送成功后 transcript 自动刷新，新消息出现在列表中
- [ ] 子 agent 收到消息后正常响应，响应出现在 transcript 中
- [ ] 父 dispatcher 的 timeline 中出现系统通知消息

### AC-4.3: TaskPanel User-to-Child Messaging -- 异常处理

- [ ] 发送失败时显示 `Message.error`
- [ ] 子任务在发送过程中被取消时，提示用户并禁用 SendBox
- [ ] 空消息不触发发送

### AC-4.4: Child Agent Model Selection -- Orchestrator 行为

- [ ] Orchestrator 的 system prompt 包含可用模型列表
- [ ] Orchestrator 创建子任务时可以指定 `model` 参数
- [ ] 未指定 `model` 时，子任务继承 dispatcher 默认模型（向后兼容）

### AC-4.5: Child Agent Model Selection -- 模型解析

- [ ] 指定的 `providerId` + `modelName` 能正确解析为完整的 provider 配置
- [ ] provider 不存在或 model 不存在时，回退到 dispatcher 默认模型并在日志中 warn
- [ ] 子任务 conversation extra 中记录实际使用的模型

### AC-4.6: Child Agent Model Selection -- UI 显示

- [ ] TaskOverview 中使用非默认模型的子任务显示模型名称标签
- [ ] 使用默认模型的子任务不显示额外标签

### AC-4.7: Group Chat Settings -- 入口

- [ ] GroupChatView header 显示 Settings 图标按钮
- [ ] 点击按钮打开右侧 Drawer
- [ ] Drawer 预填当前群聊的 name、leader agent、seed messages

### AC-4.8: Group Chat Settings -- 保存逻辑

- [ ] 修改 group chat name 后保存，header 和侧边栏名称即时更新
- [ ] 切换 leader agent 后保存，conversation extra 中 `leaderAgentId`/`leaderPresetRules`/`leaderName`/`leaderAvatar` 正确更新
- [ ] 修改 seed messages 后保存，下一次 orchestrator 消息发送时使用新的 seed messages
- [ ] 保存成功后 Drawer 关闭并显示 `Message.success`

### AC-4.9: Group Chat Settings -- 异常处理

- [ ] 保存失败时显示 `Message.error`
- [ ] leader agent 已被删除时，Select 中标记为不可用

### AC-4.10: 通用

- [ ] 所有新增用户可见文本走 i18n，6 种语言全覆盖
- [ ] 所有 UI 组件使用 `@arco-design/web-react`
- [ ] 所有图标使用 `@icon-park/react`
- [ ] TypeScript strict mode 无报错
- [ ] 新增功能有对应的 Vitest 测试文件，覆盖率 >= 80%
- [ ] dispatch 目录不超过 10 个直接子项

---

## 7. 技术约束

| 编号  | 约束                          | 说明                                                                                                                    |
| ----- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TC-1  | 三进程隔离                    | 所有 config 读写在 main process 完成，renderer 通过 IPC bridge 调用                                                     |
| TC-2  | ProcessConfig                 | main process 内部使用 `ProcessConfig`（文件 I/O）而非 `ConfigStorage`（bridge invoke），避免 IPC 死锁                   |
| TC-3  | 目录规范                      | dispatch 目录直接子项不超过 10 个。新增文件放入 `components/` 子目录                                                    |
| TC-4  | 组件库                        | 仅使用 `@arco-design/web-react` 组件和 `@icon-park/react` 图标                                                          |
| TC-5  | CSS                           | 优先 UnoCSS utility classes；复杂样式使用 CSS Modules；颜色使用语义 token                                               |
| TC-6  | 现有 IPC 兼容                 | 不修改现有 IPC channel 的参数/返回值签名，仅新增 channel                                                                |
| TC-7  | sendMessage 复用              | F-4.1 直接复用现有的 `conversation.sendMessage` IPC channel 向子 agent 发消息，不新增发送通道                           |
| TC-8  | Model resolution 健壮性       | F-4.2 模型解析失败时必须 graceful fallback 到 dispatcher 默认模型，不得导致子任务创建失败                               |
| TC-9  | Leader agent 非热切换         | F-4.3 leader agent 变更不触发 orchestrator agent 重启，仅更新 conversation extra；下次消息发送时 system prompt 动态重建 |
| TC-10 | Dispatch tool schema 向后兼容 | F-4.2 `model` 参数为可选，现有 orchestrator 不传 model 时行为不变                                                       |

---

## 8. 风险评估

| #   | 风险                                                     | 概率 | 影响 | 缓解方案                                                                                                                                     |
| --- | -------------------------------------------------------- | ---- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | 用户直接向子 agent 发消息导致 dispatcher 任务状态不同步  | 高   | 中   | 通过 `dispatch.notify-parent` 向 dispatcher timeline 插入系统通知；dispatcher 的下一轮 prompt 中会看到该通知，可自行调整编排                 |
| R-2 | 子 agent 在 `idle` 状态时收到用户消息后无法正确恢复运行  | 中   | 高   | 依赖 `workerTaskManager.getOrBuildTask` 的 lazy-start 机制；如果子 agent worker 已被回收，需要重新 fork。验证 idle -> running 的状态转换流程 |
| R-3 | Orchestrator 生成的模型 ID 与实际 provider config 不匹配 | 中   | 中   | 在 system prompt 中提供精确的 `providerId::modelName` 格式示例；解析失败时 log warn + fallback 到默认模型                                    |
| R-4 | Leader agent 切换后 system prompt 未正确更新             | 中   | 高   | 需要验证 orchestrator 的 system prompt 是否每次从 conversation extra 动态构建。如果是 agent 初始化时 snapshot 的，需要增加 prompt 刷新机制   |
| R-5 | Settings Drawer 中 leader agent 列表加载延迟             | 低   | 低   | 使用 SWR 缓存 `acp.customAgents`，与 CreateGroupChatModal 共享缓存 key                                                                       |
| R-6 | dispatch 目录新增文件超过 10 个直接子项限制              | 低   | 低   | F-4.3 新增的 `GroupChatSettingsDrawer.tsx` 放入已有的 `components/` 子目录                                                                   |
| R-7 | 用户频繁向子 agent 发消息导致子 agent 上下文过长         | 低   | 中   | 不做主动限制；子 agent 的上下文管理由底层 LLM provider 处理（自动截断或报错）；UI 层不干预                                                   |

---

## Appendix A: i18n Key 清单

命名空间: `dispatch`

```
# F-4.1: TaskPanel User-to-Child Messaging
dispatch.taskPanel.sendPlaceholder          -> "Send message to {name}..."
dispatch.taskPanel.sendToChild              -> "Send"
dispatch.taskPanel.sendFailed               -> "Failed to send message"
dispatch.taskPanel.sendDisabled             -> "Cannot send message to a {status} task"
dispatch.taskPanel.userDirectMessage        -> "User sent a direct message to \"{name}\""

# F-4.2: Child Agent Model Selection
dispatch.childTask.modelLabel               -> "Model"
dispatch.childTask.modelDefault             -> "Default"

# F-4.3: Group Chat Settings
dispatch.settings.title                     -> "Group Chat Settings"
dispatch.settings.nameLabel                 -> "Group Chat Name"
dispatch.settings.namePlaceholder           -> "Enter group chat name"
dispatch.settings.leaderAgentLabel          -> "Leader Agent"
dispatch.settings.leaderAgentPlaceholder    -> "Select a leader agent"
dispatch.settings.leaderAgentNone           -> "None (use default orchestrator)"
dispatch.settings.seedMessagesLabel         -> "Seed Messages"
dispatch.settings.seedMessagesPlaceholder   -> "Additional system instructions for the orchestrator"
dispatch.settings.save                      -> "Save"
dispatch.settings.saveSuccess               -> "Settings saved"
dispatch.settings.saveFailed                -> "Failed to save settings"
dispatch.settings.leaderAgentDeleted        -> "This agent has been deleted"
```

## Appendix B: 文件变更清单

### 新建文件

| 文件                                                                              | 说明                 |
| --------------------------------------------------------------------------------- | -------------------- |
| `src/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer.tsx` | 群聊设置 Drawer 面板 |

### 修改文件

| 文件                                                                   | 变更内容                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`               | 新增 SendBox + sendToChild 逻辑 + 状态判断                                     |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`           | header 新增 Settings 按钮 + Drawer 集成                                        |
| `src/renderer/pages/conversation/dispatch/components/TaskOverview.tsx` | 子任务行新增模型名称标签显示                                                   |
| `src/renderer/pages/conversation/dispatch/types.ts`                    | 新增 `GroupChatSettingsDrawerProps`、`ChildTaskInfoVO.modelName`               |
| `src/common/adapter/ipcBridge.ts`                                      | 新增 `dispatch.notify-parent` 和 `dispatch.update-group-chat-settings` channel |
| `src/process/bridge/dispatchBridge.ts`                                 | 新增 notify-parent 和 update-group-chat-settings handler                       |
| `src/process/` dispatch agent manager                                  | 扩展 createChild 支持 model override；system prompt 注入模型列表               |
| i18n locale 文件 (6 languages)                                         | 新增上述 i18n key                                                              |

## Appendix C: 候选功能取舍说明

| 候选功能                           | 决策             | 理由                                                                                                                                                     |
| ---------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TaskPanel user-to-child messaging  | **In Scope**     | 复用现有 `conversation.sendMessage` 通道，无需新增消息路由；用户价值高（直接干预子 agent 是多 agent 协作的核心需求）；中等风险（需处理 dispatcher 同步） |
| Child agent model selection        | **In Scope**     | 扩展 dispatch tool schema 即可，不涉及 MCP server 变更；orchestrator 自然语言指定模型，解析逻辑简单；向后兼容（optional 参数）                           |
| Group chat settings panel          | **In Scope**     | 实现简单（config 读写 + Drawer UI）；低风险（non-hot-switch 策略）；解决 seed messages 和 leader agent 不可变更的痛点                                    |
| Single-chat upgrade to dispatch    | **Out of Scope** | 风险评估未降低：conversation type 迁移、agent 热切换、消息格式不兼容、路由重建、回退困难。建议 Phase 5 用「新建 + 上下文导入」方案替代                   |
| 子任务嵌套（multi-level dispatch） | **Out of Scope** | 需要递归 dispatch 架构和树形状态管理，复杂度远超当前 Phase 范围                                                                                          |
| 子 agent 间直接通信                | **Out of Scope** | 需要 message bus / pub-sub 架构，当前 dispatch 模型为星型拓扑（dispatcher -> children），改为 mesh 拓扑风险极高                                          |
