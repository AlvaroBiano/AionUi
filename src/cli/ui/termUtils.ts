/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Calculate terminal display width — CJK and full-width chars occupy 2 columns. */
export function displayWidth(s: string, stripAnsi = false): number {
  let plain = s;
  if (stripAnsi) {
    // Strip ANSI escape codes before measuring
    // eslint-disable-next-line no-control-regex
    plain = s.replace(/\u001b\[[0-9;]*m/g, '');
  }
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0x303e) ||   // CJK Radicals, Kangxi, etc.
      (cp >= 0x3041 && cp <= 0x33ff) ||   // Hiragana, Katakana, Bopomofo, etc.
      (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK Extension A
      (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified Ideographs (main block)
      (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK Compatibility Ideographs
      (cp >= 0xfe10 && cp <= 0xfe19) ||   // Vertical Forms
      (cp >= 0xfe30 && cp <= 0xfe6f) ||   // CJK Compatibility Forms
      (cp >= 0xff01 && cp <= 0xff60) ||   // Fullwidth ASCII
      (cp >= 0xffe0 && cp <= 0xffe6) ||   // Fullwidth Signs
      (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Extension B
      (cp >= 0x2a700 && cp <= 0x2ceaf) || // CJK Extension C, D, E
      (cp >= 0x2ceb0 && cp <= 0x2ebef)    // CJK Extension F
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Truncate string to at most maxCols terminal columns. */
export function truncateToWidth(s: string, maxCols: number): string {
  let w = 0;
  let result = '';
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > maxCols) break;
    result += ch;
    w += cw;
  }
  return result;
}
