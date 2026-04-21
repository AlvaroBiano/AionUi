// src/process/acp/session/InputPreprocessor.ts
import type { PromptContent } from '@process/acp/types';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import * as path from 'path';
import * as fs from 'fs';

// Match @path or @"path with spaces" (quoted form)
const AT_FILE_REGEX = /@(?:"([^"]+)"|(\S+\.\w+))/g;

const MAX_SEARCH_DEPTH = 3;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.cache', 'dist', 'build']);

export class InputPreprocessor {
  constructor(
    private readonly readFile: (filePath: string) => string,
    private readonly cwd?: string
  ) {}

  process(text: string, files?: string[]): PromptContent {
    const items: ContentBlock[] = [{ type: 'text', text }];

    // Track which files we've already read (for deduplication)
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

      // Also skip if basename matches any uploaded file
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
    // Direct: if absolute path, use as-is
    if (path.isAbsolute(filePath)) {
      return this.isFile(filePath) ? filePath : null;
    }

    // Direct: resolve relative to cwd
    if (this.cwd) {
      const direct = path.resolve(this.cwd, filePath);
      if (this.isFile(direct)) return direct;

      // Recursive: search workspace by basename
      const basename = path.basename(filePath);
      const found = this.findInWorkspace(this.cwd, basename, 0);
      if (found) return found;
    }

    // No cwd or not found — try the raw path (readFile might handle it)
    return filePath;
  }

  /**
   * Recursively search for a file by name within the workspace.
   * Max depth 3, skips hidden dirs and node_modules.
   */
  private findInWorkspace(dir: string, fileName: string, depth: number): string | null {
    if (depth > MAX_SEARCH_DEPTH) return null;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null; // Permission denied or doesn't exist
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
      // Binary files or missing files — log and skip
      console.warn(`[ACP] Skipping unreadable file: ${filePath}`);
      return null;
    }
  }
}
