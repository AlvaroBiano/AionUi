/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseTodoLines, TodoTracker } from '../../../src/cli/ui/todoDisplay';

describe('parseTodoLines', () => {
  it('returns empty array for text with no checkboxes', () => {
    expect(parseTodoLines('just some plain text\nno todos here')).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(parseTodoLines('')).toHaveLength(0);
  });

  it("parses '- [ ] pending item' as status:'pending'", () => {
    const items = parseTodoLines('- [ ] pending item');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('pending item');
    expect(items[0]?.status).toBe('pending');
  });

  it("parses '- [x] done item' as status:'done'", () => {
    const items = parseTodoLines('- [x] done item');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('done item');
    expect(items[0]?.status).toBe('done');
  });

  it("parses '- [X] done item' as status:'done'", () => {
    const items = parseTodoLines('- [X] done item');
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('done');
  });

  it("parses '- [~] in progress' as status:'in_progress'", () => {
    const items = parseTodoLines('- [~] in progress item');
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('in_progress');
  });

  it("parses '- [-] item' as status:'pending' (dash marker no longer in_progress)", () => {
    const items = parseTodoLines('- [-] in progress item');
    expect(items).toHaveLength(0);
  });

  it('does not parse normal markdown list items as todos', () => {
    const text = [
      '- Regular list item with no brackets',
      '- Another list item',
      'Some synthesis text with - dashes',
    ].join('\n');
    expect(parseTodoLines(text)).toHaveLength(0);
  });

  it("parses '- [>] in progress' as status:'in_progress'", () => {
    const items = parseTodoLines('- [>] in progress item');
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('in_progress');
  });

  it("parses '* [ ] asterisk bullet' as status:'pending'", () => {
    const items = parseTodoLines('* [ ] asterisk bullet item');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('asterisk bullet item');
    expect(items[0]?.status).toBe('pending');
  });

  it('parses multiple checkboxes from a text block', () => {
    const text = [
      '- [x] Task one done',
      '- [ ] Task two pending',
      '- [~] Task three in progress',
    ].join('\n');
    const items = parseTodoLines(text);
    expect(items).toHaveLength(3);
    expect(items[0]?.status).toBe('done');
    expect(items[1]?.status).toBe('pending');
    expect(items[2]?.status).toBe('in_progress');
  });

  it('handles indented checkbox lines', () => {
    const items = parseTodoLines('  - [x] indented done item');
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('done');
  });
});

describe('TodoTracker', () => {
  it('returns null when no todos in text', () => {
    const tracker = new TodoTracker();
    expect(tracker.feed('task1', 'plain text with no todos')).toBeNull();
  });

  it('returns list when todos found', () => {
    const tracker = new TodoTracker();
    const result = tracker.feed('task1', '- [ ] do something\n- [x] done thing');
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
  });

  it('returns null when todos are unchanged on second feed', () => {
    const tracker = new TodoTracker();
    tracker.feed('task1', '- [ ] do something');
    const second = tracker.feed('task1', '- [ ] do something');
    expect(second).toBeNull();
  });

  it('returns updated list when todo status changes', () => {
    const tracker = new TodoTracker();
    tracker.feed('task1', '- [ ] do something');
    const updated = tracker.feed('task1', '- [x] do something');
    expect(updated).not.toBeNull();
    expect(updated?.[0]?.status).toBe('done');
  });

  it('merges updates — same text, new status overrides old', () => {
    const tracker = new TodoTracker();
    tracker.feed('task1', '- [ ] step one\n- [ ] step two');
    const result = tracker.feed('task1', '- [x] step one');
    expect(result).not.toBeNull();
    const stepOne = result?.find((i) => i.text === 'step one');
    expect(stepOne?.status).toBe('done');
    // step two should still be present (merged)
    const stepTwo = result?.find((i) => i.text === 'step two');
    expect(stepTwo?.status).toBe('pending');
  });

  it('get() returns empty array for unknown subTaskId', () => {
    const tracker = new TodoTracker();
    expect(tracker.get('unknown')).toHaveLength(0);
  });

  it('get() returns stored todos after feed', () => {
    const tracker = new TodoTracker();
    tracker.feed('task1', '- [x] completed item');
    const todos = tracker.get('task1');
    expect(todos).toHaveLength(1);
    expect(todos[0]?.status).toBe('done');
  });

  it('clear() removes todos for a subTaskId', () => {
    const tracker = new TodoTracker();
    tracker.feed('task1', '- [x] something done');
    tracker.clear('task1');
    expect(tracker.get('task1')).toHaveLength(0);
  });

  it('clear() does not affect other subTaskIds', () => {
    const tracker = new TodoTracker();
    tracker.feed('task1', '- [x] task one item');
    tracker.feed('task2', '- [ ] task two item');
    tracker.clear('task1');
    expect(tracker.get('task2')).toHaveLength(1);
  });
});
