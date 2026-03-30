/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadConfig, getConfigPath } from '../config/loader';
import { fmt } from '../ui/format';

export async function showConfig(): Promise<void> {
  const config = loadConfig();
  const path = getConfigPath();

  process.stdout.write(`${fmt.bold('Aion Config')} ${fmt.dim(`(${path})`)}\n\n`);
  process.stdout.write(`Default agent: ${fmt.cyan(config.defaultAgent)}\n\n`);

  if (Object.keys(config.agents).length === 0) {
    process.stdout.write(fmt.dim('No agents configured.\n\n'));
    process.stdout.write(`${fmt.bold('Quick setup — set an environment variable:')}\n`);
    process.stdout.write(
      `  ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}   # Claude (recommended)\n`,
    );
    process.stdout.write(
      `  ${fmt.cyan('export GEMINI_API_KEY=...')}             # Gemini\n`,
    );
    process.stdout.write(
      `\nOr write ${fmt.bold(path)} manually (JSON). See docs for schema.\n`,
    );
  } else {
    process.stdout.write(fmt.bold('Agents:\n'));
    for (const [name, agent] of Object.entries(config.agents)) {
      const isCliProvider = agent.provider === 'claude-cli' || agent.provider === 'codex-cli';
      const masked = isCliProvider
        ? fmt.dim('(CLI auth)')
        : agent.apiKey
          ? `...${agent.apiKey.slice(-4)}`
          : fmt.red('not set');
      const modelDisplay = isCliProvider
        ? fmt.dim('(uses CLI itself)')
        : (agent.model ?? fmt.red('undefined'));
      const isDefault = name === config.defaultAgent ? fmt.green(' ← default') : '';
      process.stdout.write(
        `  ${fmt.cyan(name)}${isDefault}\n` +
          `    model:    ${modelDisplay}\n` +
          `    provider: ${agent.provider}\n` +
          `    key:      ${masked}\n\n`,
      );
    }
  }

}
