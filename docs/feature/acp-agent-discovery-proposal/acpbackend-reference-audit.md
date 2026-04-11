# AcpBackend 引用审查报告

> 审查目标：`src/common/types/acpTypes.ts:516` 定义的 `AcpBackend` 类型在整个代码库中的引用分布与逻辑用途。

## 类型关系

```
AcpBackendAll (string union — 22 成员, 显式定义, line 57)
    │
    ▼
ACP_BACKENDS_ALL: Record<AcpBackendAll, AcpBackendConfig>  (运行时注册表)
    │
    ▼
AcpBackend = keyof typeof ACP_BACKENDS_ALL  (派生类型, 等价于 AcpBackendAll)  ← line 516
    │
    ▼
AcpBackendId = AcpBackend  (向后兼容别名, line 517)
```

`AcpBackend` 与 `AcpBackendAll` 结构上完全相同，都是 22 个字面量的联合。项目中两者混用，另有 `AcpBackendConfig` 接口描述后端元数据。

## 统计概览

| 分类 | 文件数 | 引用行数(约) |
|------|--------|-------------|
| 核心定义 (`acpTypes.ts`) | 1 | ~15 |
| Common 层 | 5 | ~25 |
| Process 层 (主进程) | 15 | ~80 |
| Renderer 层 | 22 | ~130 |
| 测试文件 | 5 | ~20 |
| 文档 | 4 | ~10 |
| **合计** | **~52** | **~280** |

---

## 1. 核心定义 — `src/common/types/acpTypes.ts`

| 行 | 内容 | 用途 |
|----|------|------|
| 57 | `export type AcpBackendAll = 'claude' \| 'gemini' \| ...` | 显式联合，22 个成员 |
| 162 | `export interface AcpBackendConfig { ... }` | 后端配置接口 (id, name, cliCommand, enabled, skillsDirs 等) |
| 345 | `export const ACP_BACKENDS_ALL: Record<AcpBackendAll, AcpBackendConfig>` | 全量注册表 |
| 511 | `export const ACP_ENABLED_BACKENDS` | 过滤后仅启用的子集 |
| **516** | **`export type AcpBackend = keyof typeof ACP_BACKENDS_ALL`** | **目标类型定义** |
| 517 | `export type AcpBackendId = AcpBackend` | 向后兼容别名 |
| 520 | `isValidAcpBackend(backend: string): backend is AcpBackend` | 类型守卫 |
| 524 | `getAcpBackendConfig(backend: AcpBackend): AcpBackendConfig` | 配置查询 |

---

## 2. Common 层

| 文件 | 关键引用 | 逻辑 |
|------|---------|------|
| `common/adapter/ipcBridge.ts` | `detectCliPath`, `checkAgentHealth`, `probeModelInfo`, `getAgentMcpConfigs`, `syncMcpToAgents`, `removeMcpFromAgents` 的参数都含 `backend: AcpBackend` | **IPC 桥定义** — 所有跨进程调用的后端标识 |
| `common/config/storage.ts` | `[backend in AcpBackend]?: { preferredModelId? }` 映射类型; 多个 `TChatConversation` extra 字段用 `AcpBackendAll` | **持久化存储** — 按后端存储偏好模型、会话元数据 |
| `common/chat/chatLib.ts` | `IConfirmation.backend: AcpBackend` | **权限确认** — 标识发起确认的 agent |
| `common/chat/sideQuestion.ts` | 参数 `backend?: AcpBackend` | **侧栏提问** — 标识提问的后端 |
| `common/utils/buildAgentConversationParams.ts` | `extra.backend = effectivePresetType as AcpBackend` | **会话创建** — 构建 agent 会话参数时写入 backend |

---

## 3. Process 层（主进程）

### 3.1 ACP Agent 核心

| 文件 | 关键引用 | 逻辑 |
|------|---------|------|
| `process/agent/acp/index.ts` | `AcpAgentConfig.backend: AcpBackend`; `ensureBackendAuth(backend: AcpBackend)` | **Agent 实例** — 配置、初始化、认证 |
| `process/agent/acp/AcpConnection.ts` | `private backend: AcpBackend \| null`; `connect(backend: AcpBackend)`; `doConnect(backend)`; getter `currentBackend` | **连接管理** — 建立/维护与各后端的 stdio/SSE 连接 |
| `process/agent/acp/AcpAdapter.ts` | `private backend: AcpBackend`; constructor 参数 | **协议适配** — 将 ACP 协议消息转换为内部格式 |
| `process/agent/acp/AcpDetector.ts` | `AvailableAgent.backend: AcpBackendAll` | **CLI 探测** — 检测本地已安装的 agent |

### 3.2 任务管理

| 文件 | 关键引用 | 逻辑 |
|------|---------|------|
| `process/task/AcpAgentManager.ts` | `AcpAgentManagerData.backend`; `handleStreamEvent(msg, backend)`; `handleSignalEvent(v, backend)`; `handleFinishSignal(..., backend)` | **Agent 生命周期管理** — 流式消息处理、信号处理、缓冲队列，都按 backend 区分 |
| `process/task/MessageMiddleware.ts` | `processAgentResponse(agentType: AcpBackendAll)` | **消息中间件** — 处理 cron/agent 响应时需要知道 agentType |
| `process/task/OpenClawAgentManager.ts` | `backend?: AcpBackendAll` | **OpenClaw 管理器** — 路由到 openclaw-gateway 时的后端标识 |

### 3.3 服务层

| 文件 | 关键引用 | 逻辑 |
|------|---------|------|
| `process/bridge/services/ConversationSideQuestionService.ts` | `ResolvedAcpContext.backend: AcpBackend`; `createAcpCompletionPromise(backend)` | **侧栏问答** — 解析 ACP 上下文、创建完成 promise |
| `process/channels/utils/channelConversation.ts` | `backend?: AcpBackend` 返回/赋值 | **频道会话** — 从频道参数中提取 backend |
| `process/services/IConversationService.ts` | `CreateConversationParams.backend?: AcpBackendAll` | **会话服务接口** — 创建会话时可指定后端 |
| `process/services/cron/CronStore.ts` | `CronJobRow.agentType: AcpBackendAll`; DB row cast | **定时任务存储** — 数据库行中的 agent 类型字段 |
| `process/services/cron/CronService.ts` | inline import `AcpBackendAll` | **定时任务调度** — 创建/执行定时任务时的类型标注 |
| `process/services/cron/WorkerTaskManagerJobExecutor.ts` | `getAgentType(backend: AcpBackendAll)` switch 路由 | **Worker 执行器** — 根据 backend 选择 AgentType 枚举 |
| `process/services/mcpServices/McpProtocol.ts` | `McpSource = AcpBackendAll \| 'aionui'` | **MCP 协议** — 标识 MCP 配置来源 |
| `process/services/mcpServices/McpService.ts` | 多处 `backend: AcpBackend` 参数; `getAgentForConfig`, `getDetectionTarget`, `syncMcpToAgents` | **MCP 服务** — 同步/移除 MCP 配置时按 backend 匹配 agent |

### 3.4 其他

| 文件 | 逻辑 |
|------|------|
| `process/team/TeamSessionService.ts` | `resolveBackend(agent) as AcpBackendAll` — 团队会话中解析 backend |
| `process/utils/initStorage.ts` | `AcpBackendConfig[]` — 初始化内置 assistant 列表 |
| `process/utils/message.ts` | `backend?: AcpBackend \| 'aionrs'` — 消息工具函数 |

---

## 4. Renderer 层

### 4.1 Guid 页面（Agent 选择/发送）

| 文件 | 逻辑 |
|------|------|
| `guid/types.ts` | 定义 `AvailableAgent.backend: AcpBackend`; 重导出类型 |
| `guid/hooks/useGuidAgentSelection.ts` | `selectedAgent: AcpBackend \| 'custom'`; 解析 preset agent、获取 enabledSkills、读取 preferredModelId — **核心选择逻辑** |
| `guid/hooks/useGuidSend.ts` | 发送消息时用 `AcpBackend` 构建参数 |
| `guid/hooks/usePresetAssistantResolver.ts` | 解析 preset agent type、获取预设资源、技能列表 |
| `guid/hooks/useAgentAvailability.ts` | 计算 effective agent type |
| `guid/hooks/agentSelectionUtils.ts` | `getAgentKey()` 工具函数 |
| `guid/hooks/useCustomAgentsLoader.ts` | 加载自定义 agent 列表 `AcpBackendConfig[]` |
| `guid/components/GuidActionRow.tsx` | 操作栏 — 选中 agent 显示 |
| `guid/components/AgentPillBar.tsx` | agent 胶囊选择器 |
| `guid/components/AssistantSelectionArea.tsx` | assistant 选择区 |
| `guid/components/PresetAgentTag.tsx` | preset agent 标签 |
| `guid/GuidPage.tsx` | 页面入口 — 读取 customAgents、传递 effectiveAgentInfo |

### 4.2 对话页面

| 文件 | 逻辑 |
|------|------|
| `conversation/platforms/acp/AcpChat.tsx` | `backend: AcpBackend` prop — ACP 聊天组件 |
| `conversation/platforms/acp/AcpSendBox.tsx` | `backend: AcpBackend` prop — 发送框组件 |
| `conversation/components/SkillRuleGenerator.tsx` | 读取 `AcpBackendConfig[]` 生成技能规则 |

### 4.3 设置页面

| 文件 | 逻辑 |
|------|------|
| `settings/AgentSettings/LocalAgents.tsx` | 自定义 agent CRUD 操作 |
| `settings/AgentSettings/InlineAgentEditor.tsx` | agent 内联编辑器 — 创建/更新 `AcpBackendConfig` |
| `settings/AgentSettings/AgentCard.tsx` | agent 卡片展示 |
| `settings/AgentSettings/PresetManagement.tsx` | preset agent 管理 |
| `settings/AgentSettings/AssistantManagement/types.ts` | `AssistantListItem = AcpBackendConfig & { ... }` |

### 4.4 频道配置表单

DingTalk / Lark / Telegram / Weixin 四个表单文件模式相同：

- `selectedAgent: AcpBackendAll` 状态
- `agentOptions` 选项列表
- 从存储读取时 `as AcpBackendAll` 类型断言
- `persistSelectedAgent` 参数类型

涉及文件：

- `settings/SettingsModal/contents/channels/DingTalkConfigForm.tsx`
- `settings/SettingsModal/contents/channels/LarkConfigForm.tsx`
- `settings/SettingsModal/contents/channels/TelegramConfigForm.tsx`
- `settings/SettingsModal/contents/channels/WeixinConfigForm.tsx`

### 4.5 通用组件 & Hooks

| 文件 | 逻辑 |
|------|------|
| `components/agent/AcpConfigSelector.tsx` | `CONFIG_OPTION_SUPPORTED_BACKENDS: Set<AcpBackend>` — 配置选项支持检查 |
| `components/agent/AgentSetupCard.tsx` | `AGENT_LOGOS: Partial<Record<AcpBackendAll, string>>` — agent logo 映射 |
| `hooks/agent/useAgentReadinessCheck.ts` | `AGENT_NAMES: Partial<Record<AcpBackendAll, string>>`; 就绪检查逻辑 |
| `hooks/assistant/useAssistantEditor.ts` | 创建/更新 `AcpBackendConfig` |
| `utils/model/agentTypes.ts` | `backend: AcpBackend` 在 agent 类型工具中 |

### 4.6 定时任务页面

| 文件 | 逻辑 |
|------|------|
| `pages/cron/ScheduledTasksPage/index.tsx` | `normalizeAgentBackend()` → `AcpBackendAll` |

---

## 5. 测试文件

| 文件 | 逻辑 |
|------|------|
| `tests/unit/acpAgentManagerCronGuard.test.ts` | `backend: 'claude' as AcpBackend` — cron guard 单元测试 |
| `tests/unit/AgentCard.dom.test.tsx` | `makeCustomAgent(): AcpBackendConfig` — AgentCard DOM 测试 |
| `tests/unit/InlineAgentEditor.dom.test.tsx` | `makeAgent(): AcpBackendConfig` — 编辑器 DOM 测试 |
| `tests/unit/guidAgentHooks.dom.test.ts` | `customAgents: AcpBackendConfig[]` — guid hooks 测试 |
| `tests/unit/guidAgentSelection.dom.test.ts` | `CUSTOM_AGENTS: AcpBackendConfig[]` — agent 选择测试 |

---

## 6. 文档

| 文件 | 内容 |
|------|------|
| `docs/tech/queue-and-acp-state.md` | AcpConnection 状态表中描述 `backend: AcpBackend` 字段 |
| `docs/feature/acp-agent-discovery-proposal/implementation-plan.md` | 实施计划中有「AcpBackendConfig 字段审计」章节；提到「AcpBackend 类型暂不改」 |
| `docs/feature/acp-agent-discovery-proposal/requirements.md` | 描述 `AcpBackendConfig` 死字段 |
| `docs/feature/remote-agent/requirements.md` | 描述 `ConfigStorage['acp.customAgents']` 类型为 `AcpBackendConfig[]` |

---

## 关键发现

### 1. `AcpBackend` 与 `AcpBackendAll` 混用

两者结构相同但项目中不一致地交替使用。Process 层偏好 `AcpBackendAll`，Renderer 层偏好 `AcpBackend`。建议统一为一个类型。

### 2. 传播路径

```
acpTypes.ts (定义)
    → ipcBridge.ts (IPC 协议)
        → Process 服务 (AcpAgent, AcpConnection, McpService, CronStore ...)
        → Renderer hooks/组件 (useGuidAgentSelection, AcpChat, 频道表单 ...)
```

`AcpBackend` 是贯穿整个跨进程通信链的核心标识类型。

### 3. 大量 `as AcpBackend` 强转

在 `useGuidAgentSelection.ts`、`channelConversation.ts`、`WorkerTaskManagerJobExecutor.ts` 等文件中频繁出现 `as AcpBackend` / `as AcpBackendAll` 强转，可能掩盖类型安全问题。建议引入类型守卫或收窄逻辑替代。

### 4. 覆盖面广，修改需全局评估

涉及 agent 连接、消息处理、MCP 同步、定时任务、频道配置、设置管理、会话创建等几乎所有核心业务逻辑。对 `AcpBackend` 的任何变更都需要全局影响评估。
