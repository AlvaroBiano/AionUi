/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TodoItem } from '../agents/ICoordinatorLoop';

/** Parse markdown checkbox lines from a text block. */
export function parseTodoLines(text: string): TodoItem[] {
  const lines = text.split('\n');
  const items: TodoItem[] = [];
  for (const line of lines) {
    const m = line.match(/^[\s]*[-*]\s+\[([xX ~>])\]\s+(.+)/);
    if (!m) continue;
    const marker = m[1];
    const itemText = m[2].trim();
    let status: TodoItem['status'];
    if (marker === 'x' || marker === 'X') {
      status = 'done';
    } else if (marker === '~' || marker === '>') {
      status = 'in_progress';
    } else {
      status = 'pending';
    }
    items.push({ text: itemText, status });
  }
  return items;
}

export class TodoTracker {
  private todos = new Map<string, TodoItem[]>();

  feed(subTaskId: string, text: string): TodoItem[] | null {
    const parsed = parseTodoLines(text);
    if (parsed.length === 0) return null;
    const existing = this.todos.get(subTaskId) ?? [];
    // Merge: new items override old by text key
    const merged = new Map<string, TodoItem>();
    for (const item of existing) merged.set(item.text, item);
    for (const item of parsed) merged.set(item.text, item);
    const newList = [...merged.values()];
    if (this.todosEqual(newList, existing)) return null;
    this.todos.set(subTaskId, newList);
    return newList;
  }

  get(subTaskId: string): TodoItem[] {
    return this.todos.get(subTaskId) ?? [];
  }

  clear(subTaskId: string): void {
    this.todos.delete(subTaskId);
  }

  private todosEqual(a: TodoItem[], b: TodoItem[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((item, i) => item.text === b[i]?.text && item.status === b[i]?.status);
  }
}
