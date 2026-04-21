# ACP 架构分层提案 (v2)

> 基于 [component-responsibility-audit.md](component-responsibility-audit.md) 的 12 类职责分析
> 参考 [internal-event-bus-and-hook-system.md](../design/internal-event-bus-and-hook-system.md) RFC
> v1: 2026-04-19 (6 层 + 跨层关注点, 已归档到 git history)
> v2: 2026-04-19 (4 层, 从核心抽象推导)
> v2.1: 2026-04-20 (统一状态机 3 态, 移除 suspend/IdleReclaimer, config 持久化)
> 详见 [unified-state-machine.md](unified-state-machine.md)

---

## 设计过程

### v1 的问题

v1 先定了 6 层 (Transport → Session → Runtime → Service → Registry → Interface),
然后试图把 12 类职责塞进去。遇到塞不进的就加机制 (pipeline, event bus, waterfall)。
这是拿着锤子找钉子。

引入 Event Bus RFC 后又走向另一个极端: 把一切 event 化,
Service 层变成"薄 emitter", 结果层本身失去了存在的意义。

v2 的方法: 先看清核心抽象和通信模式, 让架构从问题本身长出来。

### 四种通信模式

系统里有四种不同的通信模式, 每种需要不同机制:

| 模式         | 特征                                 | 例子                                     | 正确机制              |
| ------------ | ------------------------------------ | ---------------------------------------- | --------------------- |
| **通知**     | 一对多, 消费者独立, 不阻塞           | agent:finish → Team/Channel/Cron/Bridge  | Event Dispatch        |
| **变换**     | 顺序的, 必须完成, 修改数据           | @file 处理 → 首消息注入 → 发送           | Pipeline (显式调用链) |
| **协作**     | 多方贡献, 追加式修改                 | 会话创建时注入 MCP servers               | Waterfall             |
| **状态编排** | 跨多个事件维护状态, 有条件的主动行为 | Turn tracking (15s 兜底), Bootstrap 抑制 | 对象内聚              |

强行用一种模式统一, 要么牺牲可调试性 (全 event), 要么牺牲可扩展性 (全 pipeline)。

### AcpRuntime 为什么不该是独立层

AcpRuntime 做三件事: session 注册表, MCP 注入, idle 回收。

但 WorkerTaskManager 已经是注册表 (`{convId → IAgentManager}`)。
AcpRuntime 又建了一个 (`{convId → SessionEntry}`)。两个 map 管同一批东西。

- Session 注册表 → Registry 已经做了
- MCP 注入 → 会话构造阶段的配置, 属于 Conversation 或 Waterfall hook
- Idle 回收 → Registry 已有轮询, 加 suspend 语义即可

AcpRuntime 的思想是对的 (会话管理、事件路由、idle 回收),
但它的价值应该被吸收到其他层, 而不是保留为 pass-through。

---

## 架构总览

### 四个核心抽象 → 四个层

```
┌─────────────────────────────────────────────────────────────────┐
│  Registry (WorkerTaskManager)                                   │
│                                                                 │
│  职责: 多类型会话的注册、查找、销毁、idle 回收                  │
│  持有: Map<convId, Conversation>                                │
│  不关心: 会话内部怎么工作                                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 创建/查找/销毁
┌──────────────────────────────▼──────────────────────────────────┐
│  Conversation (新, 替代 AcpAgentManager)                        │
│                                                                 │
│  职责: 一个会话的全部业务逻辑                                   │
│  持有: Agent 实例 + InputPipeline + OutputPipeline              │
│        + TurnTracker + BackendPolicy + EventDispatcher          │
│  知道: 怎么预处理、怎么后处理、怎么追踪 turn、怎么分发事件      │
│  不知道: 协议细节、进程管理                                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ sendPrompt/cancel/setModel...
┌──────────────────────────────▼──────────────────────────────────┐
│  Agent (AcpSession + 子组件)                                    │
│                                                                 │
│  职责: 协议状态机 — FSM、认证、权限评估、配置追踪、消息翻译     │
│  不知道: DB、IPC、Team、Cron 的存在                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ client.prompt/cancel/setModel...
┌──────────────────────────────▼──────────────────────────────────┐
│  Transport (ProcessAcpClient)                                   │
│                                                                 │
│  职责: 子进程生命周期、NDJSON 传输、SDK 协议方法                │
│  不知道: Session 语义                                           │
└─────────────────────────────────────────────────────────────────┘
```

加上外围:

```
                 ┌──────────────────────────────┐
                 │   Bridge (Interface Adapter) │
                 │   IPC 翻译 + 格式适配        │
                 └──────────────┬───────────────┘
                                │
                 ┌──────────────▼───────────────┐
                 │        Registry              │
                 └──────────────┬───────────────┘
                                │
     ┌──────────────────────────▼───────────────────────────┐
     │                    Conversation                      │
     │                                                      │
     │  ┌──────────┐  ┌──────────┐  ┌───────────────────┐   │
     │  │ Input    │→ │ Agent    │→ │ Output            │   │
     │  │ Pipeline │  │ (Session)│  │ Pipeline          │   │
     │  └──────────┘  └──────────┘  └────────┬──────────┘   │
     │                                       │              │
     │  ┌──────────────┐  ┌──────────────┐   │              │
     │  │ TurnTracker  │  │BackendPolicy │   │              │
     │  └──────────────┘  └──────────────┘   │              │
     └───────────────────────────────────────┼──────────────┘
                                             │
                          ┌──────────────────▼───────────────────┐
                          │         EventDispatcher              │
                          │                                      │
                          │  内部消费者 (显式, 已知):            │
                          │    Bridge Adapter                    │
                          │    TeamConsumer                      │
                          │    ChannelConsumer                   │
                          │    CronConsumer                      │
                          │    PersistenceSubscriber             │
                          │    ObservabilityCollector            │
                          │                                      │
                          │  Extension hooks (动态, 沙箱):       │
                          │    → Hook Runtime (Layer 2, 未来)    │
                          └──────────────────────────────────────┘
```

---

## 各层详细设计

### Transport 层 — 已完成, 无需改动

`ProcessAcpClient` (493 行) + `NdjsonTransport` + `processUtils`

| 职责                                         | 组件                            |
| -------------------------------------------- | ------------------------------- |
| 子进程 spawn + 3 阶段 graceful shutdown      | ProcessAcpClient                |
| NDJSON 传输 (Node stream → Web stream → SDK) | NdjsonTransport                 |
| ACP initialize 握手                          | ProcessAcpClient.start()        |
| 4-signal 生命周期检测 (first-write-wins)     | ProcessAcpClient                |
| Pending request 追踪 + 断连 reject           | ProcessAcpClient                |
| stderr 8KB 环形缓冲                          | ProcessAcpClient                |
| SDK 调用日志 (ES6 Proxy)                     | ProcessAcpClient.loggingProxy() |

### Agent 层 — 已完成, 需修复 3 个 bug + 状态机改造

`AcpSession` (392 行) + 8 个子组件 (~800 行)

| 职责                                      | 组件                                        |
| ----------------------------------------- | ------------------------------------------- |
| 4 态外部状态机 (idle/running/ready/error) | AcpSession                                  |
| Session CRUD + 重试/退避                  | SessionLifecycle (内部管 `connecting` 标志) |
| 认证 (协议级, credential 管理)            | AuthNegotiator                              |
| Prompt 执行 + 超时 (可暂停)               | PromptExecutor (内部管 `executing` 标志)    |
| 权限三层评估 (YOLO/LRU/UI)                | PermissionResolver + ApprovalCache          |
| SDK → TMessage 翻译                       | MessageTranslator                           |
| Desired vs Current 配置追踪               | ConfigTracker (纯内存, 上层负责落盘)        |
| 输入预处理 (@file 简化版)                 | InputPreprocessor                           |
| MCP 配置合并 + transport 过滤             | McpConfig                                   |

状态机改造 (详见 [unified-state-machine.md](unified-state-machine.md)):

- 旧 7 态 (`idle|starting|active|prompting|suspended|resuming|error`) → 4 态 (`idle|running|ready|error`)
- `starting`/`resuming` 下沉为 SessionLifecycle 内部 `connecting` 标志
- `prompting` 对应外部 `running`（Runtime 需要知道 agent 是否在忙）
- `suspended` 移除 — desired/current 落盘后, kill + rebuild 等效于 resume
- `suspend()`/`resume()` 方法移除, `stop()` 回到 idle 即可

待修复:

- P0: agentCrash flag — disconnect 时需标记, team 崩溃检测依赖此
- P1: auto-reconnect — sendMessage 时断连应自动恢复
- P1: @file 引用 — 需增强为完整版 (引号路径/去重/workspace 搜索/binary 警告)

### Conversation 层 — 新建, 核心工作量

替代 AcpAgentManager (1635 行)。不是一个大类, 而是一个主类 + 若干内部组件。

#### 主类: AcpConversation

实现 `IAgentManager` 接口, 注册到 WorkerTaskManager 的 AgentFactory。

```
AcpConversation
│
│  构造时注入: Agent, InputPipeline, OutputPipeline,
│              TurnTracker, BackendPolicy, EventDispatcher
│
│  sendMessage(text, files):
│    1. dispatcher.emit('turn:started')                    — 通知 (fan-out)
│    2. processed = inputPipeline.process(text, files)     — 变换 (pipeline)
│    3. agent.sendMessage(processed)                       — 委托
│    (agent 回调触发 handleAgentStream/handleAgentFinish)
│
│  handleAgentStream(msg):
│    1. transformed = outputPipeline.process(msg)          — 变换 (pipeline)
│    2. turnTracker.onActivity()                           — 状态编排
│    3. dispatcher.emit('agent:stream', transformed)       — 通知 (fan-out)
│
│  handleAgentFinish(msg):
│    1. transformed = outputPipeline.processFinish(msg)    — 变换
│    2. turnTracker.markFinished()                         — 状态编排
│    3. dispatcher.emit('agent:finish', transformed)       — 通知
│    4. dispatcher.emit('turn:completed')                  — 通知
│
│  stop(): agent.cancelPrompt()
│  kill(): flush → agent.stop() → cleanup
│  setModel(id): backendPolicy.interceptSetModel(id, agent)
│  setMode(id): backendPolicy.interceptSetMode(id, agent)
│  confirm(callId, optionId): agent.confirmPermission(callId, optionId)
```

这个类大约 200-250 行。它做编排, 但编排逻辑是显式的、可读的、可调试的。
读 sendMessage() 从头到尾就能理解完整流程, 不需要搜索事件订阅者。

#### InputPipeline — 变换模式

```
InputPipeline
│  process(text, files) → ProcessedInput
│
│  stages (顺序执行, 每个 stage 可修改 input):
│    1. UserMessagePersister — 预写 DB + 预 emit IPC, UI 立即可见
│    2. FileRefProcessor — 解析 @path, workspace 搜索, 去重, 读内容, 拼接
│    3. FirstMessageInjector — 检测首消息, 注入 presetContext + skillsIndex + teamGuide
│    4. [未来] ExtensionContextAppender — 收集 Extension 贡献的 additionalContext, 追加 (不替换)
```

为什么是 Pipeline 不是 Waterfall event:

- 这些步骤**必须执行、必须按序、必须在发送前完成**
- @file 处理依赖 FileRefProcessor 的结果, FirstMessageInjector 依赖前面的处理
- 如果某步失败, 整个发送应该失败, 不是"其他订阅者继续"
- 用 event 你得靠 priority 排序保证顺序, 等于用更复杂的方式重新发明 pipeline

ExtensionContextAppender 是唯一面向外部的点:
它收集 Extension 贡献的 additionalContext (追加), 但**不允许替换 prompt 内容**
(RFC §8 安全红线: "beforeSend hook 替换用户原始消息内容 — prompt injection 入口")。

#### OutputPipeline — 变换模式

```
OutputPipeline
│  process(msg) → TransformedMessage
│
│  stages (顺序执行, 每个 stage 可修改 message):
│    1. ThinkTagFilter — 提取 <think> 标签, 转为 thinking 类型 (~15 行)
│    2. StatusFilter — 首消息后抑制非关键 agent_status; bootstrap 预热抑制 (~20 行)
│    3. ToolCallMerger — 深合并 tool_call_update (保留 title/kind/rawInput) (~40 行)
```

为什么是 Pipeline 不是 Event subscriber:

- ThinkTagFilter 修改消息内容, 下游所有消费者 (Persistence, Bridge, Team) 必须看到修改后的版本
- 如果 ThinkTagFilter 是 agent:stream 的订阅者, 它改了 payload, 其他并行订阅者看到的是改前还是改后?
- Event Bus 的 emit 是并行的, 不保证变换在分发前完成
- Pipeline 保证: 变换先完成, 然后用变换后的结果做 fan-out

#### TurnTracker — 状态编排模式

```
TurnTracker
│  状态: activeTrackedTurnId, fallbackTimer
│
│  onSendMessage(turnId):
│    activeTrackedTurnId = turnId
│    启动 15s 定时器
│
│  onActivity():
│    重置定时器 (proof-of-life)
│
│  markFinished():
│    清除定时器
│    activeTrackedTurnId = null
│
│  onTimeout():
│    合成 finish 信号 → dispatcher.emit('agent:finish', syntheticFinish)
│    这是 agentCrash 检测的兜底: 如果 agent 崩溃且没发 finish, 15s 后补一个
```

为什么是对象内聚不是事件订阅者:

- 它需要跨多个事件 (start, activity, finish, timeout) 维护连贯状态
- 它的行为是主动的 (定时器触发), 不是被动反应
- 作为订阅者, 它的状态管理会变得隐式且难测试

#### BackendPolicy — 策略模式

```
BackendPolicy (per-backend, 封装后端特殊行为)
│
│  ACP 后端有 13+ 种, 各自有怪癖:
│
│  interceptSetMode(modeId, agent):
│    Codex/Snow 不支持 session/set_mode → 本地拦截, 不发 RPC
│
│  interceptSetModel(modelId, agent):
│    Claude cc-switch → model slot 映射
│    非 Claude → 直接 set_model
│
│  getModelSwitchNotice(oldModel, newModel):
│    Claude → 返回 <system-reminder> 告知 AI 身份变更
│    其他 → null
│
│  enhanceError(error):
│    Qwen → "Internal error" → 可操作的用户提示
│    其他 → 原样返回
│
│  getCLILoginCommand():
│    Claude → "claude /login"
│    Qwen → "qwen login"
│    其他 → null (不需要 CLI login)
│
│  getSandboxConfig():
│    Codex → 返回 sandbox 配置
│    其他 → null
│
│  shouldReassertModelBeforePrompt():
│    Claude → true (防止 compaction 导致 model 漂移)
│    其他 → false
```

为什么单独抽出来:

- 这些逻辑目前散落在 AcpAgent (A10-A12, A21, A30) 和 AcpAgentManager (M21-M22) 里
- 每加一个新后端, 不用改 Conversation/Agent, 只加一个 Policy
- 可以独立测试每个后端的特殊行为

### Registry 层 — 已有, 小幅修改

WorkerTaskManager (123 行) + AgentFactory

| 修改项                  | 说明                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| 注册新 factory          | `agentFactory.register('acp', () => new AcpConversation(...))`                    |
| idle 回收保持 kill 语义 | 不需要 suspend — desired/current 落盘后 kill + rebuild 等效于 resume              |
| cronBusyGuard 保留      | 保护正在执行定时任务的 session 不被 idle kill                                     |
| 超时动态配置保留        | `ProcessConfig.get('acp.agentIdleTimeout')` 动态读取                              |
| IdleReclaimer 移除      | 其价值 (精确恢复) 已被 config 持久化替代, WTM 的 kill + rebuild 更优 (无内存泄漏) |
| IAgentManager 接口检查  | Bridge 层的 `instanceof AcpAgentManager` → 改为接口方法 (如 `isConfigurable()`)   |

### Bridge 层 — 已有, 需适配

| 修改项                            | 说明                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| 6 处 `instanceof AcpAgentManager` | → 接口方法检查                                                                               |
| 3 处 type cast                    | → 接口方法调用                                                                               |
| 消息格式                          | 过渡期: Bridge Adapter 做 TMessage → IResponseMessage 翻译; 长期: renderer 直接接收 TMessage |

---

## EventDispatcher 设计

不是纯 Event Bus, 也不是纯显式调用。是**带动态扩展能力的显式分发器**。

### 为什么不用纯 Event Bus

内部消费者是**已知的、稳定的**一小组 (Bridge, Team, Channel, Cron, Persistence, Observability)。
用 Event Bus:

- emit 一行代码, 看不出谁在接收 → 调试时要搜索所有 .on() 注册点
- 消费者注册散落各处 → 难以一眼看清全貌

用显式分发:

- 所有消费者在 Composition Root (应用启动时) 统一注册 → 一个文件看清全貌
- 读代码时能直接跟踪调用链

### 为什么不用纯显式调用

Extension hooks 需要**动态注册** — 用户安装了什么 Extension, 系统事先不知道。
这部分必须是动态的。

### 设计

```ts
class EventDispatcher {
  // 内部消费者: 启动时显式注册, 一个文件看清全貌
  private consumers: Map<EventType, InternalConsumer[]>;

  // Extension hooks: 动态注册, 通过 Hook Runtime 沙箱执行
  private hookRuntime: HookRuntime | null;

  emit(event: EventType, payload: EventPayload): void {
    // 1. 内部消费者: 直接调用 (无沙箱, 无超时)
    for (const consumer of this.consumers.get(event)) {
      consumer.handle(payload);
    }
    // 2. Extension hooks: 沙箱执行 (有权限检查, 有超时)
    this.hookRuntime?.dispatch(event, payload);
  }

  // Waterfall: 串行执行, 每个 handler 可修改 payload
  async waterfall(event: WaterfallEvent, payload): Promise<payload> {
    for (const handler of this.waterfallHandlers.get(event)) {
      payload = await handler(payload);
    }
    return payload;
  }
}
```

### 应用启动时的注册 (Composition Root)

```ts
// src/process/bootstrap.ts — 一个文件看清所有注册
const dispatcher = new EventDispatcher();

// 内部消费者
dispatcher.register('agent:stream', bridgeAdapter);
dispatcher.register('agent:finish', bridgeAdapter);
dispatcher.register('agent:finish', teamConsumer);
dispatcher.register('agent:stream', channelConsumer);
dispatcher.register('agent:finish', channelConsumer);
dispatcher.register('turn:started', cronBusyGuard);
dispatcher.register('turn:completed', cronBusyGuard);
dispatcher.register('turn:completed', skillSuggestWatcher);
dispatcher.register('agent:finish', persistenceSubscriber);
dispatcher.register('agent:finish', turnCompletionNotifier);

// Waterfall: 会话配置注入
dispatcher.registerWaterfall('agent:configuring', teamMcpInjector);
dispatcher.registerWaterfall('agent:configuring', presetContextInjector);

// Extension hooks (动态, 由 Hook Runtime 管理)
dispatcher.setHookRuntime(hookRuntime);
```

### 与 RFC 的关系

| RFC 概念                    | 本架构对应        | 说明                                                                                  |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| Layer 1: Internal Event Bus | EventDispatcher   | 同一套事件; 但内部消费者显式注册, 不是纯 pub/sub                                      |
| Layer 2: Hook API           | HookRuntime       | EventDispatcher 的 Extension 通道, 加安全壳                                           |
| Layer 3: Extension manifest | contributes.hooks | hooks 声明订阅哪些事件, HookRuntime 据此注册                                          |
| Layer 4: Hub                | 现有基础设施      | Layer 1-3 就绪后接入                                                                  |
| RFC 的 11 事件              | 直接复用          | agent:stream/finish/error, turn:started/completed, conversation:\*, agent:configuring |

### 与 Discussion #2488 的映射

| 社区提案                      | 本架构支持方式                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `onBeforeSendMessage`         | EventDispatcher emit `turn:started` → Extension 只读通知; 追加 context 通过 ExtensionContextAppender (pipeline 内) |
| `onAfterReceiveMessage`       | EventDispatcher emit `agent:finish` → Extension 只读通知                                                           |
| `onModelSwitch`               | EventDispatcher emit `conversation:updated` → Extension 只读通知                                                   |
| `onConversationCreate/Delete` | EventDispatcher emit `conversation:created/deleting` → Extension 只读通知                                          |
| Castor6 的 `SessionStart`     | 对应 `conversation:created`                                                                                        |
| Castor6 的 `UserPromptSubmit` | 对应 `turn:started` (只读) + ExtensionContextAppender (追加)                                                       |
| Castor6 的 `Stop`             | 对应 `turn:completed`                                                                                              |
| Extension 注入 MCP            | `agent:configuring` waterfall → Extension 可追加 MCP servers                                                       |
| Extension 修改 prompt 内容    | **不允许** — 安全红线 (prompt injection 入口)                                                                      |

---

## 12 类职责最终归属

| 大类           | 归属                                                                                                        | 机制            |
| -------------- | ----------------------------------------------------------------------------------------------------------- | --------------- |
| A 进程生命周期 | Transport (spawn/close) + Registry (kill/idle)                                                              | 对象内聚        |
| B 协议通信     | Transport (wire) + Agent (session/prompt)                                                                   | 对象内聚        |
| C 认证         | Agent (协议级) + BackendPolicy (CLI login)                                                                  | 对象内聚 + 策略 |
| D 配置管理     | Agent (ConfigTracker) + Conversation (BackendPolicy 拦截 + config 持久化) + Waterfall (`agent:configuring`) | 混合            |
| E 输入预处理   | Conversation (InputPipeline)                                                                                | Pipeline        |
| F 输出后处理   | Agent (MessageTranslator) + Conversation (OutputPipeline)                                                   | Pipeline        |
| G 权限         | Agent (PermissionResolver) + Conversation (team policy 通过 BackendPolicy 或专用 PermissionPolicy)          | 对象内聚 + 策略 |
| H 容错与恢复   | Transport (4-signal) + Agent (重试/退避) + Conversation (TurnTracker)                                       | 每层各管各的    |
| I 持久化       | EventDispatcher 消费者 (PersistenceSubscriber)                                                              | 通知            |
| J 事件路由     | EventDispatcher                                                                                             | 通知            |
| K 外部系统集成 | EventDispatcher 消费者 (Cron, Slash, Preview, TurnCompletion)                                               | 通知            |
| L 可观测性     | EventDispatcher 消费者 + Transport 内置 (stderr, logging proxy)                                             | 通知 + 对象内聚 |

### 原则

- **变换**: Pipeline — 数据必须按序处理, 下游看到的是处理后的版本
- **通知**: EventDispatcher — 一个事件多个独立消费者, 各自反应
- **协作**: Waterfall — 多方追加式贡献 (MCP 注入, Extension context)
- **编排**: 对象内聚 — 有状态的逻辑 (TurnTracker, BackendPolicy) 由拥有者直接管理
- **Extension**: Hook Runtime — 同一套事件, 加安全壳 (权限/超时/沙箱), 不允许修改 prompt

---

## 关于 AcpRuntime 的结论

AcpRuntime "转正" 的正确含义不是让它成为独立的一层,
而是让它的**设计理念** (会话管理、事件路由、idle 回收) 融入新架构:

| AcpRuntime 的理念                   | 在新架构中的体现                                                  |
| ----------------------------------- | ----------------------------------------------------------------- |
| 多会话注册表                        | Registry (WorkerTaskManager) — 已有                               |
| 事件路由                            | EventDispatcher — 新建                                            |
| MCP 注入                            | `agent:configuring` waterfall — 新建                              |
| Idle 回收                           | Registry idle kill + config 持久化 (不需要 suspend/IdleReclaimer) |
| 新消息格式 (TMessage + SignalEvent) | Agent 层 (MessageTranslator) 已输出 TMessage                      |
| acp_session 表持久化                | PersistenceSubscriber — 启用                                      |

AcpRuntime 的代码最终会被拆散: 有价值的部分进入 Registry、Conversation、EventDispatcher;
冗余的部分 (重复注册表、IdleReclaimer) 被丢弃。
IdleReclaimer 的精确恢复价值已被 config 持久化方案替代 (详见 [unified-state-machine.md](unified-state-machine.md))。

---

## 待深入设计的问题

以下问题在本提案中识别但未给出最终答案, 需要在实施前明确:

| #   | 问题                                                                                                                 | 影响                 |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Q1  | Conversation 和 IAgentManager 的关系: 新建接口还是复用 IAgentManager?                                                | Registry 层接口设计  |
| Q2  | Promise 桥接: Agent 层 setModel/setMode 是 void, Bridge 层期望 async 结果, 谁来桥接?                                 | Conversation 层实现  |
| Q3  | Renderer 消息格式迁移: 过渡期用 Bridge Adapter 翻译, 长期 renderer 改成接收 TMessage — 如何分阶段?                   | 迁移范围             |
| Q4  | EventDispatcher 的 async handler: 内部消费者全同步? 还是支持 async + Promise.allSettled?                             | EventDispatcher 接口 |
| Q5  | BackendPolicy 的粒度: 一个大 Policy 对象, 还是拆成 ModelPolicy + ModePolicy + ErrorPolicy?                           | 可维护性             |
| Q6  | Agent 层 @file 完整版: 增强 InputPreprocessor (Session 层), 还是保留在 InputPipeline (Conversation 层)?              | 层间职责划分         |
| Q7  | OutputPipeline 中 StreamBuffer (120ms 合并写 DB): 它既是变换 (缓冲) 又是副作用 (写 DB), 放 pipeline 还是 subscriber? | 模式选择             |
| Q8  | Config 持久化时机: desired 变化立即写 DB, 还是 debounce? current 确认后再清 desired 还是乐观清除?                    | 性能 vs 一致性       |
