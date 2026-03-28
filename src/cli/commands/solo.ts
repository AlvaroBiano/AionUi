/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Solo command — interactive multi-turn chat with slash-command extensions.
 *
 * Key design decisions:
 *   1. Logo + agent list shown on startup — platform identity first.
 *   2. Numbered selection prompt (Warp-compatible) when multiple agents exist.
 *      No arrow keys, no raw mode — just type 1/2/Enter.
 *   3. Slash commands (/team, /model, /agents, /help) handled locally.
 *   4. Routes through factory — CLI agents use SpawnCliAgentManager.
 *   5. First-run onboarding when no agents configured.
 */
import { createInterface } from 'node:readline';
import { loadConfig } from '../config/loader';
import { createCliAgentFactory } from '../agents/factory';
import { startRepl } from '../ui/repl';
import { fmt, hr } from '../ui/format';
import type { AionCliConfig } from '../config/types';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter, AgentMessageEvent } from '@process/task/IAgentEventEmitter';

const VERSION = '1.9.2';

// ── Logo ──────────────────────────────────────────────────────────────────────

const LOGO_LINES = [
  '    _   ___ ___  _  _ ',
  '   /_\\  |_ _/ _ \\| \\| |',
  '  / _ \\  | | (_) | .` |',
  ' /_/ \\_\\|___\\___/|_|\\_|',
];

// ── Stdout emitter ────────────────────────────────────────────────────────────

function makeStdoutEmitter(): IAgentEventEmitter {
  return {
    emitConfirmationAdd: () => {},
    emitConfirmationUpdate: () => {},
    emitConfirmationRemove: () => {},
    emitMessage(_cid: string, event: AgentMessageEvent) {
      if (event.type === 'text') {
        const text = (event.data as { content?: string })?.content ?? '';
        process.stdout.write(text);
      } else if (event.type === 'status') {
        const status = (event.data as { status?: string })?.status;
        if (status === 'done') {
          process.stdout.write('\n\n');
        }
      }
    },
  };
}

// ── Platform welcome ──────────────────────────────────────────────────────────

function printLogo(config: AionCliConfig): void {
  const agentCount = Object.keys(config.agents).length;
  const agentLabel = agentCount === 1 ? '1 agent' : `${agentCount} agents`;

  process.stdout.write('\n');
  for (const line of LOGO_LINES) {
    process.stdout.write(fmt.cyan(line) + '\n');
  }
  process.stdout.write(
    `  ${fmt.dim('Multi-Model Agent Platform')}  ${fmt.dim(`·`)}  ${fmt.dim(`v${VERSION}`)}  ${fmt.dim(`·`)}  ${fmt.green(agentLabel + ' ready')}\n`,
  );
  process.stdout.write(fmt.dim(hr()) + '\n');
}

function printOnboarding(): void {
  process.stdout.write('\n');
  for (const line of LOGO_LINES) {
    process.stdout.write(fmt.cyan(line) + '\n');
  }
  process.stdout.write(fmt.dim('  Multi-Model Agent Platform\n\n'));
  process.stdout.write(fmt.bold('No agents detected.\n\n'));
  process.stdout.write('Get started:\n\n');
  process.stdout.write(`  ${fmt.cyan('brew install anthropics/tap/claude-code')}   ${fmt.dim('# Claude Code CLI')}\n`);
  process.stdout.write(`  ${fmt.cyan('npm install -g @openai/codex')}              ${fmt.dim('# Codex CLI')}\n`);
  process.stdout.write(`\n  ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}     ${fmt.dim('# Direct Anthropic API')}\n`);
  process.stdout.write(`  ${fmt.cyan('export GEMINI_API_KEY=...')}                ${fmt.dim('# Gemini API')}\n`);
  process.stdout.write(`\nRun ${fmt.cyan('aion doctor')} to verify.\n\n`);
}

// ── Agent selector (Warp-compatible) ─────────────────────────────────────────

/**
 * Show a numbered agent list and prompt for selection.
 * Works in Warp and all terminals — no raw mode, no arrow keys.
 * Returns immediately with default if only one agent or if not a TTY.
 */
async function selectAgent(config: AionCliConfig, preferred?: string): Promise<string> {
  const keys = Object.keys(config.agents);

  // No choice needed
  if (preferred && config.agents[preferred]) return preferred;
  if (keys.length <= 1) return config.defaultAgent;
  if (!process.stdin.isTTY) return config.defaultAgent;

  // Print numbered list
  process.stdout.write('\n');
  for (const [i, key] of keys.entries()) {
    const agent = config.agents[key]!;
    const isDefault = key === config.defaultAgent;
    const provider =
      agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
        ? agent.provider
        : `${agent.provider}/${agent.model ?? '?'}`;
    const tag = isDefault ? fmt.dim('  ← default') : '';
    process.stdout.write(`  ${fmt.dim(`${i + 1}.`)} ${fmt.bold(fmt.cyan(key))}  ${fmt.dim(provider)}${tag}\n`);
  }

  const defaultIdx = keys.indexOf(config.defaultAgent) + 1 || 1;

  return new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(fmt.bold(`\nSelect agent [${defaultIdx}]: `), (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve(config.defaultAgent);
        return;
      }
      const n = parseInt(trimmed, 10);
      if (!isNaN(n) && n >= 1 && n <= keys.length) {
        resolve(keys[n - 1]!);
      } else {
        // Allow typing the name directly (e.g. "codex")
        resolve(config.agents[trimmed] ? trimmed : config.defaultAgent);
      }
    });
  });
}

// ── Slash command handler ─────────────────────────────────────────────────────

const SLASH_HELP = `
${fmt.bold('Slash commands:')}
  ${fmt.cyan('/team [goal]')}    Launch a multi-agent team
  ${fmt.cyan('/model <name>')}   Switch active agent  ${fmt.dim('(e.g. /model codex)')}
  ${fmt.cyan('/agents')}         List configured agents
  ${fmt.cyan('/help')}           Show this help
  ${fmt.cyan('/exit')}           Exit
`.trim();

async function handleSlashCommand(
  input: string,
  config: AionCliConfig,
  agentKeyRef: { current: string },
  managerRef: { current: IAgentManager },
): Promise<{ handled: boolean; exit?: boolean }> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (cmd?.toLowerCase()) {
    case 'help':
      process.stdout.write('\n' + SLASH_HELP + '\n\n');
      return { handled: true };

    case 'agents': {
      const keys = Object.keys(config.agents);
      process.stdout.write('\n' + fmt.bold('Configured agents:\n'));
      for (const [i, key] of keys.entries()) {
        const agent = config.agents[key]!;
        const marker = key === agentKeyRef.current ? fmt.green('●') : fmt.dim('○');
        const provider =
          agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
            ? agent.provider
            : `${agent.provider}/${agent.model ?? '?'}`;
        process.stdout.write(`  ${marker} ${fmt.dim(`${i + 1}.`)} ${fmt.cyan(key)}  ${fmt.dim(provider)}\n`);
      }
      process.stdout.write(fmt.dim('\n  Switch: /model <name> or /model <number>\n\n'));
      return { handled: true };
    }

    case 'model': {
      if (!arg) {
        process.stdout.write(fmt.yellow('Usage: /model <name>  e.g. /model codex\n'));
        return { handled: true };
      }
      // Support both name and number
      const keys = Object.keys(config.agents);
      const byNumber = parseInt(arg, 10);
      const resolvedKey =
        config.agents[arg] ? arg
        : (!isNaN(byNumber) && keys[byNumber - 1]) ? keys[byNumber - 1]!
        : null;

      if (!resolvedKey) {
        process.stdout.write(fmt.red(`Agent "${arg}" not found. Run /agents to list available.\n`));
        return { handled: true };
      }
      agentKeyRef.current = resolvedKey;
      const emitter = makeStdoutEmitter();
      const factory = createCliAgentFactory(config, undefined, resolvedKey);
      managerRef.current = factory(`solo-${Date.now()}`, '', emitter);
      process.stdout.write(
        fmt.green(`Switched to ${fmt.bold(resolvedKey)}\n`) +
          fmt.dim('New conversation started.\n\n'),
      );
      return { handled: true };
    }

    case 'team': {
      const { runTeam } = await import('./team');
      await runTeam({ goal: arg || undefined });
      return { handled: true };
    }

    case 'exit':
    case 'quit':
      process.stdout.write(fmt.dim('Goodbye.\n'));
      return { handled: true, exit: true };

    default:
      return { handled: false };
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runSolo(options: SoloOptions = {}): Promise<void> {
  const config = loadConfig();

  if (Object.keys(config.agents).length === 0) {
    printOnboarding();
    process.exit(1);
  }

  printLogo(config);

  // Warp-compatible agent selection
  const selectedKey = await selectAgent(config, options.agent);
  const agentKeyRef = { current: selectedKey };

  const agentConfig = config.agents[selectedKey];
  if (!agentConfig) {
    process.stderr.write(fmt.red(`Agent "${selectedKey}" not found.\n`));
    process.exit(1);
  }

  const agentKeys = Object.keys(config.agents);
  const agentInfo =
    agentConfig.provider === 'claude-cli' || agentConfig.provider === 'codex-cli'
      ? agentConfig.provider
      : `${agentConfig.provider}/${agentConfig.model ?? '?'}`;

  process.stdout.write(
    `\n${fmt.green('●')} ${fmt.bold(fmt.cyan(selectedKey))}  ${fmt.dim(agentInfo)}\n`,
  );
  if (agentKeys.length > 1) {
    process.stdout.write(
      fmt.dim(`  /model <name>  switch agent  ·  /team [goal]  multi-agent  ·  /help\n`),
    );
  } else {
    process.stdout.write(fmt.dim(`  /help for commands\n`));
  }
  process.stdout.write(fmt.dim(hr()) + '\n\n');

  const emitter = makeStdoutEmitter();
  const factory = createCliAgentFactory(config, undefined, selectedKey);
  const managerRef: { current: IAgentManager } = {
    current: factory(`solo-${Date.now()}`, '', emitter),
  };

  // Dynamic prompt: always shows the currently active agent name
  await startRepl(() => `${agentKeyRef.current} >`, async (input) => {
    if (input.startsWith('/')) {
      const result = await handleSlashCommand(input, config, agentKeyRef, managerRef);
      if (result.exit) process.exit(0);
      if (result.handled) return;
    }
    await managerRef.current.sendMessage({ content: input });
  });
}
