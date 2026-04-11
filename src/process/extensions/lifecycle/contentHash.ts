/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Recursively collect all file paths under `dir`, sorted for deterministic ordering.
 * Skips: node_modules, .git, .DS_Store, __MACOSX
 */
function getAllFiles(dir: string): string[] {
  const results: string[] = [];
  const SKIP = new Set(['node_modules', '.git', '.DS_Store', '__MACOSX']);

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Compute a deterministic SHA-256 content hash for an extension directory.
 *
 * The hash covers every file's relative path and content, producing the same
 * result regardless of platform (no zip metadata, no filesystem ordering).
 * Used for:
 * - Install directory naming: `{version}_{hashPrefix}`
 * - Integrity verification after download (replacing zip-level SHA-512)
 *
 * Must match the AionHub build script's `computeContentHash()` exactly.
 */
export function computeContentHash(extPath: string): string {
  const hash = crypto.createHash('sha256');
  const files = getAllFiles(extPath);
  for (const file of files) {
    // Normalize to forward slashes for cross-platform determinism.
    // path.relative() uses '\' on Windows but '/' on Linux/macOS.
    const rel = path.relative(extPath, file).split(path.sep).join('/');
    hash.update(rel);
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}
