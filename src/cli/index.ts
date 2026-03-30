/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * aion — Aion CLI entry point
 *
 * Command tree:
 *   aion                              Interactive single-agent mode (default)
 *   aion run <task>                   One-shot task
 *   aion config                       Show config and setup guide
 *   aion doctor                       Check agent availability and connectivity
 *
 * Env vars (auto-detected, no config file needed):
 *   ANTHROPIC_API_KEY   → enables Claude agents
 *   GEMINI_API_KEY      → enables Gemini agents
 */
import { parseArgs } from 'node:util';
import { fmt } from './ui/format';

const VERSION = '1.9.2';

const HELP = `
${fmt.bold('aion')} — Multi-Model Agent Platform  ${fmt.dim(`v${VERSION}`)}

${fmt.bold('Usage:')}
  aion                                   Interactive chat (all slash commands available)
  aion run <task>                        One-shot task  ${fmt.dim('(single agent, no REPL)')}
  aion doctor                            Check installed agents & connectivity
  aion config                            Show config and file location

${fmt.bold('Solo mode options:')}
  ${fmt.cyan('-a, --agent <name>')}        Agent to use  ${fmt.dim('(default: from config)')}
  ${fmt.cyan('-c, --continue')}            Resume the most recent session
  ${fmt.cyan('-w, --workspace <dir>')}     Working directory

${fmt.bold('Other:')}
  ${fmt.cyan('-v, --version')}             Print version
  ${fmt.cyan('-h, --help')}               Show this help

${fmt.bold('Slash commands (in solo mode):')}
  ${fmt.cyan('/model <name>')}             Switch active agent mid-session
  ${fmt.cyan('/agents')}                  List configured agents
  ${fmt.cyan('/help')}                    Show all slash commands

${fmt.bold('Setup:')}
  ${fmt.cyan('brew install anthropics/tap/claude-code')}  ${fmt.dim('# Claude Code CLI')}
  ${fmt.cyan('npm install -g @openai/codex')}             ${fmt.dim('# Codex CLI')}
  ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}      ${fmt.dim('# Direct Anthropic API')}
  ${fmt.cyan('export GEMINI_API_KEY=...')}                ${fmt.dim('# Direct Gemini API')}
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      agent: { type: 'string', short: 'a' },
      continue: { type: 'boolean', short: 'c' },
      workspace: { type: 'string', short: 'w' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.version) {
    process.stdout.write(`aion v${VERSION}\n`);
    process.exit(0);
  }

  if (values.help) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  const command = positionals[0];

  switch (command) {
    case 'run': {
      const task = positionals.slice(1).join(' ').trim() || values.goal?.trim();
      if (!task) {
        process.stderr.write(fmt.red('Usage: aion run <task>\n'));
        process.exit(1);
      }
      const { runOnce } = await import('./commands/run');
      await runOnce({ task, agent: values.agent });
      break;
    }

    case 'config': {
      const { showConfig } = await import('./commands/config');
      await showConfig();
      break;
    }

    case 'doctor': {
      const { runDoctor } = await import('./commands/doctor');
      await runDoctor();
      break;
    }

    case 'agents': {
      const { loadConfig } = await import('./config/loader');
      const config = loadConfig();
      const keys = Object.keys(config.agents);
      if (keys.length === 0) {
        process.stdout.write(fmt.dim('No agents configured. Run aion doctor for setup help.\n'));
      } else {
        process.stdout.write('\n');
        for (const [i, key] of keys.entries()) {
          const agent = config.agents[key]!;
          const isDefault = key === config.defaultAgent;
          const provider =
            agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
              ? agent.provider
              : `${agent.provider}/${agent.model ?? '?'}`;
          process.stdout.write(
            `  ${isDefault ? fmt.green('●') : fmt.dim('○')} ${fmt.dim(`${i + 1}.`)} ${fmt.cyan(key)}  ${fmt.dim(provider)}${isDefault ? fmt.dim('  ← default') : ''}\n`,
          );
        }
        process.stdout.write(fmt.dim('\n  Use /model <name> or /model <number> to switch (in chat mode)\n\n'));
      }
      break;
    }

    case 'version': {
      process.stdout.write(VERSION + '\n');
      break;
    }

    case undefined: {
      const { runSolo } = await import('./commands/solo');
      await runSolo({
        agent: values.agent,
        workspace: values.workspace,
        continueSession: values.continue,
      });
      break;
    }

    default: {
      process.stderr.write(
        fmt.red(`Unknown command: "${command}"\n`) +
          fmt.dim(`Run ${fmt.cyan('aion --help')} to see available commands.\n`),
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  process.stderr.write(fmt.red(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
