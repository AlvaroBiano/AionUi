/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { fmt } from './format';
import { createDedupStdin } from './stdinDedup';
import type { InlineCommandPicker } from './InlineCommandPicker';
import { loadHistory, appendHistory } from './history';

export type ReplHandler = (input: string) => Promise<void>;

/** Slash command names — used for tab completion */
const SLASH_COMMANDS = ['/model', '/agents', '/team', '/clear', '/help', '/exit'];

/**
 * Start an interactive readline REPL loop.
 * Resolves when the user sends EOF (Ctrl+D) or SIGINT (Ctrl+C).
 *
 * @param prompt      - static string OR function called each tick (for dynamic active-agent prompt)
 * @param handler     - called for every non-empty line
 * @param agentKeys   - optional list of configured agent names for /model <tab> completion
 * @param picker      - optional inline command picker
 * @param onEsc       - optional callback invoked when ESC is pressed during handler execution
 * @param onRlCreated - optional callback invoked with the readline Interface after creation
 */
export function startRepl(
  prompt: string | (() => string),
  handler: ReplHandler,
  agentKeys?: string[],
  picker?: InlineCommandPicker,
  onEsc?: () => void,
  onRlCreated?: (rl: Interface) => void,
): Promise<void> {
  // Resume stdin in case a prior readline left it paused (critical for Warp)
  process.stdin.resume();

  const stdinSource = createDedupStdin();

  // Build the completer — extend /model completions if agent names are provided
  const allSlashCommands = agentKeys?.length
    ? [...SLASH_COMMANDS, ...agentKeys.map((k) => `/model ${k}`)]
    : SLASH_COMMANDS;

  function dynamicCompleter(line: string): [string[], string] {
    if (line.startsWith('/')) {
      const hits = allSlashCommands.filter((c) => c.startsWith(line));
      return [hits.length ? hits : allSlashCommands, line];
    }
    return [[], line];
  }

  const rl = createInterface({
    input: stdinSource,
    output: process.stdout,
    terminal: process.stdout.isTTY ?? false,
    historySize: 200,
    completer: dynamicCompleter,
  });

  // Inject persisted history so up-arrow works across sessions
  const savedHistory = loadHistory();
  (rl as unknown as { history: string[] }).history = savedHistory;

  const getPrompt = typeof prompt === 'function' ? prompt : () => prompt;

  const ESC = '\x1b';
  const RESET = `${ESC}[0m`;
  const BOLD = `${ESC}[1m`;
  const DIM = `${ESC}[2m`;
  const CYAN = `${ESC}[36m`;

  const buildPromptStr = (): string =>
    `${DIM}❯${RESET} ${BOLD}${CYAN}${getPrompt()}${RESET} `;

  // ── Ctrl+C double-tap mechanism (修复 2) ──────────────────────────────────
  // activeOnEsc tracks whether a handler is running and how to interrupt it.
  let activeOnEsc: (() => void) | null = null;
  let sigintCount = 0;
  let sigintTimer: ReturnType<typeof setTimeout> | null = null;

  rl.on('SIGINT', () => {
    sigintCount++;
    if (sigintTimer) clearTimeout(sigintTimer);

    if (sigintCount === 1) {
      if (activeOnEsc) {
        // handler is running — interrupt it
        activeOnEsc();
      } else {
        // idle state — prompt for second tap
        process.stdout.write('\n' + fmt.dim('(Press Ctrl+C again to exit)') + '\n');
        rl.prompt(true);
      }
      sigintTimer = setTimeout(() => {
        sigintCount = 0;
      }, 2000);
      (sigintTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    } else {
      // second Ctrl+C — exit immediately
      process.stdout.write('\n' + fmt.dim('Goodbye.\n'));
      process.exit(0);
    }
  });

  // ── Handler-running flag (修复 3) ─────────────────────────────────────────
  let isHandlerRunning = false;

  // Idle key handler: ESC clears line, Ctrl+L clears screen
  const idleEscListener = (_str: string, key: { name?: string; ctrl?: boolean }): void => {
    // Ctrl+L: clear screen (works in all states)
    if (key?.ctrl && key.name === 'l') {
      process.stdout.write('\x1b[2J\x1b[H');
      rl.prompt(true);
      return;
    }
    if (key?.name !== 'escape') return;
    if (isHandlerRunning) return; // handler running — escListener handles it
    if ((picker as unknown as { isActive?: () => boolean })?.isActive?.()) return; // picker is active — don't interfere
    // clear current input line
    rl.write(null as unknown as string, { ctrl: true, name: 'u' });
  };
  process.stdin.on('keypress', idleEscListener);
  rl.once('close', () => process.stdin.off('keypress', idleEscListener));

  const ask = (): void => {
    if ((rl as unknown as { closed?: boolean }).closed) return;

    const readLine = (promptStr: string, accumulated: string[]): void => {
      rl.question(promptStr, async (line) => {
        // Continuation line: ends with \ but not \\
        if (line.endsWith('\\') && !line.endsWith('\\\\')) {
          accumulated.push(line.slice(0, -1));
          readLine(fmt.dim('  … '), accumulated);
          return;
        }
        accumulated.push(line);
        const fullInput = accumulated.join('\n').trim();
        accumulated.length = 0;

        if (!fullInput) {
          ask();
          return;
        }

        // Persist to history file — skip ephemeral slash commands
        const SKIP_HISTORY = new Set(['/help', '/clear', '/exit', '/quit', '/agents', '/model']);
        if (!SKIP_HISTORY.has(fullInput.toLowerCase().split(/\s/)[0]!)) {
          appendHistory(fullInput);
        }

        let escapedInput: string | null = null;
        // Register ESC listener during handler execution — one-shot guard prevents
        // multiple "已中断" messages when the user taps ESC more than once.
        const escListener = (_str: string, key: { name?: string }): void => {
          if (key?.name === 'escape' && escapedInput === null) {
            escapedInput = fullInput;
            onEsc?.();
          }
        };
        if (onEsc) process.stdin.on('keypress', escListener);

        // Track active ESC callback for SIGINT handler (修复 2)
        activeOnEsc = onEsc ? () => onEsc() : null;
        isHandlerRunning = true;
        // Pause readline so user keystrokes are not echoed or buffered during handler
        rl.pause();

        try {
          await handler(fullInput);
        } catch (err) {
          process.stderr.write(
            fmt.red(`Error: ${err instanceof Error ? err.message : String(err)}\n`),
          );
        } finally {
          isHandlerRunning = false;
          activeOnEsc = null;
          if (onEsc) process.stdin.off('keypress', escListener);
          if (!(rl as unknown as { closed?: boolean }).closed) rl.resume();
        }

        ask();
        // Restore the original input after the new prompt is shown, so the user
        // can resume editing what they typed before pressing ESC (like Claude Code).
        // Skip restoration for slash commands — restoring /team re-triggers the run.
        const NO_RESTORE_PREFIXES = ['/team', '/model'];
        if (escapedInput !== null) {
          const toRestore = escapedInput;
          const isLongRunning = NO_RESTORE_PREFIXES.some((p) =>
            toRestore.toLowerCase().startsWith(p),
          );
          if (!isLongRunning) {
            setImmediate(() => {
              if (!(rl as unknown as { closed?: boolean }).closed) {
                rl.write(toRestore);
              }
            });
          }
        }
      });
    };

    readLine(buildPromptStr(), []);
  };

  if (picker) {
    picker.attach(rl);
  }

  if (onRlCreated) onRlCreated(rl);

  return new Promise<void>((resolve) => {
    rl.once('close', () => {
      if (picker) picker.detach();
      process.stdout.write('\n');
      resolve();
    });

    // Suppress ERR_USE_AFTER_CLOSE from readline internal writes after close
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ERR_USE_AFTER_CLOSE' && err.code !== 'EPIPE') throw err;
    });

    ask();
  });
}
