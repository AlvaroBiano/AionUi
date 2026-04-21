# ACP Runtime 转正 — 执行计划

> 基于 [architecture-layering-proposal.md](architecture-layering-proposal.md)
> 整合 [TODO.md](TODO.md) 中的待办项
> 日期: 2026-04-21
> 原则: 每个 phase 结束时系统都能跑; 每个 step 完成即 commit

---

## Phase 1: Agent 层补齐 (AcpSession bug fixes)

前置: 无
目标: AcpSession 可靠, AcpRuntime 可以放心委托

- [x] **1.1** agentCrash flag (P0) — `process_crash` signal type, 消除 keyword 耦合
- [x] **1.2** sendMessage 断连恢复 (P1) — AcpAgentV2 已有 reconnect (error/idle → kill+start), 补测试验证, 更新审计文档
- [x] **1.3** @file 引用增强 (P1) — workspace 路径解析, 3 层递归搜索, binary 警告, 引号路径+去重保留

验证: 现有测试 + 手动测 team mode crash recovery

---

## Phase 2: 构建 AcpRuntime (核心)

前置: Phase 1
目标: AcpRuntime 实现 IAgentManager, 内部组件齐全, 可独立测试

- [x] **2.1** AcpRuntime 骨架 — 实现 IAgentManager, 组装所有零件, AcpSession 接口改造 (sendMessage→PromptContent, onNotification→SessionNotification, AgentStatus 4 态)
- [x] **2.2** BackendPolicy — per-backend 有状态策略: Claude (model switch notice, beforePrompt, /login), Codex (mode interception + sandbox config), Snow (mode interception), Qwen (error enhancement, login). Default policy for all others. Factory: `createBackendPolicy(backend)`
- [x] **2.3** OutputPipeline — ThinkTagFilter (`<think>` 提取, 复用 ThinkTagDetector) + ToolCallMerger (deep merge, stateful). StatusFilter 留给 2.1 AcpRuntime 骨架 (走 onStatusChange 回调, 非 TMessage 流)
- [x] **2.4** InputPipeline — FirstMessageInjector (preset/skills/teamGuide 首消息注入, stateful once) + FileRefProcessor (复用 InputPreprocessor). UserMessagePersister 独立 (副作用非变换, DI deps). AcpSession API 变更 (sendMessage 接收 PromptContent) + MessageTranslator 移入 OutputPipeline 均留到 2.1
- [x] **2.5** TurnTracker — 15s finish 兜底 (inactivity fallback with reset-on-activity), turn lifecycle (begin/finish/consume/clear), shouldFireFallback guard (permission dialog). 不碰事件总线 — onFallback 回调由 AcpRuntime 处理
- [x] **2.6** 权限策略 — PermissionPolicy: team MCP 自动批准 (`aionui-team`), confirmation 生命周期 (add/update/confirm/query/clear), hasPending() for TurnTracker guard. Channel 通知留给 Phase 3 EventDispatcher

此阶段 fan-out 先用直接调用, 不引入 EventDispatcher — 先让功能对, 再优化结构。

验证: 单元测试每个组件; 集成测试用临时 factory 注册跑完整流程

---

## Phase 3+4: EventDispatcher + 切换上线

前置: Phase 2
目标: AcpRuntime 通过 EventDispatcher 解耦, 成为生产代码

- [ ] **3.1** EventDispatcher 核心 — emit + waterfall + 类型安全 EventMap
- [ ] **3.2** 事件目录 — Output: agent:stream/finish/error/crash; Input/Lifecycle: turn:started/completed, model:changed, mode:changed, conversation:created/deleting; Waterfall: agent:configuring
- [ ] **3.3** 内部订阅者 — BridgeAdapter (TMessage→IResponseMessage 翻译 + ipcBridge emit), TeamConsumer (替代 teamEventBus), ChannelConsumer (替代 channelEventBus), CronConsumer (替代 cronBusyGuard 直接 import), PersistenceSubscriber (conversation.extra 写入 + acp_session 表, 修复 agentId 语义)
- [ ] **3.4** Composition Root — 启动时统一注册所有消费者, 一个文件看清全貌
- [ ] **3.5** AcpRuntime 接入 — setModel/setMode/sendMessage 等改为 dispatcher.emit, 删除硬编码消费者调用
- [ ] **3.6** `agent:configuring` waterfall — MCP 注入 (team-guide + user config) 从 AcpRuntime 内部逻辑 → waterfall 订阅者
- [ ] **4.1** Bridge 层适配 — 6 处 instanceof → 接口方法; 3 处 type cast → 接口调用
- [ ] **4.2** Factory 切换 — `factory.register('acp', ...)` 指向新 AcpRuntime
- [ ] **4.3** 全量回归测试 — 单聊、team mode、channel bot、cron、slash commands、preview

---

## Phase 5: 清理

前置: Phase 4 稳定运行
目标: 删除旧代码, 清理残留耦合

- [ ] **5.1** 删除 AcpAgentManager (1635 行)
- [ ] **5.2** 删除 AcpAgentV2 (809 行) + session/MessageTranslator.ts
- [ ] **5.3** 删除 AcpAgent 旧版 (1884 行)
- [ ] **5.4** 删除 AcpConnection 旧版 (1156 行)
- [ ] **5.5** 删除 teamEventBus + channelEventBus (已被 EventDispatcher 替代)
- [ ] **5.6** 删除 IdleReclaimer.ts + 测试
- [ ] **5.7** cronBusyGuard 从 WorkerTaskManager 移到 EventDispatcher 订阅者
- [ ] **5.8** Renderer tool_call deep merge — 删除 compat 层后 renderer 需自行做 `tool_call_update` 深合并 (来自 TODO.md)

---

## 后续 (不在本轮范围, 记录备查)

| 项目                                     | 说明                                                                        | 来源    |
| ---------------------------------------- | --------------------------------------------------------------------------- | ------- |
| SDK ContentBlock 文件引用                | 调研各后端 promptCapabilities, 按能力发 file/image block vs 纯文本 fallback | TODO.md |
| acp_session 表读取方                     | ACP Discovery 需求落地时补消费逻辑 (session 恢复, idle reclaim)             | TODO.md |
| Hook Runtime (Layer 2)                   | EventDispatcher 之上加安全壳, Extension 可挂载 hook                         | RFC     |
| useConversationCommandQueue enabled 参数 | enabled 始终为 true, 考虑去掉                                               | TODO.md |
