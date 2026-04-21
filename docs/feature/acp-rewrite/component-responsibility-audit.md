# ACP 组件职责全景审计

> 生成日期: 2026-04-19
> 目的: 列出 7 个核心组件的所有职责, 为"AcpRuntime 转正"提供决策依据

---

## 鸟瞰图

### 组件一句话定位

| 组件                  | 归属 | 一句话                                                              | 代码量        |
| --------------------- | ---- | ------------------------------------------------------------------- | ------------- |
| **WorkerTaskManager** | 通用 | 多类型 Agent 的注册表 — 不关心 agent 内部, 只管"谁活着、谁该杀"     | 123 行        |
| **AcpAgentManager**   | 旧   | ACP 的业务大管家 — 从 DB 持久化到 cron 到 UI 事件, 什么都管         | 1635 行       |
| **AcpAgent**          | 旧   | ACP 协议适配器 — 把"连接 + 认证 + 会话 + 权限 + 发消息"捏成一个对象 | 1884 行       |
| **AcpConnection**     | 旧   | 底层传输 — 手写 NDJSON + JSON-RPC + 子进程管理, 一个类干三件事      | 1156 行       |
| **AcpRuntime**        | 新   | 多会话路由器 — 管 session 的增删查, 转发事件, 但不碰业务逻辑        | 290 行        |
| **AcpSession**        | 新   | 协议状态机 — 7 态 FSM + 8 个子组件, 每个子组件只做一件事            | 392 + ~800 行 |
| **ProcessAcpClient**  | 新   | 底层传输 (重写版) — 基于 SDK, 进程 + 传输 + 协议合一但职责清晰      | 493 行        |

### 架构分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Bridge / IPC 层                             │
│  conversationBridge, acpConversationBridge, taskBridge, ...         │
│  职责: 把 renderer 的 IPC 调用翻译成 main-process 操作              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
   ┌──────────────┐   ┌────────────────┐   ┌──────────────┐
   │ WorkerTask-  │   │  Team/Channel  │   │   Cron/Pet   │
   │ Manager      │   │  Systems       │   │   Systems    │
   │ (注册表)     │   │ (多agent协作)  │   │ (定时/确认)  │
   └──────┬───────┘   └───────┬────────┘   └───────┬──────┘
          │                   │                    │
          └───────────────────┼────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                     业务编排层 (Business Orchestration)             │
│                                                                     │
│  旧: AcpAgentManager (1635行, 什么都做)                             │
│  新: AcpRuntime (290行, 只做路由) + ??? (业务逻辑无人承接)          │
│                                                                     │
│  职责: DB 持久化、事件广播、turn 追踪、cron 集成、                  │
│        thinking 累积、首消息注入、slash commands、preview...        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     协议适配层 (Protocol Adapter)                   │
│                                                                     │
│  旧: AcpAgent (1884行) + AcpAgentV2 (809行, 兼容桥)                 │
│  新: AcpSession (392行 + 8 子组件)                                  │
│                                                                     │
│  职责: 状态机、连接/重连/重试、认证、权限评估、                     │
│        消息翻译、配置追踪、prompt 执行/超时                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     传输层 (Transport)                              │
│                                                                     │
│  旧: AcpConnection (1156行, 手写 NDJSON + JSON-RPC)                 │
│  新: ProcessAcpClient (493行, 基于 SDK)                             │
│                                                                     │
│  职责: 子进程生命周期、NDJSON 流、协议握手、请求追踪                │
└─────────────────────────────────────────────────────────────────────┘
```

### 12 类职责矩阵

把所有细项归纳为 **12 大类**, 一张表看全貌:

| 大类                | WorkerTaskManager |      AcpAgentManager      |          AcpAgent          |     AcpConnection      |     |    AcpRuntime    |       AcpSession        |     ProcessAcpClient      |
| ------------------- | :---------------: | :-----------------------: | :------------------------: | :--------------------: | --- | :--------------: | :---------------------: | :-----------------------: |
| **A. 进程生命周期** |    ● kill/回收    |        ● init/kill        |        ● start/kill        |  ● connect/disconnect  |     | ○ 回收(suspend)  |       ○ teardown        |       ● spawn/close       |
| **B. 协议通信**     |                   |                           |     ● 委托 Connection      | ● 手写 NDJSON+JSON-RPC |     |     ○ 纯委托     |    ● FSM+子组件编排     |        ● SDK 全套         |
| **C. 认证**         |                   |                           |       ● 含 CLI login       |  ○ authenticate 透传   |     |     ○ 纯委托     |    ● AuthNegotiator     |    ○ authenticate 透传    |
| **D. 配置管理**     |                   |       ● 持久化+拦截       |      ● get/set+再确认      |     ● set+乐观缓存     |     |    ● MCP 注入    |     ● ConfigTracker     |        ○ set 透传         |
| **E. 输入预处理**   |                   |       ● 首消息注入        |       ● @file 完整版       |                        |     |                  |     ○ @file 简化版      |                           |
| **F. 输出后处理**   |                   | ● 缓冲+thinking+`<think>` |     ● 类型映射+file op     |                        |     |      ○ 透传      |   ● MessageTranslator   |                           |
| **G. 权限**         |                   |    ● team auto-approve    |     ● ApprovalStore+UI     |  ● timeout 暂停/恢复   |     |     ○ 纯委托     |  ● PermissionResolver   |                           |
| **H. 容错与恢复**   |                   |       ● finish 兜底       |   ● 自动重连+agentCrash    |     ● 启动失败检测     |     |                  |  ● 重试+退避+断连恢复   | ● 4-signal+pending reject |
| **I. 持久化**       |                   |     ● 6 个 save+缓存      | ● 能力缓存到 ProcessConfig |                        |     |   ○ 全部注释掉   |                         |                           |
| **J. 事件路由**     |                   |        ● 三路广播         |         ○ 回调上报         |                        |     | ○ 钩子(无消费者) | ○ SessionCallbacks 上报 |                           |
| **K. 外部系统集成** |      ○ 枚举       | ● cron+slash+preview+turn |     ○ navigation 拦截      |                        |     |                  |      ○ 存 commands      |                           |
| **L. 可观测性**     |                   |      ● request_trace      |   ○ thought/content 追踪   | ● stderr+首 chunk 延迟 |     |                  |  ○ usage+spawn metric   |  ● stderr+logging proxy   |

图例: **●** 核心负责 / **○** 有涉及但很薄 / 空 = 不涉及

### 缺口速览

| 大类           | 新架构缺口                                                                    |
| -------------- | ----------------------------------------------------------------------------- |
| A 进程生命周期 | ✅ 基本覆盖 (suspend vs kill 语义差异待对齐)                                   |
| B 协议通信     | ✅ 完全覆盖                                                                    |
| C 认证         | ⚠️ 协议级有, **CLI login 缺失** (AcpAgentV2 compat 补)                         |
| D 配置管理     | ⚠️ 追踪有, **持久化+后端拦截 (Codex/Snow) 缺失**                               |
| E 输入预处理   | ❌ **首消息注入完全缺失; @file 显著弱化**                                      |
| F 输出后处理   | ❌ **流式缓冲、thinking 累积、`<think>` 提取、tool call 深合并全缺**           |
| G 权限         | ⚠️ 三层评估有, **team auto-approve + channel 通知缺失**                        |
| H 容错与恢复   | ❌ **自动重连 (P1)、agentCrash (P0)、finish 兜底全缺**                         |
| I 持久化       | ❌ **完全空白** — acp_session 表注释掉, conversation.extra 路径不存在          |
| J 事件路由     | ❌ **只有回调链, 无三路广播** — team/channel 收不到事件                        |
| K 外部系统集成 | ❌ **cron、slash waiter、preview、TurnCompletionService 全缺**                 |
| L 可观测性     | ⚠️ 底层有 (stderr/logging proxy), **request_trace + context usage 持久化缺失** |

### 一眼看出的问题

1. **AcpAgentManager 是个"上帝对象"** — 12 类中它重度参与 10 类 (仅 B 协议通信和 C 认证不直接碰)
2. **新架构的"业务编排层"是空的** — AcpRuntime 在 E/F/H/I/J/K 六个大类中**完全空白**
3. **旧代码的底层 (A+B+C) 已经被新代码很好地替代了** — AcpSession + ProcessAcpClient 覆盖了 AcpAgent + AcpConnection 的传输和协议职责
4. **真正的迁移工作集中在六个大类**:
   - **E 输入预处理** — 首消息注入、@file 完整版
   - **F 输出后处理** — 流式缓冲、thinking 累积、`<think>` 提取、tool call 深合并
   - **H 容错与恢复** — 自动重连、finish 兜底、agentCrash
   - **I 持久化** — 6 个 save + ProcessConfig 缓存 (新版全部空白)
   - **J 事件路由** — 三路广播 (新版只有回调链)
   - **K 外部系统集成** — cron、slash commands、preview、TurnCompletionService

---

## 目录

0. [鸟瞰图](#鸟瞰图)
1. [WorkerTaskManager [通用]](#1-workertaskmanager-通用--123-行)
2. [AcpAgentManager [旧]](#2-acpagentmanager-旧--1635-行)
3. [AcpAgent [旧]](#3-acpagent-旧--1884-行)
4. [AcpConnection [旧]](#4-acpconnection-旧--1156-行)
5. [AcpRuntime [新]](#5-acpruntime-新--290-行)
6. [AcpSession [新]](#6-acpsession-新--392-行--8-个子组件-1200-行总计)
7. [AcpClient / ProcessAcpClient [新]](#7-acpclient-processacpclient-新--493-行)
8. [职责覆盖关系速查](#职责覆盖关系速查)

---

## 1. WorkerTaskManager [通用] — 123 行

**文件**: `src/process/task/WorkerTaskManager.ts`
**角色**: 多类型 Agent 注册表和生命周期控制器。与 ACP 无关, 是所有 agent 类型的统一管理层。

| #   | 职责                          | 说明                                                                 |
| --- | ----------------------------- | -------------------------------------------------------------------- |
| W1  | 任务注册 (in-memory cache)    | `taskList: Array<{id, task}>`, 按 conversationId 索引                |
| W2  | 惰性构建 (lazy build from DB) | `getOrBuildTask()` 从 SQLite 读 conversation, 通过 AgentFactory 分发 |
| W3  | 多类型工厂分发                | 6 种 agent 类型: acp, gemini, aionrs, openclaw, nanobot, remote      |
| W4  | 任务替换/去重                 | `addTask()` 发现同 ID 旧任务时先 kill 再替换                         |
| W5  | 单任务 kill                   | `kill(id, reason?)` — 支持 `idle_timeout` / `team_deleted` 原因      |
| W6  | 全量清理                      | `clear()` — kill all, 等 5s 异步清理 (Windows taskkill)              |
| W7  | 空闲 CLI agent 回收           | 60s 轮询, 对 `finished` 状态的 acp/aionrs 类型执行 kill              |
| W8  | 任务枚举                      | `listTasks()` → `{id, type}[]`, 供 tray/bridge/snapshot 使用         |

### 消费者

| 消费者              | 文件                                   | 用法                                  |
| ------------------- | -------------------------------------- | ------------------------------------- |
| App 入口            | `src/index.ts`                         | `clear()` on app quit                 |
| Bridge 层 (7+ 模块) | `src/process/bridge/*.ts`              | 20+ IPC 方法全部依赖                  |
| Tray 菜单           | `src/process/utils/tray.ts`            | `listTasks().length`                  |
| Cron 服务           | `src/process/services/cron/`           | `getOrBuildTask(yoloMode)`            |
| Team 系统           | `src/process/team/`                    | `getOrBuildTask(skipCache)`, `kill()` |
| Channel 系统        | `src/process/channels/`                | `getOrBuildTask()`, `getTask()`       |
| Pet 确认            | `src/process/pet/petConfirmManager.ts` | `getTask()` for confirm               |

---

## 2. AcpAgentManager [旧] — 1635 行

**文件**: `src/process/task/AcpAgentManager.ts`
**角色**: ACP agent 的"业务编排层"。继承 `BaseAgentManager`, 实现 `IAgentManager` 接口, 持有 `AcpAgentV2` 实例。

| #   | 职责                              | 说明                                                                                                    |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| M1  | Agent 惰性初始化                  | `initAgent()` — bootstrap promise 保护, 首次 sendMessage/warmup 时触发                                  |
| M2  | Bootstrap 预热抑制                | `bootstrapping` flag 抑制 warmup 阶段的 stream 事件, 避免 sidebar spinner                               |
| M3  | 消息发送入口                      | `sendMessage()` — 用户消息持久化、agent init、首消息注入、委托给 agent                                  |
| M4  | 用户消息预持久化 + 预发送         | agent init 之前就写 DB + emit IPC, UI 立即可见用户消息                                                  |
| M5  | 首消息技能/预设注入               | presetContext + skillsIndex + teamGuide prompt 拼接到首条消息                                           |
| M6  | Turn 追踪 + 丢失 finish 兜底      | `beginTrackedTurn()`, `markTrackedTurnFinished()`, 15s 定时器合成 finish                                |
| M7  | 流式文本 DB 缓冲                  | `bufferedStreamTextMessages` Map, 120ms 合并写入减少 I/O                                                |
| M8  | Stream 事件处理管线               | `handleStreamEvent()` — 过滤噪音、转换格式、持久化到 DB、三路广播                                       |
| M9  | Agent 状态噪音过滤                | 首消息后抑制非关键 agent_status 事件 (只保留 error/disconnected)                                        |
| M10 | Thinking 消息累积                 | thinkingMsgId/thinkingStartTime/thinkingContent 状态, 定期 flushThinkingToDb()                          |
| M11 | `<think>` 标签提取                | `extractAndStripThinkTags()` 处理 MiniMax 等不规范模型的内联 think 标签                                 |
| M12 | Signal 事件处理                   | `handleSignalEvent()` — 权限、finish、error 三路分发                                                    |
| M13 | 权限管理 (manager 层)             | yolo 自动批准 + team MCP 工具 (`aionui-team`) 自动批准 + channel 通知                                   |
| M14 | 三路事件总线广播                  | `ipcBridge` (→renderer) + `teamEventBus` (→team 生命周期) + `channelEventBus` (→channel 路由)           |
| M15 | request_trace 事件                | 开发调试: 记录 agentType, backend, modelId, cliPath, sessionMode, timestamp                             |
| M16 | Cron 集成                         | `cronBusyGuard.setProcessing()`, cron 命令检测 (`hasCronCommands`), `skillSuggestWatcher.onFinish()`    |
| M17 | Finish 处理                       | `handleFinishSignal()`: 累积内容检查 cron、processCronInMessage、flush buffers                          |
| M18 | ConversationTurnCompletionService | finish 时调 `notifyPotentialCompletion()` 通知外部服务                                                  |
| M19 | Per-conversation DB 持久化        | `saveModelId()`, `saveSessionMode()`, `saveConfigOptions()`, `saveContextUsage()`, `saveAcpSessionId()` |
| M20 | Model list 缓存到 ProcessConfig   | `cacheModelList()` for Guid 页面离线显示                                                                |
| M21 | 后端特定 mode 拦截                | Codex/Snow 不支持 ACP `session/set_mode`, 本地拦截不发 RPC                                              |
| M22 | Codex sandbox mode                | `writeCodexSandboxMode()` 写入 Codex 配置文件                                                           |
| M23 | Stop (取消当前 prompt)            | `stop()` → `agent.cancelPrompt()`, 不杀进程                                                             |
| M24 | Kill (完全销毁)                   | `kill()` — flush buffer, clear slash command waiters, `agent.kill()` with 1.5s+0.5s grace               |
| M25 | Slash commands 管理               | `getAcpSlashCommands()` 同步返回, `loadAcpSlashCommands()` 含 waiter + timeout 机制                     |
| M26 | Preview open 事件                 | `handlePreviewOpenEvent()` 转发到 renderer                                                              |

### 消费者

| 消费者                          | 文件                   | 用法                                                                        |
| ------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `workerTaskManagerSingleton.ts` | 工厂注册               | `agentFactory.register('acp', ...)`                                         |
| `acpConversationBridge.ts`      | 6 处 `instanceof` 检查 | getMode, getModelInfo, setModel, setMode, getConfigOptions, setConfigOption |
| `conversationBridge.ts`         | type cast              | warmup → `initAgent()`, getSlashCommands → `loadAcpSlashCommands()`         |

---

## 3. AcpAgent [旧] — 1884 行

**文件**: `src/process/agent/acp/index.ts`
**角色**: 旧版 ACP 协议适配层。直接持有 `AcpConnection`, 负责连接生命周期、认证、Session 管理、消息发送、权限处理。
**状态**: 仍存在于代码库, 被 `AcpAgentManager` 做 type import; 运行时已被 `AcpAgentV2` 替代。

| #   | 职责                                  | 说明                                                                                                          |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A1  | 连接生命周期                          | `start()` — connect + auth + session + mode + model, 带 1 次自动重试                                          |
| A2  | 自动重连 (sendMessage 时)             | `sendMessage()` 中检测断开 → 重新调 `start()`                                                                 |
| A3  | 认证流程 (multi-step)                 | `performAuthentication()`: initResult check → session creation → CLI login → retry session                    |
| A4  | CLI login 执行                        | `ensureBackendAuth()` — spawn `claude /login`, `qwen login` 等后端 CLI 命令                                   |
| A5  | Session 创建/恢复                     | `createOrResumeSession()` — ownership 校验, resume 优先, fallback 新建                                        |
| A6  | MCP 服务器注入                        | `loadBuiltinSessionMcpServers()` — user (ProcessConfig) + team MCP + team-guide MCP                           |
| A7  | MCP 就绪等待                          | `waitForMcpReady(teamSlotId, 30_000)` in team mode                                                            |
| A8  | YOLO mode 管理                        | `enableYoloMode()`, `applySessionMode()`                                                                      |
| A9  | Session mode 管理                     | `setMode()`, `applySessionMode()` (fatal mode 失败抛异常, non-fatal 仅 warn)                                  |
| A10 | Model 管理 (get/set)                  | `getModelInfo()` (cc-switch 优先), `setModelByConfigOption()` (set_model 优先, fallback set_config_option)    |
| A11 | Model 再确认 (每次 prompt 前)         | `sendMessage()` 中 re-assert `userModelOverride`, 防止 compaction 导致 model 漂移                             |
| A12 | Claude model switch notice            | `pendingModelSwitchNotice` → 下次 prompt 前注入 `<system-reminder>` 告知 AI 身份变更                          |
| A13 | Config options 管理                   | `getConfigOptions()`, `setConfigOption()`, 启动时 apply pending config options                                |
| A14 | Prompt timeout 配置                   | `applyPromptTimeoutFromConfig()` — per-backend → global → default 300s                                        |
| A15 | 消息发送 (核心)                       | `sendMessage()` — auto-reconnect + @file + model re-assert + `<system-reminder>` + timeout                    |
| A16 | @ 文件引用处理 (完整版)               | `processAtFileReferences()` — 解析 `@path`, workspace 搜索, 去重, 读内容, 拼接结构化块                        |
| A17 | 权限请求处理                          | `handlePermissionRequest()` — promise-based, ApprovalStore 查询, 30min 超时 (team 无超时)                     |
| A18 | Approval 缓存                         | `ApprovalStore` — session 级 "always allow" 缓存                                                              |
| A19 | 权限确认                              | `confirmMessage()` — 解析 approve key, 存入 always allow                                                      |
| A20 | Navigation 工具拦截                   | `isNavigationTool()`, `extractNavigationUrl()`, `handleInterceptedNavigation()` → preview_open                |
| A21 | Session update 分发                   | `handleSessionUpdate()` — tool_call, tool_call_update, usage_update, config_option_update, available_commands |
| A22 | Turn 生命周期 + agentCrash            | `handleEndTurn()` (thought/content 追踪), `handleDisconnect()` (`agentCrash: true` for team)                  |
| A23 | 断连/崩溃处理                         | `handleDisconnect()` — 发送 `agentCrash: true` finish, 清理 permissions/approvals/navigation                  |
| A24 | Context usage 追踪                    | `usage_update` 优先; `PromptResponse.usage` 作为 fallback                                                     |
| A25 | File operation 渲染                   | `handleFileOperation()` → 构造 tool_call 类型 TMessage (read/write)                                           |
| A26 | UI 事件发射 (status/error/permission) | `emitStatusMessage()`, `emitErrorMessage()`, `emitPermissionRequest()`, `emitMessage()`                       |
| A27 | TMessage 类型映射                     | text→content, tips→thought/error, acp_tool_call, plan                                                         |
| A28 | 能力缓存到 ProcessConfig              | cachedInitializeResult, cachedModels, cachedConfigOptions, cachedModes                                        |
| A29 | Prompt 取消 + Kill                    | `cancelPrompt()` (reject pending + finish), `kill()` (disconnect + clear all)                                 |
| A30 | 错误分类                              | auth, timeout, permission, connection, Qwen-specific 各自不同的用户提示                                       |

### 与新版 AcpAgentV2 的关系

`AcpAgentV2` (`src/process/acp/compat/AcpAgentV2.ts`, 809 行) 是 AcpAgent 的**兼容替代品**, 内部委托给 `AcpSession`。
它复制了 AcpAgent 的大部分职责 (A1-A30 中约 20 项), 但以下几项**在 V2 中缺失或弱化**:

| 旧职责                  | V2 状态                                             | 参考                                                          |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| A2 自动重连             | ❌ 缺失 (P1 open bug)                                | V2-MIGRATION-AUDIT #21                                        |
| A11 model 再确认        | ⚠️ 策略不同 (V2 成功后清 desired)                    | V2-MIGRATION-AUDIT #23                                        |
| A16 @ 文件引用          | ⚠️ 简化版 (无引号路径/去重/workspace搜索/binary警告) | V2-MIGRATION-AUDIT #22                                        |
| A22 agentCrash flag     | ❌ 缺失 (P0 open bug)                                | V2-MIGRATION-AUDIT #20                                        |
| A24 usage fallback      | ⚠️ 在 PromptExecutor 中有简化实现                    |                                                               |
| A25 file operation 渲染 | ❌ 未实现                                            | session 通过 buildProtocolHandlers 处理 fs, 但不生成 TMessage |
| A30 Qwen 错误增强       | ❌ 缺失                                              | V2-MIGRATION-AUDIT #26                                        |

---

## 4. AcpConnection [旧] — 1156 行

**文件**: `src/process/agent/acp/AcpConnection.ts`
**角色**: 旧版底层传输层。手写 NDJSON + JSON-RPC + 子进程管理一体化。

| #   | 职责                              | 说明                                                                                           |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| C1  | 子进程生成 (后端分发)             | `connect()` — switch/case 路由到 claude/codebuddy/codex/generic (13+ 后端)                     |
| C2  | ACP 协议握手                      | `initialize()` — JSON-RPC, `protocolVersion: 1`, `clientCapabilities: {fs}`                    |
| C3  | 启动失败检测                      | `Promise.race` init vs timeout (60s) vs processExit                                            |
| C4  | stderr 捕获                       | 512B head + 1536B tail 环形缓冲, 用于启动错误诊断                                              |
| C5  | NDJSON 收发 (手写)                | stdout 逐行解析 `JSON.parse`, stdin `JSON.stringify + \n`                                      |
| C6  | JSON-RPC 消息路由                 | response (by id) → resolve pending; request/notification (by method) → dispatch handler        |
| C7  | 请求 ID 管理 + pending tracking   | 自增 ID, `PendingRequest` {resolve, reject, timeout}                                           |
| C8  | Session 创建 / 恢复 / 加载        | `newSession()`, `resumeSession()`, `loadSession()` — 支持 Claude `_meta` resume                |
| C9  | Session 能力解析                  | `parseSessionCapabilities()` — configOptions, modes, models (含 iFlow `_meta.models` fallback) |
| C10 | CWD 归一化                        | `normalizeCwdForAgent()` — 绝对→相对 (大多数后端), 保持绝对 (copilot/codex)                    |
| C11 | Prompt 发送                       | `sendPrompt()` — text content array, 性能计时                                                  |
| C12 | Prompt 取消                       | `cancelPrompt()` — cancel notification + resolve all pending prompt requests with null         |
| C13 | Timeout 管理 (可暂停/恢复)        | `pauseRequestTimeout()`, `resumeRequestTimeout()`, `resetSessionPromptTimeouts()`              |
| C14 | 权限请求协商                      | `handlePermissionRequest()` — 暂停 timeout → 委托回调 → 恢复 timeout                           |
| C15 | Config option / Model / Mode 设置 | `setSessionMode()`, `setModel()`, `setConfigOption()` — 乐观缓存更新                           |
| C16 | Config option 流式更新            | 拦截 `config_option_update` 通知, 实时更新缓存                                                 |
| C17 | 文件读写 (ACP fs 委托)            | `handleReadOperation()`, `handleWriteOperation()` — resolveWorkspacePath + fs 操作             |
| C18 | 路径解析                          | `resolveWorkspacePath()` — 相对→绝对 (join workingDir)                                         |
| C19 | 认证                              | `authenticate(methodId?)`                                                                      |
| C20 | 优雅断连                          | `disconnect()` — session/close (if supported) → `isSetupComplete=false` → terminateChild       |
| C21 | 异常退出处理                      | `handleProcessExit()` — reject all pending, clear state, call onDisconnect                     |
| C22 | 首 chunk 延迟追踪                 | prompt → first `session/update` latency logging                                                |
| C23 | 启动错误消息构造                  | `buildStartupErrorMessage()` — ENOENT, exit 0 (no ACP support), config error                   |

---

## 5. AcpRuntime [新] — 290 行

**文件**: `src/process/acp/runtime/AcpRuntime.ts`
**角色**: 新版应用层会话管理器。管理多个 AcpSession 实例的生命周期。
**状态**: 已实现但**零消费者** — 无任何生产代码实例化。

| #   | 职责                         | 说明                                                                                                   |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| R1  | 多会话管理                   | `Map<convId, SessionEntry>` — 每个 conversation 一个 session                                           |
| R2  | 创建会话                     | `createConversation()` — 构建 AgentConfig, 注入 MCP, 创建 AcpSession, 调 session.start()               |
| R3  | 关闭会话                     | `closeConversation()` — session.stop() + 从 map 移除                                                   |
| R4  | MCP 注入 (team-guide + user) | team guide MCP 注入 + ProcessConfig mcp.config 过滤                                                    |
| R5  | 双通道事件路由               | `onStreamEvent` (高频 TMessage) + `onSignalEvent` (低频 SignalEvent)                                   |
| R6  | Callback 构建                | `buildCallbacks()` — 将 SessionCallbacks 翻译为 convId-tagged SignalEvent discriminated union          |
| R7  | 空闲会话回收                 | `IdleReclaimer` — 30s 轮询, 5min 超时 → `session.suspend()` (不是 kill)                                |
| R8  | 命令委托                     | sendMessage, confirmPermission, cancelPrompt, cancelAll, setModel, setMode, setConfigOption, retryAuth |
| R9  | 会话状态查询                 | `getSessionStatus(convId)`                                                                             |
| R10 | 优雅关闭                     | `shutdown()` — suspend 所有 active/prompting session, 停 IdleReclaimer, 清 map                         |
| R11 | DB 持久化 (设计但禁用)       | 13 处 `TODO(ACP Discovery)` — acp_session 表的 upsert/delete/touch/update 全部注释掉                   |

### 注意

- `IdleReclaimer` 是 **suspend** 语义 (保留 sessionId 供恢复), 而 WorkerTaskManager 是 **kill** 语义 (销毁进程 + 从列表移除)
- `buildCallbacks()` 输出新格式 `SignalEvent`, 不输出旧格式 `IResponseMessage`
- 所有 `setModel/setMode/setConfigOption` 都是 **fire-and-forget** (void), 不是 async 返回结果

---

## 6. AcpSession [新] — 392 行 + 8 个子组件 (~1200 行总计)

**文件**: `src/process/acp/session/AcpSession.ts`
**角色**: 新版核心协议会话层。7 态状态机 + 8 个职责分离的子组件。

### AcpSession 本体 (392 行)

| #   | 职责              | 说明                                                                                                                                |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S1  | 7 态状态机        | `idle` → `starting` → `active` → `prompting` → `suspended` → `resuming` → `error`                                                   |
| S2  | 状态转换校验      | `VALID_TRANSITIONS` map, `setStatus()` 校验合法性                                                                                   |
| S3  | Callback 安全包装 | `wrapCallbacks()` — try/catch (sync) + .catch() (async), 防止回调 bug 破坏状态机                                                    |
| S4  | 协议 handler 构建 | `buildProtocolHandlers()` — 绑定 `onSessionUpdate`, `onRequestPermission`, `onReadTextFile`, `onWriteTextFile`                      |
| S5  | Session 通知分发  | `handleMessage()` — mode_update → ConfigTracker, config_option_update → callback, usage_update → callback, 其他 → MessageTranslator |
| S6  | 路径遍历防护      | `assertPathAllowed(filePath)` — 校验 fs 操作路径在 cwd 或 additionalDirectories 内                                                  |
| S7  | 断连恢复入口      | `onDisconnect()` — prompting 态触发 `lifecycle.resumeFromDisconnect()`; 其他态 → suspended                                          |
| S8  | 错误状态进入      | `enterError()` — clearPending + rejectAll permissions + stop timer + 转 error 态                                                    |

### SessionLifecycle (381 行)

**文件**: `src/process/acp/session/SessionLifecycle.ts`

| #   | 职责                | 说明                                                                                                             |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| S9  | 进程生成 + 初始化   | `spawnAndInit()` → `clientFactory.create()` + `client.start()`, 记录 spawn 延迟                                  |
| S10 | Session 创建/加载   | `establishSession()` → createSession / loadSession; AUTH_REQUIRED → authPending; session_expired → fallback 新建 |
| S11 | 认证流程            | AUTH_REQUIRED 检测 → `authPending = true` → teardown → signal `auth_required` → `retryAuth()`                    |
| S12 | 重试 (指数退避)     | start/resume 各自独立重试计数 + `clearBunxCacheIfNeeded()` + 指数退避延迟                                        |
| S13 | YOLO mode 应用      | `resolveYoloModeId(backend, availableModes)` + `applyYoloMode()`                                                 |
| S14 | 配置重确认 (重连后) | `reassertConfig()` — 从 `ConfigTracker.getPendingChanges()` 取 diff, best-effort 重发 model/mode/configOptions   |
| S15 | Teardown            | `teardown()` → `client.close()` + null client                                                                    |
| S16 | bunx cache 清理     | 委托 `ProcessAcpClient.clearBunxCacheIfNeeded()`                                                                 |

### PromptExecutor (167 行)

**文件**: `src/process/acp/session/PromptExecutor.ts`

| #       | 职责                 | 说明                                                                                                               |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| S17     | Prompt 执行          | `execute(content)` → set prompting → reassertConfig → start timer → `client.prompt()` → stop timer → turn_finished |
| S18     | Pending prompt 缓冲  | `setPending()` / `flush()` — send-while-suspended 场景, resume 后自动 flush                                        |
| S19     | Prompt 超时 (可暂停) | 委托 `PromptTimer` — start/pause/resume/reset/stop, 超时 → cancel + recoverable error                              |
| S20-err | Prompt 错误处理      | AUTH_REQUIRED → buffer + auth pending; retryable → recoverable error signal; otherwise → enterError                |

### PromptTimer (71 行)

**文件**: `src/process/acp/session/PromptTimer.ts`

| #    | 职责              | 说明                                                |
| ---- | ----------------- | --------------------------------------------------- |
| S19a | 三态定时器        | `idle` / `running` / `paused`                       |
| S19b | Pause/Resume 支持 | 权限 UI 等待期间暂停, 返回后恢复 (剩余时间重新计算) |
| S19c | Reset 支持        | 每次收到 streaming 数据时重置 (proof-of-life)       |

### PermissionResolver (164 行)

**文件**: `src/process/acp/session/PermissionResolver.ts`

| #        | 职责              | 说明                                                                                     |
| -------- | ----------------- | ---------------------------------------------------------------------------------------- |
| S20      | 三层权限评估      | (1) YOLO → auto-pick `allow_*`; (2) LRU cache hit → return cached; (3) → UI promise      |
| S21      | Approval LRU 缓存 | `ApprovalCache` — 500 条上限, "always allow" 决策缓存, key = kind+title+operation fields |
| S22-perm | Pending 权限管理  | `resolve(callId, optionId)`, `rejectAll(error)`                                          |

### MessageTranslator (292 行)

**文件**: `src/process/acp/session/MessageTranslator.ts`

| #    | 职责                       | 说明                                                                                                        |
| ---- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| S22  | SDK 通知 → TMessage 翻译   | `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `user_message_chunk` |
| S23  | 消息 ID 映射 (turn-scoped) | SDK messageId → 稳定 UUID, 同一 turn 内合并, 每 turn 重置                                                   |
| S24  | 工具类型/内容/位置映射     | `mapToolKind()` (read/edit/execute), `mapToolContent()`, `mapToolLocations()`                               |
| S22a | Config update 过滤         | `CONFIG_UPDATES` set — mode/config/command/usage 类型不经过 translator                                      |

### ConfigTracker (142 行)

**文件**: `src/process/acp/session/ConfigTracker.ts`

| #    | 职责                        | 说明                                                                        |
| ---- | --------------------------- | --------------------------------------------------------------------------- |
| S25  | Desired vs Current 双层配置 | current (agent 已确认) + desired (用户意图, 未同步)                         |
| S26  | Pending changes 差异计算    | `getPendingChanges()` → `{model?, mode?, configOptions[]}` for 重连后重确认 |
| S27  | 不可变配置快照              | `modelSnapshot()`, `modeSnapshot()`, `configSnapshot()`                     |
| S25a | Session result 同步         | `syncFromSessionResult()` — 从 session 创建/加载响应批量更新 current state  |

### AuthNegotiator (79 行)

**文件**: `src/process/acp/session/AuthNegotiator.ts`

| #    | 职责                     | 说明                                                                      |
| ---- | ------------------------ | ------------------------------------------------------------------------- |
| S28  | 认证凭证管理             | credentials 存储 / 合并 / 读取                                            |
| S28a | Auth method 选择         | `selectAuthMethod()` — 遍历 `env_var` 类型方法, 匹配已存凭证              |
| S28b | 协议认证调用             | `authenticate(protocol, authMethods)` → `protocol.authenticate(methodId)` |
| S28c | AuthRequired UI 数据构造 | `buildAuthRequiredData()` for renderer 显示                               |

### InputPreprocessor (34 行)

**文件**: `src/process/acp/session/InputPreprocessor.ts`

| #    | 职责                | 说明                                                                                 |
| ---- | ------------------- | ------------------------------------------------------------------------------------ |
| S29  | 输入预处理          | text → `ContentBlock[]`, 显式文件附件 → 读内容 ContentBlock                          |
| S29a | @file 引用 (简化版) | regex `/@([\w/.~-]+\.\w+)/g` — 无引号路径、无去重、无 workspace 搜索、无 binary 警告 |

### McpConfig (86 行)

**文件**: `src/process/acp/session/McpConfig.ts`

| #    | 职责                   | 说明                                                                                           |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| S30  | MCP 配置合并           | `merge(preset + user + team)` — user 覆盖同名 preset, team 总是追加                            |
| S30a | Storage → SDK 格式转换 | `fromStorageConfig()` — 过滤 builtin+enabled+connected, 按 transport 类型映射, capability 过滤 |

---

## 7. AcpClient / ProcessAcpClient [新] — 493 行

**文件**: `src/process/acp/infra/ProcessAcpClient.ts`
**接口**: `src/process/acp/infra/IAcpClient.ts` (105 行)
**辅助**: `NdjsonTransport.ts` (72 行), `processUtils.ts` (133 行), `AcpProtocol.ts` (146 行)
**角色**: 新版底层 — 子进程生命周期 + 传输 + 协议, 基于 `@agentclientprotocol/sdk`。

| #   | 职责                  | 说明                                                                                                                               |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1  | 子进程生成            | `start()` step 1: `spawnFn()` + `waitForSpawn()`, 错误包装为 `AgentSpawnError`                                                     |
| P2  | stderr 环形缓冲       | 8KB ring buffer (`STARTUP_STDERR_MAX = 8192`)                                                                                      |
| P3  | 4-signal 生命周期检测 | `exit` / `close` / `stdout.close` / `connection.abort` — first-write-wins `recordAgentExit()`                                      |
| P4  | NDJSON 传输           | `NdjsonTransport.fromChildProcess()` — Node stream → Web stream → SDK `ndJsonStream()`                                             |
| P5  | SDK Connection 创建   | `new ClientSideConnection(handlers, stream)` — 绑定 4 个协议回调                                                                   |
| P6  | ACP initialize 握手   | `start()` step 5: `connection.initialize()` with clientInfo + protocolVersion                                                      |
| P7  | 启动失败检测 + 诊断   | `Promise.race(init, failureWatcher)` + `normalizeInitializeError()` (等待 exit event + stderr)                                     |
| P8  | 协议方法代理          | createSession, loadSession, forkSession, prompt, cancel, closeSession, setModel, setMode, setConfigOption, authenticate, extMethod |
| P9  | Pending 请求追踪      | `runConnectionRequest()` + `Set<PendingRequest>` — 断连时 reject all with `AgentDisconnectedError`                                 |
| P10 | 调试日志代理          | `loggingProxy()` — ES6 Proxy 拦截所有 SDK 调用, `console.debug` 请求/响应/错误                                                     |
| P11 | hasActivePrompt 标记  | prompt() 前设 true, 完成后 false — 用于 `AgentExitInfo.unexpectedDuringPrompt` 诊断                                                |
| P12 | 优雅关闭 (3 阶段)     | `gracefulShutdown()`: `stdin.end()` → SIGTERM (1.5s) → SIGKILL (1s) → `child.unref()`                                              |
| P13 | bunx 缓存清理         | `clearBunxCacheIfNeeded()` — 解析 stderr 中的 cache 路径, 安全路径校验后 `fs.rmSync`                                               |
| P14 | Lifecycle snapshot    | `{ pid, running, lastExit }` 只读快照                                                                                              |

### 辅助组件

| 组件                 | 文件                                       | 职责                                                                                                                   |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `NdjsonTransport`    | `src/process/acp/infra/NdjsonTransport.ts` | 3 种适配: `fromChildProcess()`, `fromByteStreams()`, `fromWebSocket()`                                                 |
| `processUtils`       | `src/process/acp/infra/processUtils.ts`    | `splitCommandLine()`, `waitForSpawn()`, `waitForExit()`, `isProcessAlive()`, `gracefulShutdown()`, `prepareCleanEnv()` |
| `AcpProtocol`        | `src/process/acp/infra/AcpProtocol.ts`     | 独立的薄协议包装 (无进程管理), 导出共享参数类型                                                                        |
| `AcpError` hierarchy | `src/process/acp/errors/AcpError.ts`       | `AgentSpawnError`, `AgentStartupError`, `AgentDisconnectedError` — 都标记 `retryable: true`                            |

---

## 职责覆盖关系速查

下表展示**旧组件职责被新组件覆盖的情况**:
- ✅ = 完全覆盖
- ⚠️ = 部分覆盖 / 弱化
- ❌ = 未覆盖 (缺失)

### AcpConnection → AcpClient (ProcessAcpClient)

| 旧                    | 新       | 状态 | 备注                         |
| --------------------- | -------- | ---- | ---------------------------- |
| C1 子进程生成         | P1       | ✅    | spawnFn 注入更灵活           |
| C2 协议握手           | P6       | ✅    | SDK-based                    |
| C3 启动失败检测       | P7       | ✅    | 4-signal 更完善              |
| C4 stderr 捕获        | P2       | ✅    | 8KB vs 2KB                   |
| C5 NDJSON 收发        | P4       | ✅    | SDK ndJsonStream vs 手写     |
| C6 JSON-RPC 路由      | P5       | ✅    | SDK 内置                     |
| C7 pending request    | P9       | ✅    | 断连自动 reject              |
| C8 session 管理       | P8 + S10 | ✅    |                              |
| C9 能力解析           | S25      | ✅    | ConfigTracker                |
| C10 CWD 归一化        | S6       | ⚠️    | assertPathAllowed 不完全等价 |
| C11 prompt 发送       | P8 + S17 | ✅    |                              |
| C12 prompt 取消       | P8 + S17 | ✅    |                              |
| C13 timeout 暂停/恢复 | S19      | ✅    | PromptTimer                  |
| C14 权限协商          | S20      | ✅    | PermissionResolver           |
| C15 config/model/mode | P8 + S25 | ✅    |                              |
| C16 config 流式更新   | S5       | ✅    | AcpSession.handleMessage     |
| C17 文件读写          | S4 + S6  | ✅    | buildProtocolHandlers        |
| C18 路径解析          | S6       | ✅    | assertPathAllowed            |
| C19 认证              | P8 + S28 | ✅    |                              |
| C20 优雅断连          | P12      | ✅    | 3 阶段                       |
| C21 异常退出          | P3       | ✅    | 4-signal first-write-wins    |
| C22 首 chunk 延迟     | —        | ❌    | 新版未追踪                   |
| C23 启动错误消息      | P7       | ⚠️    | 诊断信息格式不同             |

### AcpAgent → AcpSession + AcpAgentV2

| 旧                             | 新                 | 状态 | 备注                                             |
| ------------------------------ | ------------------ | ---- | ------------------------------------------------ |
| A1 连接生命周期                | S9 + S12           | ✅    | SessionLifecycle                                 |
| A2 自动重连                    | —                  | ❌    | **P1 open bug**, V2 抛 INVALID_STATE             |
| A3 认证流程 (multi-step)       | S11 + S28          | ⚠️    | 有协议认证, 无 CLI login                         |
| A4 CLI login 执行              | AcpAgentV2         | ✅    | 在 compat 层, 非 session 层                      |
| A5 session 创建/恢复           | S10                | ✅    |                                                  |
| A6 MCP 注入                    | R4 + S30           | ✅    |                                                  |
| A7 MCP 就绪等待                | AcpAgentV2         | ✅    | 在 compat 层                                     |
| A8 YOLO mode                   | S13                | ✅    |                                                  |
| A9 session mode                | S25 + P8           | ✅    |                                                  |
| A10 model 管理                 | S25 + P8           | ✅    |                                                  |
| A11 model 再确认               | S14                | ⚠️    | reassertConfig 只在重连时, 非每次 prompt         |
| A12 Claude model switch notice | AcpAgentV2         | ✅    | 在 compat 层                                     |
| A13 config options             | S25 + P8           | ✅    |                                                  |
| A14 prompt timeout 配置        | S19                | ✅    |                                                  |
| A15 消息发送                   | S17                | ⚠️    | 无 auto-reconnect, 无 @file 完整版               |
| A16 @ 文件引用 (完整版)        | S29                | ⚠️    | **简化版**: 无引号/去重/workspace搜索/binary警告 |
| A17 权限请求                   | S20                | ✅    |                                                  |
| A18 approval 缓存              | S21                | ✅    | LRU with key hashing                             |
| A19 权限确认                   | S22-perm           | ✅    |                                                  |
| A20 navigation 拦截            | AcpAgentV2         | ✅    | 在 compat 层                                     |
| A21 session update 分发        | S5 + S22           | ✅    |                                                  |
| A22 agentCrash flag            | —                  | ❌    | **P0 open bug**                                  |
| A23 断连/崩溃处理              | S7                 | ⚠️    | 恢复有, 但无 agentCrash 标记                     |
| A24 context usage              | S5 callback        | ✅    |                                                  |
| A25 file operation 渲染        | —                  | ❌    | 新版不生成 file op TMessage                      |
| A26 UI 事件发射                | R5 + R6            | ⚠️    | 新格式 SignalEvent, 非旧格式 IResponseMessage    |
| A27 TMessage 类型映射          | S22                | ✅    | MessageTranslator                                |
| A28 能力缓存到 ProcessConfig   | AcpAgentV2         | ✅    | 在 compat 层                                     |
| A29 prompt 取消 + kill         | S17 + S15          | ✅    |                                                  |
| A30 错误分类                   | AcpError hierarchy | ⚠️    | 结构化但无 Qwen 特定增强                         |

### AcpAgentManager → AcpRuntime

| 旧                             | 新  | 状态 | 备注                                                   |
| ------------------------------ | --- | ---- | ------------------------------------------------------ |
| M1 agent 惰性初始化            | R2  | ⚠️    | Runtime 直接 start, 无 bootstrap promise               |
| M2 bootstrap 预热抑制          | —   | ❌    |                                                        |
| M3 消息发送入口                | R8  | ⚠️    | 纯委托, 无业务逻辑                                     |
| M4 用户消息预持久化            | —   | ❌    |                                                        |
| M5 首消息技能/预设注入         | —   | ❌    |                                                        |
| M6 turn 追踪 + finish 兜底     | —   | ❌    |                                                        |
| M7 流式文本 DB 缓冲            | —   | ❌    |                                                        |
| M8 stream 事件处理管线         | R5  | ⚠️    | 只有 hook, 无处理管线                                  |
| M9 agent 状态噪音过滤          | —   | ❌    |                                                        |
| M10 thinking 消息累积          | —   | ❌    |                                                        |
| M11 `<think>` 标签提取         | —   | ❌    |                                                        |
| M12 signal 事件处理            | R6  | ⚠️    | 翻译为 SignalEvent, 无业务分发                         |
| M13 权限管理 (manager 层)      | —   | ❌    | yolo/team auto-approve 在 Session 层; channel 通知缺失 |
| M14 三路事件总线广播           | —   | ❌    |                                                        |
| M15 request_trace 事件         | —   | ❌    |                                                        |
| M16 cron 集成                  | —   | ❌    |                                                        |
| M17 finish 处理                | —   | ❌    |                                                        |
| M18 TurnCompletionService      | —   | ❌    |                                                        |
| M19 per-conversation DB 持久化 | R11 | ❌    | 设计了但全部注释掉                                     |
| M20 model list 缓存            | —   | ❌    |                                                        |
| M21 后端特定 mode 拦截         | —   | ❌    |                                                        |
| M22 codex sandbox mode         | —   | ❌    |                                                        |
| M23 stop                       | R8  | ✅    |                                                        |
| M24 kill                       | R3  | ⚠️    | close vs kill 语义不同                                 |
| M25 slash commands 管理        | —   | ❌    |                                                        |
| M26 preview open 事件          | —   | ❌    |                                                        |

### WorkerTaskManager → AcpRuntime

| 旧                  | 新  | 状态 | 备注                               |
| ------------------- | --- | ---- | ---------------------------------- |
| W1 任务注册         | R1  | ⚠️    | Map vs Array, 无 type 字段         |
| W2 惰性构建 from DB | —   | ❌    | AcpRuntime 不读 DB                 |
| W3 多类型工厂分发   | —   | ❌    | AcpRuntime 只管 ACP                |
| W4 任务替换/去重    | —   | ❌    |                                    |
| W5 单任务 kill      | R3  | ⚠️    | close (stop+remove) vs kill        |
| W6 全量清理         | R10 | ⚠️    | shutdown (suspend) vs clear (kill) |
| W7 空闲回收         | R7  | ⚠️    | suspend vs kill, 不同语义          |
| W8 任务枚举         | —   | ❌    | 无 listTasks()                     |

---

## 附: 关键结论

1. **AcpRuntime 的实际完成度约 20%** — 会话管理骨架完成, 但所有业务逻辑 (M1-M26) 和持久化 (R11) 缺失
2. **WorkerTaskManager 不可被 AcpRuntime 替代** — 它管理 6 种 agent 类型, AcpRuntime 只管 ACP
3. **AcpAgentManager 的 1635 行中, ~1200 行是 AcpRuntime 不覆盖的业务逻辑**, 需要一个新的归宿
4. **AcpAgentV2 中仍有 ~10 项独有能力** (CLI login, 能力缓存, tool call merging, promise bridging, Claude 特殊逻辑等) 需要迁移
5. **3 个 P0/P1 open bug** (agentCrash, auto-reconnect, @file) 无论走哪条路都需要修复
