# ACP Agent Registry 迁移实施方案

> 日期：2026-04-08
> 状态：方案草稿
> 前置文档：`requirements.md` (问题陈述与提案方向)

---

## 一、方案概述

基于现有 AgentHub + Extension lifecycle 机制，用最小改动实现运行时托管。

**核心思路**：

- **安装逻辑留在扩展 `install.ts` 中**：每个 Agent 安装方式不同，由扩展自己处理
- **AionUi 只负责两件事**：
  1. 提供安装目录环境变量
  2. 从该目录启动 Agent
- **不在 AionUi core 中造 BinaryInstaller / NodeRuntimeManager 等通用抽象**

**为什么这样做比之前的方案更好**：

- AionUi 已 bundled bun → 不需要 Node.js 三级回退，`bunx` 替代 `npx`
- 扩展 install.ts 已覆盖 npm/binary/curl 等安装模式 → 不需要通用 BinaryInstaller
- 每个 Agent 安装差异大 → 放在扩展侧比抽象到 core 更灵活

---

## 二、运行时流程分析

### 2.1 AcpConnection 路由

`AcpConnection.doConnect()` 通过 `switch(backend)` 路由到不同的 connector：

- `'claude'` / `'codex'` / `'codebuddy'` → 专用 connector（**硬编码 NPX 包名 + 版本号**，有 Phase 1/2 重试）
- `'qwen'` / `'goose'` / `'auggie'` 等 14 个通用 builtin → `connectGenericBackend()`（需要 `cliPath`）
- `'custom'` → `connectGenericBackend()`（Extension agent 和用户自定义 agent 都走这条路径）

### 2.2 Extension Agent 的 backend

**Extension agent 的 `backend` 永远是 `'custom'`**（`AcpDetector.detectExtensionAgents()` 中硬编码）。即使扩展声明的 adapter id 是 `"claude"`，`backend` 仍然是 `'custom'`。

这意味着 **extension agent 永远走 `spawnGenericBackend()`**，不会走 `connectClaude()` 等专用连接器的硬编码 NPX 逻辑。

### 2.3 启动流程

```
用户选择 Agent → renderer IPC → AcpAgentManager.initAgent()
  → 解析 CLI 路径:
      Extension: ExtensionRegistry.getAcpAdapters() → adapter.defaultCliPath
      Builtin: acp.config[backend].cliPath || ACP_BACKENDS_ALL[backend].cliCommand
  → AcpConnection.doConnect(backend, cliPath, workingDir, acpArgs, customEnv)
  → switch(backend) 路由到 connector
  → prepareCleanEnv() (用户 shell env + bundled PATH - 有害变量 + customEnv)
  → spawn(command, args, { stdio: pipe, env, cwd })
  → JSON-RPC: initialize → session/new → 就绪
```

### 2.4 对方案的影响

1. **Extension agent 已走 generic 路径** — 不需要改路由逻辑，只需在 CLI path 解析阶段插入 managed 目录查找
2. **Hub 安装的 Agent 不走专用 connector** — 不会触发 NPX Phase 1/2 重试。从 managed 目录启动不需要 NPX
3. **环境准备对所有路径一致** — `prepareCleanEnv()` 统一处理，用户 API key、HOME 正确透传

### 2.5 AcpBackendConfig 字段审计

| 分类       | 字段                                                                                                                                                               | 状态                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 运行时生效 | `cliCommand`, `acpArgs`, `enabled`, `env`, `skillsDirs`, `name`/`avatar`/`description`, `isPreset`/`context`/`presetAgentType`, `enabledSkills`/`customSkillNames` | ✅ 在用                                                                                   |
| 半生效     | `defaultCliPath`                                                                                                                                                   | ⚠️ claude/codex/codebuddy 专用 connector 硬编码 NPX 包名，忽略此字段；仅 generic 路径读取 |
| 死代码     | `authRequired`, `supportsStreaming`, `apiKeyFields`, `connectionType`, `models`, `isBuiltin`                                                                       | ❌ 定义了但运行时从未消费                                                                 |

**结论**：Extension manifest 只需声明运行时生效的字段，死代码字段不搬迁。

---

## 三、AionUi 侧改动

### 3.1 Lifecycle runner 注入安装目录

**改动文件**：`src/process/extensions/lifecycle/lifecycle.ts`

在 `runLifecycleHook()` 中 fork 子进程时，注入 `AIONUI_AGENT_INSTALL_DIR`：

```typescript
// lifecycle.ts — runLifecycleHook() 中 fork 子进程处
const contentHash = computeContentHash(extension.directory); // 扩展内容的 sha256
const hashPrefix = contentHash.substring(0, 8);
const installDir = path.join(
  getAgentInstallBasePath(), // 见下方说明
  extension.manifest.name, // e.g. "aionext-auggie"
  `${extension.manifest.version}_${hashPrefix}` // e.g. "1.0.0_a3f8b2c1"
);
fs.mkdirSync(installDir, { recursive: true });

child = fork(runnerScript, [], {
  cwd: extension.directory,
  env: {
    ...getEnhancedEnv(),
    AIONUI_AGENT_INSTALL_DIR: installDir,
  },
  silent: false,
});
```

`getAgentInstallBasePath()` 遵循项目已有的目录命名规范（`src/process/utils/utils.ts`）：

```typescript
// 新增，与 getDataPath() / getConfigPath() 同模式
export const getAgentInstallBasePath = (): string => {
  const rootPath = getElectronPathOrFallback('userData');
  const agentsPath = path.join(rootPath, 'agents');
  return ensureCliSafeSymlink(agentsPath, getEnvAwareName('.aionui-agents'));
};
// release → ~/.aionui-agents (软链接 → ~/Library/Application Support/AionUi/agents/)
// dev     → ~/.aionui-agents-dev
```

install.ts 通过 `process.env.AIONUI_AGENT_INSTALL_DIR` 拿到目标路径，往里装东西。AionUi 不关心怎么装，只看结果。

### 3.2 Agent 发现层替换

**改动文件**：`src/process/agent/acp/AcpDetector.ts` + 新增 resolver

当前 `AcpDetector.detectBuiltinAgents()` 对每个 CLI 调 `which`。改为优先级链：

```
1. 用户手动配置的 cliPath（acp.config[x].cliPath）
2. managed 安装目录（~/.aionui-agents/ (或 dev 模式下 ~/.aionui-agents-dev/){ext-name}/{version}_{hash}/）
3. 扩展 manifest 的 defaultCliPath（bunx fallback）
4. which（系统 PATH，降级为 fallback）
```

关键改动：

- `detectBuiltinAgents()` 之前先查 managed 目录
- 从 managed 目录找到的 Agent，直接用绝对路径，不走 `which`
- `HubInstaller.verifyInstallation()` 改为检查 managed 目录中是否有可执行文件，不再依赖 `AcpDetector.refreshAll()` + `which`

### 3.3 元数据解耦

**改动文件**：`src/common/types/acpTypes.ts`、`src/renderer/utils/model/agentModes.ts`、`src/process/agent/acp/constants.ts`

目标：通过 Hub 扩展安装的 Agent，其元数据从 manifest `contributes.acpAdapters` 读取，不再依赖 `ACP_BACKENDS_ALL` 硬编码。`AcpBackend` 类型暂不改动——当前 Hub 扩展只覆盖已有的 `AcpBackend` 枚举值，不存在类型不够用的问题。

**注意**：Extension agent 的 `backend` 在当前架构中永远是 `'custom'`（`AcpDetector.detectExtensionAgents()` 硬编码），走 `connectGenericBackend()` 路径。因此 Extension agent 实际消费的是 adapter 上的字段（`cliPath`、`acpArgs`、`env`），不读 `ACP_BACKENDS_ALL`。

需要从 manifest 获取的字段（基于审计结果，**仅限运行时生效字段**）：

| 字段             | manifest 位置                              | 当前硬编码位置                       | 运行时消费方                    |
| ---------------- | ------------------------------------------ | ------------------------------------ | ------------------------------- |
| `cliCommand`     | `contributes.acpAdapters[].cliCommand`     | `ACP_BACKENDS_ALL[x].cliCommand`     | AcpDetector (which 检测)        |
| `acpArgs`        | `contributes.acpAdapters[].acpArgs`        | `ACP_BACKENDS_ALL[x].acpArgs`        | spawnGenericBackend()           |
| `defaultCliPath` | `contributes.acpAdapters[].defaultCliPath` | `ACP_BACKENDS_ALL[x].defaultCliPath` | AcpAgentManager (bunx fallback) |
| `env`            | `contributes.acpAdapters[].env`            | `ACP_BACKENDS_ALL[x].env`            | prepareCleanEnv()               |
| `skillsDirs`     | `contributes.acpAdapters[].skillsDirs`     | `ACP_BACKENDS_ALL[x].skillsDirs`     | initAgent()                     |

以下字段**不需要搬迁**（审计确认为死代码，运行时从未被消费）：

- `authRequired`、`supportsStreaming`、`apiKeyFields`、`connectionType`、`models`、`isBuiltin`

需要从 ACP 协议动态获取的字段（当前硬编码）：

| 字段         | 获取方式                                          | 当前硬编码位置               |
| ------------ | ------------------------------------------------- | ---------------------------- |
| modes        | `session/new` → `configOptions` (category: mode)  | `agentModes.ts`              |
| models       | `session/new` → `configOptions` (category: model) | `ACP_BACKENDS_ALL[x].models` |
| YOLO mode 值 | 从 configOptions 中识别 auto-approve 类 mode      | `constants.ts`               |

### 3.4 Capability 动态化

**改动文件**：`src/renderer/utils/model/agentModes.ts`、renderer 侧消费 `acp.cachedConfigOptions` 的组件

- `session/new` 返回的 `configOptions` 已经包含 modes/models 信息
- 已有 `acp.cachedConfigOptions` 缓存机制
- **改动**：renderer 侧从 "读 `agentModes.ts` 硬编码" 改为 "读 `acp.cachedConfigOptions` 缓存 + 硬编码 fallback"

### 3.5 错误分层

**改动文件**：`src/process/agent/acp/AcpConnection.ts` (`buildStartupErrorMessage`)、`src/process/extensions/hub/HubInstaller.ts`

| 错误阶段 | 错误类型        | 用户可见信息                 | 可操作动作       |
| -------- | --------------- | ---------------------------- | ---------------- |
| Hub      | 网络不可达      | "无法获取 Agent 列表"        | 重试 / 检查网络  |
| 安装     | install.ts 失败 | "{Agent} 安装失败: {reason}" | 重试 / 查看日志  |
| 安装     | 平台不支持      | "{Agent} 不支持当前平台"     | 无               |
| 运行时   | 启动失败        | "{Agent} 启动失败: {reason}" | 查看日志 / 重试  |
| 运行时   | 协议不兼容      | "{Agent} 版本不兼容"         | 更新 Agent       |
| 认证     | auth_required   | "需要认证"                   | Authenticate CTA |

---

## 四、AionHub 侧改动

### 4.1 build script 改造

**改动文件**：`.github/scripts/build-extensions.js`

两项改动：

1. **把 scripts/ 打进 zip**：当前只打包 `aion-extension.json`，改为打包整个扩展目录（排除 `.DS_Store` 等）。这样 install.ts 才能在安装后被执行。

2. **integrity 改为内容 hash**：当前 `dist.integrity` 是 zip 文件的 SHA-512，跨平台不一致（zip 格式差异）。改为对**解压后的文件内容**算 SHA-256：

```javascript
function computeContentHash(extPath) {
  const hash = crypto.createHash('sha256');
  const files = getAllFiles(extPath).sort(); // 排序保证顺序一致
  for (const file of files) {
    hash.update(path.relative(extPath, file)); // 相对路径
    hash.update(fs.readFileSync(file)); // 文件内容
  }
  return hash.digest('hex');
}
```

index.json 的 `dist.integrity` 改为 `sha256-{contentHash}`。AionUi 侧 `verifyIntegrity()` 对应改为解压后校验内容 hash。

这个 contentHash 同时也用于安装目录命名（前 8 位），保证内容变了就安装到新目录。

### 4.2 install.ts：统一安装到 managed 目录

所有扩展的 install.ts 改为使用 `process.env.AIONUI_AGENT_INSTALL_DIR`：

**npm 包类 — binary 名 = cliCommand**（auggie、qwen、codebuddy、opencode 等）：

```typescript
import { $} from 'bun';
import { mkdirSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';

const dir = process.env.AIONUI_AGENT_INSTALL_DIR!;
await $`bun install --cwd ${dir} @augmentcode/auggie`;

// 约定: bin/{cliCommand} 必须存在
const binDir = join(dir, 'bin');
mkdirSync(binDir, { recursive: true });
const link = join(binDir, 'auggie'); // = cliCommand
if (!existsSync(link)) symlinkSync(join(dir, 'node_modules', '.bin', 'auggie'), link);
// 可执行文件产出: ${dir}/bin/auggie → node_modules/.bin/auggie
```

**npm 包类 — binary 名 ≠ cliCommand**（claude、codex）：

```typescript
import { $ } from 'bun';
import { mkdirSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';

const dir = process.env.AIONUI_AGENT_INSTALL_DIR!;
await $`bun install --cwd ${dir} @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp`;

// 约定: bin/{cliCommand}，npm binary 名 (claude-agent-acp) ≠ cliCommand (claude)
const binDir = join(dir, 'bin');
mkdirSync(binDir, { recursive: true });
const link = join(binDir, 'claude'); // = cliCommand
if (!existsSync(link)) symlinkSync(join(dir, 'node_modules', '.bin', 'claude-agent-acp'), link);
// 可执行文件产出: ${dir}/bin/claude → node_modules/.bin/claude-agent-acp
```

**binary 下载类**（goose、kimi、kiro 等）：

```typescript
import { $ } from 'bun';
const dir = process.env.AIONUI_AGENT_INSTALL_DIR!;

// 直接下载到 bin/ 目录
const binDir = `${dir}/bin`;
await $`mkdir -p ${binDir}`;
await $`curl -fsSL https://github.com/block/goose/releases/latest/download/goose-darwin-arm64 -o ${binDir}/goose`;
await $`chmod +x ${binDir}/goose`;
// 可执行文件产出: ${dir}/bin/goose
```

### 4.3 manifest 补全（仅运行时生效字段）

基于 AcpBackendConfig 字段审计结果（见第二章），**只搬运行时生效的字段**，死代码字段（`authRequired`、`supportsStreaming`、`apiKeyFields`、`connectionType`、`models`、`isBuiltin`）不搬。

需要确保每个扩展的 `contributes.acpAdapters` 包含以下字段：

| 字段             | 说明                                           | 示例                                   |
| ---------------- | ---------------------------------------------- | -------------------------------------- |
| `cliCommand`     | CLI 命令名（检测用 + `bin/` 约定路径的文件名） | `"claude"`                             |
| `acpArgs`        | ACP 启动参数                                   | `["--experimental-acp"]`               |
| `defaultCliPath` | bunx fallback 路径                             | `"bunx @augmentcode/auggie"`           |
| `skillsDirs`     | 技能目录（如有）                               | `[".claude/skills"]`                   |
| `env`            | 额外环境变量（如有）                           | `{ "KEY_FIELD": "ANTHROPIC_API_KEY" }` |

> **约定**：`install.ts` 必须在 `$AIONUI_AGENT_INSTALL_DIR/bin/{cliCommand}` 放置可执行文件或 symlink。AionUi 按此约定路径查找，不需要额外的路径声明字段。

### 4.4 推进 pending 扩展

10 个 pending 扩展改造 install.ts 后移入 `extensions/` 目录。优先级按用户需求排序。

---

## 五、安装目录结构

```
~/.aionui-agents/ (或 dev 模式下 ~/.aionui-agents-dev/)                              # 固定路径，暂不开放自定义
├── aionext-auggie/
│   └── 1.0.0_a3f8b2c1/                       # {version}_{contentHash 前 8 位}
│       ├── bin/
│       │   └── auggie → ../node_modules/.bin/auggie   # symlink, = cliCommand
│       └── node_modules/.bin/auggie
├── aionext-goose/
│   └── 1.0.0_7e2d4f01/
│       └── bin/
│           └── goose                          # 直接下载的 binary, = cliCommand
└── aionext-claude/
    └── 0.25.3_c9b1e5a2/
        ├── bin/
        │   └── claude → ../node_modules/.bin/claude-agent-acp  # cliCommand ≠ npm binary
        └── node_modules/.bin/claude-agent-acp
```

**`bin/{cliCommand}` 约定**：所有扩展的 `install.ts` 必须在 `$AIONUI_AGENT_INSTALL_DIR/bin/{cliCommand}` 放置可执行文件或 symlink。AionUi 的 `ManagedInstallResolver` 按此约定路径查找，不需要额外的 manifest 字段（已移除 `installedBinaryPath`）。这种 convention-over-configuration 方式减少了 manifest 与实际产出不一致的风险。

**版本隔离**：每个版本一个子目录 `{version}_{contentHash前8位}`。内容变了 hash 就变，即使版本号没 bump 也会安装到新目录。更新时旧目录保留直到确认新版本正常。

---

## 六、迁移策略

### 6.1 用户配置继承

spawn Agent 时的环境保持一致：

```typescript
const env = {
  ...userShellEnv, // 完整 shell 环境（API keys 等）
  HOME: os.homedir(), // Agent 找 ~/.claude/ 等配置
  // 不干预 Agent 自身的配置发现行为
};
```

### 6.2 Agent 发现优先级（过渡期）

```
1. 用户手动配置 cliPath → 直接使用
2. managed 目录有可执行文件 → 从已知路径启动
3. 扩展 manifest defaultCliPath → bunx 即时运行
4. which（系统 PATH）→ 使用，标记 unmanaged
5. 无 → 报错，引导到 Agent Hub 安装
```

### 6.3 版本升级

```
Hub Index 刷新 → 发现扩展有新版本（contentHash 变化）
→ Hub UI 显示 "有新版本可用"（已有 update_available 状态）
→ 用户点击 "更新"
→ 重新下载扩展 zip → 执行 onInstall → 安装到新的 {version}_{hash}/ 目录
→ 旧版本目录保留，新 session 使用新版本
→ 旧版本由清理逻辑回收（保留最近 N 个版本）
```

---

## 七、子任务拆解

### 任务 0: 开发基础设施 — Hub URL 可配置

所有后续 Hub 相关改动的前置任务。当前 `HUB_REMOTE_URLS` 硬编码 GitHub CDN 地址，开发/测试无法指向本地。

```
0a. AionUi: constants.ts 支持 AIONUI_HUB_URL 环境变量（逗号分隔多个 URL）
    - 环境变量中的 URL 排在 HUB_REMOTE_URLS 前面（优先级更高）
    - HubIndexManager + HubInstaller 无需改动（已通过 HUB_REMOTE_URLS 消费）
0b. AionHub: kits/ 下提供 static file server 脚本
    - 服务 dist/ 目录，用于本地开发测试
    - 用法: AIONUI_HUB_URL=http://localhost:PORT/ bun run start
```

### 任务 1: AionUi 侧 — lifecycle runner 改造

先于 AionHub 侧改动，因为 install.ts 依赖 `AIONUI_AGENT_INSTALL_DIR` 环境变量。

```
1a. lifecycle.ts：计算安装目录（~/.aionui-agents/ (或 dev 模式下 ~/.aionui-agents-dev/){name}/{version}_{hash}）+ 注入 AIONUI_AGENT_INSTALL_DIR
1b. computeContentHash() 工具函数：对扩展目录内容算 SHA-256
1c. HubInstaller.verifyIntegrity()：从 hash zip 改为解压后 hash 内容
1d. HubInstaller.verifyInstallation()：从 AcpDetector.refreshAll() + which 改为检查 managed 目录中是否有可执行文件
```

### 任务 2: AionHub 侧 — 扩展改造

任务 1 完成后，AionHub 侧直接改（现有扩展没有用户，不需要迁移兼容）。

```
2a. build script：把 scripts/ 打进 zip + integrity 改为内容 SHA-256
2b. manifest 补全（仅运行时生效字段，死代码字段不搬）：
    - 确保每个扩展声明: cliCommand, acpArgs, defaultCliPath, env, skillsDirs
    - 不搬: authRequired, supportsStreaming, apiKeyFields, connectionType, models, isBuiltin
2c. install.ts 全部改为使用 process.env.AIONUI_AGENT_INSTALL_DIR（不再 bun install -g）
    - 必须在 $AIONUI_AGENT_INSTALL_DIR/bin/{cliCommand} 放置可执行文件或 symlink
2d. 推进 pending 扩展（按优先级分批）：
    - P0: claude, codex, goose（高需求）
    - P1: copilot, kimi, kiro, droid
    - P2: mistral-vibe, openclaw-gateway, qoder
```

### 任务 3: AionUi 侧 — Agent 发现层替换

```
3a. ManagedInstallResolver：从 ~/.aionui-agents/ (或 dev 模式下 ~/.aionui-agents-dev/) 查找已安装 Agent
    - 按 bin/{cliCommand} 约定定位可执行文件
3b. 组装解析优先级链：用户配置 > managed > defaultCliPath (bunx) > which
3c. Hub 安装的 Agent 从 manifest 读取元数据（acpArgs 等），不读 ACP_BACKENDS_ALL
3d. ACP_BACKENDS_ALL 瘦身：移除 Hub 可提供的字段，保留内置 Agent 的默认值
```

### 任务 4: Capability 动态化

独立于上述任务，可随时推进。

```
4a. renderer 侧 modes 从 acp.cachedConfigOptions 读取
4b. agentModes.ts 硬编码降级为 fallback
4c. YOLO mode 常量从 configOptions 动态识别
```

### 任务 5: 错误分层 + 版本清理

```
5a. 替换 "CLI Not Found" 为分阶段错误信息
5b. managed 目录旧版本清理逻辑（保留最近 N 个版本，清理更早的）
```

### 任务 6: 卸载功能

> 新增：2026-04-12。详见 `requirements.md` 第七章。

```
6a. HubInstaller 新增 uninstall() 方法：
    - 断开该 Agent 的活跃会话
    - 执行 onUninstall lifecycle hook（已有基础设施）
    - 删除 managed 安装目录 (~/.aionui-agents/{name}/ 整个目录)
    - 删除扩展解压目录
    - HubStateManager 重置为 not_installed
    - 触发 AcpDetector.refreshAll()
6b. AgentHubModal：已安装扩展显示"卸载"按钮（替换当前 disabled 的"已安装"按钮）
6c. hubBridge.ts：实现 hub.uninstall handler（当前为 stub）
```

### 任务 7: 认证流程

> 新增：2026-04-12。详见 `requirements.md` 第八章。
> 认证信息完全从 ACP 协议 `auth_methods` 运行时获取，不在 manifest 中声明。

```
7a. AcpConnection 拦截认证错误 + 缓存 auth_methods：
    - initialize 握手时缓存 Agent 返回的 auth_methods
    - 捕获 ErrorCode::AuthRequired / -32000 / -32603 中的认证类错误
    - 通过 IPC 通知 renderer 侧显示认证引导，携带 auth_methods 信息
7b. Renderer 侧认证引导 UI：
    - 消息输入框上方显示"立即登录"按钮（如有多种 method 则展开列表）
    - AuthMethodTerminal / terminal-auth meta：打开用户系统终端执行登录命令
    - 含 authUrl 的 method：shell.openExternal 打开浏览器
    - AuthMethodEnvVar：引导到设置页配置环境变量
7c. 认证完成检测 + 重试：
    - 终端类：无法直接监听系统终端进程，显示"我已完成登录"按钮让用户手动确认
    - 浏览器类：同上，用户手动确认
    - 确认后调用 authenticate(method_id) 通知 Agent，然后重试连接
```

### 任务 8: 迁移提示

> 新增：2026-04-12。详见 `requirements.md` 第九章。

```
8a. AcpDetector 标记 Agent 来源（managed / unmanaged / user-configured）
8b. 迁移匹配逻辑：unmanaged Agent 的 cliCommand 与 Hub index 扩展匹配
8c. 弹窗 UI：显示可迁移 Agent 列表 + 当前 which 路径 + 一键安装按钮
8d. 批量安装：调用 HubInstaller.install() + refreshAll()
8e. 记忆逻辑：已处理的 Agent 不再提示；"稍后再说"下次启动仍检测
```

### 依赖关系

```
任务 0 (Hub URL 可配置) ← 最前置，所有 Hub 开发/测试依赖
  |
  v
任务 1 (lifecycle runner)  ──→  任务 2 (AionHub 扩展改造)
  |                                  |
  v                                  |
任务 3 (Agent 发现层) ←──────────────┘
  |
  ├──→ 任务 5 (错误分层 + 清理)
  ├──→ 任务 6 (卸载功能) ← 依赖任务 1 (managed 目录) + 任务 3 (发现层)
  ├──→ 任务 7 (认证流程) ← 依赖任务 3 (发现层)；auth 信息从 ACP 协议运行时获取
  └──→ 任务 8 (迁移提示) ← 依赖任务 3 (Agent 来源标记) + Hub index 加载

任务 4 (Capability 动态化) ← 独立，随时可做
```

---

## 八、风险与缓解

| 风险                              | 缓解                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Hub 远程源不可达                  | managed 目录已安装的 Agent 不受影响；bundled 扩展始终可用                              |
| install.ts 执行任意命令的安全风险 | 已有 trust mechanism 设计（`extension-trust-mechanism.md`）；白名单限制 bun/bunx       |
| bun install --cwd 的兼容性        | 部分包可能不支持 --cwd 安装，需逐一验证；备选方案是 install.ts 中手动下载 tarball 解压 |
| 浏览器认证回调时序                | AionUi 无法直接监听浏览器回调；方案：轮询 authenticate 接口 或 用户手动确认            |
| 终端登录 UX                       | AionUi 无内置终端，需打开系统终端；无法直接监听进程退出，依赖用户手动确认              |
| 迁移提示误判                      | 仅对 which 发现且 Hub 有对应扩展的 Agent 提示；用户手动 cliPath 的不纳入               |

---

## 附录 A: 当前硬编码清单

| 硬编码值                                  | 位置                   | 替换方式                                                             |
| ----------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `ACP_BACKENDS_ALL`                        | `acpTypes.ts:336-536`  | Hub 扩展 manifest `contributes.acpAdapters`（AcpBackend 类型暂不改） |
| `AGENT_MODES`                             | `agentModes.ts`        | ACP `session/new` configOptions + fallback                           |
| `CLAUDE_YOLO_SESSION_MODE` 等             | `constants.ts`         | 从 configOptions 动态识别                                            |
| `@zed-industries/claude-agent-acp@0.21.0` | `acpConnectors.ts`     | 扩展 install.ts 管理版本；managed 路径优先级高于 NPX                 |
| `@zed-industries/codex-acp@0.9.5`         | `acpConnectors.ts`     | 同上                                                                 |
| `@tencent-ai/codebuddy-code@2.70.1`       | `acpConnectors.ts`     | 同上                                                                 |
| `['--experimental-acp']` 默认             | `acpConnectors.ts:239` | manifest `acpAdapters[].acpArgs`                                     |
| `node >= 18.17` / `20.10`                 | `acpConnectors.ts`     | bundled bun 替代，不再需要 Node.js 版本检查                          |

## 附录 B: AcpBackendConfig 字段审计

| 字段                          | 运行时状态 | 消费位置                                            | 处理               |
| ----------------------------- | ---------- | --------------------------------------------------- | ------------------ |
| `cliCommand`                  | ✅ 在用     | `AcpDetector.detectBuiltinAgents()` (which 检测)    | 搬到 manifest      |
| `acpArgs`                     | ✅ 在用     | `spawnGenericBackend()`                             | 搬到 manifest      |
| `defaultCliPath`              | ⚠️ 半生效   | generic 路径读取，claude/codex/codebuddy 硬编码忽略 | 搬到 manifest      |
| `enabled`                     | ✅ 在用     | UI 控制                                             | 保留在 AionUi 配置 |
| `env`                         | ✅ 在用     | `prepareCleanEnv()`                                 | 搬到 manifest      |
| `skillsDirs`                  | ✅ 在用     | `initAgent()`                                       | 搬到 manifest      |
| `name`/`avatar`/`description` | ✅ 在用     | UI 展示                                             | 保留在 AionUi 配置 |
| `authRequired`                | ❌ 死代码   | 无运行时消费                                        | 不搬，后续清理     |
| `supportsStreaming`           | ❌ 死代码   | 无                                                  | 不搬               |
| `apiKeyFields`                | ❌ 死代码   | 无                                                  | 不搬               |
| `connectionType`              | ❌ 死代码   | 无（全部走 stdio）                                  | 不搬               |
| `models`                      | ❌ 死代码   | 无                                                  | 不搬，改为动态获取 |
| `isBuiltin`                   | ❌ 死代码   | 无                                                  | 不搬               |

关键发现：`connectClaude()`/`connectCodex()`/`connectCodebuddy()` 三个专用 connector **硬编码了 NPX 包名和版本**，完全忽略 `defaultCliPath`。但在新方案中，Extension agent 的 `backend` 是 `'custom'`，走 `connectGenericBackend()` 路径，不会触发这些专用 connector。managed 目录的绝对路径会在更早的优先级被命中，自然绕过了 NPX 硬编码问题。

## 附录 C: 与现有 Sprint 计划的关系

| Sprint       | 已有计划                | 本方案   |
| ------------ | ----------------------- | -------- |
| Sprint 1-3   | P0-P2: 状态/错误/热路径 | 不受影响 |
| Sprint 4     | P3: 连接复用            | 不受影响 |
| **Sprint 5** | P4: 运行时托管 (空缺)   | 任务 1-5 |

## 附录 D: AionHub 仓库侧改动清单

| 改动                                   | 文件                                   | 说明                                                         |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| zip 打包 scripts/                      | `.github/scripts/build-extensions.js`  | 当前只打包 manifest                                          |
| integrity 改为内容 hash                | `.github/scripts/build-extensions.js`  | 从 zip 的 SHA-512 改为解压内容的 SHA-256，解决跨平台不一致   |
| install.ts 用 AIONUI_AGENT_INSTALL_DIR | 所有 `extensions/*/scripts/install.ts` | 从 `bun install -g` 改为 `--cwd $DIR`                        |
| manifest 补全                          | 所有 `aion-extension.json`             | 补充运行时生效字段（cliCommand, acpArgs, defaultCliPath 等） |
| pending → active                       | 10 个扩展                              | 改造 install.ts 后移入 extensions/                           |
