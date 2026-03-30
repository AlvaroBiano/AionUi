/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Solo command — interactive multi-turn chat.
 *
 * Design (per UX Lead spec):
 *   - ≤2 lines of chrome before prompt on repeat runs
 *   - Passive agent list — no readline before REPL, no Warp stdin freeze
 *   - Warn loudly on silent agent fallbacks
 *   - Kill old manager before switching agents
 *   - ↑/↓ history via readline historySize (in repl.ts)
 */
import { loadConfig } from '../config/loader';
import { createCliAgentFactory } from '../agents/factory';
import { startRepl } from '../ui/repl';
import { InlineCommandPicker } from '../ui/InlineCommandPicker';
import { fmt, hr, Spinner } from '../ui/format';
import { isFirstLaunch } from '../ui/history';
import type { Interface } from 'node:readline';
import type { AionCliConfig } from '../config/types';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter, AgentMessageEvent } from '@process/task/IAgentEventEmitter';

// Single source of truth pulled from package.json at build time via esbuild define,
// with a fallback so it still works in ts-node / tests.
const VERSION: string =
  typeof __AION_VERSION__ !== 'undefined' ? __AION_VERSION__ : '1.9.2';

declare const __AION_VERSION__: string | undefined;

const LOGO_LINES = [
  '  ┌─┐  ┬  ┌─┐  ┌┐┌',
  '  ├─┤  │  │ │  │╲│',
  '  ┴ ┴  ┴  └─┘  ┘ └',
];

// ── Emitter ───────────────────────────────────────────────────────────────────

type StdoutEmitter = IAgentEventEmitter & {
  mute(): void;
  unmute(): void;
};

function makeStdoutEmitter(
  getRl: () => Interface | null = () => null,
): StdoutEmitter {
  const spinner = new Spinner('Thinking');
  let textStarted = false;
  // muted=true after ESC/interrupt: swallows all subsequent agent events so that
  // in-flight text/done events don't corrupt the terminal after "已中断" is shown.
  let muted = false;

  return {
    mute() {
      muted = true;
      spinner.stop(); // clear spinner line immediately
    },
    unmute() {
      muted = false;
    },
    emitConfirmationAdd: () => {},
    emitConfirmationUpdate: () => {},
    emitConfirmationRemove: () => {},
    emitMessage(_cid: string, event: AgentMessageEvent) {
      if (muted) return; // swallow all events after interrupt
      if (event.type === 'status') {
        const status = (event.data as { status?: string })?.status;
        if (status === 'running') {
          textStarted = false;
          process.stdout.write(`\n${fmt.dim(hr())}\n`);
          spinner.start();
        } else if (status === 'done') {
          spinner.stop();
          textStarted = false;
          process.stdout.write(`\n${fmt.dim(hr())}\n\n`);
          const rl = getRl();
          if (rl) {
            rl.resume();
            rl.prompt(true);
          }
        }
      } else if (event.type === 'text') {
        if (!textStarted) {
          spinner.stop();
          textStarted = true;
        }
        process.stdout.write((event.data as { content?: string })?.content ?? '');
      }
    },
  };
}

// ── Display ───────────────────────────────────────────────────────────────────

function printOnboarding(): void {
  process.stdout.write('\n');
  for (const line of LOGO_LINES) process.stdout.write(fmt.dim(line) + '\n');
  process.stdout.write('\n');
  process.stdout.write(`   ${fmt.dim('Multi-Model Agent Platform')}   ${fmt.dim('v' + VERSION)}\n\n`);
  process.stdout.write(fmt.bold('No agents detected.\n\n'));
  process.stdout.write(
    `   ${fmt.cyan('brew install anthropic/tap/claude-code')}   ${fmt.dim('# Claude Code CLI')}\n` +
      `   ${fmt.cyan('npm install -g @openai/codex')}              ${fmt.dim('# Codex CLI')}\n\n` +
      `   ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}       ${fmt.dim('# Anthropic API')}\n` +
      `   ${fmt.cyan('export GEMINI_API_KEY=...')}                 ${fmt.dim('# Gemini API')}\n\n` +
      `Run ${fmt.cyan('aion doctor')} to verify.\n\n`,
  );
}

/**
 * Logo + agent status header.
 * Active agent shown bold+cyan with a filled dot, others dim.
 */
function printHeader(config: AionCliConfig, activeKey: string): void {
  process.stdout.write('\n');
  for (const line of LOGO_LINES) {
    process.stdout.write(fmt.dim(line) + '\n');
  }
  process.stdout.write('\n');
  process.stdout.write(`   ${fmt.dim('Multi-Model Agent Platform')}   ${fmt.dim('v' + VERSION)}\n\n`);

  const keys = Object.keys(config.agents);
  const agentList = keys
    .map((k) => {
      if (k === activeKey) {
        return `${fmt.bold(fmt.cyan(k))} ${fmt.cyan('●')}`;
      }
      return fmt.dim(`${k} ·`);
    })
    .join('  ');

  process.stdout.write(fmt.dim(`  ${hr()}`) + '\n');
  process.stdout.write(`   ${agentList}   ${fmt.dim('/help')}\n\n`);
}

function printTips(): void {
  process.stdout.write(
    `  ${fmt.dim(hr('╴', 80))}\n` +
    `  ${fmt.cyan('/')}      ${fmt.dim('Commands  —  Tab to complete')}\n` +
    `  ${fmt.cyan('/team')}  ${fmt.dim('Multi-agent mode')}\n` +
    `  ${fmt.cyan('ESC')}    ${fmt.dim('Interrupt, restore input')}\n` +
    `  ${fmt.cyan('/help')}  ${fmt.dim('View commands & shortcuts')}\n` +
    `  ${fmt.dim(hr('╴', 80))}\n\n`,
  );
}

// ── Slash commands ────────────────────────────────────────────────────────────

const SLASH_HELP = `
${fmt.bold('Slash commands:')}
  ${fmt.cyan('/model <name|num>')}  Switch agent  ${fmt.dim('(e.g. /model codex  or  /model 2)')}
  ${fmt.cyan('/agents')}            List configured agents
  ${fmt.cyan('/team [goal]')}       Launch multi-agent mode
  ${fmt.cyan('/clear')}             Clear screen (keeps session context)
  ${fmt.cyan('/help')}              Show this help
  ${fmt.cyan('/exit')}              Quit

${fmt.bold('Shortcuts:')}
  ${fmt.cyan('ESC')}       Interrupt agent response, restore input
  ${fmt.cyan('Ctrl+C')}    Interrupt; press again to quit
  ${fmt.cyan('Ctrl+L')}    Clear screen (same as /clear)
  ${fmt.cyan('\\')}         Backslash at end of line to continue on next line
`.trim();

async function handleSlashCommand(
  input: string,
  config: AionCliConfig,
  agentKeyRef: { current: string },
  managerRef: { current: IAgentManager },
  emitterRef: { current: StdoutEmitter },
  suppressEscRef: { current: boolean },
  picker: InlineCommandPicker,
  getRl: () => Interface | null,
): Promise<{ handled: boolean; exit?: boolean }> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (cmd?.toLowerCase()) {
    case 'help':
      process.stdout.write('\n' + SLASH_HELP + '\n\n');
      return { handled: true };

    case 'agents': {
      const keys = Object.keys(config.agents);
      process.stdout.write('\n');
      for (const [i, key] of keys.entries()) {
        const agent = config.agents[key]!;
        const isActive = key === agentKeyRef.current;
        const provider =
          agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
            ? agent.provider
            : `${agent.provider}/${agent.model ?? '?'}`;
        process.stdout.write(
          `  ${isActive ? fmt.green('●') : fmt.dim('○')} ${fmt.dim(`${i + 1}.`)} ${fmt.cyan(key)}  ${fmt.dim(provider)}${isActive ? fmt.dim('  ← active') : ''}\n`,
        );
      }
      process.stdout.write(fmt.dim('\n  Use /model <name> or /model <number> to switch\n\n'));
      return { handled: true };
    }

    case 'model': {
      if (!arg) {
        if (process.stdout.isTTY) {
          // 交互式选择器（TTY 环境）
          const agents = Object.keys(config.agents).map((k) => ({
            key: k,
            provider: config.agents[k]!.provider,
            isActive: k === agentKeyRef.current,
          }));
          await new Promise<void>((resolve) => {
            picker.showAgentSelector(agents, async (selectedKey) => {
              if (selectedKey && selectedKey !== agentKeyRef.current) {
                await managerRef.current.stop();
                process.stdout.write('\r\x1b[2K'); // clear any dangling spinner line
                agentKeyRef.current = selectedKey;
                const factory = createCliAgentFactory(config, undefined, selectedKey);
                emitterRef.current = makeStdoutEmitter(getRl);
                managerRef.current = factory(`solo-${Date.now()}`, '', emitterRef.current);
                process.stdout.write(`\n${fmt.cyan('→')} ${fmt.bold(fmt.cyan(selectedKey))}  ${fmt.dim('Switched. New session.')}\n\n`);
              }
              resolve();
            });
          });
        } else {
          // 非 TTY 降级：静态列表
          const keys = Object.keys(config.agents);
          process.stdout.write('\n');
          for (const [i, k] of keys.entries()) {
            const agent = config.agents[k]!;
            const isActive = k === agentKeyRef.current;
            process.stdout.write(
              `  ${isActive ? fmt.green('●') : fmt.dim('○')}  ${fmt.dim(`${i + 1}.`)} ${fmt.cyan(k)}  ${fmt.dim(agent.provider)}${isActive ? fmt.green('  ← active') : ''}\n`,
            );
          }
          process.stdout.write(fmt.dim('\n  Type /model <name> or /model <number> to switch\n\n'));
        }
        return { handled: true };
      }
      const keys = Object.keys(config.agents);
      const byNum = parseInt(arg, 10);
      const resolvedKey =
        config.agents[arg]
          ? arg
          : !isNaN(byNum) && keys[byNum - 1]
            ? keys[byNum - 1]!
            : null;

      if (!resolvedKey) {
        const available = keys.join(', ');
        process.stdout.write(fmt.red(`✗ "${arg}" not found — available: ${available}\n\n`));
        return { handled: true };
      }

      // Kill old manager before switching to avoid orphaned processes
      await managerRef.current.stop();
      process.stdout.write('\r\x1b[2K'); // clear any dangling spinner line
      agentKeyRef.current = resolvedKey;
      const factory = createCliAgentFactory(config, undefined, resolvedKey);
      emitterRef.current = makeStdoutEmitter(getRl);
      managerRef.current = factory(`solo-${Date.now()}`, '', emitterRef.current);
      process.stdout.write(`\n${fmt.cyan('→')} ${fmt.bold(fmt.cyan(resolvedKey))}  ${fmt.dim('Switched. New session.')}\n\n`);
      return { handled: true };
    }

    case 'clear':
      process.stdout.write('\x1b[2J\x1b[H'); // erase screen + move cursor home
      printHeader(config, agentKeyRef.current);
      printTips();
      return { handled: true };

    case 'team': {
      const { runTeam } = await import('./team');
      const abortController = new AbortController();
      const teamEscListener = (_str: string, key: { name?: string }) => {
        if (key?.name === 'escape') abortController.abort();
      };
      process.stdin.on('keypress', teamEscListener);
      suppressEscRef.current = true; // prevent solo onEsc from also firing during team
      try {
        await runTeam({ goal: arg || undefined, activeAgent: agentKeyRef.current }, getRl() ?? undefined, abortController.signal);
      } catch (err) {
        if (err instanceof Error && !err.message.includes('interrupted')) {
          process.stderr.write(fmt.red(`\n✗ ${err.message}\n\n`));
        }
      } finally {
        suppressEscRef.current = false;
        process.stdin.off('keypress', teamEscListener);
      }
      return { handled: true };
    }

    case 'exit':
    case 'quit':
      process.stdout.write(fmt.dim('Goodbye.\n'));
      return { handled: true, exit: true };

    default: {
      // Unknown slash command: tell the user instead of silently passing to agent
      const knownCmds = '/model, /agents, /team, /clear, /help, /exit';
      process.stdout.write(
        fmt.yellow(`⚠ Unknown command /${cmd ?? ''} — available: ${knownCmds}\n\n`),
      );
      return { handled: true };
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

type SoloOptions = { agent?: string; workspace?: string; continueSession?: boolean };

export async function runSolo(options: SoloOptions = {}): Promise<void> {
  const config = loadConfig();

  if (Object.keys(config.agents).length === 0) {
    printOnboarding();
    process.exit(1);
  }

  // Resolve active agent — warn loudly if requested agent not found
  let activeKey: string;
  if (options.agent) {
    if (config.agents[options.agent]) {
      activeKey = options.agent;
    } else {
      process.stderr.write(
        fmt.yellow(`⚠ Agent "${options.agent}" not configured — using ${config.defaultAgent}\n`),
      );
      activeKey = config.defaultAgent;
    }
  } else {
    activeKey = config.defaultAgent;
  }

  printHeader(config, activeKey);
  if (isFirstLaunch()) printTips();
  if (options.continueSession) {
    process.stdout.write(`  ${fmt.cyan('↩')} ${fmt.dim('Resuming last session')}\n\n`);
  }

  const agentKeyRef = { current: activeKey };
  const rlRef: { current: Interface | null } = { current: null };
  const getRl = (): Interface | null => rlRef.current;

  // Track the current emitter so onEsc can mute it immediately (RC-3/RC-4 fix).
  const emitterRef: { current: StdoutEmitter } = {
    current: makeStdoutEmitter(getRl),
  };
  const managerRef: { current: IAgentManager } = {
    current: createCliAgentFactory(config, undefined, activeKey, options.continueSession)(`solo-${Date.now()}`, '', emitterRef.current),
  };

  // suppressEsc=true during team runs: prevents the solo onEsc from firing
  // alongside the team's own abortController — avoids double "已中断" (RC-2 fix).
  const suppressEscRef = { current: false };

  const agentKeys = Object.keys(config.agents);
  const picker = new InlineCommandPicker(agentKeys);

  // Single readline lifecycle — owns stdin from here to EOF
  // Pass agent keys so Tab expands /model <Tab> to agent names
  await startRepl(
    () => `${agentKeyRef.current} >`,
    async (input) => {
      if (input.startsWith('/')) {
        const result = await handleSlashCommand(input, config, agentKeyRef, managerRef, emitterRef, suppressEscRef, picker, getRl);
        if (result.exit) process.exit(0);
        if (result.handled) return;
      }
      // Unmute emitter at the start of each new message (reset from any prior interrupt)
      emitterRef.current.unmute();
      await managerRef.current.sendMessage({ content: input });
    },
    agentKeys,
    picker,
    () => {
      if (suppressEscRef.current) return; // team mode handles its own abort
      process.stdout.write('\n' + fmt.yellow('⊘ Interrupted.') + '\n');
      emitterRef.current.mute(); // suppress in-flight agent events immediately
      managerRef.current.stop().catch(() => {});
    },
    (rl) => { rlRef.current = rl; },
  );

  // Clean EOF path (Ctrl+D): stop agent, exit
  await Promise.race([
    managerRef.current.stop(),
    new Promise<void>((r) => setTimeout(r, 1500).unref()),
  ]);
  process.exit(0);
}
