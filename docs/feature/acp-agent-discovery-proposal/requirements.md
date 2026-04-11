# AionUi ACP Agent 发现与运行时托管方案提案

> 日期：2026-04-07（更新：2026-04-08）
> 状态：提案草稿
> 关联方案：`1-acp-optimization-plan-final.md` (P4: 运行时托管)
> 参考实现：`5-zed-acp-registry-internals.md` (Zed ACP Registry 内部分析)

---

## 一、问题陈述

AionUi 当前的 ACP Agent 集成存在多类问题，按根因可分为三大类。

### 1. Agent 可执行文件发现机制脆弱

当前方案依赖 `which` / `where` 在用户 PATH 中搜索 Agent 可执行文件（如 `claude`、`codex`）。该方案在 Agent Hub 出现之前勉强可用，但随着生态发展，**同一台机器上同名可执行文件越来越多**。

以 `claude` 为例，在一台典型开发机上执行 `fd -H -t x '^claude$' /` 会发现至少以下来源：

| 来源                    | 路径示例                                                  | 说明                              |
| ----------------------- | --------------------------------------------------------- | --------------------------------- |
| 用户全局安装            | `/usr/local/bin/claude`                                   | npm -g 或 brew 安装               |
| VSCode Claude Code 插件 | `~/.vscode/extensions/anthropic.claude-code-*/cli/claude` | 插件自带，版本由插件管理          |
| claude-code-sdk         | `node_modules/.bin/claude`                                | 项目级依赖                        |
| Zed 托管                | `~/Library/Application Support/Zed/node/.../npm exec`     | Zed 通过 npx 运行，不留全局二进制 |

`which` 命中的是哪个，完全取决于用户 shell profile 的 PATH 顺序。这导致：

- **不可预测**：同一用户在不同终端、不同 shell 下可能命中不同版本。
- **版本漂移**：用户更新全局安装时，AionUi 无法感知版本变化，也无法保证兼容性。
- **误命中**：命中了不支持 ACP 的旧版本，或命中了不在预期上下文中运行的版本（如 VSCode 插件内嵌版本）。
- **错误归因困难**：npx 找不到时报 `'claude' CLI Not Found`，用户无法判断是 ACP 问题还是环境问题。

**这不是一个可以靠"更好的 which"解决的问题。** 所有基于全局搜索的方案，本质上都是在赌用户环境的一致性。

### 2. 状态管理与错误处理不闭环

这类问题在 `1-acp-optimization-plan-final.md` 中已有详细分析（P0-P2），核心表现包括：

- **断连伪装成 finish**：连接层知道进程退出的 code/signal，但 `handleDisconnect()` 只发 `finish`，不透传断连原因。
- **Queue 死锁**：turn 结束信号丢失或状态未正确归零时，后续消息持续被当作 busy 而进入队列，用户只能刷新。
- **空消息队列状态下消息仍入队**：ACP 状态同步不准确，renderer 侧对 running/idle 的推断与 process 侧不一致。
- **消息入队后吐不出来**：queue/busy gate 依赖 renderer 推断的状态，如果 turn 结束信号丢失，队列永远卡住。

这些问题在 Sprint 1-3 中已有修复计划，不再赘述。

### 3. 硬编码适配问题

这类问题纯粹是工程质量问题：

- **`set_mode` / `set_model` 硬编码不兼容值**：向 Agent 发送其不支持的 mode 或 model 值，导致 Agent 拒绝或行为异常。这类参数应该从 Agent 的 capability 声明中动态获取，而不是客户端硬编码。
- **缺少 capability 适配**：不同 Agent 支持的功能集不同（如是否支持 `session/load`、`session/resume`、tool confirmation 等），当前缺少统一的 capability 查询和降级机制。
- **测试覆盖不足**：上述兼容性问题在上线前应该被多 Agent 交叉测试发现，反映出测试矩阵的缺失。

---

## 二、根因分析：`which` 方案为什么不可持续

`which` 方案的核心假设是：**用户机器上有且只有一个正确的 Agent 可执行文件，且它在 PATH 中。**

这个假设在 2025 年初或许成立。当时 ACP Agent 生态刚起步，大部分用户只有一个全局安装的 `claude` CLI。但到 2026 年 Q2，情况已经根本改变：

1. **Agent 数量爆发**：ACP Registry 已有 25+ Agent（amp、auggie、claude、codex、cursor、gemini、goose、junie、kilo、kimi 等），且还在快速增长。
2. **每个 IDE/工具都自带 Agent**：VSCode、JetBrains、Zed 都在自己的扩展/插件体系内托管 Agent 的安装和运行，不依赖全局 PATH。
3. **同名冲突不可避免**：`claude` 这个名字同时被全局 CLI、VSCode 插件、SDK 依赖、npx 缓存使用。
4. **AionUi 已有自建 AgentHub**：AionUi 有自己的扩展分发体系（`https://github.com/iOfficeAI/AionHub`），已支持扩展级别的 Agent 安装。但当前 Hub 安装的扩展最终仍依赖 `which` 检测 CLI 是否可用，没有实现运行时托管。

**结论：`which` 方案的风险已经充分暴露，是时候在现有 AgentHub 基础上增强为完整的运行时托管方案。**

---

## 三、现有 AgentHub 架构分析

### 3.1 整体架构

AionUi 已有自建的 AgentHub 扩展分发系统，核心组件：

| 组件              | 文件                                                          | 职责                                       |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `HubIndexManager` | `src/process/extensions/hub/HubIndexManager.ts`               | 加载、合并 Hub 索引（本地 bundled + 远程） |
| `HubStateManager` | `src/process/extensions/hub/HubStateManager.ts`               | 运行时状态追踪（安装中/已安装/失败等）     |
| `HubInstaller`    | `src/process/extensions/hub/HubInstaller.ts`                  | 扩展下载、校验、解压、安装编排             |
| `AgentHubModal`   | `src/renderer/pages/settings/AgentSettings/AgentHubModal.tsx` | Hub UI 组件                                |
| `useHubAgents`    | `src/renderer/hooks/agent/useHubAgents.ts`                    | React hook 管理 Hub 生命周期               |
| `hubBridge.ts`    | `src/process/bridge/hubBridge.ts`                             | IPC 桥接                                   |
| lifecycle runner  | `src/process/extensions/lifecycle/lifecycle.ts`               | 执行扩展 onInstall/onActivate 等钩子       |

### 3.2 Hub Index

Hub 索引有两个来源，运行时合并（远程覆盖本地同名项）：

**本地 bundled** (`resources/hub/index.json`)：随 app 打包，包含 4 个预置扩展（auggie、codebuddy、opencode、qwen）。

**远程** (`HUB_REMOTE_URLS`)：

```
https://raw.githubusercontent.com/iOfficeAI/AionHub/dist-latest/index.json
https://cdn.jsdelivr.net/gh/iOfficeAI/AionHub@dist-latest/index.json
```

### 3.3 Extension Manifest（aion-extension.json）

每个扩展通过 manifest 声明其贡献的 ACP 适配器和安装方式：

```json
{
  "name": "aionext-auggie",
  "displayName": "Augment Code",
  "version": "1.0.0",
  "contributes": {
    "acpAdapters": [
      {
        "id": "auggie",
        "name": "Augment Code",
        "cliCommand": "auggie",
        "defaultCliPath": "bunx @augmentcode/auggie",
        "acpArgs": ["--acp"],
        "authRequired": false,
        "supportsStreaming": false
      }
    ]
  },
  "lifecycle": {
    "onInstall": {
      "shell": { "cliCommand": "bun", "args": ["run", "scripts/install.ts"] },
      "timeout": 30000
    }
  }
}
```

manifest 中已经声明了 `ACP_BACKENDS_ALL` 中大量硬编码的信息（acpArgs、cliCommand、authRequired 等）。

### 3.4 Lifecycle 执行机制

`lifecycle.ts` 通过 `child_process.fork()` 在独立进程中执行 onInstall 钩子：

```typescript
// lifecycle.ts:144-148
child = fork(runnerScript, [], {
  cwd: extension.directory,
  env: getEnhancedEnv(), // 包含 bundled bun 的 PATH
  silent: false,
});
```

`lifecycleRunner.ts` 接收 IPC 消息后执行 shell 命令或 script。当前只允许 `bun` 和 `bunx` 两个命令（白名单）。

### 3.5 现有 install.ts 模式

AionHub 中的扩展 install.ts 已经覆盖了多种安装方式：

| 模式           | 示例                                      | 使用者                 |
| -------------- | ----------------------------------------- | ---------------------- |
| npm 包直接安装 | `bun install -g @augmentcode/auggie`      | auggie, qwen           |
| 多源重试       | 依次尝试 npm 官方源、华为、腾讯、淘宝镜像 | codebuddy              |
| npm + trust    | `bun add -g --trust opencode-ai`          | opencode, droid, qoder |
| curl \| bash   | `curl -fsSL .../install.sh \| bash`       | goose, kimi, kiro      |
| 平台判断       | Windows: PowerShell irm, Unix: curl       | mistral-vibe           |
| 两步安装       | 先装 CLI 再装 ACP adapter                 | claude, codex          |

### 3.6 当前方案的局限

**Hub 只解决了"分发扩展包"的问题，没有解决"运行时托管"的问题。** 具体表现：

1. **安装位置不可控**：`bun install -g` 装到 bun 全局目录，路径取决于 bun 配置，不由 AionUi 管理。
2. **检测仍走 `which`**：`HubInstaller.verifyInstallation()` 最终调用 `AcpDetector.refreshAll()`，仍然依赖 `which` 检测 CLI。如果 CLI 不在 PATH 中，就被判定为安装失败。
3. **版本不可控**：扩展声明 `contributes.acpAdapters: ["qwen"]`，但不控制用户系统上的 `qwen` 是什么版本。
4. **scripts 未打包**：当前 zip 包只含 `aion-extension.json`，install.ts 没有被打进包里。manifest 写了 `bun run scripts/install.ts` 但实际执行时脚本不存在。

---

## 四、参考实现：Zed 的 ACP Registry 方案

> 以下分析基于 Zed commit 77ee72e665 (2026-04-06) 的源码，完整细节见 `5-zed-acp-registry-internals.md`。

### 4.1 整体架构

Zed 安装后只有一个内置 Agent（Zed Agent）。所有第三方 Agent（Claude、Codex、Auggie、Goose 等）都通过 ACP Registry 安装。

### 4.2 核心设计

- **Binary 按需下载 + 版本隔离**：安装到 `~/Library/Application Support/Zed/external_agents/registry/{agent-id}/v_{hash}/`，从安装目录启动，不走 `which`。
- **Node.js 三级回退**：自定义路径 → 系统 PATH → 自动下载到应用数据目录。
- **NPX 隔离**：空白 npmrc + 独立 cache 目录。

### 4.3 对 AionUi 的借鉴价值

AionUi 和 Zed 的关键区别：**AionUi bundled 了 bun**。这意味着：

- Zed 需要解决 Node.js 运行时问题（三级回退），AionUi 可以直接用 bundled bun 的 `bunx` 替代 `npx`。
- Zed 需要在核心代码中实现 BinaryInstaller，AionUi 可以把安装逻辑放在每个扩展的 `install.ts` 中——更灵活、更解耦。
- Zed 从 ACP 官方 Registry (`cdn.agentclientprotocol.com`) 获取 Agent 列表，AionUi 有自己的 AgentHub (`github.com/iOfficeAI/AionHub`)。

**结论：不需要照搬 Zed 的方案，AionUi 可以基于已有的 AgentHub + Extension lifecycle 机制，以更简单的方式实现运行时托管。**

---

## 五、AionUi 改进提案

### 5.1 总体方向

在现有 AgentHub + Extension lifecycle 基础上增强为**完整的运行时托管方案**。核心思路：

1. **安装逻辑留在扩展 `install.ts` 中**：每个 Agent 的安装方式不同（npm 包、curl binary、多源重试等），由扩展自己处理，不在 AionUi core 中造通用抽象。
2. **AionUi 只负责提供安装目录**：lifecycle runner 在执行 onInstall 时注入 `AIONUI_AGENT_INSTALL_DIR` 环境变量，install.ts 往该目录安装可执行文件。
3. **从安装目录启动，不走 `which`**：Agent 发现逻辑改为先查 managed 安装目录，`which` 降级为 fallback。
4. **元数据从扩展 manifest 获取，不硬编码**：`ACP_BACKENDS_ALL` 中的 acpArgs、cliCommand 等信息已经在 `aion-extension.json` 的 `contributes.acpAdapters` 中声明。

### 5.2 安装流程（升级后）

```
用户在 AgentHubModal 点击 Install
  |
  v
HubInstaller.install(name)
  │
  ├─ 下载/解压扩展 zip（包含 aion-extension.json + scripts/）
  │
  ├─ 手动触发热重载 ExtensionRegistry.hotReload()
  │
  └─ 执行 onInstall lifecycle hook:
      ├─ lifecycle runner 计算安装目录: ~/...AionUi/agents/managed/{extension-name}/v_{version}/
      │
      ├─ 注入 env: AIONUI_AGENT_INSTALL_DIR=<上述路径>
      │
      └─ fork 子进程执行 `bun run scripts/install.ts`
          │
          └─ install.ts 把可执行文件装到 $AIONUI_AGENT_INSTALL_DIR
  |
  v
验证安装：检查 AIONUI_AGENT_INSTALL_DIR 中是否存在可执行文件
（不再走 AcpDetector.refreshAll() + which）
```

### 5.3 install.ts 示例（升级后）

```typescript
// aionext-auggie/scripts/install.ts
import { $ } from 'bun';

const installDir = process.env.AIONUI_AGENT_INSTALL_DIR!;
await $`bun install --cwd ${installDir} @augmentcode/auggie`;
```

```typescript
// aionext-goose/scripts/install.ts
import { $ } from 'bun';

const installDir = process.env.AIONUI_AGENT_INSTALL_DIR!;
if (process.platform === 'win32') {
  throw new Error('Goose does not support Windows.');
}
// 下载 binary 到 managed 目录
await $`curl -fsSL https://github.com/block/goose/releases/latest/download/goose-darwin-arm64 -o ${installDir}/goose`;
await $`chmod +x ${installDir}/goose`;
```

### 5.4 Agent 发现（升级后）

```
用户选择一个 Agent (e.g., "Claude")
  |
  v
1. acp.config[claude].cliPath — 用户手动指定了路径？
   --> 有：直接使用
   |
   v 没有
2. managed 安装目录 ~/.aionui-agents/aionext-claude/0.25.3_c9b1e5a2/  (dev: ~/.aionui-agents-dev/)
   --> 有可执行文件：直接从该路径启动
   |
   v 没有
3. 已安装扩展 manifest 的 defaultCliPath（如 "bunx @augmentcode/auggie"）
   --> bunx 即时运行（bun 已 bundled，不依赖用户环境）
   |
   v 没有
4. which('claude') — 系统 PATH
   --> 有：使用（标记为 unmanaged）
   |
   v 没有
5. 报错："Agent 不可用，请通过 Agent Hub 安装"
```

### 5.5 安装目录结构

安装目录（暂不开放用户自定义）：

- Release: `~/.aionui-agents/`（软链接 → `~/Library/Application Support/AionUi/agents/`）
- Dev: `~/.aionui-agents-dev/`

遵循项目已有的 `getDataPath()` / `getConfigPath()` 同模式（`ensureCliSafeSymlink` + `getEnvAwareName`）。

```
~/.aionui-agents/
├── aionext-auggie/
│   └── 1.0.0_a3f8b2c1/                      # {version}_{contentHash 前 8 位}
│       └── node_modules/.bin/auggie          # bun install --cwd 的产物
├── aionext-goose/
│   └── 1.0.0_7e2d4f01/
│       └── goose                             # curl 下载的 binary
└── aionext-claude/
    └── 0.25.3_c9b1e5a2/
        └── node_modules/.bin/claude-agent-acp
```

目录名用内容 hash（扩展文件内容的 SHA-256 前 8 位）而非纯版本号，保证即使版本号未 bump 但内容变了也会安装到新目录。

### 5.6 用户配置继承

**核心原则：我们只管可执行文件从哪里来，不干预 Agent 运行时的配置发现行为。**

Agent spawn 时的环境保持和用户在终端直接运行一致：

- `HOME` = 用户 home 目录（Agent 能找到 `~/.claude/settings.json` 等配置）
- 环境变量全量继承（API keys 等透传）
- 工作目录 = 用户选择的 workspace
- 不设 `NPM_CONFIG_PREFIX` 等，不干预 Agent 自身的包管理逻辑

### 5.7 错误分层

替换当前笼统的 "CLI Not Found"：

| 错误阶段 | 错误类型        | 用户可见信息                 | 可操作动作       |
| -------- | --------------- | ---------------------------- | ---------------- |
| Hub      | 网络不可达      | "无法获取 Agent 列表"        | 重试 / 检查网络  |
| 安装     | install.ts 失败 | "{Agent} 安装失败: {reason}" | 重试 / 查看日志  |
| 安装     | 平台不支持      | "{Agent} 不支持当前平台"     | 无               |
| 运行时   | 启动失败        | "{Agent} 启动失败: {reason}" | 查看日志 / 重试  |
| 运行时   | 协议不兼容      | "{Agent} 版本不兼容"         | 更新 Agent       |
| 认证     | auth_required   | "需要认证"                   | Authenticate CTA |

### 5.8 Capability 适配

从 ACP `initialize` 握手中获取 Agent 的能力声明，替代当前的硬编码：

- modes/models 从 `session/new` 返回的 `configOptions` 动态获取
- `agentModes.ts` 硬编码降级为 fallback
- UI 层根据 capability 决定显示哪些选项

### 5.9 与现有改造计划的关系

| Sprint       | 已有计划                | 本提案补充           |
| ------------ | ----------------------- | -------------------- |
| Sprint 1-3   | P0-P2: 状态/错误/热路径 | 不受影响，继续推进   |
| Sprint 4     | P3: 连接复用            | 不受影响             |
| **Sprint 5** | P4: 运行时托管 (空缺)   | **本提案填充此阶段** |

---

## 六、Agent 运行时流程分析

### 6.1 AcpConnection 路由机制

`AcpConnection.doConnect()` 通过 `switch(backend)` 路由到不同的 connector：

| backend 值                             | connector                 | 特点                                                                                   |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `'claude'`                             | `connectClaude()`         | 硬编码 `@zed-industries/claude-agent-acp@0.21.0`，Phase 1/2 NPX 重试                   |
| `'codex'`                              | `connectCodex()`          | 硬编码平台特定包名（win32-x64/linux-arm64/darwin-arm64），缓存 binary 优先 + Phase 1/2 |
| `'codebuddy'`                          | `connectCodebuddy()`      | 硬编码 `@tencent-ai/codebuddy-code@2.70.1`                                             |
| `'qwen'`/`'goose'`/`'auggie'` 等 14 个 | `connectGenericBackend()` | 需要 cliPath，通用 `spawnGenericBackend()`                                             |
| `'custom'`                             | `connectGenericBackend()` | 同上，Extension agent 和用户自定义 agent 都走这条路径                                  |

### 6.2 Extension Agent 的 backend 值

**Extension agent 的 `backend` 永远是 `'custom'`**。在 `AcpDetector.detectExtensionAgents()` 中：

```typescript
// AcpDetector.ts — detectExtensionAgents()
agent: {
  backend: 'custom' as const,                        // 硬编码为 custom
  customAgentId: `ext:${extensionName}:${adapterId}`, // 仅作标识
  cliPath: adapter.defaultCliPath,
  acpArgs: adapter.acpArgs,
}
```

即使扩展声明的 adapter id 是 `"claude"`，`backend` 仍然是 `'custom'`。这意味着 **extension agent 永远走 `spawnGenericBackend()`**，不会走 `connectClaude()` 等专用连接器。

### 6.3 完整启动流程

```
用户选择 Agent → renderer IPC → WorkerTaskManager → AcpAgentManager.initAgent()
  |
  v
解析 CLI 路径（AcpAgentManager）：
  - Extension agent: ExtensionRegistry.getAcpAdapters() → adapter.defaultCliPath + acpArgs
  - Builtin agent: acp.config[backend].cliPath || ACP_BACKENDS_ALL[backend].cliCommand
  - Custom agent: acp.customAgents[id].defaultCliPath
  |
  v
AcpAgent.start() → AcpConnection.doConnect(backend, cliPath, workingDir, acpArgs, customEnv)
  |
  v
switch(backend) 路由：
  - 'claude'/'codex'/'codebuddy' → 专用 connector（hardcoded NPX 包）
  - 其余 builtin → connectGenericBackend()
  - 'custom'（extension + 用户自定义） → connectGenericBackend()
  |
  v
prepareCleanEnv()：
  - 加载用户 shell 环境（~/.zshrc 中的 API_KEY 等）
  - 合并 getEnhancedEnv()（bundled bun/node 的 PATH）
  - 去掉有害变量（NODE_OPTIONS、npm_* 等）
  - 合并 customEnv（extension/custom agent 的额外环境变量）
  |
  v
spawn(command, args, { stdio: ['pipe','pipe','pipe'], env, cwd: workingDir })
  |
  v
JSON-RPC over stdio：initialize → session/new → 会话就绪
```

### 6.4 对迁移方案的影响

1. **Extension agent 已经走 generic 路径** — 不需要改路由逻辑，只需要在 CLI path 解析阶段（`AcpAgentManager.initAgent()`）插入 managed 目录查找
2. **Hub 安装的 Agent 不走专用 connector** — 不会走 `connectClaude()` 的 NPX Phase 1/2 重试逻辑。但我们已经装到 managed 目录了，不需要 NPX 重试
3. **环境准备对所有路径一致** — `prepareCleanEnv()` 统一处理，用户 API key、HOME 都能正确透传

### 6.5 AcpBackendConfig 字段审计

`AcpBackendConfig`（`acpTypes.ts`）定义了 Agent 的元数据字段。审计发现大量字段已成死代码：

**运行时生效的字段：**

| 字段                                       | 运行时使用位置                                              |
| ------------------------------------------ | ----------------------------------------------------------- |
| `cliCommand`                               | `AcpDetector.detectBuiltinAgents()` 用 `which` 检测是否安装 |
| `acpArgs`                                  | `spawnGenericBackend()` 传给进程的参数                      |
| `enabled`                                  | 控制 Agent 是否在 UI 中可用                                 |
| `env`                                      | spawn 时注入的额外环境变量                                  |
| `skillsDirs`                               | Agent 技能目录声明                                          |
| `name` / `avatar` / `description`          | UI 展示                                                     |
| `isPreset` / `context` / `presetAgentType` | 预设 Agent 相关                                             |
| `enabledSkills` / `customSkillNames`       | 技能管理                                                    |

**半生效的字段：**

| 字段             | 问题                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultCliPath` | claude/codex/codebuddy 三个专用 connector **硬编码了 NPX 包名**，完全忽略此字段。仅通用 `spawnGenericBackend()` 路径的 Agent 会读取。 |

**死代码字段（定义了但运行时从未读取）：**

| 字段                | 说明                            |
| ------------------- | ------------------------------- |
| `authRequired`      | 未被任何运行时逻辑消费          |
| `supportsStreaming` | 同上                            |
| `apiKeyFields`      | 同上                            |
| `connectionType`    | 同上，所有 Agent 实际都走 stdio |
| `models`            | 同上，renderer 侧未消费         |
| `isBuiltin`         | 同上                            |

**关键发现：** `connectClaude()` / `connectCodex()` / `connectCodebuddy()` 三个专用连接函数中，NPX 包和版本号是硬编码常量（如 `CLAUDE_ACP_NPX_PACKAGE = '@zed-industries/claude-agent-acp@0.21.0'`），不读取 `AcpBackendConfig` 中的 `defaultCliPath`。

---

## 七、风险与边界

### 6.1 已知风险

- **Hub 远程源不可达**：GitHub raw / jsDelivr 不可达时，已安装 Agent 仍可从 managed 目录启动，但新安装和更新会受阻。bundled 扩展始终可用。
- **install.ts 安全性**：扩展的 install.ts 可以执行任意 bun/bunx 命令。需要 trust mechanism（已有设计文档 `extension-trust-mechanism.md`）。
- **企业环境限制**：部分企业环境禁止自动下载外部二进制。需支持手动指定 `cliPath` 旁路。
- **bun 兼容性**：部分 npm 包可能与 bun 不完全兼容。bundled bun 的版本需要定期更新。

### 6.2 不在本提案范围内

- P0-P2 的状态管理、错误处理、热路径改造（已有独立 Sprint 计划）
- P3 的连接复用拓扑（已有独立 Sprint 计划）
- ACP 协议本身的演进（不是 AionUi 能单方面决定的）

---

## 八、附录

### A. ACP Registry 当前 Agent 列表快照 (2026-04-07)

共 25 个 Agent，按分发方式分类：

**Binary only (6)**：amp-acp, corust-agent, cursor, kimi, mistral-vibe, opencode

**NPX only (11)**：auggie, autohand, claude-acp, cline, codebuddy-code, deepagents, factory-droid, gemini, github-copilot-cli, nova, pi-acp, qoder, qwen-code

**Binary + NPX (3)**：codex-acp, kilo, stakpak

**uvx only (3, Zed 未支持)**：crow-cli, fast-agent, minion-code

### B. AionHub 扩展现状 (2026-04-08)

**Active（4 个，在 `extensions/` 目录）：**

| 扩展名            | 适配 Agent   | 安装方式                    |
| ----------------- | ------------ | --------------------------- |
| aionext-auggie    | Augment Code | `bun install -g` (多源重试) |
| aionext-codebuddy | CodeBuddy    | `bun install -g` (多源重试) |
| aionext-opencode  | OpenCode     | `bun add -g --trust`        |
| aionext-qwen      | Qwen CLI     | `bun install -g`            |

**Pending（10 个，在 `pending/` 目录）：**

| 扩展名                   | 适配 Agent     | 安装方式                    |
| ------------------------ | -------------- | --------------------------- |
| aionext-claude           | Claude Code    | 两步: CLI + ACP adapter     |
| aionext-codex            | Codex          | 两步: CLI + ACP adapter     |
| aionext-copilot          | GitHub Copilot | `bun install -g`            |
| aionext-droid            | Factory Droid  | `bun add -g --trust`        |
| aionext-goose            | Goose          | `curl \| bash` (no Windows) |
| aionext-kimi             | Kimi Code      | `curl \| bash` (no Windows) |
| aionext-kiro             | Kiro CLI       | `curl \| bash` (no Windows) |
| aionext-mistral-vibe     | Mistral Vibe   | 平台判断: curl / PowerShell |
| aionext-openclaw-gateway | OpenClaw       | `bun install -g`            |
| aionext-qoder            | Qoder CLI      | `bun add -g --trust`        |

### C. 关键参考源码路径

**AionUi Hub + Extension 系统：**

| 文件                                                  | 职责                               |
| ----------------------------------------------------- | ---------------------------------- |
| `src/process/extensions/hub/HubIndexManager.ts`       | Hub 索引加载与合并                 |
| `src/process/extensions/hub/HubStateManager.ts`       | 安装状态追踪                       |
| `src/process/extensions/hub/HubInstaller.ts`          | 安装编排                           |
| `src/process/extensions/lifecycle/lifecycle.ts`       | lifecycle hook 执行（fork 子进程） |
| `src/process/extensions/lifecycle/lifecycleRunner.ts` | 子进程中执行 shell/script          |
| `src/process/extensions/constants.ts`                 | 远程 URL、schema version           |
| `src/common/types/hub.ts`                             | Hub 类型定义                       |

**AionUi ACP 系统：**

| 文件                                     | 职责                                     |
| ---------------------------------------- | ---------------------------------------- |
| `src/process/agent/acp/AcpDetector.ts`   | Agent 发现（which + extension + custom） |
| `src/common/types/acpTypes.ts`           | ACP_BACKENDS_ALL 硬编码元数据            |
| `src/process/agent/acp/acpConnectors.ts` | 进程 spawn、环境准备                     |
| `src/renderer/utils/model/agentModes.ts` | 硬编码的 per-backend mode 列表           |

**AionHub 仓库：**

| 文件                                  | 职责                              |
| ------------------------------------- | --------------------------------- |
| `extensions/*/aion-extension.json`    | 扩展 manifest                     |
| `extensions/*/scripts/install.ts`     | 扩展安装脚本                      |
| `.github/scripts/build-extensions.js` | 构建脚本（生成 zip + index.json） |
