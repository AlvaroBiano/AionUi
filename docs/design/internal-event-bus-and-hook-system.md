# RFC: Internal Event Bus & Hook System

> Status: Draft
> Date: 2026-04-19
> References: [Discussion #2488 — Hook System & Hook Hub](https://github.com/iOfficeAI/AionUi/discussions/2488)

## 目录

1. [问题定义](#1-问题定义)
2. [现状分析](#2-现状分析)
   - 2.1 [现有事件机制清单](#21-现有事件机制清单)
   - 2.2 [跨模块耦合模式](#22-跨模块耦合模式)
3. [分层架构提案](#3-分层架构提案)
4. [Layer 1: Internal Event Bus](#4-layer-1-internal-event-bus)
   - 4.1 [核心事件清单](#41-核心事件清单)
   - 4.2 [接口设计](#42-接口设计)
   - 4.3 [与现有机制的关系](#43-与现有机制的关系)
5. [Layer 2: Hook API](#5-layer-2-hook-api)
6. [Layer 3: Extension 整合](#6-layer-3-extension-整合)
7. [迁移计划](#7-迁移计划)
8. [安全边界](#8-安全边界)
9. [Open Questions](#9-open-questions)

---

## 1. 问题定义

AionUi 缺少一个清晰的分层事件架构。内部模块解耦、外部开发者扩展、终端用户自定义这三种需求需要不同的抽象，但目前要么没有、要么混在一个未完成的 Extension 系统里。

具体表现：

- **模块间硬编码依赖**：每个 AgentManager 直接 import 3 个不相关模块（teamEventBus、channelEventBus、cronBusyGuard）做消息扇出和状态管理，6 个 Manager 中重复了约 360 行几乎相同的代码。
- **Bridge 层成为 god-function**：`conversationBridge.ts`（649 行）在删除会话时手动串联 5 个模块的清理逻辑，每增加一个感知会话变化的模块都要改这个文件。
- **消息处理硬编码业务逻辑**：`MessageMiddleware.ts` 直接 import cronService 做 CRUD，消息处理层和定时任务领域紧耦合。
- **5 套互不通信的事件机制**并存（ipcBridge emitters、teamEventBus、channelEventBus、extensionEventBus、callback hooks），没有统一的事件命名空间。
- **Extension 系统的 Hook 能力缺失**：Extension 能贡献 agents/themes/skills，但无法挂载到消息流、会话生命周期等核心流程。

---

## 2. 现状分析

### 2.1 现有事件机制清单

当前 `src/process/` 中存在 5 套独立的事件/通知机制：

| #   | 机制                     | 位置                                                                     | 类型                   | 事件数                                   | 作用域                                |
| --- | ------------------------ | ------------------------------------------------------------------------ | ---------------------- | ---------------------------------------- | ------------------------------------- |
| 1   | `ipcBridge.buildEmitter` | `src/common/adapter/ipcBridge.ts`                                        | Bridge RPC             | 39 channels                              | main → renderer/WebSocket             |
| 2   | `teamEventBus`           | `src/process/team/teamEventBus.ts`                                       | EventEmitter singleton | 1 (`responseStream`)                     | AgentManagers → TeammateManager       |
| 3   | `channelEventBus`        | `src/process/channels/agent/ChannelEventBus.ts`                          | EventEmitter singleton | 1 (`channel.agent.message`)              | AgentManagers → ChannelMessageService |
| 4   | `extensionEventBus`      | `src/process/extensions/lifecycle/ExtensionEventBus.ts`                  | EventEmitter singleton | 6 系统 + N 自定义                        | Extension 生命周期 + 扩展间通信       |
| 5   | Callback hooks           | `src/process/task/IpcAgentEventEmitter.ts`, `src/common/adapter/main.ts` | 模块级可变回调         | 2 (`setConfirmHook`, `setPetNotifyHook`) | 特定模块间点对点                      |

**关键发现**：`teamEventBus` 和 `channelEventBus` 的存在是因为 `ipcBridge.buildEmitter` 只能推送到 renderer，main process 内部的模块无法通过它监听事件。`setConfirmHook` 和 `setPetNotifyHook` 同理——都是缺少统一内部事件总线的 workaround。

### 2.2 跨模块耦合模式

通过对 `src/process/` 全量代码的审计，识别出 5 种主要的耦合模式：

#### Pattern 1: Agent 消息扇出（最普遍）

每个 AgentManager 的 finish handler 重复这段逻辑：

```
ipcBridge.*.responseStream.emit(message)       → renderer
teamEventBus.emit('responseStream', message)   → Team 模块
channelEventBus.emitAgentMessage(id, message)  → Channel 模块
```

**影响范围**：6 个 AgentManager（ACP、Gemini、Aionrs、OpenClaw、Remote、NanoBot）。

**涉及文件**：

- `src/process/task/AcpAgentManager.ts` — import channelEventBus (:3), teamEventBus (:4)
- `src/process/task/GeminiAgentManager.ts` — import channelEventBus (:7), teamEventBus (:34)
- `src/process/task/AionrsManager.ts` — import channelEventBus (:11), teamEventBus (:12)
- `src/process/task/OpenClawAgentManager.ts` — import channelEventBus (:8), teamEventBus (:21)
- `src/process/task/RemoteAgentManager.ts` — import channelEventBus (:8), teamEventBus (:20)
- `src/process/task/NanoBotAgentManager.ts` — import teamEventBus (:18)

#### Pattern 2: Agent Turn 生命周期管理（最脆弱）

每个 AgentManager 在消息发送和完成时手动调用：

```
cronBusyGuard.setProcessing(true)    // 发送时
cronBusyGuard.setProcessing(false)   // 完成时
skillSuggestWatcher.onFinish()       // 完成时
```

**脆弱性**：如果新增一个 AgentManager 忘记加这些调用，cron 模块会静默地出错（认为 agent 还在工作，不执行定时任务）。

**涉及文件**：

- `src/process/task/AcpAgentManager.ts` — import cronBusyGuard (:29), skillSuggestWatcher (:39)
- `src/process/task/GeminiAgentManager.ts` — import cronBusyGuard (:24), skillSuggestWatcher (:25)
- `src/process/task/AionrsManager.ts` — import cronBusyGuard (:28), skillSuggestWatcher (:29)
- `src/process/task/OpenClawAgentManager.ts` — import cronBusyGuard (:17), skillSuggestWatcher (:18)
- `src/process/task/RemoteAgentManager.ts` — import cronBusyGuard (:16), skillSuggestWatcher (:17)
- `src/process/task/NanoBotAgentManager.ts` — import cronBusyGuard (:14), skillSuggestWatcher (:15)
- `src/process/task/WorkerTaskManager.ts` — import cronBusyGuard (:13) 用于空闲检查

#### Pattern 3: Bridge 层编排清理链（最复杂）

`conversationBridge.ts` 在删除会话时手动串联 5 个不相关模块：

```
workerTaskManager.kill(id)                        // step 1: 杀 agent 进程
channelManager.cleanupConversation(id)             // step 2: 清理 channel 关联
conversationService.deleteConversation(id)         // step 3: 数据库删除
removeFromMessageCache(id)                         // step 4: 清消息缓存
emitConversationListChanged() + refreshTrayMenu()  // step 5: 通知 UI
```

**涉及文件**：

- `src/process/bridge/conversationBridge.ts` — 删除逻辑 (:264-300)，创建逻辑 (:127-173)，更新逻辑 (:302-337)，warmup (:344-360)，sendMessage (:496-606)

#### Pattern 4: MessageMiddleware 硬编码 Cron 逻辑

`MessageMiddleware.ts` 直接 import cronService 并在 `handleCronCommands()` 中执行 cron job 的 CRUD：

**涉及文件**：

- `src/process/task/MessageMiddleware.ts` — import cronService (:10)，handleCronCommands (:191-258)

#### Pattern 5: Team MCP 注入散布各处

`shouldInjectTeamGuideMcp()` + `getTeamGuideStdioConfig()` 在 5 个文件中被 import：

**涉及文件**：

- `src/process/task/AcpAgentManager.ts` (:44) — shouldInjectTeamGuideMcp
- `src/process/task/AcpAgentManager.ts` (:1009) — dynamic import teamGuidePrompt
- `src/process/task/agentUtils.ts` (:9) — getTeamGuidePrompt
- `src/process/task/GeminiAgentManager.ts` (:27) — getTeamGuideStdioConfig
- `src/process/acp/compat/AcpAgentV2.ts` (:23-25) — getTeamGuideStdioConfig, shouldInjectTeamGuideMcp
- `src/process/acp/runtime/AcpRuntime.ts` (:4,21) — getTeamGuideStdioConfig, shouldInjectTeamGuideMcp

---

## 3. 分层架构提案

将 Hook/Extension 系统拆为 4 层，从下往上逐层构建，每层有明确边界，上层依赖下层：

```
┌──────────────────────────────────────────┐
│  Layer 4: Hub (生态分发)                 │  复用现有 HubIndexManager / HubInstaller
├──────────────────────────────────────────┤
│  Layer 3: Extension (打包与分发单元)     │  hooks 成为 contributes 的一种类型
├──────────────────────────────────────────┤
│  Layer 2: Hook API (开发者扩展点)        │  安全壳: 权限声明 + 超时 + 隔离执行
├──────────────────────────────────────────┤
│  Layer 1: Internal Event Bus (模块解耦)  │  ← 本 RFC 的核心范围
└──────────────────────────────────────────┘
```

**Layer 1: Internal Event Bus**

- 给谁用：AionUi 自身模块（Team、Cron、Channel、Preview 等）
- 解决什么：模块间硬编码依赖
- 边界：纯内部，不暴露给外部代码。不涉及权限、沙箱、打包。
- 本 RFC 的核心范围

**Layer 2: Hook API**

- 给谁用：Extension 开发者
- 解决什么：Extension 无法挂载到核心流程（消息流、会话生命周期）
- 边界：建立在 Layer 1 之上，监听同一套事件，但加了安全壳（权限声明、超时、隔离执行）
- 后续 RFC

**Layer 3: Extension 整合**

- hooks 成为 `contributes` manifest 的一种类型
- 复用现有 manifest schema、lifecycle hooks、sandbox 机制
- 后续 RFC

**Layer 4: Hub**

- 复用现有 `HubIndexManager`、`HubInstaller` 基础设施
- 前提：Layer 1-3 可用后自然接入
- 后续 RFC

---

## 4. Layer 1: Internal Event Bus

### 4.1 核心事件清单

从 §2.2 的 5 种耦合模式中提炼出 11 个核心事件。每个事件都来自真实的耦合问题，不是凭空设计。

#### 领域 1: Agent 消息流（解决 Pattern 1）

| 事件           | 触发时机           | Payload                                  | 生产者        | 消费者                                           |
| -------------- | ------------------ | ---------------------------------------- | ------------- | ------------------------------------------------ |
| `agent:stream` | agent 输出流式片段 | `{ conversationId, message, agentType }` | AgentManagers | Bridge Adapter (→ renderer), Team, Channel       |
| `agent:finish` | agent 完成一轮回复 | `{ conversationId, message, agentType }` | AgentManagers | Bridge Adapter, Team, Channel, MessageMiddleware |
| `agent:error`  | agent 出错/崩溃    | `{ conversationId, error, agentType }`   | AgentManagers | Bridge Adapter, Team                             |

重构后，AgentManager 只需：

```ts
// Before (每个 Manager 重复 ~60 行)
ipcBridge.acpConversation.responseStream.emit(message);
teamEventBus.emit('responseStream', message);
channelEventBus.emitAgentMessage(id, message);
cronBusyGuard.setProcessing(false);
skillSuggestWatcher.onFinish();

// After (1 行)
eventBus.emit('agent:finish', { conversationId, message, agentType });
```

#### 领域 2: Turn 生命周期（解决 Pattern 2）

| 事件             | 触发时机           | Payload                                        | 生产者        | 消费者                                                                             |
| ---------------- | ------------------ | ---------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `turn:started`   | 用户消息开始被处理 | `{ conversationId }`                           | AgentManagers | CronBusyGuard (`setProcessing(true)`)                                              |
| `turn:completed` | 一轮对话结束       | `{ conversationId, workspace, model, isCron }` | AgentManagers | CronBusyGuard (`setProcessing(false)`), SkillSuggestWatcher, Renderer (via bridge) |

重构后，CronBusyGuard 自己订阅事件管理状态，不再由 AgentManager 调用：

```ts
// CronBusyGuard 内部
eventBus.on('turn:started', () => this.setProcessing(true));
eventBus.on('turn:completed', () => this.setProcessing(false));
```

#### 领域 3: 会话生命周期（解决 Pattern 3）

| 事件                    | 触发时机       | Payload                         | 生产者              | 消费者                                                                    |
| ----------------------- | -------------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `conversation:created`  | 会话创建后     | `{ id, type, workspace }`       | ConversationService | Tray, Renderer (via bridge)                                               |
| `conversation:deleting` | 会话删除前     | `{ id, source }`                | ConversationService | WorkerTaskManager (kill agent), Channel (cleanup), Cron (cleanup jobs)    |
| `conversation:deleted`  | 会话删除后     | `{ id }`                        | ConversationService | MessageCache (clear), Tray (refresh), Renderer (via bridge)               |
| `conversation:updated`  | 会话元数据变更 | `{ id, changes, modelChanged }` | ConversationService | WorkerTaskManager (kill if model changed), Tray (refresh if name changed) |

重构后，`conversationBridge.ts` 的删除逻辑从 5 步串联变为：

```ts
// Before (bridge 手动编排 5 个模块)
await workerTaskManager.kill(id);
await channelManager.cleanupConversation(id);
await conversationService.deleteConversation(id);
removeFromMessageCache(id);
emitConversationListChanged();
refreshTrayMenuSafely();

// After (service 发事件，各模块自行处理)
await conversationService.deleteConversation(id); // 内部 emit conversation:deleting → conversation:deleted
```

#### 领域 4: Cron 命令检测（解决 Pattern 4）

| 事件                    | 触发时机               | Payload                                        | 生产者            | 消费者      |
| ----------------------- | ---------------------- | ---------------------------------------------- | ----------------- | ----------- |
| `cron:command:detected` | 消息中检测到 cron 命令 | `{ conversationId, commands: [{kind, data}] }` | MessageMiddleware | CronService |

重构后，MessageMiddleware 不再 import cronService：

```ts
// Before (MessageMiddleware 直接 CRUD cron jobs)
import { cronService } from '../services/cron/cronServiceSingleton';
await cronService.addJob(jobData);

// After (只检测和通知)
eventBus.emit('cron:command:detected', { conversationId, commands });
```

#### 领域 5: Agent 配置注入（解决 Pattern 5）

| 事件                | 触发时机            | Payload                                                            | 生产者       | 消费者                            |
| ------------------- | ------------------- | ------------------------------------------------------------------ | ------------ | --------------------------------- |
| `agent:configuring` | agent 构建/初始化时 | `{ conversationId, agentType, config }` (waterfall, config 可修改) | AgentFactory | Team MCP 注入, Extension MCP 注入 |

重构后，Team 模块注册配置中间件，不再散布在每个 agent 类型中：

```ts
// Team 模块内部注册一次
eventBus.on('agent:configuring', (ctx) => {
  if (shouldInjectTeamGuideMcp(ctx.conversationId)) {
    ctx.config.mcpServers.push(getTeamGuideStdioConfig());
  }
});
```

### 4.2 接口设计

```ts
type EventHandler<T> = (payload: T) => void | Promise<void>

type EventBus = {
  /** 注册事件监听器 */
  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void

  /** 注册一次性监听器 */
  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void

  /** 移除监听器 */
  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void

  /** 发送事件（并行通知所有监听器） */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]>): void

  /**
   * Waterfall 发送（串行执行，每个 handler 可修改 payload）
   * 用于 agent:configuring 等需要中间件链的场景
   */
  waterfall<K extends keyof WaterfallEventMap>(
    event: K,
    payload: WaterfallEventMap[K]
  ): Promise<WaterfallEventMap[K]>
}
```

设计原则：

- **类型安全**：`EventMap` 定义所有事件的 payload 类型，`emit` 和 `on` 在编译时检查。
- **两种发送模式**：`emit`（并行通知，不关心返回值）和 `waterfall`（串行管道，handler 可修改 payload 并传递给下一个）。
- **不做的事**：不支持优先级排序、不支持 wildcard 匹配、不支持 event bubbling。简单的 pub/sub 足够解决当前问题。

### 4.3 与现有机制的关系

| 现有机制                         | 统一后的处理                                                   | 理由                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipcBridge.buildEmitter` (39 个) | **保留**                                                       | 它的职责是 main→renderer/WebSocket 通信，与内部 Event Bus 是不同层次。Bridge Adapter 作为 Event Bus 的消费者之一，将内部事件转发到 renderer。 |
| `teamEventBus`                   | **废弃** → 统一到 Event Bus 的 `agent:stream/finish`           | 本身只有 1 个事件 (`responseStream`)，是 ipcBridge 无法同进程监听的 workaround。                                                              |
| `channelEventBus`                | **废弃** → 统一到 Event Bus 的 `agent:stream/finish`           | 同上，只有 1 个事件 (`channel.agent.message`)。                                                                                               |
| `extensionEventBus`              | **保留**                                                       | 职责独立（Extension 间通信 + 生命周期），与核心业务事件无交集。                                                                               |
| `setConfirmHook`                 | **废弃** → 统一到 Event Bus 的 `confirmation:*` 事件（如需要） | 当前只有 petConfirmManager 使用，是缺少内部事件总线的 workaround。                                                                            |
| `setPetNotifyHook`               | **废弃** → Pet 模块直接订阅 Event Bus 需要的事件               | 当前是 ALL-event 拦截器，违反最小权限原则。                                                                                                   |

统一后的架构：

```
AgentManager
  │
  ├──emit──→ Internal Event Bus ──→ Team (on agent:finish)
  │              │                 ──→ Channel (on agent:stream/finish)
  │              │                 ──→ CronBusyGuard (on turn:started/completed)
  │              │                 ──→ SkillSuggestWatcher (on turn:completed)
  │              │                 ──→ Pet (on 需要的事件)
  │              │                 ──→ [未来] Hook API (Layer 2)
  │              │
  │              └──→ Bridge Adapter ──→ Renderer (ipcBridge.emit)
  │                                 ──→ WebSocket clients
  │
  └─ 不再 import teamEventBus, channelEventBus, cronBusyGuard, skillSuggestWatcher
```

---

## 5. Layer 2: Hook API

> 本节为方向性设计，详细规格留待 Layer 1 落地后的后续 RFC。

Hook API 建立在 Internal Event Bus 之上，区别在于：

| 维度         | Internal Event Bus (Layer 1) | Hook API (Layer 2)                    |
| ------------ | ---------------------------- | ------------------------------------- |
| 使用者       | AionUi 内部模块              | Extension 开发者                      |
| 信任级别     | 完全信任                     | 不信任，需要安全壳                    |
| 执行环境     | 直接在 main process 执行     | Sandbox（Worker Thread 或受控子进程） |
| 超时控制     | 无                           | before hooks: 5s，after hooks: 10s    |
| 权限         | 无限制                       | 需在 manifest 中声明                  |
| payload 访问 | 完整访问                     | 可能过滤敏感字段                      |

Hook 是 Layer 1 事件的受控镜像：

```
Internal Event Bus
  │
  ├── agent:finish ──→ [内部消费者直接处理]
  │
  └── agent:finish ──→ Hook Runtime ──→ sandbox 执行 extension hook handler
                          │
                          ├── 权限检查 (manifest 声明了 hooks.agent:finish?)
                          ├── 超时控制 (10s)
                          ├── payload 过滤 (移除敏感字段)
                          └── 错误隔离 (hook 失败不影响核心流程)
```

### 事件暴露策略

不是所有 Layer 1 事件都应暴露给 Hook API。初步分类：

| 事件                    | 暴露给 Hook API   | 理由                                                                   |
| ----------------------- | ----------------- | ---------------------------------------------------------------------- |
| `agent:stream`          | 只读通知          | 开发者可用于实时翻译、关键词检测                                       |
| `agent:finish`          | 只读通知          | 开发者可用于日志、分析、自动摘要                                       |
| `agent:error`           | 只读通知          | 开发者可用于错误监控                                                   |
| `turn:started`          | 只读通知          | 开发者可用于计时、UI 提示                                              |
| `turn:completed`        | 只读通知          | 开发者可用于自动后处理                                                 |
| `conversation:created`  | 只读通知          | 开发者可用于自动标签、模板注入                                         |
| `conversation:deleting` | 只读通知          | 开发者可用于备份、归档                                                 |
| `conversation:deleted`  | 只读通知          | 开发者可用于清理                                                       |
| `conversation:updated`  | 只读通知          | 开发者可用于同步                                                       |
| `cron:command:detected` | 不暴露            | 纯内部实现细节                                                         |
| `agent:configuring`     | waterfall（受限） | 开发者可注入 MCP servers 等配置，但需要 `hooks.agent:configuring` 权限 |

### 与 Discussion #2488 的对应

| Discussion 提案                   | 本 RFC 对应                                             |
| --------------------------------- | ------------------------------------------------------- |
| TCP404 的 `onBeforeSendMessage`   | Layer 2 hook，监听 `turn:started`，只读                 |
| TCP404 的 `onAfterReceiveMessage` | Layer 2 hook，监听 `agent:finish`，只读                 |
| TCP404 的 `onConversationCreate`  | Layer 2 hook，监听 `conversation:created`，只读         |
| TCP404 的 `onSettingsChange`      | 可扩展：Layer 1 新增 `settings:changed` 事件            |
| TCP404 的 `onModelSwitch`         | 可通过 `conversation:updated` + `modelChanged` 字段覆盖 |
| Castor6 的 `SessionStart`         | 对应 `conversation:created`                             |
| Castor6 的 `UserPromptSubmit`     | 对应 `turn:started`（Layer 2 hook 可读取 prompt 内容）  |
| Castor6 的 `Stop`                 | 对应 `turn:completed`                                   |
| Castor6 的 `PostCompact`          | 不适用 — AionUi 无 context compaction 机制              |
| Castor6 的 `command` 执行模式     | 待定 — 需评估安全性，见 §8                              |

---

## 6. Layer 3: Extension 整合

> 方向性设计，后续 RFC 详述。

hooks 成为 Extension manifest 的一种 `contributes` 类型：

```jsonc
{
  "name": "my-auto-translate",
  "version": "1.0.0",
  "contributes": {
    "hooks": {
      "agent:finish": {
        "handler": "hooks/translate.mjs",
        "timeout": 10000,
      },
    },
  },
  "permissions": {
    "hooks": ["agent:finish"],
  },
}
```

复用现有 Extension 基础设施：

- manifest schema（Zod 校验）
- lifecycle hooks（onInstall, onActivate, onDeactivate, onUninstall）
- Hub 安装/分发（HubIndexManager, HubInstaller）

需要重新评估的部分：

- Sandbox 执行模型的复杂度：当前 Worker Thread sandbox 是否过重？是否需要更轻量的选项？
- Castor6 提出的 `command` 模式（spawn 外部脚本）的安全性与适用场景

---

## 7. 迁移计划

### Phase 1: 建立 Event Bus + 解耦 Agent 消息扇出（Pattern 1 + 2）

**范围**：

- 新建 `src/process/eventBus/` 模块
- 重构 6 个 AgentManager，移除 teamEventBus / channelEventBus / cronBusyGuard / skillSuggestWatcher 的直接 import
- Team 模块改为订阅 `agent:stream/finish`
- Channel 模块改为订阅 `agent:stream/finish`
- CronBusyGuard 改为订阅 `turn:started/completed`

**验证**：

- 所有 AgentManager 不再 import team、channel、cron 模块
- 现有 team mode 功能正常
- 现有 channel bot 功能正常
- cron 定时任务不在 agent 工作时触发

**预期改动量**：~15 个文件，删除约 360 行重复代码

### Phase 2: 解耦 Conversation 生命周期（Pattern 3）

**范围**：

- ConversationService 在 create/delete/update 时 emit 事件
- `conversationBridge.ts` 不再手动串联清理链
- 各模块（WorkerTaskManager、Channel、MessageCache、Tray）改为订阅事件

**验证**：

- 删除会话后所有关联资源被正确清理
- `conversationBridge.ts` 复杂度显著降低

### Phase 3: 解耦 MessageMiddleware（Pattern 4）

**范围**：

- MessageMiddleware 只负责检测 cron 命令，emit `cron:command:detected`
- CronService 订阅并处理
- MessageMiddleware 移除对 cronService 的 import

### Phase 4: 解耦 Team MCP 注入（Pattern 5）

**范围**：

- 引入 `agent:configuring` waterfall 事件
- Team 模块注册配置中间件
- 移除 5 个文件中散布的 `shouldInjectTeamGuideMcp` 调用

---

## 8. 安全边界

### Layer 1 (Internal Event Bus) 的安全模型

Layer 1 是纯内部机制，运行在 main process 的信任域内，不需要额外的安全控制。但需要注意：

- Event Bus 模块不应暴露到 preload 或 renderer
- Event Bus 不应通过 IPC bridge 暴露给外部

### Layer 2 (Hook API) 的安全红线

以下 hook 行为必须禁止（写入 Layer 2 RFC 时作为硬性约束）：

| 禁止项                                               | 理由                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| Hook 拦截/修改 IPC bridge 调用                       | 破坏 Electron 安全模型                             |
| Hook 访问任意文件系统路径                            | 需要 `filesystem` permission 且限定 scope          |
| Hook 访问凭证（OAuth tokens, API keys, JWT secrets） | 数据泄露风险                                       |
| Hook spawn 不受限子进程                              | 等同 RCE，必须走 sandbox 或要求 `shell` permission |
| `beforeSend` hook 替换用户原始消息内容               | prompt injection 入口，只允许追加 metadata         |
| Hook 注入 preload 脚本或修改 contextBridge           | 摧毁 Electron context isolation                    |
| Hook 注入 Worker Thread 代码                         | Worker 有 Node.js 全权限                           |

### `command` 模式的安全评估

Discussion #2488 中 Castor6 提出的 `type: "command"` 模式（spawn 外部脚本）：

- **优点**：简单直接，语言无关（Python/Node/Shell 都行），类似 git hooks
- **风险**：子进程拥有与 AionUi main process 相同的系统权限，无 sandbox 隔离
- **建议**：如果采用，必须 (1) 要求 `shell` permission，(2) 限制可执行路径为 Extension 目录内，(3) 用户安装时明确提示风险等级，(4) timeout 上限远低于 Castor6 建议的 600s（建议 30s）

---

## 9. Open Questions

| #   | 问题                                                                                    | 影响范围         | 备选方案                                                                           |
| --- | --------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Q1  | Event Bus 是否需要支持异步 handler？                                                    | Layer 1 接口设计 | A: 纯同步（简单但限制消费者）; B: 支持 async handler + Promise.allSettled（推荐）  |
| Q2  | `conversation:deleting` 事件的消费者需要保证执行顺序吗？                                | Phase 2 迁移     | A: 并行执行所有消费者（简单）; B: 支持 priority 排序（复杂但可控）                 |
| Q3  | Bridge Adapter 监听 Event Bus 后转发到 renderer 的机制如何实现？                        | 架构衔接         | A: 显式注册（手动列出要转发的事件）; B: 自动转发所有事件（简单但可能泄露内部事件） |
| Q4  | Layer 2 的执行模型最终选 sandbox (Worker Thread) 还是 command (spawn)，还是两者都支持？ | Layer 2 RFC      | 待 Layer 1 落地后结合实际需求决定                                                  |
| Q5  | `agent:configuring` waterfall 事件的 handler 执行顺序如何确定？                         | Phase 4 迁移     | A: 注册顺序; B: 显式 priority 值                                                   |
| Q6  | 现有 `extensionEventBus` 是否最终也应合并到统一 Event Bus？                             | 长期架构         | 当前保持独立，观察 Layer 2 落地后是否有合并需求                                    |
