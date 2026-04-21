# ACP 架构 v3 — 基于三条判定原则的分层

> 基于 phase2 [review-questions.md](review-questions.md) 里发现的边界模糊点
> 与 phase2 [architecture-layering-proposal.md](../phase2/architecture-layering-proposal.md) 的差异: 明确 Agent 层收窄、职责用原则推导而非枚举
> 日期: 2026-04-21

---

## 判定原则

遇到 "这个东西放哪层" 的问题, 按序套用:

1. **对谁有意义**
   - 只对 "子进程 + 字节流" 有意义 → Transport
   - 只对 "一个 ACP session 协议状态" 有意义 → Agent
   - 只对 "一次产品会话" 有意义 (涉及 DB/UI/Team/Cron/首消息) → Conversation

2. **依赖谁**
   - 依赖 `TMessage` / `ConversationId` / 产品业务语义 (`aionui-team`, `[[AION_FILES]]`) → 不能在 Agent
   - 依赖 SDK 原生类型 → 可以在 Agent
   - 依赖 `ChildProcess` / stderr / 字节流 → 只能在 Transport

3. **出错后谁恢复**
   - 进程崩 → Transport 感知, Agent 决定重连, Conversation 决定通知用户
   - 认证过期 → Agent 感知, Conversation 决定弹框
   - 文件读不到 → Conversation 决定

**Agent 层的试金石**: 能不能被替换成任何 ACP backend 测试工具? 让它不能被替换的东西都要移走。

---

## 架构图

### 主干: 三层

```
┌──────────────────────────────────────────────────────────────┐
│ Conversation — AcpRuntime (新, 替代 AcpAgentManager)         │
│                                                              │
│ 一句话: 把"一个 session"变成"一次产品会话"                   │
│                                                              │
│ 持有:                                                        │
│   AcpSession                                                 │
│   InputPipeline       — 变换 (@file, 首消息注入)             │
│   OutputPipeline      — 变换 (SDK→TMessage, think, toolMerge)│
│   TurnTracker         — 编排 (15s 兜底)                      │
│   BackendPolicy       — 策略 (per-backend 特殊行为)          │
│   PermissionPolicy    — 策略 (YOLO 动态, team MCP 自动批准)  │
│   UserMessagePersister — 副作用 (预写 DB + emit IPC)         │
│                                                              │
│ 出口:                                                        │
│   → EventDispatcher (Phase 3 引入) / 直接调用 (Phase 2 过渡) │
│   → Bridge/Team/Channel/Cron/DB 订阅者                       │
│                                                              │
│ 实现 IAgentManager, 与 Gemini/xxx/AgentManager               │
│ 等同级                                                       │
└────────────────────┬─────────────────────────────────────────┘
                     │ sendPrompt(PromptContent) / cancel / setModel / setMode / setConfigOption
                     │                        ↑
                     │             两个出口 callback:
                     │             onNotification(SessionNotification)
                     │             onLifecycle(Signal)
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Agent — AcpSession (收窄, 保留)                              │
│                                                              │
│ 一句话: 维护一个 ACP session 的协议状态                      │
│                                                              │
│ 持有:                                                        │
│   SessionLifecycle    — create/load/retry/auth               │
│   ConfigTracker       — desired vs current (跨重连存活)      │
│   PromptExecutor      — 发 prompt + 超时 + pending           │
│   AuthNegotiator      — 凭证跨 retry 保持                    │
│   PermissionResolver  — 协议级 L2 LRU cache + L3 UI 委托     │
│                         (L1 静态 YOLO 删除, 策略由上层决定)  │
│                                                              │
│ 状态机: idle | running | ready | error (3 态, 降自 7 态)     │
│                                                              │
│ 不持有 / 已移出:                                             │
│   InputPreprocessor  → InputPipeline                         │
│   MessageTranslator  → OutputPipeline                        │
│   静态 YOLO 标志      → PermissionPolicy                     │
│   onMessage(TMessage) → onNotification(SessionNotification)  │
└────────────────────┬─────────────────────────────────────────┘
                     │ client.prompt / cancel / setModel /
                     │ initialize / newSession / loadSession
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Transport — ProcessAcpClient (纯净化)                        │
│                                                              │
│ 一句话: 让一个 agent 进程说 ACP 协议                         │
│                                                              │
│ 职责:                                                        │
│   spawn 进程 / graceful 3-phase shutdown                     │
│   NDJSON ↔ SDK ClientSideConnection                          │
│   ACP initialize 握手                                        │
│   4-signal 生命周期检测 → DisconnectInfo                     │
│   SDK method pass-through (prompt/cancel/setModel/...)       │
│   pending request tracking + 断连 reject                     │
│   stderr 8KB 环形缓冲 (对外暴露 getStderr)                   │
│   SDK logging proxy (可观测性)                               │
│                                                              │
│ 不持有 / 已移出:                                             │
│   clearBunxCacheIfNeeded  → Agent 层 retry 路径              │
└──────────────────────────────────────────────────────────────┘
```

### 外围: Registry + Bridge + Event

```
┌──────────────────────────────────────────────────────────────┐
│ Bridge (Interface Adapter)                                   │
│   IPC 翻译, 不做业务决策                                      │
│   renderer ← IResponseMessage ← Bridge Adapter ← EventDispatch│
└────────────────────┬─────────────────────────────────────────┘
                     │ 接口方法 (无 instanceof)
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Registry — WorkerTaskManager                                 │
│   Map<convId, IAgentManager>                                 │
│   idle kill + rebuild (不需要 suspend 语义)                  │
└────────────────────┬─────────────────────────────────────────┘
                     │ AgentFactory.register('acp', ...)
                     ▼
              AcpRuntime (上面的 Conversation 层)

┌──────────────────────────────────────────────────────────────┐
│ EventDispatcher (Phase 3 引入)                               │
│                                                              │
│ 内部消费者 (Composition Root 启动时显式注册):                │
│   BridgeAdapter         — TMessage → IResponseMessage        │
│   TeamConsumer          — team fan-out                       │
│   ChannelConsumer       — channel bot                        │
│   CronConsumer          — cron busy guard                    │
│   PersistenceSubscriber — agent message → DB                 │
│                                                              │
│ Waterfall:                                                   │
│   agent:configuring — MCP 注入 (team / preset)               │
│                                                              │
│ 外部 hooks (未来):                                           │
│   → Hook Runtime (Layer 2)                                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 关键边界决定

### 决定 1 — Agent 出口只发 SDK 原生数据

**旧**: 8 种 callback (`onMessage` TMessage / `onConfigUpdate` / `onModelUpdate` / `onModeUpdate` / `onContextUsage` / `onPermissionRequest` / `onStatusChange` / `onSignal`)
**新**: 2 种 callback

```ts
type SessionCallbacks = {
  onNotification: (n: SessionNotification) => void; // 原生 SDK 数据, Pipeline 负责翻译
  onLifecycle: (signal: LifecycleSignal) => void; // 状态/错误/认证
};

type LifecycleSignal =
  | { type: 'status_change'; status: 'idle' | 'running' | 'ready' | 'error' }
  | { type: 'session_established'; sessionId: string }
  | { type: 'auth_required'; auth: AuthRequiredData }
  | { type: 'session_expired' }
  | { type: 'process_crash'; exitCode: number | null; signal: string | null }
  | { type: 'error'; message: string; recoverable: boolean };
```

**为什么**: 避免 Session 层既懂协议又懂产品类型, 彻底解决 Q-B (翻译权威层)。

**影响**: OutputPipeline 变成唯一翻译点, 不再有"Session 先吃一半"的不对称。ConfigTracker 里的 current model/mode 仍然留在 Session (那是协议状态), 但**不**通过专门 callback 外发; Conversation 自己从 SessionNotification 流里认出 `current_mode_update` 等, 然后查 Session.configSnapshot() 读快照。

### 决定 2 — Agent sendPrompt 只接受 PromptContent

**旧**: `sendMessage(text: string, files?: string[])` 内部走 InputPreprocessor
**新**: `sendPrompt(content: PromptContent)` — ContentBlock[] 已经是 SDK 原生

**为什么**: @file / `[[AION_FILES]]` / workspace 搜索都是产品约定, 彻底解决 Q-A (输入预处理权威层)。

**影响**: AcpSession 不再持有 InputPreprocessor; session/ 目录下的 InputPreprocessor.ts 删除 (Phase 2.1); 运行时只有 runtime/InputPipeline 一份实现。

### 决定 3 — YOLO 策略上移到 Conversation

**旧**: PermissionResolver 构造时固化 `autoApproveAll: agentConfig.yoloMode`, 静态
**新**: PermissionResolver 只做 L2 (LRU cache) + L3 (UI 委托); L1 auto-approve 由 Conversation 传入一个 `preApprove(request) → optionId | null` 决策函数

```ts
interface PermissionResolverConfig {
  cacheMaxSize?: number;
  preApprove?: (req: PermissionRequest) => string | null; // ← 由 Conversation 注入
}
```

**为什么**: 彻底解决 Q-C (静态 YOLO 吃掉 team MCP 规则的 bug); YOLO 可以动态切换, team MCP 自动批准不会被 YOLO 吞。

**影响**: Conversation 的 PermissionPolicy 把 "YOLO + team MCP" 合并为一个 preApprove 函数注入给 Session; Session 不再知道 `agentConfig.yoloMode` 的存在。

### 决定 4 — 状态机 3 态化

**旧**: 7 态 `idle | starting | active | prompting | suspended | resuming | error`
**新**: 3 态 `idle | running | ready | error`

| 旧        | 新                               | 说明                   |
| --------- | -------------------------------- | ---------------------- |
| idle      | idle                             | 未 start               |
| starting  | running (内部 `connecting=true`) | 正在建立连接           |
| active    | ready                            | 可发 prompt            |
| prompting | running (内部 `executing=true`)  | 在执行                 |
| resuming  | running (内部 `connecting=true`) | 重连中                 |
| suspended | **删除**                         | 用 kill + rebuild 替代 |
| error     | error                            |                        |

**为什么**: suspend/resume 的价值 (精确恢复) 已被 config 持久化 + kill+rebuild 替代; 状态机简化后, Conversation 只需知道 "能不能发 prompt" (status === 'ready'), 不需要懂 7 态语义。

**影响**: `AcpSession.suspend()` / `resume()` 方法移除; `AcpRuntime.shutdown()` 不再调 suspend; SessionLifecycle 的 resuming/resumeFromDisconnect 路径内部仍存在, 但不对外暴露状态。

### 决定 5 — bunx cache 启发式下沉到 Agent

**旧**: ProcessAcpClient.clearBunxCacheIfNeeded (检查自己的 stderr 然后删目录); SessionLifecycle 通过 `instanceof ProcessAcpClient` 穿透调用
**新**: Transport 只暴露 `getStderr(): string`; 启发式判定和 cache 清理在 Agent 层的 retry 路径

**为什么**: Transport 应该只传输, 不做错误恢复决策; `instanceof` 穿透说明抽象漏了。

**影响**: ProcessAcpClient 瘦身; AcpClient 接口加 `readonly stderr: string`。

---

## 数据流 — 一个完整的 turn

```
用户点发送 (text + files[])
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ AcpRuntime.sendMessage(text, files)                     │
│                                                         │
│  1. UserMessagePersister.persist({text, msgId, convId}) │
│     └─→ DB write + IPC emit (UI 立即可见)               │
│                                                         │
│  2. content = InputPipeline.process(text, files,        │
│                                      injectionCtx)      │
│     ├─ [[AION_FILES]] 剥离                              │
│     ├─ 首消息注入 (preset/skills/teamGuide)             │
│     └─ @file 解析 → PromptContent (ContentBlock[])      │
│                                                         │
│  3. content = backendPolicy.beforePrompt(content)       │
│     └─ Claude: prepend <system-reminder> (如有)         │
│                                                         │
│  4. turnTracker.beginTurn()                             │
│                                                         │
│  5. session.sendPrompt(content)                         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ AcpSession.sendPrompt(content)                          │
│                                                         │
│  state: ready → running                                 │
│  promptExecutor.execute(content)                        │
│    └─→ client.prompt(sessionId, content)                │
│                                                         │
│  监听 onSessionUpdate 回调 (来自 Transport)             │
│    └─→ host.callbacks.onNotification(notification)      │
└────────────────────────┬────────────────────────────────┘
                         │ onNotification(SessionNotification)
                         ▼
┌─────────────────────────────────────────────────────────┐
│ AcpRuntime.handleNotification(notification)             │
│                                                         │
│  1. turnTracker.onActivity()                            │
│                                                         │
│  2. messages = OutputPipeline.process(notification)     │
│     ├─ MessageTranslator: SDK → TMessage                │
│     ├─ ThinkTagFilter: 提取 <think>                     │
│     └─ ToolCallMerger: deep merge tool_call_update      │
│                                                         │
│  3. for msg of messages:                                │
│       dispatcher.emit('agent:stream', msg) (Phase 3)    │
│       或直接调 bridgeAdapter.onStream(msg) (Phase 2)    │
└─────────────────────────────────────────────────────────┘

Turn 结束 (finish 或 15s 兜底):
                         ▼
┌─────────────────────────────────────────────────────────┐
│ AcpRuntime.handleFinish / TurnTracker.onFallback        │
│                                                         │
│  turnTracker.markFinished(turnId)                       │
│  outputPipeline.onTurnEnd()                             │
│  dispatcher.emit('agent:finish', ...)                   │
│  dispatcher.emit('turn:completed', ...)                 │
└─────────────────────────────────────────────────────────┘
```

---

## 与 phase2 proposal 的差异

| 话题                   | phase2                                | phase3 (v3)                                                 |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------- |
| Agent 出口             | 8 个 callback (含 TMessage)           | 2 个 callback (onNotification + onLifecycle)                |
| Agent sendMessage 参数 | (text, files)                         | (PromptContent)                                             |
| @file 解析             | 两处共存 (session + runtime)          | 只在 runtime/InputPipeline                                  |
| SDK 翻译               | Session 先吃一半, Pipeline 再翻译其余 | 只在 runtime/OutputPipeline                                 |
| YOLO 策略              | Session 静态 + Runtime 动态 (两层判)  | 只在 Runtime/PermissionPolicy, 通过 preApprove 注入 Session |
| 状态机                 | 7 态                                  | 3 态                                                        |
| bunx cache             | Transport 里 + instanceof 穿透        | Agent 通过 stderr 读取决定                                  |
| Agent 层存在性         | 提案里但职责含糊                      | 明确"协议状态 = Session"、"产品会话 = Runtime"              |

---

## 验证: 三条判定原则对每个子组件

| 组件                           | 原则 1 对谁有意义           | 原则 2 依赖谁                       | 原则 3 出错谁恢复           | → 层             |
| ------------------------------ | --------------------------- | ----------------------------------- | --------------------------- | ---------------- |
| ProcessAcpClient.spawnFn       | 子进程                      | ChildProcess                        | Transport 感知后上报        | **Transport**    |
| NdjsonTransport                | 字节流                      | stream                              | Transport                   | **Transport**    |
| 4-signal detection             | 进程                        | ChildProcess event                  | Transport                   | **Transport**    |
| SessionLifecycle               | ACP session                 | SDK `newSession`/`loadSession`      | Agent (retry/reauth)        | **Agent**        |
| ConfigTracker                  | ACP session 配置状态        | SDK model/mode 类型                 | Agent (reassert 跨重连)     | **Agent**        |
| PromptExecutor                 | ACP session prompt 状态     | SDK prompt/cancel                   | Agent (pending 缓存)        | **Agent**        |
| AuthNegotiator                 | ACP session 认证协商        | SDK AuthMethod                      | Agent (凭证跨 retry)        | **Agent**        |
| PermissionResolver L2/L3       | ACP permission request 协议 | SDK RequestPermission               | Agent (cache)               | **Agent**        |
| InputPipeline                  | 产品输入约定                | `[[AION_FILES]]` + workspace 路径   | Conversation (失败提示用户) | **Conversation** |
| OutputPipeline                 | 产品消息展示                | TMessage                            | Conversation                | **Conversation** |
| TurnTracker                    | 产品 turn 概念 (15s 体验)   | 时间                                | Conversation                | **Conversation** |
| BackendPolicy                  | 产品级后端差异              | BackendId 字符串                    | Conversation                | **Conversation** |
| PermissionPolicy (YOLO + team) | 产品权限策略                | `aionui-team` / `yoloMode` 用户设置 | Conversation                | **Conversation** |
| UserMessagePersister           | 产品持久化                  | DB + IPC                            | Conversation                | **Conversation** |

每一行用原则都能对上, 没有"两层都可以"的情况 — 这说明分层成立。

---

## 待决问题 (不在本文档内定)

- **Q-D BackendPolicy 方法的消费点**: `enhanceErrorMessage` / `getLoginCommand` 具体在哪层调? 建议: Policy 对象只被 Conversation 持有, 需要 enhance 的错误信号由 Conversation 在转发给 dispatcher 前调用; Bridge 不直接访问 Policy
- **Q-F TurnTracker 合成 finish 的出口形态**: 是构造假 SessionNotification 走一遍 Pipeline, 还是直接构造 TMessage? 建议后者 — 合成是 Runtime 的事, 不走翻译
- **Q-G Pipeline 失败的回滚**: UserMessagePersister 预写后 InputPipeline 失败 / sendPrompt INVALID_STATE — 需要定义补偿动作 (emit error 消息? 还是删 DB 记录?)
- **Q-2 setModel/setMode Promise 桥接**: 方案 A (Session 返 Promise) vs 方案 B (Runtime pending map) — 下一步必须拍板
