/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Backend 类型定义
 * ACP Backend Type Definitions
 *
 * 为了更好的扩展性，将所有支持的 ACP 后端定义在此处
 * 当需要支持新的后端时，只需要在这里添加即可
 * For better extensibility, all supported ACP backends are defined here.
 * When adding a new backend, simply add it here.
 */

/**
 * 预设助手的主 Agent 类型，用于决定创建哪种类型的对话
 * The primary agent type for preset assistants, used to determine which conversation type to create.
 */
export type PresetAgentType = 'gemini' | 'claude' | 'codex' | 'codebuddy' | 'opencode' | 'qwen' | 'kiro';

/**
 * 使用 ACP 协议的预设 Agent 类型（需要通过 ACP 后端路由）
 * Preset agent types that use ACP protocol (need to be routed through ACP backend)
 *
 * 这些类型会在创建对话时使用对应的 ACP 后端，而不是 Gemini 原生对话
 * These types will use corresponding ACP backend when creating conversation, instead of native Gemini
 */
export const ACP_ROUTED_PRESET_TYPES: readonly PresetAgentType[] = [
  'claude',
  'codebuddy',
  'opencode',
  'codex',
  'qwen',
  'kiro',
] as const;

export const CODEX_ACP_BRIDGE_VERSION = '0.9.5';
export const CODEX_ACP_NPX_PACKAGE = `@zed-industries/codex-acp@${CODEX_ACP_BRIDGE_VERSION}`;

export const CLAUDE_ACP_BRIDGE_VERSION = '0.21.0';
export const CLAUDE_ACP_NPX_PACKAGE = `@zed-industries/claude-agent-acp@${CLAUDE_ACP_BRIDGE_VERSION}`;

export const CODEBUDDY_ACP_BRIDGE_VERSION = '2.73.0';
export const CODEBUDDY_ACP_NPX_PACKAGE = `@tencent-ai/codebuddy-code@${CODEBUDDY_ACP_BRIDGE_VERSION}`;

/**
 * 检查预设 Agent 类型是否需要通过 ACP 后端路由
 * Check if preset agent type should be routed through ACP backend
 */
export function isAcpRoutedPresetType(type: PresetAgentType | undefined): boolean {
  return type !== undefined && ACP_ROUTED_PRESET_TYPES.includes(type);
}

// 全部后端类型定义 - 包括暂时不支持的 / All backend types - including temporarily unsupported ones
export type AcpBackendAll =
  | 'claude' // Claude ACP
  | 'gemini' // Google Gemini ACP
  | 'qwen' // Qwen Code ACP
  | 'iflow' // iFlow CLI ACP
  | 'codex' // OpenAI Codex ACP (via codex-acp bridge)
  | 'codebuddy' // Tencent CodeBuddy Code CLI
  | 'droid' // Factory Droid CLI (ACP via `droid exec --output-format acp`)
  | 'goose' // Block's Goose CLI
  | 'auggie' // Augment Code CLI
  | 'kimi' // Kimi CLI (Moonshot)
  | 'opencode' // OpenCode CLI
  | 'copilot' // GitHub Copilot CLI
  | 'qoder' // Qoder CLI
  | 'openclaw-gateway' // OpenClaw Gateway WebSocket
  | 'vibe' // Mistral Vibe CLI
  | 'nanobot' // nanobot CLI
  | 'cursor' // Cursor AI Agent CLI
  | 'kiro' // Kiro CLI (AWS)
  | 'hermes' // Hermes Agent CLI (Nous Research)
  | 'snow' // Snow AI CLI
  | 'remote' // Remote agent (WebSocket, no local CLI)
  | 'aionrs' // Aion CLI agent (Rust binary, JSON Lines protocol)
  | 'custom'; // User-configured custom ACP agent

/**
 * 潜在的 ACP CLI 工具列表
 * 用于自动检测用户本地安装的 CLI 工具
 * 当有新的 ACP CLI 工具发布时，只需在此列表中添加即可
 *
 * Potential ACP CLI tools list.
 * Used for auto-detecting CLI tools installed on user's local machine.
 * When new ACP CLI tools are released, simply add them to this list.
 */
export interface PotentialAcpCli {
  /** CLI 可执行文件名 / CLI executable filename */
  cmd: string;
  /** ACP 启动参数 / ACP launch arguments */
  args: string[];
  /** 显示名称 / Display name */
  name: string;
  /** 对应的 backend id / Corresponding backend id */
  backendId: AcpBackendAll;
}

/** 默认的 ACP 启动参数 / Default ACP launch arguments */
const DEFAULT_ACP_ARGS = ['--experimental-acp'];

/**
 * 从 ACP_BACKENDS_ALL 生成可检测的 CLI 列表
 * 仅包含有 cliCommand 且已启用的后端（排除 gemini 和 custom）
 * Generate detectable CLI list from ACP_BACKENDS_ALL
 * Only includes enabled backends with cliCommand (excludes gemini and custom)
 */
function generatePotentialAcpClis(): PotentialAcpCli[] {
  // 需要在 ACP_BACKENDS_ALL 定义之后调用，所以使用延迟初始化
  // Must be called after ACP_BACKENDS_ALL is defined, so use lazy initialization
  return Object.entries(ACP_BACKENDS_ALL)
    .filter(([id, config]) => {
      // 排除没有 CLI 命令的后端（gemini 内置，custom 用户配置，aionrs 非 ACP 类型）
      // Exclude backends without CLI command (gemini is built-in, custom is user-configured, aionrs is not ACP type)
      if (!config.cliCommand) return false;
      if (id === 'gemini' || id === 'custom' || id === 'aionrs') return false;
      return config.enabled;
    })
    .map(([id, config]) => ({
      cmd: config.cliCommand!,
      args: config.acpArgs || DEFAULT_ACP_ARGS,
      name: config.name,
      backendId: id as AcpBackendAll,
    }));
}

// 延迟初始化，避免循环依赖 / Lazy initialization to avoid circular dependency
let _potentialAcpClis: PotentialAcpCli[] | null = null;

/**
 * 已知支持 ACP 协议的 CLI 工具列表
 * 检测时会遍历此列表，用 `which` 命令检查是否安装
 * 从 ACP_BACKENDS_ALL 自动生成，避免数据冗余
 */
export const POTENTIAL_ACP_CLIS: PotentialAcpCli[] = new Proxy([] as PotentialAcpCli[], {
  get(_target, prop) {
    if (_potentialAcpClis === null) {
      _potentialAcpClis = generatePotentialAcpClis();
    }
    if (prop === 'length') return _potentialAcpClis.length;
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      return _potentialAcpClis[Number(prop)];
    }
    if (prop === Symbol.iterator) {
      return function* () {
        yield* _potentialAcpClis!;
      };
    }
    if (prop === 'map') return _potentialAcpClis.map.bind(_potentialAcpClis);
    if (prop === 'filter') return _potentialAcpClis.filter.bind(_potentialAcpClis);
    if (prop === 'forEach') return _potentialAcpClis.forEach.bind(_potentialAcpClis);
    return Reflect.get(_potentialAcpClis, prop);
  },
});

/**
 * ACP 后端 Agent 配置
 * 用于内置后端（claude, gemini, qwen）和用户自定义 Agent
 *
 * Configuration for an ACP backend agent.
 * Used for both built-in backends (claude, gemini, qwen) and custom user agents.
 */
export interface AcpBackendConfig {
  /** 后端唯一标识符 / Unique identifier for the backend (e.g., 'claude', 'gemini', 'custom') */
  id: string;

  /** UI 显示名称 / Display name shown in the UI (e.g., 'Goose', 'Claude Code') */
  name: string;

  /** 本地化名称 / Localized names (e.g., { 'zh-CN': '...', 'en-US': '...' }) */
  nameI18n?: Record<string, string>;

  /** 助手列表或设置中显示的简短描述 / Short description shown in assistant lists or settings */
  description?: string;

  /** 本地化描述 / Localized descriptions (e.g., { 'zh-CN': '...', 'en-US': '...' }) */
  descriptionI18n?: Record<string, string>;

  /** 助手头像 - 可以是 emoji 或图片路径 / Avatar for the assistant - can be an emoji string or image path */
  avatar?: string;

  /**
   * 用于 `which` 命令检测的 CLI 命令名
   * 仅当二进制文件名与 id 不同时需要
   *
   * CLI command name used for detection via `which` command.
   * Example: 'goose', 'claude', 'qwen'
   * Only needed if the binary name differs from id.
   */
  cliCommand?: string;

  /**
   * 完整 CLI 路径（可包含空格分隔的参数）
   * 用于启动进程
   *
   * Full CLI path with optional arguments (space-separated).
   * Used when spawning the process.
   * Examples:
   *   - 'goose' (simple binary)
   *   - 'npx @qwen-code/qwen-code' (npx package)
   *   - '/usr/local/bin/my-agent --verbose' (full path with args)
   * Note: '--experimental-acp' is auto-appended for non-custom backends.
   */
  defaultCliPath?: string;

  /** 使用前是否需要认证 / Whether this backend requires authentication before use */
  authRequired?: boolean;

  /** 是否启用并显示在 UI 中 / Whether this backend is enabled and should appear in the UI */
  enabled?: boolean;

  /** 是否支持流式响应 / Whether this backend supports streaming responses */
  supportsStreaming?: boolean;

  /**
   * 传递给子进程的自定义环境变量
   * 启动时与 process.env 合并
   *
   * Custom environment variables to pass to the spawned process.
   * Merged with process.env when spawning.
   * Example: { "ANTHROPIC_API_KEY": "sk-...", "DEBUG": "true" }
   */
  env?: Record<string, string>;

  /**
   * 扩展声明的 API Key 字段列表
   * 用户可在 Settings UI 中配置这些值，配置后作为环境变量注入到子进程
   *
   * API Key fields declared by extensions for user configuration in Settings UI.
   * User-entered values are injected as environment variables when spawning the process.
   * Example: [{ key: "MY_API_KEY", label: "API Key", type: "password", required: true }]
   */
  apiKeyFields?: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'select' | 'number' | 'boolean';
    required?: boolean;
    options?: string[];
    default?: string | number | boolean;
  }>;

  /**
   * 启用 ACP 模式时的参数
   * 不同 CLI 使用不同约定：
   *   - ['--experimental-acp'] 用于 claude（未指定时的默认值）
   *   - ['--acp'] 用于 qwen, auggie
   *   - ['acp'] 用于 goose（子命令）
   *
   * Arguments to enable ACP mode when spawning the CLI.
   * Different CLIs use different conventions:
   *   - ['--experimental-acp'] for claude (default if not specified)
   *   - ['--acp'] for qwen, auggie
   *   - ['acp'] for goose (subcommand)
   * If not specified, defaults to ['--experimental-acp'].
   */
  acpArgs?: string[];

  /**
   * 原生 skill 发现目录（相对于 workspace 根目录）
   * 只有配置了此字段的 CLI 才支持原生 skill 发现（CLI 自动扫描目录中的 SKILL.md）
   * 未配置的 backend 将 fallback 到首条消息注入（prompt injection）
   *
   * Native skill discovery directories (relative to workspace root).
   * Only CLIs with this field support native skill discovery (CLI auto-scans directory for SKILL.md).
   * Backends without this field will fallback to first-message injection (prompt injection).
   */
  skillsDirs?: string[];

  /**
   * 头像背景色（CSS 颜色值，如 "hsl(14 72% 85%)"）
   * 仅在无图片头像（emoji / 占位符）时生效。
   * Avatar background color (any CSS color, e.g. "hsl(14 72% 85%)").
   * Only applied when there is no image avatar (emoji or fallback icon).
   */
  avatarBgColor?: string;

  /** 是否为基于提示词的预设（无需 CLI 二进制文件）/ Whether this is a prompt-based preset (no CLI binary required) */
  isPreset?: boolean;

  /** 此预设的系统提示词或规则上下文 / The system prompt or rule context for this preset */
  context?: string;

  /** 此预设的本地化提示词 / Localized prompts for this preset (e.g., { 'zh-CN': '...', 'en-US': '...' }) */
  contextI18n?: Record<string, string>;

  /** 此预设的示例 prompts / Example prompts for this preset */
  prompts?: string[];

  /** 本地化示例 prompts / Localized example prompts */
  promptsI18n?: Record<string, string[]>;

  /**
   * 此预设的主 Agent 类型（仅 isPreset=true 时生效）
   * 决定选择此预设时创建哪种类型的对话
   * - 'gemini': 创建 Gemini 对话
   * - 'claude': 创建使用 Claude 后端的 ACP 对话
   * - 'codex': 创建 Codex 对话
   * - 任意字符串: 扩展贡献的 ACP 适配器 ID（如 'ext-buddy'）
   * 为向后兼容默认为 'gemini'
   *
   * The primary agent type for this preset (only applies when isPreset=true).
   * Determines which conversation type to create when selecting this preset.
   * - 'gemini': Creates a Gemini conversation
   * - 'claude': Creates an ACP conversation with Claude backend
   * - 'codex': Creates a Codex conversation
   * - any string: Extension-contributed ACP adapter ID (e.g. 'ext-buddy')
   * Defaults to 'gemini' for backward compatibility.
   */
  presetAgentType?: PresetAgentType | string;

  /**
   * 此助手可用的模型列表（仅 isPreset=true 时生效）
   * 如果未指定，将使用系统默认的模型列表
   *
   * Available models for this assistant (only applies when isPreset=true).
   * If not specified, system default models will be used.
   */
  models?: string[];

  /** 是否为内置助手（不可编辑/删除）/ Whether this is a built-in assistant (cannot be edited/deleted) */
  isBuiltin?: boolean;

  /**
   * 此助手启用的 skills 列表（仅 isPreset=true 时生效）
   * 如果未指定或为空数组，将加载所有可用 skills
   *
   * Enabled skills for this assistant (only applies when isPreset=true).
   * If not specified or empty array, all available skills will be loaded.
   */
  enabledSkills?: string[];

  /**
   * 通过 "Add Skills" 添加的自定义 skills 名称列表（仅 isPreset=true 时生效）
   * 这些 skills 会显示在 Custom Skills 区域，即使已经被导入
   *
   * List of custom skill names added via "Add Skills" button (only applies when isPreset=true).
   * These skills will be displayed in the Custom Skills section even after being imported.
   */
  customSkillNames?: string[];
}

// 所有后端配置 - 包括暂时禁用的 / All backend configurations - including temporarily disabled ones
export const ACP_BACKENDS_ALL: Record<AcpBackendAll, AcpBackendConfig> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    description:
      "Anthropic's Claude Code — an agentic AI coding tool that lives in your terminal and understands your codebase.",
    descriptionI18n: {
      'zh-CN': 'Anthropic 出品的 Claude Code，深度理解代码库的终端 AI 编程助手。',
    },
    prompts: [
      'Implement this feature end-to-end — code, tests, and docs',
      'Find every place in the codebase affected by this change and fix them all',
      'Run the failing tests and keep iterating until they all pass',
    ],
    promptsI18n: {
      'zh-CN': [
        '端到端实现这个功能——包括代码、测试和文档',
        '找出代码库中所有受这次改动影响的地方并逐一修复',
        '运行失败的测试，持续迭代直到全部通过',
      ],
    },
    avatarBgColor: 'hsl(14 72% 85%)',
    cliCommand: 'claude',
    authRequired: true,
    enabled: true,
    supportsStreaming: false,
    skillsDirs: ['.claude/skills'],
  },
  gemini: {
    id: 'gemini',
    name: 'Google CLI',
    description:
      "Google's Gemini CLI — a multimodal AI agent with long context support and Google ecosystem integration.",
    descriptionI18n: {
      'zh-CN': 'Google 出品的 Gemini CLI，多模态 AI 助手，支持超长上下文与 Google 生态集成。',
    },
    prompts: [
      'Load the entire codebase and walk me through the full architecture',
      'Analyze this screenshot and implement the UI layout it shows',
      'Trace this data flow across all files from input to output',
    ],
    promptsI18n: {
      'zh-CN': [
        '加载整个代码库，带我过一遍完整的架构设计',
        '分析这张截图，实现其中展示的 UI 布局',
        '从输入到输出，跨所有文件追踪这条数据流',
      ],
    },
    avatarBgColor: 'hsl(207 68% 84%)',
    cliCommand: 'gemini',
    authRequired: true,
    enabled: false,
    supportsStreaming: true,
    skillsDirs: ['.gemini/skills'],
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen Code',
    description: "Alibaba's Qwen Code — an AI coding agent powered by the Qwen model family.",
    descriptionI18n: {
      'zh-CN': '阿里巴巴出品的 Qwen Code，基于通义千问大模型的 AI 编程助手。',
    },
    prompts: [
      'Generate production-ready code with detailed Chinese inline comments',
      'Review this code and write comprehensive Chinese documentation',
      'Convert this business requirement into a complete implementation',
    ],
    promptsI18n: {
      'zh-CN': [
        '生成带详细中文注释的生产级代码',
        '审查这段代码，补充完整的中文技术文档',
        '把这份业务需求转化为完整的代码实现',
      ],
    },
    avatarBgColor: 'hsl(268 60% 85%)',
    cliCommand: 'qwen',
    defaultCliPath: 'npx @qwen-code/qwen-code',
    authRequired: true,
    enabled: true, // ✅ 已验证支持：Qwen CLI v0.0.10+ 支持 --acp
    supportsStreaming: true,
    acpArgs: ['--acp'], // Use --acp instead of deprecated --experimental-acp
    skillsDirs: ['.qwen/skills'],
  },
  iflow: {
    id: 'iflow',
    name: 'iFlow CLI',
    description: 'iFlow CLI — an AI agent optimized for workflow automation and task orchestration.',
    descriptionI18n: {
      'zh-CN': 'iFlow CLI，专为工作流自动化和任务编排优化的 AI 智能体。',
    },
    prompts: [
      'Design a step-by-step deployment pipeline for this project',
      'Build a task chain to automate this multi-stage workflow',
      'Set up automated CI/CD with rollback on failure',
    ],
    promptsI18n: {
      'zh-CN': [
        '为这个项目设计分步骤的部署流水线',
        '构建任务链，自动化这个多阶段工作流',
        '配置带失败回滚的自动化 CI/CD 流程',
      ],
    },
    avatarBgColor: 'hsl(152 55% 83%)',
    cliCommand: 'iflow',
    authRequired: true,
    enabled: true,
    supportsStreaming: false,
    skillsDirs: ['.iflow/skills'],
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    description: "OpenAI's Codex — a terminal-native AI coding agent powered by GPT models.",
    descriptionI18n: {
      'zh-CN': 'OpenAI 出品的 Codex，基于 GPT 模型的终端原生 AI 编程助手。',
    },
    prompts: [
      'Turn this plain-English description into working production code',
      'Convert this Python script to TypeScript with strict types',
      'Implement this algorithm from the pseudocode above',
    ],
    promptsI18n: {
      'zh-CN': [
        '把这段自然语言描述转化为可运行的生产代码',
        '将这个 Python 脚本转换为带严格类型的 TypeScript',
        '根据上面的伪代码实现这个算法',
      ],
    },
    avatarBgColor: 'hsl(218 65% 85%)',
    cliCommand: 'codex', // Detect local codex CLI (codex-acp bridge invokes it)
    defaultCliPath: `npx ${CODEX_ACP_NPX_PACKAGE}`,
    authRequired: true, // Needs OPENAI_API_KEY or ChatGPT auth
    enabled: true, // ✅ Codex via codex-acp ACP bridge
    supportsStreaming: false,
    acpArgs: [], // codex-acp is ACP by default, no flag needed
    skillsDirs: ['.codex/skills'],
  },
  codebuddy: {
    id: 'codebuddy',
    name: 'CodeBuddy',
    description:
      "Tencent's CodeBuddy — an AI programming assistant with deep code understanding and generation capabilities.",
    descriptionI18n: {
      'zh-CN': '腾讯出品的 CodeBuddy，具备深度代码理解与生成能力的 AI 编程助手。',
    },
    prompts: [
      'Deep-dive into this module and explain every design decision',
      'Generate a complete test suite covering all edge cases for this service',
      'Identify security vulnerabilities in this authentication flow',
    ],
    promptsI18n: {
      'zh-CN': [
        '深入分析这个模块，解释其中每一个设计决策',
        '为这个 Service 生成覆盖所有边界情况的完整测试套件',
        '找出这套认证流程中存在的安全漏洞',
      ],
    },
    avatarBgColor: 'hsl(187 58% 83%)',
    cliCommand: 'codebuddy',
    defaultCliPath: `npx ${CODEBUDDY_ACP_NPX_PACKAGE}`,
    authRequired: true,
    enabled: true, // ✅ Tencent CodeBuddy Code CLI，使用 `codebuddy --acp` 启动
    supportsStreaming: false,
    acpArgs: ['--acp'], // codebuddy 使用 --acp flag
    skillsDirs: ['.codebuddy/skills'],
  },
  goose: {
    id: 'goose',
    name: 'Goose',
    description: "Block's Goose — an open-source autonomous AI agent that executes multi-step tasks using tools.",
    descriptionI18n: {
      'zh-CN': 'Block 出品的 Goose，使用工具执行多步骤任务的开源自主 AI 智能体。',
    },
    prompts: [
      'Autonomously plan and execute a full project setup from scratch',
      'Chain these tasks together and run them end-to-end without stopping',
      'Search the web for the latest API docs and integrate them into this code',
    ],
    promptsI18n: {
      'zh-CN': [
        '自主规划并从零执行完整的项目初始化',
        '将这些任务串联起来，端到端连续执行不中断',
        '搜索最新 API 文档，并将其集成到这段代码中',
      ],
    },
    avatarBgColor: 'hsl(42 68% 83%)',
    cliCommand: 'goose',
    authRequired: false,
    enabled: true, // ✅ Block's Goose CLI，使用 `goose acp` 启动
    supportsStreaming: false,
    acpArgs: ['acp'], // goose 使用子命令而非 flag
    skillsDirs: ['.goose/skills'],
  },
  auggie: {
    id: 'auggie',
    name: 'Augment Code',
    description:
      'Augment Code — an AI coding agent that deeply understands large codebases for context-aware assistance.',
    descriptionI18n: {
      'zh-CN': 'Augment Code，深度理解大型代码库、提供上下文感知的 AI 编程智能体。',
    },
    avatarBgColor: 'hsl(342 58% 85%)',
    cliCommand: 'auggie',
    authRequired: false,
    enabled: true, // ✅ Augment Code CLI，使用 `auggie --acp` 启动
    supportsStreaming: false,
    acpArgs: ['--acp'], // auggie 使用 --acp flag
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi CLI',
    description: "Moonshot AI's Kimi CLI — a long-context AI coding agent with strong multilingual capabilities.",
    descriptionI18n: {
      'zh-CN': 'Moonshot AI 出品的 Kimi CLI，支持超长上下文与多语言的 AI 编程智能体。',
    },
    avatarBgColor: 'hsl(237 38% 88%)',
    cliCommand: 'kimi',
    authRequired: false,
    enabled: true, // ✅ Kimi CLI (Moonshot)，使用 `kimi acp` 启动
    supportsStreaming: false,
    acpArgs: ['acp'], // kimi 使用 acp 子命令
    skillsDirs: ['.kimi/skills'],
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode — an open-source AI coding agent that supports multiple model providers.',
    descriptionI18n: {
      'zh-CN': 'OpenCode，支持多种模型提供商的开源 AI 编程智能体。',
    },
    prompts: [
      'Build this feature using the best available model for each subtask',
      'Migrate this service to a new framework while preserving all behavior',
      'Audit this codebase for deprecated APIs and upgrade them all',
    ],
    promptsI18n: {
      'zh-CN': [
        '用最适合每个子任务的模型来实现这个功能',
        '将这个服务迁移到新框架，同时保留所有现有行为',
        '审查代码库中的废弃 API，并全部升级到最新版本',
      ],
    },
    avatarBgColor: 'hsl(163 55% 83%)',
    cliCommand: 'opencode',
    authRequired: false,
    enabled: true, // ✅ OpenCode CLI，使用 `opencode acp` 启动
    supportsStreaming: false,
    acpArgs: ['acp'], // opencode 使用 acp 子命令
  },
  droid: {
    id: 'droid',
    name: 'Factory Droid',
    description: "Factory's Droid — an AI software engineering agent designed for automated, end-to-end coding tasks.",
    descriptionI18n: {
      'zh-CN': 'Factory 出品的 Droid，专为端到端自动化编程任务设计的 AI 软件工程智能体。',
    },
    avatarBgColor: 'hsl(202 55% 83%)',
    cliCommand: 'droid',
    // Droid uses FACTORY_API_KEY from environment, not an interactive auth flow.
    authRequired: false,
    enabled: true, // ✅ Factory docs: `droid exec --output-format acp` (JetBrains/Zed ACP integration)
    supportsStreaming: false,
    acpArgs: ['exec', '--output-format', 'acp'],
    skillsDirs: ['.factory/skills'],
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    description:
      'GitHub Copilot Agent — AI pair programmer by GitHub and Microsoft, deeply integrated with your codebase.',
    descriptionI18n: {
      'zh-CN': 'GitHub Copilot 智能体，由 GitHub 和微软出品的 AI 结对编程助手，深度融入代码库。',
    },
    prompts: [
      'Suggest the next logical change based on my recent edits in this file',
      'Generate a full test suite that covers edge cases in this module',
      'Review this PR diff and flag anything that looks risky or incorrect',
    ],
    promptsI18n: {
      'zh-CN': [
        '根据我最近的编辑，建议这个文件接下来最合理的代码变更',
        '生成覆盖这个模块边界情况的完整测试套件',
        '审查这个 PR 的 diff，标出看起来有风险或错误的地方',
      ],
    },
    avatarBgColor: 'hsl(228 62% 85%)',
    cliCommand: 'copilot',
    authRequired: false,
    enabled: true, // ✅ GitHub Copilot CLI，使用 `copilot --acp --stdio` 启动
    supportsStreaming: false,
    acpArgs: ['--acp', '--stdio'], // copilot 使用 --acp --stdio 启动 ACP mode
  },
  qoder: {
    id: 'qoder',
    name: 'Qoder CLI',
    description: 'Qoder CLI — an AI coding assistant focused on intelligent code generation and refactoring.',
    descriptionI18n: {
      'zh-CN': 'Qoder CLI，专注于智能代码生成与重构的 AI 编程助手。',
    },
    avatarBgColor: 'hsl(295 52% 85%)',
    cliCommand: 'qodercli',
    authRequired: false,
    enabled: true, // ✅ Qoder CLI，使用 `qodercli --acp` 启动
    supportsStreaming: false,
    acpArgs: ['--acp'], // qoder 使用 --acp flag
  },
  vibe: {
    id: 'vibe',
    name: 'Mistral Vibe',
    description: "Mistral's Vibe — an AI coding agent powered by Mistral models for fast, expressive code generation.",
    descriptionI18n: {
      'zh-CN': 'Mistral 出品的 Vibe，基于 Mistral 模型的 AI 编程智能体，专注快速、流畅的代码生成。',
    },
    avatarBgColor: 'hsl(353 62% 85%)',
    cliCommand: 'vibe-acp',
    authRequired: false,
    enabled: true, // ✅ Mistral Vibe CLI，使用 `vibe-acp` 启动
    supportsStreaming: false,
    acpArgs: [],
    skillsDirs: ['.vibe/skills'],
  },
  'openclaw-gateway': {
    id: 'openclaw-gateway',
    name: 'OpenClaw',
    description: 'OpenClaw — an open-source AI agent gateway with real-time WebSocket streaming support.',
    descriptionI18n: {
      'zh-CN': 'OpenClaw，支持实时 WebSocket 流式传输的开源 AI 智能体网关。',
    },
    avatarBgColor: 'hsl(88 52% 83%)',
    cliCommand: 'openclaw',
    authRequired: false,
    enabled: true, // ✅ OpenClaw Gateway WebSocket mode
    supportsStreaming: true,
    acpArgs: ['gateway'], // openclaw gateway command (for detection)
  },
  nanobot: {
    id: 'nanobot',
    name: 'Nano Bot',
    description: 'Nano Bot — a lightweight, scriptable AI agent built for focused and fast coding tasks.',
    descriptionI18n: {
      'zh-CN': 'Nano Bot，轻量可脚本化的 AI 智能体，专为专注、高效的编程任务而设计。',
    },
    avatarBgColor: 'hsl(30 18% 86%)',
    cliCommand: 'nanobot',
    authRequired: false,
    enabled: true,
    supportsStreaming: false,
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor Agent',
    description:
      "Cursor's AI agent — the coding assistant from the AI-first code editor, now available in your terminal.",
    descriptionI18n: {
      'zh-CN': 'Cursor AI 编辑器的智能体，现可在终端中直接使用。',
    },
    prompts: [
      'Refactor this entire feature using patterns already established in this codebase',
      'Learn my coding style from existing files and write new code that matches it',
      'Find and eliminate all duplication across this module',
    ],
    promptsI18n: {
      'zh-CN': [
        '参照代码库中已有的模式，重构这整个功能模块',
        '从现有文件学习我的编码风格，按风格生成新代码',
        '找出并消除这个模块中所有的重复代码',
      ],
    },
    // Note: Cursor CLI uses the generic command name "agent". Detection relies on `which agent`
    // which may match other tools. Users should ensure the Cursor CLI is the `agent` on their PATH.
    avatarBgColor: 'hsl(168 55% 83%)',
    cliCommand: 'agent',
    authRequired: true, // Requires active Cursor subscription
    enabled: true, // ✅ Cursor AI Agent CLI, launched via `agent acp`
    supportsStreaming: false,
    acpArgs: ['acp'], // Cursor uses `agent acp` subcommand
    skillsDirs: ['.cursor/skills'],
  },
  kiro: {
    id: 'kiro',
    name: 'Kiro',
    description: "Amazon's Kiro — an AI-powered coding agent from AWS with spec-driven development capabilities.",
    descriptionI18n: {
      'zh-CN': '亚马逊出品的 Kiro，具备规范驱动开发能力的 AWS AI 编程智能体。',
    },
    prompts: [
      'Turn this feature request into a detailed technical spec',
      'Implement exactly what this spec says, step by step',
      'Write a spec for a new API, then generate the full implementation',
    ],
    promptsI18n: {
      'zh-CN': [
        '把这个功能需求转化为详细的技术规范',
        '严格按照这份规范逐步实现每一项要求',
        '先写一份新 API 的规范，再生成完整实现',
      ],
    },
    avatarBgColor: 'hsl(36 68% 83%)',
    cliCommand: 'kiro-cli',
    authRequired: true, // Requires Kiro / AWS Builder ID login
    enabled: true, // ✅ Kiro CLI, launched via `kiro-cli acp`
    supportsStreaming: false,
    acpArgs: ['acp'], // Kiro uses `kiro-cli acp` subcommand
  },
  hermes: {
    id: 'hermes',
    name: 'Hermes Agent',
    description: 'Hermes by Nous Research — an AI agent with 90+ tools, persistent memory, and multi-platform support.',
    descriptionI18n: {
      'zh-CN': 'Nous Research 出品的 Hermes，拥有 90+ 工具、持久记忆与多平台支持的 AI 智能体。',
    },
    avatarBgColor: 'hsl(128 52% 83%)',
    cliCommand: 'hermes',
    authRequired: true,
    enabled: true, // ✅ Nous Research Hermes Agent，使用 `hermes acp` 启动
    supportsStreaming: false,
    acpArgs: ['acp'], // hermes 使用 acp 子命令
  },
  snow: {
    id: 'snow',
    name: 'Snow AI',
    description: 'Snow AI — a streamlined AI coding agent for clean, focused software development workflows.',
    descriptionI18n: {
      'zh-CN': 'Snow AI，专注简洁、高效软件开发流程的 AI 编程智能体。',
    },
    avatarBgColor: 'hsl(193 55% 88%)',
    cliCommand: 'snow',
    authRequired: false,
    enabled: true,
    supportsStreaming: false,
    acpArgs: ['--acp'],
  },
  remote: {
    id: 'remote',
    name: 'Remote Agent',
    avatarBgColor: 'hsl(250 40% 87%)',
    cliCommand: undefined, // No local CLI — connected via WebSocket URL
    authRequired: false,
    enabled: true,
    supportsStreaming: true,
  },
  aionrs: {
    id: 'aionrs',
    name: 'Aion CLI',
    description: 'Aion CLI — a built-in high-performance AI agent powered by a Rust runtime with streaming support.',
    descriptionI18n: {
      'zh-CN': 'Aion CLI，内置的高性能 AI 智能体，基于 Rust 运行时，支持流式输出。',
    },
    prompts: [
      'Quickly scan this file and tell me exactly what it does',
      'Prototype a working solution for this problem right now',
      'Stream the analysis as you go through this large codebase',
    ],
    promptsI18n: {
      'zh-CN': [
        '快速扫描这个文件，精准告诉我它的作用',
        '现在就为这个问题快速原型一个可运行的解决方案',
        '分析这个大型代码库时，实时流式输出分析结果',
      ],
    },
    avatarBgColor: 'hsl(215 65% 83%)',
    cliCommand: 'aionrs',
    authRequired: false, // Auth handled via env vars from model config
    enabled: true,
    supportsStreaming: true,
    skillsDirs: ['.aionrs/skills'],
  },
  custom: {
    id: 'custom',
    name: 'Custom Agent',
    cliCommand: undefined, // User-configured via settings
    authRequired: false,
    enabled: true,
    supportsStreaming: false,
  },
};

// 仅启用的后端配置 / Enabled backends only
export const ACP_ENABLED_BACKENDS: Record<string, AcpBackendConfig> = Object.fromEntries(
  Object.entries(ACP_BACKENDS_ALL).filter(([_, config]) => config.enabled)
);

// 当前启用的后端类型 / Currently enabled backend types
export type AcpBackend = keyof typeof ACP_BACKENDS_ALL;
export type AcpBackendId = AcpBackend; // 向后兼容 / Backward compatibility

// 工具函数 / Utility functions
export function isValidAcpBackend(backend: string): backend is AcpBackend {
  return backend in ACP_ENABLED_BACKENDS;
}

export function getAcpBackendConfig(backend: AcpBackend): AcpBackendConfig {
  // Enabled backends first; fall back to ACP_BACKENDS_ALL so that display
  // metadata (description, prompts, logo) is always accessible even for
  // backends whose enabled flag is false (e.g. the built-in gemini agent).
  return ACP_ENABLED_BACKENDS[backend] ?? ACP_BACKENDS_ALL[backend];
}

// 获取所有启用的后端配置 / Get all enabled backend configurations
export function getEnabledAcpBackends(): AcpBackendConfig[] {
  return Object.values(ACP_ENABLED_BACKENDS);
}

// 获取所有后端配置（包括禁用的）/ Get all backend configurations (including disabled ones)
export function getAllAcpBackends(): AcpBackendConfig[] {
  return Object.values(ACP_BACKENDS_ALL);
}

// 检查后端是否启用 / Check if a backend is enabled
export function isAcpBackendEnabled(backend: AcpBackendAll): boolean {
  return ACP_BACKENDS_ALL[backend]?.enabled ?? false;
}

/**
 * 检查给定 agent 类型/backend 是否支持原生 skill 发现
 * Check if a given agent type/backend supports native skill discovery.
 * When false, callers should fallback to prompt injection for skills.
 */
export function hasNativeSkillSupport(agentTypeOrBackend: string | undefined): boolean {
  if (!agentTypeOrBackend) return false;
  const config = ACP_BACKENDS_ALL[agentTypeOrBackend as AcpBackendAll];
  return !!config?.skillsDirs?.length;
}

/**
 * 获取指定 backend 的原生 skill 目录列表
 * Get native skill directories for a given backend.
 * Returns undefined if the backend does not support native skill discovery.
 */
export function getSkillsDirsForBackend(agentTypeOrBackend: string | undefined): string[] | undefined {
  if (!agentTypeOrBackend) return undefined;
  return ACP_BACKENDS_ALL[agentTypeOrBackend as AcpBackendAll]?.skillsDirs;
}

// ACP 错误类型系统 - 优雅的错误处理 / ACP Error Type System - Elegant error handling
export enum AcpErrorType {
  CONNECTION_NOT_READY = 'CONNECTION_NOT_READY',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  UNKNOWN = 'UNKNOWN',
}

export interface AcpError {
  type: AcpErrorType;
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

// ACP 结果类型 - 类型安全的结果处理 / ACP Result Type - Type-safe result handling
export type AcpResult<T = unknown> = { success: true; data: T } | { success: false; error: AcpError };

// 创建 ACP 错误的辅助函数 / Helper function to create ACP errors
export function createAcpError(
  type: AcpErrorType,
  message: string,
  retryable: boolean = false,
  details?: unknown
): AcpError {
  return {
    type,
    code: type.toString(),
    message,
    retryable,
    details,
  };
}

export function isRetryableError(error: AcpError): boolean {
  return error.retryable || error.type === AcpErrorType.CONNECTION_NOT_READY;
}

// ACP JSON-RPC 协议类型 / ACP JSON-RPC Protocol Types
export const JSONRPC_VERSION = '2.0' as const;

export interface AcpRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export interface AcpResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface AcpNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

// 所有会话更新的基础接口 / Base interface for all session updates
export interface BaseSessionUpdate {
  sessionId: string;
}

// Agent 消息块更新 / Agent message chunk update
export interface AgentMessageChunkUpdate extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'agent_message_chunk';
    content: {
      type: 'text' | 'image';
      text?: string;
      data?: string;
      mimeType?: string;
      uri?: string;
    };
  };
}

// Agent 思考块更新 / Agent thought chunk update
export interface AgentThoughtChunkUpdate extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'agent_thought_chunk';
    content: {
      type: 'text';
      text: string;
    };
  };
}

// ===== 共享子类型 / Shared sub-types =====

/** Tool call 内容项类型 / Tool call content item type */
export interface ToolCallContentItem {
  type: 'content' | 'diff';
  content?: {
    type: 'text';
    text: string;
  };
  path?: string;
  oldText?: string | null;
  newText?: string;
}

/** Tool call 位置项类型 / Tool call location item type */
export interface ToolCallLocationItem {
  path: string;
}

// 工具调用更新 / Tool call update
export interface ToolCallUpdate extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'tool_call';
    toolCallId: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    title: string;
    kind: 'read' | 'edit' | 'execute';
    rawInput?: Record<string, unknown>;
    content?: ToolCallContentItem[];
    locations?: ToolCallLocationItem[];
  };
}

// 工具调用状态更新 / Tool call update (status change)
export interface ToolCallUpdateStatus extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'tool_call_update';
    toolCallId: string;
    status: 'completed' | 'failed';
    // rawInput may arrive in tool_call_update with complete data (after streaming completes)
    // This happens when input_json_delta finishes and the full input is available
    rawInput?: Record<string, unknown>;
    content?: Array<{
      type: 'content';
      content: {
        type: 'text';
        text: string;
      };
    }>;
  };
}

// 计划更新 / Plan update
export interface PlanUpdate extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'plan';
    entries: Array<{
      content: string;
      status: 'pending' | 'in_progress' | 'completed';
      priority?: 'low' | 'medium' | 'high';
    }>;
  };
}

// 可用命令更新 / Available commands update
export interface AvailableCommandsUpdate extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'available_commands_update';
    availableCommands: Array<{
      name: string;
      description: string;
      input?: {
        hint?: string;
      } | null;
    }>;
  };
}

// 用户消息块更新 / User message chunk update
export interface UserMessageChunkUpdate extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'user_message_chunk';
    content: {
      type: 'text' | 'image';
      text?: string;
      data?: string;
      mimeType?: string;
      uri?: string;
    };
  };
}

// ===== ACP ConfigOption types (stable API) =====

/** A single select option within a config option */
export interface AcpConfigSelectOption {
  value: string;
  name?: string;
  label?: string; // Some agents may use label instead of name
}

/** A configuration option returned by session/new */
export interface AcpSessionConfigOption {
  id: string;
  name?: string;
  label?: string; // Some agents may use label instead of name
  description?: string;
  category?: string;
  type: 'select' | 'boolean' | 'string';
  currentValue?: string;
  selectedValue?: string; // Some agents may use selectedValue instead of currentValue
  options?: AcpConfigSelectOption[];
}

/** Config options update notification (within session/update) */
export interface ConfigOptionsUpdatePayload extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'config_option_update';
    configOptions: AcpSessionConfigOption[];
  };
}

/** Usage update notification from ACP backend (context window utilization, supported by claude-agent-acp and codex-acp) */
export interface UsageUpdatePayload extends BaseSessionUpdate {
  update: {
    sessionUpdate: 'usage_update';
    /** Total tokens currently in context */
    used: number;
    /** Context window capacity (max tokens) */
    size: number;
    /** Cumulative session cost */
    cost?: {
      amount: number;
      currency: string;
    };
  };
}

/** Per-turn token usage from PromptResponse (unstable ACP spec, supported by codex-acp) */
export interface AcpPromptResponseUsage {
  /** Total input tokens (includes context from previous turns) */
  inputTokens: number;
  /** Total output tokens for this turn */
  outputTokens: number;
  /** Sum of all token types */
  totalTokens: number;
  /** Tokens read from cache */
  cachedReadTokens?: number | null;
  /** Tokens written to cache */
  cachedWriteTokens?: number | null;
  /** Reasoning/thinking tokens */
  thoughtTokens?: number | null;
}

// ===== ACP Models types (unstable API) =====

/** An available model returned by session/new (unstable API) */
export interface AcpAvailableModel {
  id?: string;
  modelId?: string; // OpenCode uses modelId instead of id
  name?: string;
}

/** Models info returned by session/new (unstable API) */
export interface AcpSessionModels {
  currentModelId?: string;
  availableModels?: AcpAvailableModel[];
}

// ===== Unified model info for UI =====

/** Unified model info that abstracts over both stable and unstable APIs */
export interface AcpModelInfo {
  /** Currently active model ID */
  currentModelId: string | null;
  /** Display label for the current model */
  currentModelLabel: string | null;
  /** Available models for switching */
  availableModels: Array<{ id: string; label: string }>;
  /** Whether the user can switch models */
  canSwitch: boolean;
  /** Source of the model info: 'configOption' (stable) or 'models' (unstable) */
  source: 'configOption' | 'models';
  /** Config option ID (only when source is 'configOption') */
  configOptionId?: string;
}

// 所有会话更新的联合类型 / Union type for all session updates
export type AcpSessionUpdate =
  | AgentMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallUpdate
  | ToolCallUpdateStatus
  | PlanUpdate
  | AvailableCommandsUpdate
  | UserMessageChunkUpdate
  | ConfigOptionsUpdatePayload
  | UsageUpdatePayload;

// 当前的 ACP 权限请求接口 / Current ACP permission request interface
export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}
export interface AcpPermissionRequest {
  sessionId: string;
  options: Array<AcpPermissionOption>;
  toolCall: {
    toolCallId: string;
    rawInput?: {
      command?: string;
      description?: string;
      [key: string]: unknown;
    };
    status?: string;
    title?: string;
    kind?: string;
    content?: ToolCallContentItem[];
    locations?: ToolCallLocationItem[];
  };
}

// 历史兼容性类型 - 支持旧版本数据结构 / Legacy compatibility type - supports old version data structures
export interface LegacyAcpPermissionData extends Record<string, unknown> {
  // 可能的旧版本字段 / Possible old version fields
  options?: Array<{
    optionId?: string;
    name?: string;
    kind?: string;
    // 兼容可能的其他字段 / Compatible with other possible fields
    [key: string]: unknown;
  }>;
  toolCall?: {
    toolCallId?: string;
    rawInput?: unknown;
    title?: string;
    kind?: string;
    // 兼容可能的其他字段 / Compatible with other possible fields
    [key: string]: unknown;
  };
}

// 兼容性联合类型 / Compatibility union type
export type CompatibleAcpPermissionData = AcpPermissionRequest | LegacyAcpPermissionData;

export type AcpMessage = AcpRequest | AcpNotification | AcpResponse | AcpSessionUpdate;

// 文件操作请求类型 / File Operation Request Types
export interface AcpFileWriteRequest extends AcpRequest {
  method: 'fs/write_text_file';
  params: {
    sessionId: string;
    path: string;
    content: string;
  };
}

export interface AcpFileReadRequest extends AcpRequest {
  method: 'fs/read_text_file';
  params: {
    sessionId: string;
    path: string;
  };
}

// ===== ACP 协议方法常量 / ACP Protocol Method Constants =====
// 这些常量定义了 ACP 协议中使用的 method 名称
// 来源：现有代码实现（无官方协议文档，如有更新请同步修改）
// These constants define the method names used in the ACP protocol.
// Source: Existing code implementation (no official protocol docs, sync changes if updated).

export const ACP_METHODS = {
  SESSION_UPDATE: 'session/update',
  REQUEST_PERMISSION: 'session/request_permission',
  READ_TEXT_FILE: 'fs/read_text_file',
  WRITE_TEXT_FILE: 'fs/write_text_file',
  SET_CONFIG_OPTION: 'session/set_config_option',
} as const;

export type AcpMethod = (typeof ACP_METHODS)[keyof typeof ACP_METHODS];

// ===== 可辨识联合类型 / Discriminated Union Types =====
// 用于 AcpConnection.handleIncomingRequest 的类型安全分发
// Used for type-safe dispatching in AcpConnection.handleIncomingRequest

/** Session 更新通知 / Session update notification */
export interface AcpSessionUpdateNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: typeof ACP_METHODS.SESSION_UPDATE;
  params: AcpSessionUpdate;
}

/** 权限请求消息 / Permission request message */
export interface AcpPermissionRequestMessage {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: typeof ACP_METHODS.REQUEST_PERMISSION;
  params: AcpPermissionRequest;
}

/** 文件读取请求（带类型化 params）/ File read request (with typed params) */
export interface AcpFileReadMessage {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: typeof ACP_METHODS.READ_TEXT_FILE;
  params: {
    path: string;
    sessionId?: string;
  };
}

/** 文件写入请求（带类型化 params）/ File write request (with typed params) */
export interface AcpFileWriteMessage {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: typeof ACP_METHODS.WRITE_TEXT_FILE;
  params: {
    path: string;
    content: string;
    sessionId?: string;
  };
}

/**
 * ACP 入站消息联合类型
 * TypeScript 可根据 method 字段自动窄化类型
 *
 * ACP incoming message union type.
 * TypeScript can automatically narrow the type based on the method field.
 */
export type AcpIncomingMessage =
  | AcpSessionUpdateNotification
  | AcpPermissionRequestMessage
  | AcpFileReadMessage
  | AcpFileWriteMessage;
