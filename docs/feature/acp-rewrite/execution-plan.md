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

- [ ] **2.1** AcpRuntime 骨架 — 清空现有代码, 实现 IAgentManager, 持有 AcpSession, 基本 sendMessage/stop/kill 跑通
- [ ] **2.2** BackendPolicy — per-backend 有状态策略 (即 TODO.md 中的 SessionPlugin 概念): mode 拦截 (Codex/Snow), model 映射 (Claude cc-switch), model switch notice (Claude `<system-reminder>`), CLI login (claude/qwen), error 增强 (Qwen), sandbox config (Codex). 通过 SessionOptions/SessionCallbacks 影响 Session 行为, 不违反 session 层禁依赖 ProcessConfig 约束
- [ ] **2.3** OutputPipeline — ThinkTagFilter (`<think>` 提取) + StatusFilter (噪音抑制) + ToolCallMerger (deep merge, 来自 TODO.md tool_call 合并策略)
- [ ] **2.4** InputPipeline — UserMessagePersister + FileRefProcessor + FirstMessageInjector. FileRefProcessor 预留 SDK ContentBlock 接口 (TODO.md 文件引用调研), 初期仍用纯文本 fallback
- [ ] **2.5** TurnTracker — 15s finish 兜底, agentCrash 合成, turn 状态维护
- [ ] **2.6** 权限策略 — team MCP 工具自动批准, channel 通知

此阶段 fan-out 先用直接调用, 不引入 EventDispatcher — 先让功能对, 再优化结构。

验证: 单元测试每个组件; 集成测试用临时 factory 注册跑完整流程

---

## Phase 3: EventDispatcher + 订阅者迁移

前置: Phase 2 功能完整
目标: fan-out 从硬编码 import → EventDispatcher

- [ ] **3.1** EventDispatcher 核心 — emit + waterfall + 类型安全 EventMap
- [ ] **3.2** 内部订阅者 — BridgeAdapter, TeamConsumer, ChannelConsumer, CronConsumer, PersistenceSubscriber (含修复 agentId 语义: `agentId = customAgentId ?? backend`, 启用 acp_session 表写入, 来自 TODO.md)
- [ ] **3.3** Composition Root — 启动时统一注册, 一个文件看清全貌
- [ ] **3.4** AcpRuntime 切换 — 移除直接 import, 改用 dispatcher.emit
- [ ] **3.5** `agent:configuring` waterfall — MCP 注入从内部逻辑 → waterfall 订阅者

验证: 行为不变, 内部结构变了

---

## Phase 4: 切换上线

前置: Phase 3
目标: AcpRuntime 成为生产代码

- [ ] **4.1** Bridge 层适配 — 6 处 instanceof → 接口方法; 3 处 type cast → 接口调用
- [ ] **4.2** 消息格式桥接 — Bridge Adapter 做 TMessage → IResponseMessage 翻译 (过渡期)
- [ ] **4.3** Factory 切换 — `factory.register('acp', ...)` 指向新 AcpRuntime
- [ ] **4.4** 全量回归测试 — 单聊、team mode、channel bot、cron、slash commands、preview

---

## Phase 5: 清理

前置: Phase 4 稳定运行
目标: 删除旧代码, 清理残留耦合

- [ ] **5.1** 删除 AcpAgentManager (1635 行)
- [ ] **5.2** 删除 AcpAgentV2 (809 行)
- [ ] **5.3** 删除 AcpAgent 旧版 (1884 行)
- [ ] **5.4** 删除 AcpConnection 旧版 (1156 行)
- [ ] **5.5** 删除 teamEventBus + channelEventBus (已被 EventDispatcher 替代)
- [ ] **5.6** cronBusyGuard 从 WorkerTaskManager 移到 EventDispatcher 订阅者
- [ ] **5.7** Renderer tool_call deep merge — 删除 compat 层后 renderer 需自行做 `tool_call_update` 深合并 (来自 TODO.md)

---

## 后续 (不在本轮范围, 记录备查)

| 项目 | 说明 | 来源 |
|------|------|------|
| SDK ContentBlock 文件引用 | 调研各后端 promptCapabilities, 按能力发 file/image block vs 纯文本 fallback | TODO.md |
| acp_session 表读取方 | ACP Discovery 需求落地时补消费逻辑 (session 恢复, idle reclaim) | TODO.md |
| Hook Runtime (Layer 2) | EventDispatcher 之上加安全壳, Extension 可挂载 hook | RFC |
| useConversationCommandQueue enabled 参数 | enabled 始终为 true, 考虑去掉 | TODO.md |
