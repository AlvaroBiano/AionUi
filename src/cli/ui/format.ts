/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Terminal escape code formatting — no external dependencies */

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const BLUE = `${ESC}[34m`;
const CYAN = `${ESC}[36m`;
const RED = `${ESC}[31m`;
const MAGENTA = `${ESC}[35m`;

export const fmt = {
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  magenta: (s: string) => `${MAGENTA}${s}${RESET}`,
};

export const STATUS_ICONS = {
  pending: '·',
  running: '◐', // non-TTY fallback; live rendering uses braille spinner
  done: '✓',
  failed: '✗',
  cancelled: '·',
} as const;

/** Erase N lines upward in the terminal */
export function clearLines(n: number): void {
  for (let i = 0; i < n; i++) {
    process.stdout.write(`${ESC}[1A${ESC}[2K`);
  }
}

/**
 * Count the physical terminal rows occupied by a string, accounting for line
 * wrapping. CJK/fullwidth characters each count as 2 columns. ANSI escape
 * codes are stripped before measuring.
 */
export function physicalRows(text: string, cols = process.stdout.columns ?? 80): number {
  // Strip all ANSI escape sequences (CSI + OSC variants)
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/\u001b(?:\[[0-9;]*[A-Za-z]|\][^\u0007]*\u0007)/g, '');
  let rows = 0;
  for (const logicalLine of stripped.split('\n')) {
    // Measure column width accounting for CJK double-width characters
    let lineWidth = 0;
    for (const ch of logicalLine) {
      const cp = ch.codePointAt(0) ?? 0;
      lineWidth +=
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0x303e) ||
        (cp >= 0x3041 && cp <= 0x33ff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe6f) ||
        (cp >= 0xff01 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6)
          ? 2
          : 1;
    }
    rows += Math.max(1, Math.ceil(lineWidth / cols));
  }
  return rows;
}

/** Horizontal rule sized to terminal width. Pass a custom char for alternate styles (e.g. '╴'). */
export function hr(char = '─', maxWidth = 120): string {
  return char.repeat(Math.min(process.stdout.columns ?? 80, maxWidth));
}

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private label: string;
  private active = false;

  constructor(label = 'Thinking') {
    this.label = label;
  }

  start(): void {
    if (!process.stdout.isTTY || this.active) return;
    this.active = true;
    this.frame = 0;
    this.timer = setInterval(() => {
      const f = SPIN_FRAMES[this.frame % SPIN_FRAMES.length]!;
      process.stdout.write(`\r${fmt.cyan(f)} ${fmt.dim(this.label)}   `);
      this.frame++;
    }, 80);
    this.timer.unref(); // don't prevent process exit when all other work is done
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K'); // clear current line
  }
}
