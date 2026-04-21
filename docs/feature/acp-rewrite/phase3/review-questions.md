# 架构分层提案 — Review 问题记录

> 针对 [architecture-layering-proposal.md](architecture-layering-proposal.md) 的疑问
> 背景: Phase 1 完成 + Phase 2.2-2.6 组件产出后, 准备进入 2.1 AcpRuntime 骨架
> 日期: 2026-04-21

---

## 核心感受

提案给出的四层 (Transport / Agent / Conversation / Registry) 抽象是对的,
但把这四层落到当前代码去, 会发现**同一类职责在两层都有实现**, 导致
"哪一层是权威" 的问题很难回答。下面每个问题都是一个**边界模糊点**。

---

## 一、层间职责重叠 / 权威不明

### Q-A 输入预处理 (@file 解析) 的权威层

**现象**

- Agent 层 `src/process/acp/session/AcpSession.ts:100` 持有 `inputPreprocessor`,
  `sendMessage(text, files)` (L194-207) 调它做 @file 解析
- Conversation 层 `src/process/acp/runtime/InputPipeline.ts:77-116` 也做 @file
  解析, 且 dccfbfff2 commit 说 "自包含, 不再从 session/ import"

两层都写了一份 @file 逻辑, 且 workspace 搜索规则实现各一份 (`InputPreprocessor.ts`
vs `InputPipeline.ts`)。

**问题**

- 计划里是 InputPipeline 成为唯一入口, AcpSession 改成接收已处理好的 `PromptContent`?
- 如果是, 2.1 必须一起把 AcpSession.sendMessage 签名改掉, 否则两层各走各的会有奇怪状态
- session/InputPreprocessor.ts 什么时候删? 2.1 之内还是之后?

---

### Q-B 输出翻译 (SDK → TMessage) 的权威层

**现象**

- Agent 层 `AcpSession.ts:312-355` 的 `handleMessage` 分两路:
  - `current_mode_update` / `config_option_update` / `usage_update` / `available_commands_update`
    → 直接调 `configTracker` 更新, 走 `callbacks.onModeUpdate` / `onConfigUpdate` / `onContextUsage`
    **不进入消息流**
  - 其余 → `messageTranslator.translate` → `callbacks.onMessage(TMessage)` **进入消息流**
- Conversation 层 `OutputPipeline.ts:128-292` 的 `MessageTranslator` (inline 自 dccfbfff2)
  也做 SDK → TMessage 翻译, 但因为那 4 种 config 消息在 Session 被提前吃掉,
  Pipeline 实际看不到它们

**问题**

- Session 现在同时是 "config 语义路由" 和 "消息流源头", 出了两种 callback
- Pipeline 只看得到 "非 config" 的一半, 视野不完整
- 如果 2.1 改成 `onNotification(SessionNotification)` 出口, Session 层 handleMessage
  里的 config 分流要不要保留? 还是全部扔给 Pipeline, Pipeline 自己分流?

核心矛盾: **翻译在哪儿做?** 如果 Pipeline 是权威, Session 不该先截走一半;
如果 Session 是权威, Pipeline 里的 MessageTranslator 是多余。

---

### Q-C 权限决策的层间分工 (PermissionPolicy vs PermissionResolver)

**现象**

- Agent 层 `PermissionResolver` (`AcpSession.ts:101-104`) 在构造时固化
  `autoApproveAll: agentConfig.yoloMode`, 之后不变
- Conversation 层 `PermissionPolicy.ts:62-68` 维护 `_isYoloMode` 可以动态切换

**问题**

- 两层都在判 YOLO, 但语义不同: Session 判 "session 创建时是不是 YOLO",
  Runtime 判 "现在是不是 YOLO"
- 当 session 创建时 yoloMode=true, `PermissionResolver` 的 L1 直接 auto-approve,
  **permission request 不会上浮到 Runtime**, PermissionPolicy 的 team MCP
  规则 (`aionui-team`) 永远不触发
- 这是 by design (静态 YOLO 不需要 team MCP 细分) 还是 bug?
- 如果 by design, 需要写在注释里; 如果不是, PermissionPolicy 的 team 规则应该下沉到 Resolver

---

### Q-D BackendPolicy 的消费点散落

**现象**

提案说 BackendPolicy 住在 Conversation 层, 但它的方法会被不同层调用:

| 方法                    | 何时调用            | 在哪一层     |
| ----------------------- | ------------------- | ------------ |
| `beforePrompt(content)` | 发送前修改 prompt   | Conversation |
| `interceptSetMode`      | setMode 拦截        | Conversation |
| `onModelChanged`        | 模型切换成功后      | Conversation |
| `enhanceErrorMessage`   | 错误信号到达时      | ?            |
| `getLoginCommand`       | 渲染端请求 login 时 | Bridge?      |
| `tryAuthRetry`          | 收到 auth_required  | ?            |

**问题**

- `enhanceErrorMessage` 该在哪里调? Session 发 `onSignal({type:'error'})` 之前?
  Runtime 转发给 EventDispatcher 之前? 还是 Bridge 送到 renderer 之前?
- 不同层调同一个 Policy 对象, 就意味着跨层共享可变状态 (`_modelOverride`, `_authRetried`),
  谁拥有它? 如果 Conversation 拥有, Bridge/Session 怎么拿到?

---

### Q-E UserMessagePersister 的归属

**现象**

- 现在放在 `runtime/UserMessagePersister.ts`, 由 Conversation 调用
- 它做三件事: 写 DB + touch conversation + emit IPC (`user_content` 事件)
- 12 类职责表 I 持久化 → "EventDispatcher 消费者 (PersistenceSubscriber)"

**问题**

- 当前实现是**直接副作用**, 不走 EventDispatcher。Phase 3 要不要迁到订阅者?
- 用户消息在 agent 回复前就要落 DB / 上屏 (UX 要求), 这和 "agent 产出后订阅者落 DB"
  的模式不对称 — 用户端是主动写, agent 端是被动写
- Conversation 既做编排又做 "pre-send 持久化副作用", 是否违反 "Conversation 不关心持久化" 的理想?

---

### Q-F TurnTracker 的 onFallback 出口

**现象**

`TurnTracker.ts:158` 的 `onFallback(turnId)` 回调, 需要有人把它变成一个真正的
"合成 finish 信号" 送出去。

**问题**

- 谁来合成? Conversation 自己构造 `SessionNotification` (假装 SDK 发的) 给 Pipeline 走一遍?
  还是直接构造 TMessage 扔给下游?
- 走 Pipeline 意味着 "合成 notification" 可能和真正的 notification 不区分,
  `markFinished` / `reset` 等状态清理会不会被 Pipeline 的中间 stage 干扰?
- 这个出口不定, 2.1 的 Runtime 里就会堆一坨 ad-hoc 逻辑

---

### Q-G Pipeline 失败的回滚语义

**现象**

- `UserMessagePersister.persist` 先写 DB + emit IPC
- 之后 `InputPipeline.process` 可能失败 (读文件 throw?), 或 `AcpSession.sendMessage`
  在 idle/error 状态抛 `AcpError('INVALID_STATE')`
- 此时 DB 里留了 user message, UI 已显示, agent 没收到

**问题**

- 失败是"删 DB 记录 + emit cancel IPC"? 还是"追加一条 error 消息作为这条 user message 的回复"?
- Conversation 层要不要显式定义 "pre-send 失败" 的补偿动作?

---

## 二、层间契约待明确 (影响 2.1 API 形态)

### Q-1 AcpSession 状态机 3 态化落地时机

- `unified-state-machine.md` 承诺降到 `idle|running|ready|error` 3 态
- 当前 `AcpSession.ts:36-44` 仍是 7 态, `suspend`/`resume`/'suspended' 活着
- 2.1 要不要连同状态机一起改? 还是先保 7 态, 状态机降态作为 2.1 之后独立 step?

### Q-2 setModel/setMode 的 Promise 归属 (延续 v1 Q2)

- 当前 `AcpSession.ts:225-231` 吞错在 `console.warn`, Bridge 拿不到结果
- 方案 A: AcpSession.setModel 返回 `Promise<void>`, reject 带错误
- 方案 B: Conversation 自己维护 `{pendingOp → resolver}`, 监听 `onModelUpdate`
- **在 2.1 动手之前必须二选一**, 否则 Runtime 骨架的 API 表面会有不同形态

### Q-3 Session ↔ Conversation 的 callback 边界

- 当前 `SessionCallbacks` 出了 8 种回调 (`onMessage` / `onStatusChange` /
  `onConfigUpdate` / `onModelUpdate` / `onModeUpdate` / `onContextUsage` /
  `onPermissionRequest` / `onSignal`)
- 新设计要不要收敛成两种: `onNotification(SessionNotification)` (裸 SDK 数据)
  - `onLifecycle(Signal)` (状态/错误/认证等)?
- 还是保留细粒度 callback, 让 Conversation 选择性订阅?

---

## 三、附带发现的实现风险 (非架构)

单独列出, 架构讨论可忽略, 但实施时要处理:

1. `TurnTracker.beginTurn` (L54-60) 不立即 schedule fallback, 完全沉默的 agent
   永远不触发兜底 — 是否 by design?
2. `ToolCallMerger` (OutputPipeline.ts:370-372) 的 60s `setTimeout` 没被 `reset()` 清掉,
   会话销毁后 timer 泄漏; `!== 'unknown'` / `!== 'execute'` 魔法字符串与
   `MessageTranslator` 默认值耦合
3. `InputPipeline` 用同步 `fs.readFileSync` + 3 层递归 `readdirSync`, 单个大文件
   或巨量文件时阻塞 event loop
4. `AcpRuntime.ts:203-207` 的 `session.suspend()` 在 3 态化后要删除
