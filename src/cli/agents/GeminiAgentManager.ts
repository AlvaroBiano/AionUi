/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GeminiAgentManager — standalone IAgentManager for Google Gemini models.
 *
 * Uses the @google/genai SDK directly for Gemini models, maintaining multi-turn
 * conversation history and streaming output via IAgentEventEmitter.
 */
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter } from '@process/task/IAgentEventEmitter';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { AgentType, AgentStatus } from '@process/task/agentTypes';
import type { AgentConfig } from '../config/types';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export class GeminiAgentManager implements IAgentManager {
  readonly type: AgentType = 'acp';
  status: AgentStatus | undefined = 'pending';
  readonly workspace: string;
  readonly conversation_id: string;

  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private history: HistoryMessage[] = [];
  private aborted = false;

  constructor(
    conversationId: string,
    private readonly config: AgentConfig,
    private readonly emitter: IAgentEventEmitter,
    workspace?: string,
  ) {
    this.conversation_id = conversationId;
    this.workspace = workspace ?? process.cwd();
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'gemini-2.0-flash';
  }

  async sendMessage(data: { content: string }): Promise<void> {
    this.status = 'running';
    this.aborted = false;
    this.emitter.emitMessage(this.conversation_id, { type: 'status', data: { status: 'running' } });
    this.history.push({ role: 'user', content: data.content });

    let fullText = '';
    try {
      const contents = this.history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const response = await this.ai.models.generateContentStream({
        model: this.model,
        contents,
      });

      for await (const chunk of response) {
        if (this.aborted) break;
        const text = chunk.text ?? '';
        if (text) {
          fullText += text;
          this.emitter.emitMessage(this.conversation_id, {
            type: 'text',
            data: { content: text, msg_id: randomUUID() },
          });
        }
      }
    } catch (err) {
      const message = String(err);
      this.emitter.emitMessage(this.conversation_id, {
        type: 'text',
        data: { content: `错误：${message}\n`, msg_id: randomUUID() },
      });
    } finally {
      if (fullText) {
        this.history.push({ role: 'assistant', content: fullText });
      }
      this.status = 'finished';
      this.emitter.emitMessage(this.conversation_id, {
        type: 'status',
        data: { status: 'done' },
      });
    }
  }

  async stop(): Promise<void> {
    this.aborted = true;
    this.status = 'finished';
  }

  confirm(_msgId: string, _callId: string, _data: unknown): void {
    // No confirmation dialogs in CLI mode
  }

  getConfirmations(): IConfirmation[] {
    return [];
  }

  kill(): void {
    this.aborted = true;
  }
}
