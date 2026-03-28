/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createInterface } from 'node:readline';
import { fmt } from './format';

export type ReplHandler = (input: string) => Promise<void>;

/**
 * Start an interactive readline REPL loop.
 * Resolves when the user sends EOF (Ctrl+D) or SIGINT (Ctrl+C).
 *
 * @param prompt - static string OR a function called each tick (for dynamic prompts)
 */
export function startRepl(prompt: string | (() => string), handler: ReplHandler): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const getPrompt = typeof prompt === 'function' ? prompt : () => prompt;

  const ask = (): void => {
    rl.question(fmt.bold(fmt.cyan(`${getPrompt()} `)), async (line) => {
      const input = line.trim();
      if (input) {
        try {
          await handler(input);
        } catch (err) {
          process.stderr.write(
            fmt.red(`Error: ${err instanceof Error ? err.message : String(err)}\n`),
          );
        }
      }
      ask();
    });
  };

  return new Promise<void>((resolve) => {
    rl.once('close', () => {
      process.stdout.write('\n');
      resolve();
    });
    ask();
  });
}
