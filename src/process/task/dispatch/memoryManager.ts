/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/memoryManager.ts

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Memory entry persisted to the memory directory.
 */
export type MemoryEntry = {
  id: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  title: string;
  content: string;
  createdAt: number;
};

/** Per-workspace write mutex to prevent concurrent file corruption */
const writeMutexMap = new Map<string, Promise<void>>();

/**
 * Acquire a per-workspace write mutex. Serializes writes to the same workspace.
 */
function withMutex(workspace: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeMutexMap.get(workspace) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeMutexMap.set(workspace, next);
  // Clean up resolved mutex to prevent memory leak
  void next.finally(() => {
    if (writeMutexMap.get(workspace) === next) {
      writeMutexMap.delete(workspace);
    }
  });
  return next;
}

/**
 * Get the memory directory path for a workspace.
 */
function getWorkspaceMemoryDir(workspace: string): string {
  return path.join(workspace, '.aion', 'memory');
}

/**
 * Get the global memory directory path.
 */
function getGlobalMemoryDir(): string {
  return path.join(os.homedir(), '.aion', 'memory');
}

/**
 * Read MEMORY.md content from a directory, returning empty string if not found.
 */
async function readMemoryIndex(memoryDir: string): Promise<string> {
  const memoryPath = path.join(memoryDir, 'MEMORY.md');
  try {
    return await fs.promises.readFile(memoryPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Load MEMORY.md from memory directory hierarchy.
 * Merges: assistant-specific > workspace > global.
 * Returns concatenated content for prompt injection.
 */
export async function loadMemory(workspace: string, assistantMemoryDir?: string): Promise<string> {
  const parts: string[] = [];

  // 1. Global memory
  const globalContent = await readMemoryIndex(getGlobalMemoryDir());
  if (globalContent.trim()) {
    parts.push(`### Global Memory\n${globalContent.trim()}`);
  }

  // 2. Workspace memory (skip if workspace is empty or relative)
  if (!workspace || !path.isAbsolute(workspace)) {
    return parts.join('\n\n');
  }
  const workspaceContent = await readMemoryIndex(getWorkspaceMemoryDir(workspace));
  if (workspaceContent.trim()) {
    parts.push(`### Workspace Memory\n${workspaceContent.trim()}`);
  }

  // 3. Assistant-specific memory (highest priority, shown last = overrides)
  if (assistantMemoryDir) {
    const assistantContent = await readMemoryIndex(assistantMemoryDir);
    if (assistantContent.trim()) {
      parts.push(`### Assistant Memory\n${assistantContent.trim()}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Save a new memory entry. Creates/updates the markdown file and
 * updates MEMORY.md index.
 *
 * Uses atomic write pattern (write .tmp then rename) and per-workspace
 * mutex for concurrent write safety.
 */
export async function saveMemory(workspace: string, entry: MemoryEntry): Promise<void> {
  if (!workspace || !path.isAbsolute(workspace)) {
    mainWarn('[memoryManager]', 'Cannot save memory: workspace is empty or relative');
    return;
  }
  return withMutex(workspace, async () => {
    const memoryDir = getWorkspaceMemoryDir(workspace);

    // Auto-create memory directory if not exists
    await fs.promises.mkdir(memoryDir, { recursive: true });

    // Write individual memory file
    const filename = `${entry.type}_${entry.id}.md`;
    const filePath = path.join(memoryDir, filename);
    const fileContent = `# ${entry.title}\n\n${entry.content}\n`;

    // Atomic write: write to .tmp then rename
    const tmpPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tmpPath, fileContent, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);

    // Update MEMORY.md index (append entry)
    const indexPath = path.join(memoryDir, 'MEMORY.md');
    const indexLine = `- [${entry.title}](${filename}) — ${entry.content.slice(0, 80).replace(/\n/g, ' ')}\n`;

    // Read existing index content
    let existingIndex = '';
    try {
      existingIndex = await fs.promises.readFile(indexPath, 'utf-8');
    } catch {
      // File does not exist yet, start fresh
    }

    // Append new entry
    const updatedIndex = existingIndex + indexLine;

    // Atomic write for index
    const tmpIndexPath = `${indexPath}.tmp`;
    await fs.promises.writeFile(tmpIndexPath, updatedIndex, 'utf-8');
    await fs.promises.rename(tmpIndexPath, indexPath);

    mainLog('[memoryManager]', `Saved memory: ${entry.type}/${entry.title} -> ${filePath}`);
  });
}

/**
 * List all memory entries from MEMORY.md index.
 * Parses the markdown link format: `- [title](filename) — description`
 */
export async function listMemories(workspace: string): Promise<MemoryEntry[]> {
  const memoryDir = getWorkspaceMemoryDir(workspace);
  const indexContent = await readMemoryIndex(memoryDir);

  if (!indexContent.trim()) {
    return [];
  }

  const entries: MemoryEntry[] = [];
  const lineRegex = /^- \[(.+?)]\((\w+)_(\w+)\.md\)\s*—\s*(.*)$/gm;

  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(indexContent)) !== null) {
    const [, title, type, id, description] = match;
    if (title && type && id) {
      // Read the full content from the individual file
      const filePath = path.join(memoryDir, `${type}_${id}.md`);
      let content = description ?? '';
      try {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        // Strip the title line from content
        const contentLines = fileContent.split('\n');
        content = contentLines.slice(2).join('\n').trim() || content;
      } catch {
        mainWarn('[memoryManager]', `Memory file not found: ${filePath}`);
      }

      const validTypes = ['user', 'feedback', 'project', 'reference'] as const;
      const memoryType = validTypes.includes(type as MemoryEntry['type'])
        ? (type as MemoryEntry['type'])
        : 'reference';

      entries.push({
        id,
        type: memoryType,
        title,
        content,
        createdAt: 0, // Cannot recover from index format
      });
    }
  }

  return entries;
}
