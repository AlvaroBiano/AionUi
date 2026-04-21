// tests/unit/process/acp/runtime/OutputPipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutputPipeline } from '@process/acp/runtime/OutputPipeline';
import type { TMessage, IMessageText, IMessageAcpToolCall, IMessageThinking } from '@/common/chat/chatLib';
import type { SessionNotification } from '@agentclientprotocol/sdk';

describe('OutputPipeline', () => {
  let pipeline: OutputPipeline;

  beforeEach(() => {
    pipeline = new OutputPipeline('conv-1');
  });

  afterEach(() => {
    pipeline.reset();
  });

  // ── Helper: create SDK notifications ──

  function textNotification(text: string, messageId = 'msg-1'): SessionNotification {
    return {
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId,
        content: { type: 'text', text },
      },
    } as unknown as SessionNotification;
  }

  function thoughtNotification(text: string, messageId = 'msg-1'): SessionNotification {
    return {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        messageId,
        content: { type: 'text', text },
      },
    } as unknown as SessionNotification;
  }

  function toolCallNotification(toolCallId: string, overrides: Record<string, unknown> = {}): SessionNotification {
    return {
      update: {
        sessionUpdate: 'tool_call',
        toolCallId,
        status: 'running',
        title: 'Read file',
        kind: 'read',
        ...overrides,
      },
    } as unknown as SessionNotification;
  }

  function toolCallUpdateNotification(
    toolCallId: string,
    overrides: Record<string, unknown> = {}
  ): SessionNotification {
    return {
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        title: 'unknown',
        kind: 'execute',
        ...overrides,
      },
    } as unknown as SessionNotification;
  }

  function planNotification(entries: Array<{ content: string; status: string }>): SessionNotification {
    return {
      update: {
        sessionUpdate: 'plan',
        entries,
      },
    } as unknown as SessionNotification;
  }

  function configNotification(type: string): SessionNotification {
    return {
      update: { sessionUpdate: type },
    } as unknown as SessionNotification;
  }

  // ── Stage 1: MessageTranslator ──

  it('translates agent_message_chunk to IMessageText', () => {
    const result = pipeline.process(textNotification('hello'));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect((result[0] as IMessageText).content.content).toBe('hello');
  });

  it('translates agent_thought_chunk to IMessageThinking', () => {
    const result = pipeline.process(thoughtNotification('reasoning'));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('thinking');
    expect((result[0] as IMessageThinking).content.content).toBe('reasoning');
  });

  it('translates tool_call to IMessageAcpToolCall', () => {
    const result = pipeline.process(toolCallNotification('tc-1'));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('acp_tool_call');
    expect((result[0] as IMessageAcpToolCall).content.update.title).toBe('Read file');
  });

  it('translates plan to IMessagePlan', () => {
    const result = pipeline.process(planNotification([{ content: 'Step 1', status: 'pending' }]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('plan');
  });

  it('filters config updates (returns empty)', () => {
    expect(pipeline.process(configNotification('current_mode_update'))).toEqual([]);
    expect(pipeline.process(configNotification('config_option_update'))).toEqual([]);
    expect(pipeline.process(configNotification('usage_update'))).toEqual([]);
  });

  it('assigns stable msg_id for same SDK messageId within a turn', () => {
    const r1 = pipeline.process(textNotification('chunk 1', 'sdk-1'));
    const r2 = pipeline.process(textNotification('chunk 2', 'sdk-1'));
    expect(r1[0].msg_id).toBe(r2[0].msg_id);
  });

  it('clears msg_id map on onTurnEnd', () => {
    const r1 = pipeline.process(textNotification('turn 1', 'sdk-1'));
    pipeline.onTurnEnd();
    const r2 = pipeline.process(textNotification('turn 2', 'sdk-1'));
    expect(r1[0].msg_id).not.toBe(r2[0].msg_id);
  });

  // ── Stage 2: ThinkTagFilter ──

  it('extracts <think> tags from text content', () => {
    const result = pipeline.process(textNotification('<think>reasoning</think>answer'));
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('thinking');
    expect((result[0] as IMessageThinking).content.content).toBe('reasoning');
    expect(result[1].type).toBe('text');
    expect((result[1] as IMessageText).content.content).toContain('answer');
  });

  it('passes text without think tags through unchanged', () => {
    const result = pipeline.process(textNotification('plain text'));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });

  // ── Stage 3: ToolCallMerger ──

  it('merges tool_call_update preserving title from original', () => {
    pipeline.process(toolCallNotification('tc-1', { title: 'Edit file', kind: 'edit' }));
    const result = pipeline.process(toolCallUpdateNotification('tc-1', { content: [{ type: 'content' }] }));

    expect(result).toHaveLength(1);
    const merged = result[0] as IMessageAcpToolCall;
    expect(merged.content.update.title).toBe('Edit file'); // preserved from original
    expect(merged.content.update.kind).toBe('edit'); // preserved from original
  });

  it('overrides title when update has non-fallback value', () => {
    pipeline.process(toolCallNotification('tc-2', { title: 'Old' }));
    const result = pipeline.process(toolCallUpdateNotification('tc-2', { title: 'New' }));

    const merged = result[0] as IMessageAcpToolCall;
    expect(merged.content.update.title).toBe('New');
  });

  // ── Full pipeline: translate → think filter → merge ──

  it('processes full pipeline: SDK notification through all stages', () => {
    // Text with think tags
    const textResult = pipeline.process(textNotification('<think>hmm</think>response'));
    expect(textResult).toHaveLength(2);
    expect(textResult[0].type).toBe('thinking');
    expect(textResult[1].type).toBe('text');

    // Tool call + update
    pipeline.process(toolCallNotification('tc-full', { title: 'Bash', kind: 'execute' }));
    const updateResult = pipeline.process(toolCallUpdateNotification('tc-full', { status: 'completed' }));
    expect(updateResult).toHaveLength(1);
    expect((updateResult[0] as IMessageAcpToolCall).content.update.title).toBe('Bash');
  });

  // ── reset ──

  it('clears all state on reset', () => {
    pipeline.process(toolCallNotification('tc-r', { title: 'Tracked' }));
    pipeline.reset();

    // After reset, same toolCallId treated as new
    const result = pipeline.process(toolCallNotification('tc-r', { title: 'Fresh' }));
    expect((result[0] as IMessageAcpToolCall).content.update.title).toBe('Fresh');
  });
});
