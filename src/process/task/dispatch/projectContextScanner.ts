/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/projectContextScanner.ts

import fs from 'node:fs';
import path from 'node:path';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Scanned project context for prompt injection.
 */
export type ProjectContext = {
  /** Condensed text for prompt injection (max ~4000 chars) */
  summary: string;
  /** Raw file paths that were scanned */
  scannedFiles: string[];
  /** Timestamp of last scan */
  scannedAt: number;
};

/** Default character budget for project context summary */
const DEFAULT_MAX_CHARS = 4000;

/** Scan timeout in milliseconds */
const SCAN_TIMEOUT_MS = 5000;

/**
 * Safely read a file within the workspace, respecting budget and abort signal.
 * Returns the file content (truncated to maxChars) or null if not found/error.
 */
async function safeReadFile(
  filePath: string,
  workspace: string,
  maxChars: number,
  signal?: AbortSignal
): Promise<string | null> {
  // Security: ensure the file is within the workspace directory tree
  const resolved = path.resolve(filePath);
  const workspaceResolved = path.resolve(workspace);
  if (!resolved.startsWith(workspaceResolved + path.sep) && resolved !== workspaceResolved) {
    return null;
  }

  try {
    if (signal?.aborted) return null;
    const content = await fs.promises.readFile(resolved, { encoding: 'utf-8', signal });
    return content.slice(0, maxChars);
  } catch {
    return null;
  }
}

/**
 * Read first N lines from a file.
 */
async function readFirstLines(
  filePath: string,
  workspace: string,
  lineCount: number,
  maxChars: number,
  signal?: AbortSignal
): Promise<string | null> {
  const content = await safeReadFile(filePath, workspace, maxChars * 2, signal);
  if (!content) return null;
  const lines = content.split('\n').slice(0, lineCount);
  return lines.join('\n').slice(0, maxChars);
}

/**
 * Extract "scripts" section from package.json content.
 */
function extractPackageJsonScripts(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const pkg = parsed as Record<string, unknown>;

    const parts: string[] = [];

    if (typeof pkg.name === 'string') {
      parts.push(`Project: ${pkg.name}`);
    }
    if (typeof pkg.description === 'string') {
      parts.push(`Description: ${pkg.description}`);
    }

    const scripts = pkg.scripts;
    if (typeof scripts === 'object' && scripts !== null) {
      const scriptEntries = Object.entries(scripts as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      if (scriptEntries) {
        parts.push(`Scripts:\n${scriptEntries}`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : null;
  } catch {
    return null;
  }
}

/**
 * Extract tech stack signals from tsconfig.json.
 */
function extractTsconfigSignals(content: string): string | null {
  try {
    // Strip single-line comments for lenient parsing
    const stripped = content.replace(/\/\/.*$/gm, '');
    const parsed: unknown = JSON.parse(stripped);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const tsconfig = parsed as Record<string, unknown>;

    const parts: string[] = [];
    const compilerOptions = tsconfig.compilerOptions;
    if (typeof compilerOptions === 'object' && compilerOptions !== null) {
      const opts = compilerOptions as Record<string, unknown>;
      if (typeof opts.target === 'string') parts.push(`Target: ${opts.target}`);
      if (typeof opts.module === 'string') parts.push(`Module: ${opts.module}`);
      if (typeof opts.jsx === 'string') parts.push(`JSX: ${opts.jsx}`);
      if (opts.strict === true) parts.push('Strict mode enabled');
    }

    return parts.length > 0 ? `TypeScript config:\n  ${parts.join(', ')}` : null;
  } catch {
    return null;
  }
}

/**
 * Extract tech stack signals from pyproject.toml (basic parsing).
 */
function extractPyprojectSignals(content: string): string | null {
  const parts: string[] = [];

  // Extract project name
  const nameMatch = /^\s*name\s*=\s*"([^"]+)"/m.exec(content);
  if (nameMatch) parts.push(`Python project: ${nameMatch[1]}`);

  // Extract python version requirement
  const pyVersionMatch = /requires-python\s*=\s*"([^"]+)"/m.exec(content);
  if (pyVersionMatch) parts.push(`Python: ${pyVersionMatch[1]}`);

  // Extract build system
  const buildMatch = /build-backend\s*=\s*"([^"]+)"/m.exec(content);
  if (buildMatch) parts.push(`Build: ${buildMatch[1]}`);

  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Scan workspace for project context files and produce a condensed summary
 * suitable for system prompt injection.
 *
 * Scan priority (stops reading after hitting char budget):
 *   1. CLAUDE.md / AGENTS.md        -> project instructions
 *   2. .gemini/                      -> Gemini native config
 *   3. package.json (scripts only)   -> available commands
 *   4. README.md (first 200 lines)  -> project overview
 *   5. tsconfig.json / pyproject.toml -> tech stack signals
 */
export async function scanProjectContext(
  workspace: string,
  options?: { maxChars?: number; signal?: AbortSignal }
): Promise<ProjectContext> {
  // Guard: empty or missing workspace — return empty context
  if (!workspace || !path.isAbsolute(workspace)) {
    return { summary: '', scannedFiles: [], scannedAt: Date.now() };
  }

  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const scannedFiles: string[] = [];
  const sections: string[] = [];
  let remainingBudget = maxChars;

  // Create an AbortController with timeout for the overall scan
  const controller = new AbortController();
  const externalSignal = options?.signal;

  // Link external signal if provided
  if (externalSignal) {
    if (externalSignal.aborted) {
      return { summary: '', scannedFiles: [], scannedAt: Date.now() };
    }
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  // Set timeout
  const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  const signal = controller.signal;

  const addSection = (label: string, content: string, filePath: string): void => {
    if (remainingBudget <= 0 || signal.aborted) return;

    const truncated = content.slice(0, remainingBudget);
    sections.push(`### ${label}\n${truncated}`);
    scannedFiles.push(filePath);
    remainingBudget -= truncated.length + label.length + 5; // account for ### and newline
  };

  try {
    // Priority 1: CLAUDE.md / AGENTS.md (up to 2000 chars combined)
    const instructionBudget = Math.min(2000, remainingBudget);

    for (const fileName of ['CLAUDE.md', 'AGENTS.md']) {
      if (signal.aborted || remainingBudget <= 0) break;
      const filePath = path.join(workspace, fileName);
      const content = await safeReadFile(filePath, workspace, instructionBudget, signal);
      if (content) {
        addSection(`${fileName} (Project Instructions)`, content, filePath);
      }
    }

    // Priority 2: .gemini/ directory
    if (!signal.aborted && remainingBudget > 0) {
      const geminiDir = path.join(workspace, '.gemini');
      try {
        const entries = await fs.promises.readdir(geminiDir, { withFileTypes: true });
        for (const entry of entries) {
          if (signal.aborted || remainingBudget <= 0) break;
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const filePath = path.join(geminiDir, entry.name);
            const content = await safeReadFile(filePath, workspace, Math.min(500, remainingBudget), signal);
            if (content) {
              addSection(`.gemini/${entry.name}`, content, filePath);
            }
          }
        }
      } catch {
        // .gemini directory not found, skip
      }
    }

    // Priority 3: package.json (scripts only)
    if (!signal.aborted && remainingBudget > 0) {
      const pkgPath = path.join(workspace, 'package.json');
      const pkgContent = await safeReadFile(pkgPath, workspace, 10000, signal);
      if (pkgContent) {
        const scripts = extractPackageJsonScripts(pkgContent);
        if (scripts) {
          addSection('package.json', scripts, pkgPath);
        }
      }
    }

    // Priority 4: README.md (first 200 lines)
    if (!signal.aborted && remainingBudget > 0) {
      const readmePath = path.join(workspace, 'README.md');
      const readmeContent = await readFirstLines(readmePath, workspace, 200, Math.min(1000, remainingBudget), signal);
      if (readmeContent) {
        addSection('README.md (excerpt)', readmeContent, readmePath);
      }
    }

    // Priority 5: tsconfig.json / pyproject.toml
    if (!signal.aborted && remainingBudget > 0) {
      const tsconfigPath = path.join(workspace, 'tsconfig.json');
      const tsconfigContent = await safeReadFile(tsconfigPath, workspace, 5000, signal);
      if (tsconfigContent) {
        const signals = extractTsconfigSignals(tsconfigContent);
        if (signals) {
          addSection('tsconfig.json', signals, tsconfigPath);
        }
      }
    }

    if (!signal.aborted && remainingBudget > 0) {
      const pyprojectPath = path.join(workspace, 'pyproject.toml');
      const pyprojectContent = await safeReadFile(pyprojectPath, workspace, 5000, signal);
      if (pyprojectContent) {
        const signals = extractPyprojectSignals(pyprojectContent);
        if (signals) {
          addSection('pyproject.toml', signals, pyprojectPath);
        }
      }
    }
  } catch (err) {
    mainWarn('[ProjectContextScanner]', 'Scan interrupted or failed', err);
  } finally {
    clearTimeout(timeout);
  }

  const summary = sections.join('\n\n');
  mainLog('[ProjectContextScanner]', `Scanned ${scannedFiles.length} files, summary ${summary.length} chars`);

  return {
    summary,
    scannedFiles,
    scannedAt: Date.now(),
  };
}
