// src/process/acp/runtime/UserMessagePersister.ts

import type { TMessage, IMessageText } from '@/common/chat/chatLib';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { CronMessageMeta } from '@/common/chat/chatLib';

// ─── Dependencies (injected for testability) ────────────────────

export type PersisterDeps = {
  addMessage: (conversationId: string, message: TMessage) => void;
  updateConversation: (conversationId: string) => Promise<void>;
  emitToRenderer: (message: IResponseMessage) => void;
};

// ─── Message data ───────────────────────────────────────────────

export type UserMessageData = {
  msgId: string;
  content: string;
  conversationId: string;
  cronMeta?: CronMessageMeta;
  hidden?: boolean;
  silent?: boolean;
};

// ─── UserMessagePersister ───────────────────────────────────────

/**
 * Persists user message to DB and emits to renderer BEFORE agent init.
 * This ensures the UI shows the user's message immediately, even while
 * the agent backend is still connecting/authenticating.
 *
 * Not a pipeline stage — this is a side effect, not a transformation.
 * AcpRuntime calls this before running the InputPipeline.
 */
export class UserMessagePersister {
  constructor(private readonly deps: PersisterDeps) {}

  persist(data: UserMessageData): void {
    if (data.silent || !data.msgId || !data.content) return;

    const userMessage: IMessageText = {
      id: data.msgId,
      msg_id: data.msgId,
      type: 'text',
      position: 'right',
      conversation_id: data.conversationId,
      content: {
        content: data.content,
        ...(data.cronMeta && { cronMeta: data.cronMeta }),
      },
      createdAt: Date.now(),
      ...(data.hidden && { hidden: true }),
    };

    // 1. Write to DB
    this.deps.addMessage(data.conversationId, userMessage);

    // 2. Touch conversation to update sidebar sorting
    void this.deps.updateConversation(data.conversationId).catch(() => {
      // Conversation might not exist in DB yet
    });

    // 3. Emit to renderer for immediate UI display
    this.deps.emitToRenderer({
      type: 'user_content',
      conversation_id: data.conversationId,
      msg_id: data.msgId,
      data: data.cronMeta
        ? { content: userMessage.content.content, cronMeta: data.cronMeta }
        : userMessage.content.content,
      ...(data.hidden && { hidden: true }),
    });
  }
}
