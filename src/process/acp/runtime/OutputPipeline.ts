// src/process/acp/runtime/OutputPipeline.ts

import type { TMessage, IMessageText, IMessageThinking, IMessageAcpToolCall } from '@/common/chat/chatLib';
import { extractAndStripThinkTags } from '@process/task/ThinkTagDetector';
import { uuid } from '@/common/utils';

// ─── Pipeline Interface ─────────────────────────────────────────

/**
 * OutputPipeline transforms TMessages from AcpSession before dispatch.
 *
 * Each stage receives a TMessage and returns 0..N TMessages:
 * - [] = suppress
 * - [msg] = pass through or transform
 * - [extra, msg] = emit additional messages (e.g. thinking before content)
 */
export class OutputPipeline {
  private readonly thinkTagFilter = new ThinkTagFilter();
  private readonly toolCallMerger = new ToolCallMerger();

  /** Process a message through all pipeline stages. */
  process(message: TMessage): TMessage[] {
    // ThinkTagFilter: extract <think> tags from text content
    if (message.type === 'text') {
      return this.thinkTagFilter.process(message);
    }

    // ToolCallMerger: deep merge tool_call updates
    if (message.type === 'acp_tool_call') {
      return [this.toolCallMerger.process(message)];
    }

    // All other types: pass through
    return [message];
  }

  /** Clear all stateful pipeline state (call on kill/destroy). */
  reset(): void {
    this.toolCallMerger.reset();
  }
}

// ─── ThinkTagFilter ─────────────────────────────────────────────

/**
 * Extracts inline <think>/<thinking> tags from text content messages.
 * Produces a separate IMessageThinking before the cleaned IMessageText.
 *
 * Stateless — uses the existing ThinkTagDetector utility.
 */
class ThinkTagFilter {
  process(message: IMessageText): TMessage[] {
    const text = message.content.content;
    if (!text || typeof text !== 'string') return [message];

    const { thinking, content: stripped } = extractAndStripThinkTags(text);

    if (!thinking) return [message];

    const results: TMessage[] = [];

    // Emit thinking message first
    results.push({
      id: uuid(),
      msg_id: message.msg_id,
      conversation_id: message.conversation_id,
      type: 'thinking',
      content: {
        content: thinking,
        status: 'done' as const,
      },
    });

    // Emit cleaned content (only if there's non-empty content left)
    if (stripped.trim()) {
      results.push({
        ...message,
        content: { ...message.content, content: stripped },
      });
    }

    return results;
  }
}

// ─── ToolCallMerger ─────────────────────────────────────────────

/**
 * Deep-merges incremental tool_call_update messages with their original tool_call.
 *
 * The renderer replaces by toolCallId, so we must preserve fields
 * (title, kind, rawInput) that partial updates don't include.
 *
 * Stateful — tracks active tool calls by toolCallId.
 */
class ToolCallMerger {
  private activeToolCalls = new Map<string, IMessageAcpToolCall>();

  process(message: IMessageAcpToolCall): IMessageAcpToolCall {
    const toolCallId = message.content?.update?.toolCallId;
    if (!toolCallId) return message;

    const existing = this.activeToolCalls.get(toolCallId);
    if (!existing) {
      // First time seeing this toolCallId — store and pass through
      this.activeToolCalls.set(toolCallId, message);
      return message;
    }

    // Merge: new fields override, missing fields preserved from existing
    const merged: IMessageAcpToolCall = {
      ...existing,
      msg_id: toolCallId,
      status: message.status,
      content: {
        ...existing.content,
        update: {
          ...existing.content.update,
          ...message.content.update,
          // Only override non-fallback values
          title:
            message.content.update.title !== 'unknown' ? message.content.update.title : existing.content.update.title,
          kind: message.content.update.kind !== 'execute' ? message.content.update.kind : existing.content.update.kind,
          content: message.content.update.content ?? existing.content.update.content,
          rawInput: message.content.update.rawInput ?? existing.content.update.rawInput,
        },
      },
    };

    this.activeToolCalls.set(toolCallId, merged);

    // Clean up completed/failed tool calls after a delay
    if (message.content.update.status === 'completed' || message.content.update.status === 'failed') {
      setTimeout(() => this.activeToolCalls.delete(toolCallId), 60_000);
    }

    return merged;
  }

  reset(): void {
    this.activeToolCalls.clear();
  }
}
