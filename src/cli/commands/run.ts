/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-shot task execution — single agent, no REPL, no orchestrator.
 * Behaves like `claude --print`: send task, stream output, exit.
 */
import { loadConfig } from '../config/loader';
import { createCliAgentFactory } from '../agents/factory';
import { fmt } from '../ui/format';
import type { AgentMessageEvent } from '@process/task/IAgentEventEmitter';

type RunOptions = { task: string; agent?: string };

export async function runOnce(options: RunOptions): Promise<void> {
  const config = loadConfig();

  if (Object.keys(config.agents).length === 0) {
    process.stderr.write(fmt.red('No agents configured. Run `aion doctor` for setup help.\n'));
    process.exit(1);
  }

  const activeKey =
    options.agent && config.agents[options.agent] ? options.agent : config.defaultAgent;

  let textStarted = false;

  const emitter = {
    emitConfirmationAdd: () => {},
    emitConfirmationUpdate: () => {},
    emitConfirmationRemove: () => {},
    emitMessage(_cid: string, event: AgentMessageEvent) {
      if (event.type === 'text') {
        const content = (event.data as { content?: string })?.content ?? '';
        if (content) {
          process.stdout.write(content);
          textStarted = true;
        }
      } else if (event.type === 'status') {
        const status = (event.data as { status?: string })?.status;
        if (status === 'done' && textStarted) {
          process.stdout.write('\n');
        }
      }
    },
  };

  const manager = createCliAgentFactory(config, undefined, activeKey)(
    `run-${Date.now()}`,
    '',
    emitter,
  );

  await manager.sendMessage({ content: options.task });

  await Promise.race([
    manager.stop(),
    new Promise<void>((r) => setTimeout(r, 2000).unref()),
  ]);
}
