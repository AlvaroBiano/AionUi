// tests/unit/process/acp/runtime/OutputPipeline.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputPipeline } from '@process/acp/runtime/OutputPipeline';
import type { TMessage, IMessageText, IMessageAcpToolCall, IMessageThinking } from '@/common/chat/chatLib';

describe('OutputPipeline', () => {
  let pipeline: OutputPipeline;

  beforeEach(() => {
    pipeline = new OutputPipeline();
  });

  afterEach(() => {
    pipeline.reset();
  });

  function makeTextMessage(content: string, id = 'msg-1'): IMessageText {
    return {
      id,
      msg_id: 'turn-1',
      conversation_id: 'conv-1',
      type: 'text',
      content: { content },
    };
  }

  function makeToolCallMessage(
    toolCallId: string,
    overrides: Partial<{
      title: string;
      kind: string;
      content: string;
      rawInput: string;
      status: string;
    }> = {}
  ): IMessageAcpToolCall {
    return {
      id: toolCallId,
      msg_id: toolCallId,
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title: 'unknown',
          kind: 'execute',
          status: 'running',
          ...overrides,
        },
      },
    } as IMessageAcpToolCall;
  }

  // ── Pass-through ──

  it('passes non-text non-tool_call messages through unchanged', () => {
    const msg: TMessage = {
      id: 'p1',
      conversation_id: 'conv-1',
      type: 'plan',
      content: { sessionId: 's1', entries: [] },
    };
    const result = pipeline.process(msg);
    expect(result).toEqual([msg]);
  });

  // ── ThinkTagFilter ──

  it('passes text without think tags through unchanged', () => {
    const msg = makeTextMessage('hello world');
    const result = pipeline.process(msg);
    expect(result).toEqual([msg]);
  });

  it('extracts <think> tags into separate thinking message', () => {
    const msg = makeTextMessage('<think>reasoning here</think>actual response');
    const result = pipeline.process(msg);

    expect(result).toHaveLength(2);

    // First: thinking message
    const thinking = result[0] as IMessageThinking;
    expect(thinking.type).toBe('thinking');
    expect(thinking.content.content).toBe('reasoning here');
    expect(thinking.content.status).toBe('done');

    // Second: cleaned text
    const text = result[1] as IMessageText;
    expect(text.type).toBe('text');
    expect(text.content.content).not.toContain('<think>');
    expect(text.content.content).toContain('actual response');
  });

  it('suppresses empty content after think tag extraction', () => {
    const msg = makeTextMessage('<think>only thinking</think>');
    const result = pipeline.process(msg);

    // Only thinking message, no empty text
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('thinking');
  });

  it('handles <thinking> tags as well', () => {
    const msg = makeTextMessage('<thinking>deep thought</thinking>answer');
    const result = pipeline.process(msg);

    expect(result).toHaveLength(2);
    expect((result[0] as IMessageThinking).content.content).toBe('deep thought');
  });

  // ── ToolCallMerger ──

  it('passes first tool_call through and stores it', () => {
    const msg = makeToolCallMessage('tc-1', { title: 'Read file', kind: 'read' });
    const result = pipeline.process(msg);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(msg);
  });

  it('merges update into existing tool_call preserving title and kind', () => {
    // First: original with real title/kind
    const original = makeToolCallMessage('tc-1', { title: 'Read file', kind: 'read', content: 'initial' });
    pipeline.process(original);

    // Second: update with fallback title/kind but new content
    const update = makeToolCallMessage('tc-1', { title: 'unknown', kind: 'execute', content: 'updated' });
    const result = pipeline.process(update);

    expect(result).toHaveLength(1);
    const merged = result[0] as IMessageAcpToolCall;
    expect(merged.content.update.title).toBe('Read file'); // preserved
    expect(merged.content.update.kind).toBe('read'); // preserved
    expect(merged.content.update.content).toBe('updated'); // overridden
  });

  it('overrides title/kind when update has non-fallback values', () => {
    const original = makeToolCallMessage('tc-2', { title: 'Old title', kind: 'read' });
    pipeline.process(original);

    const update = makeToolCallMessage('tc-2', { title: 'New title', kind: 'edit' });
    const result = pipeline.process(update);

    const merged = result[0] as IMessageAcpToolCall;
    expect(merged.content.update.title).toBe('New title');
    expect(merged.content.update.kind).toBe('edit');
  });

  it('preserves rawInput when update does not provide it', () => {
    const original = makeToolCallMessage('tc-3', { rawInput: '{"file":"a.ts"}' });
    pipeline.process(original);

    const update = makeToolCallMessage('tc-3', { content: 'new output' });
    const result = pipeline.process(update);

    const merged = result[0] as IMessageAcpToolCall;
    expect(merged.content.update.rawInput).toBe('{"file":"a.ts"}');
  });

  it('handles independent tool calls separately', () => {
    const tc1 = makeToolCallMessage('tc-a', { title: 'File A' });
    const tc2 = makeToolCallMessage('tc-b', { title: 'File B' });

    pipeline.process(tc1);
    pipeline.process(tc2);

    const update1 = makeToolCallMessage('tc-a', { content: 'result A' });
    const update2 = makeToolCallMessage('tc-b', { content: 'result B' });

    const r1 = pipeline.process(update1);
    const r2 = pipeline.process(update2);

    expect((r1[0] as IMessageAcpToolCall).content.update.title).toBe('File A');
    expect((r2[0] as IMessageAcpToolCall).content.update.title).toBe('File B');
  });

  // ── reset ──

  it('clears tool call state on reset', () => {
    const original = makeToolCallMessage('tc-r', { title: 'Tracked' });
    pipeline.process(original);

    pipeline.reset();

    // After reset, same toolCallId is treated as new (no merge)
    const msg = makeToolCallMessage('tc-r', { title: 'Fresh' });
    const result = pipeline.process(msg);
    expect((result[0] as IMessageAcpToolCall).content.update.title).toBe('Fresh');
  });
});
