// src/process/acp/runtime/InputPipeline.ts

import type { PromptContent } from '@process/acp/types';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import * as path from 'path';
import * as fs from 'fs';

const AIONUI_FILES_MARKER = '[[AION_FILES]]';

// Match @path or @"path with spaces" (quoted form)
const AT_FILE_REGEX = /@(?:"([^"]+)"|(\S+\.\w+))/g;

const MAX_SEARCH_DEPTH = 3;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.cache', 'dist', 'build']);

// ─── Injection Context ──────────────────────────────────────────

/**
 * Content to inject on the first user message.
 * AcpRuntime resolves these (from config, skills, team) before calling the pipeline.
 * The pipeline just wraps and prepends — it doesn't know how to fetch skills/presets.
 */
export type InjectionContext = {
  presetContext?: string;
  skillsIndex?: string;
  teamGuidePrompt?: string;
};

// ─── InputPipeline ──────────────────────────────────────────────

/**
 * Transforms user input into PromptContent for the agent.
 *
 * Stages (in order):
 * 1. Strip AIONUI_FILES_MARKER
 * 2. First message injection (preset, skills, teamGuide) — once per lifetime
 * 3. @file reference resolution + uploaded file content
 */
export class InputPipeline {
  private readonly firstMessageInjector = new FirstMessageInjector();
  private readonly readFile: (filePath: string) => string;
  private readonly cwd: string | undefined;

  constructor(cwd?: string, readFile?: (filePath: string) => string) {
    this.cwd = cwd;
    this.readFile = readFile ?? ((filePath) => fs.readFileSync(filePath, 'utf-8'));
  }

  /**
   * Process user input through all pipeline stages.
   *
   * @param text       Raw user message text
   * @param files      Uploaded file paths (from drag-drop or attach)
   * @param injection  First-message injection context (ignored after first call)
   */
  process(text: string, files?: string[], injection?: InjectionContext): PromptContent {
    // 1. Strip [[AION_FILES]] marker (appended by renderer for uploaded files)
    let processed = text;
    if (processed.includes(AIONUI_FILES_MARKER)) {
      processed = processed.split(AIONUI_FILES_MARKER)[0].trimEnd();
    }

    // 2. First message injection
    processed = this.firstMessageInjector.process(processed, injection);

    // 3. @file resolution + uploaded file content → PromptContent (ContentBlock[])
    return this.resolveFiles(processed, files);
  }

  /** Whether the first message injection has been consumed. */
  get firstMessageConsumed(): boolean {
    return this.firstMessageInjector.consumed;
  }

  // ── @file resolution ──────────────────────────────────────────

  private resolveFiles(text: string, files?: string[]): PromptContent {
    const items: ContentBlock[] = [{ type: 'text', text }];
    const readPaths = new Set<string>();

    // 1. Read explicitly uploaded files first
    if (files) {
      for (const filePath of files) {
        if (readPaths.has(filePath)) continue;
        const item = this.tryReadFile(filePath);
        if (item) {
          items.push(item);
          readPaths.add(filePath);
        }
      }
    }

    // 2. Parse @references from text, skipping already-read files
    const matches = text.matchAll(AT_FILE_REGEX);
    for (const match of matches) {
      const filePath = match[1] ?? match[2]; // group 1 = quoted, group 2 = unquoted
      if (!filePath || readPaths.has(filePath)) continue;

      // Skip if basename matches any uploaded file
      const basename = filePath.split(/[\\/]/).pop();
      if (files?.some((f) => f === filePath || f.endsWith(`/${basename}`) || f.endsWith(`\\${basename}`))) {
        continue;
      }

      // Resolve path relative to workspace, then try recursive search
      const resolved = this.resolveFilePath(filePath);
      if (!resolved || readPaths.has(resolved)) continue;

      const item = this.tryReadFile(resolved);
      if (item) {
        items.push(item);
        readPaths.add(resolved);
      }
    }
    return items;
  }

  /**
   * Resolve an @file path to an absolute path.
   * 1. Try direct resolution (absolute or relative to cwd)
   * 2. Fall back to recursive workspace search by filename
   */
  private resolveFilePath(filePath: string): string | null {
    if (path.isAbsolute(filePath)) {
      return this.isFile(filePath) ? filePath : null;
    }

    if (this.cwd) {
      const direct = path.resolve(this.cwd, filePath);
      if (this.isFile(direct)) return direct;

      const basename = path.basename(filePath);
      const found = this.findInWorkspace(this.cwd, basename, 0);
      if (found) return found;
    }

    return filePath;
  }

  private findInWorkspace(dir: string, fileName: string, depth: number): string | null {
    if (depth > MAX_SEARCH_DEPTH) return null;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) return full;
      if (entry.isDirectory()) {
        const found = this.findInWorkspace(full, fileName, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  private isFile(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  private tryReadFile(filePath: string): ContentBlock | null {
    try {
      const content = this.readFile(filePath);
      return { type: 'text', text: `[File: ${filePath}]\n${content}` };
    } catch {
      console.warn(`[ACP] Skipping unreadable file: ${filePath}`);
      return null;
    }
  }
}

// ─── FirstMessageInjector ───────────────────────────────────────

/**
 * Wraps the first user message with [Assistant Rules] + [User Request] structure.
 * Injects presetContext, skillsIndex, and teamGuidePrompt if provided.
 *
 * Stateful: fires once, then becomes a no-op for the rest of the conversation.
 */
class FirstMessageInjector {
  private _consumed = false;

  get consumed(): boolean {
    return this._consumed;
  }

  process(text: string, injection?: InjectionContext): string {
    if (this._consumed || !injection) return text;

    const parts: string[] = [];
    if (injection.presetContext) parts.push(injection.presetContext);
    if (injection.skillsIndex) parts.push(injection.skillsIndex);
    if (injection.teamGuidePrompt) parts.push(injection.teamGuidePrompt);

    this._consumed = true;

    if (parts.length === 0) return text;

    return `[Assistant Rules - You MUST follow these instructions]\n${parts.join('\n\n')}\n\n[User Request]\n${text}`;
  }
}
