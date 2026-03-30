/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight Markdown → terminal ANSI renderer.
 * No external dependencies — pure string manipulation.
 *
 * Handles:
 *   - # H1 / ## H2 / ### H3  → bold + color
 *   - **text** / __text__     → bold
 *   - `code`                  → cyan
 *   - ```block```             → dim box
 *   - | table |               → Unicode box table
 *   - - item / * item         → • bullet
 *   - > quote                 → │ dim quote
 */

import { displayWidth as _displayWidth } from './termUtils';

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
const YELLOW = `${ESC}[33m`;
const BLUE = `${ESC}[34m`;
const MAGENTA = `${ESC}[35m`;

/** Calculate visible terminal columns for a string (CJK + emoji = 2 cols). Strips ANSI codes. */
export function displayWidth(s: string): number {
  return _displayWidth(s, true);
}

/** Pad a string to a given display width using spaces. */
function padToWidth(s: string, width: number): string {
  const w = displayWidth(s);
  return s + ' '.repeat(Math.max(0, width - w));
}

// ── Inline renderers ──────────────────────────────────────────────────────────

/** Render inline markdown (bold, code) within a single line of text. */
function renderInline(text: string): string {
  // Code spans first (protect content from further processing)
  const parts: string[] = [];
  let rest = text;

  // Split on backtick code spans
  const codeRe = /`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = codeRe.exec(rest)) !== null) {
    parts.push(renderBoldItalic(rest.slice(last, match.index)));
    parts.push(`${CYAN}${match[1]}${RESET}`);
    last = match.index + match[0].length;
  }
  parts.push(renderBoldItalic(rest.slice(last)));
  return parts.join('');
}

function renderBoldItalic(text: string): string {
  // **bold** or __bold__
  return text
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
    .replace(/__(.+?)__/g, `${BOLD}$1${RESET}`);
}

// ── Table renderer ────────────────────────────────────────────────────────────

/** Parse a markdown table into rows of cells. Returns null if not a table. */
function parseTable(lines: string[]): string[][] | null {
  if (lines.length < 2) return null;
  // Check at least first line is pipe-delimited
  if (!lines[0]!.includes('|')) return null;
  // Check second line is a separator (---|---| etc.)
  if (!/^\s*\|?[\s\-:|]+\|[\s\-:|]*$/.test(lines[1]!)) return null;

  const rows: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === 1) continue; // skip separator row
    const line = lines[i]!.trim();
    if (!line.startsWith('|') && !line.includes('|')) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows.length > 0 ? rows : null;
}

/** Strip inline markdown markers for accurate display-width measurement. */
function stripInlineMarkers(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function renderTable(rows: string[][]): string {
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths: number[] = Array(colCount).fill(0) as number[];

  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? '';
      // Measure width from stripped text so **bold** markers don't inflate column width
      colWidths[c] = Math.max(colWidths[c]!, displayWidth(stripInlineMarkers(cell)) + 2); // +2 for padding
    }
  }

  const top =
    '  ┌' + colWidths.map((w) => '─'.repeat(w)).join('┬') + '┐';
  const mid =
    '  ├' + colWidths.map((w) => '─'.repeat(w)).join('┼') + '┤';
  const bot =
    '  └' + colWidths.map((w) => '─'.repeat(w)).join('┴') + '┘';

  const renderRow = (cells: string[]): string => {
    const cols = cells.map((cell, i) => {
      const w = colWidths[i] ?? 0;
      // Apply inline rendering (bold, code) and pad based on stripped width
      const rendered = renderInline(cell);
      const inner = ' ' + rendered + ' ';
      return padToWidth(inner, w);
    });
    return '  │' + cols.join('│') + '│';
  };

  const out: string[] = [];
  out.push(top);
  for (let i = 0; i < rows.length; i++) {
    out.push(renderRow(rows[i]!));
    if (i === 0 && rows.length > 1) {
      // After header row
      out.push(mid);
    }
  }
  out.push(bot);
  return out.join('\n');
}

// ── Code block renderer ───────────────────────────────────────────────────────

function renderCodeBlock(lines: string[], lang: string): string {
  const label = lang ? ` ${lang} ` : '';
  const width = Math.min(process.stdout?.columns ?? 80, 80) - 4;
  const inner = lines.map((l) => `  ${DIM}│${RESET} ${l}`).join('\n');
  const topBar = `  ${DIM}╭─${label}${'─'.repeat(Math.max(0, width - label.length - 2))}╮${RESET}`;
  const botBar = `  ${DIM}╰${'─'.repeat(width)}╯${RESET}`;
  return topBar + '\n' + inner + '\n' + botBar;
}

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * Render markdown text to terminal ANSI string.
 * Handles headings, bold, code spans, code blocks, tables, lists, and blockquotes.
 */
export function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // ── Fenced code block ──────────────────────────────────────────────────
    const fenceMatch = /^```(\w*)/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      out.push(renderCodeBlock(codeLines, lang));
      i++; // skip closing ```
      continue;
    }

    // ── Table detection: collect consecutive pipe lines ───────────────────
    if (line.includes('|')) {
      const tableLines: string[] = [];
      let j = i;
      while (j < lines.length && lines[j]!.includes('|')) {
        tableLines.push(lines[j]!);
        j++;
      }
      if (tableLines.length >= 2) {
        const rows = parseTable(tableLines);
        if (rows) {
          out.push(renderTable(rows));
          i = j;
          continue;
        }
      }
    }

    // ── Headings ──────────────────────────────────────────────────────────
    const h3 = /^### (.+)$/.exec(line);
    if (h3) {
      out.push(`${MAGENTA}${BOLD}  ${h3[1]}${RESET}`);
      i++;
      continue;
    }
    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      out.push(`\n${BLUE}${BOLD}  ${h2[1]}${RESET}`);
      i++;
      continue;
    }
    const h1 = /^# (.+)$/.exec(line);
    if (h1) {
      out.push(`\n${YELLOW}${BOLD}  ${h1[1]}${RESET}`);
      i++;
      continue;
    }

    // ── Blockquote ────────────────────────────────────────────────────────
    const quote = /^> (.*)$/.exec(line);
    if (quote) {
      out.push(`  ${DIM}│ ${renderInline(quote[1]!)}${RESET}`);
      i++;
      continue;
    }

    // ── Unordered list ────────────────────────────────────────────────────
    const listItem = /^(\s*)[*-] (.+)$/.exec(line);
    if (listItem) {
      const indent = listItem[1]!.length;
      const bullet = indent > 0 ? '  ◦' : '  •';
      out.push(`${bullet} ${renderInline(listItem[2]!)}`);
      i++;
      continue;
    }

    // ── Ordered list ──────────────────────────────────────────────────────
    const orderedItem = /^(\s*)(\d+)\. (.+)$/.exec(line);
    if (orderedItem) {
      out.push(`  ${DIM}${orderedItem[2]}.${RESET} ${renderInline(orderedItem[3]!)}`);
      i++;
      continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────────
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      out.push(`  ${DIM}${'─'.repeat(40)}${RESET}`);
      i++;
      continue;
    }

    // ── Plain paragraph (with inline rendering) ───────────────────────────
    if (line.trim() === '') {
      out.push('');
    } else {
      out.push(renderInline(line));
    }
    i++;
  }

  return out.join('\n');
}

/**
 * Strip all markdown symbols from text, leaving plain readable text.
 * Used for preview snippets in TeamPanel where ANSI codes would be noise.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // fenced code blocks → just their content
      .replace(/```[\w]*\n([\s\S]*?)```/g, '$1')
      // headings
      .replace(/^#{1,6}\s+/gm, '')
      // bold / italic
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      // inline code
      .replace(/`([^`]+)`/g, '$1')
      // table pipes and separators
      .replace(/^\|[-:\s|]+\|$/gm, '')
      .replace(/\|/g, ' ')
      // blockquote marker
      .replace(/^>\s*/gm, '')
      // list markers
      .replace(/^(\s*)[*-]\s+/gm, '$1')
      .replace(/^(\s*)\d+\.\s+/gm, '$1')
      // horizontal rules
      .replace(/^[-*]{3,}$/gm, '')
      // collapse multiple spaces
      .replace(/  +/g, ' ')
      .trim()
  );
}
