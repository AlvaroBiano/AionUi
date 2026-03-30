/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * progressParser — filter agent stdout/stderr to surface meaningful activity lines.
 * Returns null for noise, ParsedProgressLine for displayable content.
 */

export type ParsedProgressLine = {
  text: string;
  kind: 'tool' | 'file' | 'thinking' | 'generic';
};

/** Strip ANSI escape codes from a string. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

const NOISE_PATTERNS: RegExp[] = [
  /^\s*\w+\s+(ERROR|WARN|DEBUG|INFO|TRACE|WARNING)[\s:]/i,
  /^(OpenAI Codex|workdir:|model:|provider:|approval:|sandbox:|reasoning\s|session id:|mcp[\s:/]|exec\s|succeeded in|tokens used|auto-compact)/i,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // timestamps
  /^[─━═-]{4,}$/, // horizontal rules
  /^>\s*$/, // lone arrows
  /^\s*$/, // blank lines
];

const TOOL_PATTERN =
  /^(bash|read|write|edit|glob|grep|webfetch|websearch|task|agent|notebook)\s*[:(]/i;
const FILE_PATTERN =
  /(?:reading|writing|editing|creating|saved?)\s+([\w./\\-]+\.\w{1,10})/i;
const THINKING_PATTERN = /\b(thinking|analyzing|planning|reviewing|processing|generating)\b/i;

export function parseProgressLine(raw: string): ParsedProgressLine | null {
  const stripped = stripAnsi(raw).trim();
  if (!stripped) return null;

  // Suppress noise
  for (const pat of NOISE_PATTERNS) {
    if (pat.test(stripped)) return null;
  }

  // Must have at least some printable non-symbol content
  if (!/[a-zA-Z0-9\u4e00-\u9fff]/.test(stripped)) return null;

  // Classify
  if (TOOL_PATTERN.test(stripped)) {
    return { text: stripped.slice(0, 120), kind: 'tool' };
  }
  if (FILE_PATTERN.test(stripped)) {
    return { text: stripped.slice(0, 120), kind: 'file' };
  }
  if (THINKING_PATTERN.test(stripped)) {
    return { text: stripped.slice(0, 120), kind: 'thinking' };
  }
  return { text: stripped.slice(0, 120), kind: 'generic' };
}

export function parseProgressChunk(chunk: string): ParsedProgressLine[] {
  return chunk
    .split('\n')
    .map((line) => parseProgressLine(line))
    .filter((l): l is ParsedProgressLine => l !== null);
}
