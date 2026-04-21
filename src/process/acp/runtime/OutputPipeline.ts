// src/process/acp/runtime/OutputPipeline.ts

import type {
  IMessageAcpToolCall,
  IMessagePlan,
  IMessageText,
  IMessageThinking,
  TMessage,
} from '@/common/chat/chatLib';
import type { ToolCallContentItem, ToolCallLocationItem } from '@/common/types/acpTypes';
import type {
  ContentChunk,
  Plan,
  SessionNotification,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallUpdate,
  ToolKind,
} from '@agentclientprotocol/sdk';
import { extractAndStripThinkTags } from '@process/task/ThinkTagDetector';
import { uuid } from '@/common/utils';

// ─── SDK → Application type mappers ─────────────────────────────

const TOOL_KIND_MAP: Record<string, 'read' | 'edit' | 'execute'> = {
  read: 'read',
  search: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  execute: 'execute',
  think: 'execute',
  fetch: 'execute',
  switch_mode: 'execute',
  other: 'execute',
};

function mapToolKind(kind: ToolKind | null | undefined): 'read' | 'edit' | 'execute' {
  if (!kind) return 'execute';
  return TOOL_KIND_MAP[kind] ?? 'execute';
}

function mapToolContent(content: ToolCallContent[] | null | undefined): ToolCallContentItem[] | undefined {
  if (!content || content.length === 0) return undefined;
  return content.map((item): ToolCallContentItem => {
    if (item.type === 'diff') {
      const diff = item as { type: 'diff'; path?: string; oldText?: string; newText?: string };
      return { type: 'diff', path: diff.path, oldText: diff.oldText, newText: diff.newText };
    }
    const contentItem = item as { type: string; content?: { type: string; text?: string } };
    return { type: 'content', content: contentItem.content as { type: 'text'; text: string } | undefined };
  });
}

function mapToolLocations(locations: ToolCallLocation[] | null | undefined): ToolCallLocationItem[] | undefined {
  if (!locations || locations.length === 0) return undefined;
  return locations.map((loc): ToolCallLocationItem => ({ path: loc.path ?? '' }));
}

const CONFIG_UPDATES = new Set<SessionUpdate['sessionUpdate']>([
  'current_mode_update',
  'config_option_update',
  'session_info_update',
  'usage_update',
]);

// ─── OutputPipeline ─────────────────────────────────────────────

/**
 * Transforms SDK SessionNotifications into TMessages for dispatch.
 *
 * Stages (in order):
 * 1. MessageTranslator: SessionNotification → TMessage[] (SDK → application format)
 * 2. ThinkTagFilter: extract <think> tags from text content
 * 3. ToolCallMerger: deep merge tool_call_update into stored originals
 *
 * Input: SessionNotification (SDK protocol type)
 * Output: TMessage[] (application/renderer type)
 */
export class OutputPipeline {
  private readonly translator: MessageTranslator;
  private readonly thinkTagFilter = new ThinkTagFilter();
  private readonly toolCallMerger = new ToolCallMerger();

  constructor(conversationId: string) {
    this.translator = new MessageTranslator(conversationId);
  }

  /** Process a SDK notification through all pipeline stages. */
  process(notification: SessionNotification): TMessage[] {
    // Stage 1: SDK → TMessage translation
    const translated = this.translator.translate(notification);

    // Stage 2+: Post-processing each message
    const results: TMessage[] = [];
    for (const msg of translated) {
      if (msg.type === 'text') {
        results.push(...this.thinkTagFilter.process(msg));
      } else if (msg.type === 'acp_tool_call') {
        results.push(this.toolCallMerger.process(msg));
      } else {
        results.push(msg);
      }
    }
    return results;
  }

  /** Signal turn end — clears translator message ID map. */
  onTurnEnd(): void {
    this.translator.onTurnEnd();
  }

  /** Clear all stateful pipeline state (call on kill/destroy). */
  reset(): void {
    this.translator.reset();
    this.toolCallMerger.reset();
  }
}

// ─── Stage 1: MessageTranslator ─────────────────────────────────

/**
 * Translates SDK SessionNotification → TMessage[].
 * Maintains turn-scoped messageId → UUID map so streaming chunks merge correctly.
 */
class MessageTranslator {
  private messageMap = new Map<string, string>();

  constructor(private readonly conversationId: string) {}

  translate(notification: SessionNotification): TMessage[] {
    const update = notification.update;
    const updateType = update.sessionUpdate;

    if (CONFIG_UPDATES.has(updateType)) return [];

    switch (updateType) {
      case 'agent_message_chunk':
        return this.handleAgentMessageChunk(update);
      case 'agent_thought_chunk':
        return this.handleThoughtChunk(update);
      case 'tool_call':
        return this.handleToolCall(update);
      case 'tool_call_update':
        return this.handleToolCallUpdate(update);
      case 'plan':
        return this.handlePlan(update);
      case 'available_commands_update':
      case 'user_message_chunk':
      default:
        return [];
    }
  }

  onTurnEnd(): void {
    this.messageMap.clear();
  }

  reset(): void {
    this.messageMap.clear();
  }

  private resolveMsgId(sdkMessageId: string): string {
    let msgId = this.messageMap.get(sdkMessageId);
    if (!msgId) {
      msgId = crypto.randomUUID();
      this.messageMap.set(sdkMessageId, msgId);
    }
    return msgId;
  }

  private handleAgentMessageChunk(update: ContentChunk): IMessageText[] {
    const messageId = update.messageId ?? 'default';
    const text = update.content.type === 'text' ? update.content.text : '';
    if (!text) return [];

    const msgId = this.resolveMsgId(messageId);
    return [
      {
        id: msgId,
        msg_id: msgId,
        conversation_id: this.conversationId,
        type: 'text',
        content: { content: text },
        position: 'left',
        status: 'work',
      },
    ];
  }

  private handleThoughtChunk(update: ContentChunk): IMessageThinking[] {
    const messageId = `thought-${update.messageId ?? 'default'}`;
    const text = update.content.type === 'text' ? update.content.text : '';
    if (!text) return [];

    const msgId = this.resolveMsgId(messageId);
    return [
      {
        id: msgId,
        msg_id: msgId,
        conversation_id: this.conversationId,
        type: 'thinking',
        content: { content: text, status: 'thinking' },
        position: 'left',
        status: 'work',
      },
    ];
  }

  private handleToolCall(update: ToolCall): IMessageAcpToolCall[] {
    this.messageMap.clear();
    const toolCallId = update.toolCallId ?? crypto.randomUUID();

    return [
      {
        id: toolCallId,
        msg_id: toolCallId,
        conversation_id: this.conversationId,
        type: 'acp_tool_call',
        content: {
          sessionId: '',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            status: update.status ?? 'pending',
            title: update.title ?? 'unknown',
            kind: mapToolKind(update.kind),
            rawInput: update.rawInput as Record<string, unknown> | undefined,
            content: mapToolContent(update.content),
            locations: mapToolLocations(update.locations),
          },
        },
        position: 'left',
        status: 'work',
      },
    ];
  }

  private handleToolCallUpdate(update: ToolCallUpdate): IMessageAcpToolCall[] {
    const toolCallId = update.toolCallId ?? '';

    return [
      {
        id: toolCallId,
        msg_id: toolCallId,
        conversation_id: this.conversationId,
        type: 'acp_tool_call',
        content: {
          sessionId: '',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            status: update.status ?? 'completed',
            title: update.title ?? 'unknown',
            kind: mapToolKind(update.kind),
            rawInput: update.rawInput as Record<string, unknown> | undefined,
            content: mapToolContent(update.content),
          },
        },
        position: 'left',
        status: update.status === 'completed' || update.status === 'failed' ? 'finish' : 'work',
      },
    ];
  }

  private handlePlan(plan: Plan): IMessagePlan[] {
    this.messageMap.clear();
    if (!plan.entries || plan.entries.length === 0) return [];

    const planMsgId = this.resolveMsgId('plan');
    return [
      {
        id: planMsgId,
        msg_id: planMsgId,
        conversation_id: this.conversationId,
        type: 'plan',
        content: {
          sessionId: '',
          entries: plan.entries.map((e) => ({
            content: e.content,
            status: e.status as 'pending' | 'in_progress' | 'completed',
            priority: e.priority as 'low' | 'medium' | 'high' | undefined,
          })),
        },
        position: 'left',
        status: 'finish',
      },
    ];
  }
}

// ─── Stage 2: ThinkTagFilter ────────────────────────────────────

/**
 * Extracts inline <think>/<thinking> tags from text content messages.
 * Produces a separate IMessageThinking before the cleaned IMessageText.
 * Stateless.
 */
class ThinkTagFilter {
  process(message: IMessageText): TMessage[] {
    const text = message.content.content;
    if (!text || typeof text !== 'string') return [message];

    const { thinking, content: stripped } = extractAndStripThinkTags(text);
    if (!thinking) return [message];

    const results: TMessage[] = [];

    results.push({
      id: uuid(),
      msg_id: message.msg_id,
      conversation_id: message.conversation_id,
      type: 'thinking',
      content: { content: thinking, status: 'done' as const },
    });

    if (stripped.trim()) {
      results.push({
        ...message,
        content: { ...message.content, content: stripped },
      });
    }

    return results;
  }
}

// ─── Stage 3: ToolCallMerger ────────────────────────────────────

/**
 * Deep-merges incremental tool_call_update messages with their original tool_call.
 * Preserves title/kind/rawInput when update has fallback values.
 * Stateful — tracks active tool calls by toolCallId.
 */
class ToolCallMerger {
  private activeToolCalls = new Map<string, IMessageAcpToolCall>();

  process(message: IMessageAcpToolCall): IMessageAcpToolCall {
    const toolCallId = message.content?.update?.toolCallId;
    if (!toolCallId) return message;

    const existing = this.activeToolCalls.get(toolCallId);
    if (!existing) {
      this.activeToolCalls.set(toolCallId, message);
      return message;
    }

    const merged: IMessageAcpToolCall = {
      ...existing,
      msg_id: toolCallId,
      status: message.status,
      content: {
        ...existing.content,
        update: {
          ...existing.content.update,
          ...message.content.update,
          title:
            message.content.update.title !== 'unknown' ? message.content.update.title : existing.content.update.title,
          kind: message.content.update.kind !== 'execute' ? message.content.update.kind : existing.content.update.kind,
          content: message.content.update.content ?? existing.content.update.content,
          rawInput: message.content.update.rawInput ?? existing.content.update.rawInput,
        },
      },
    };

    this.activeToolCalls.set(toolCallId, merged);

    if (message.content.update.status === 'completed' || message.content.update.status === 'failed') {
      setTimeout(() => this.activeToolCalls.delete(toolCallId), 60_000);
    }

    return merged;
  }

  reset(): void {
    this.activeToolCalls.clear();
  }
}
