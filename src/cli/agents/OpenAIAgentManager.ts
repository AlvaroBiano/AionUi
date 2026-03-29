/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAIAgentManager — standalone IAgentManager for OpenAI models.
 *
 * Uses the OpenAI SDK directly for GPT models, maintaining multi-turn
 * conversation history and streaming output via IAgentEventEmitter.
 */
import { randomUUID } from 'node:crypto';
import OpenAI, { AuthenticationError, RateLimitError, APIConnectionError } from 'openai';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter } from '@process/task/IAgentEventEmitter';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { AgentType, AgentStatus } from '@process/task/agentTypes';
import type { AgentConfig } from '../config/types';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export class OpenAIAgentManager implements IAgentManager {
  readonly type: AgentType = 'acp';
  status: AgentStatus | undefined = 'pending';
  readonly workspace: string;
  readonly conversation_id: string;

  private readonly client: OpenAI;
  private readonly model: string;
  private history: HistoryMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(
    conversationId: string,
    private readonly config: AgentConfig,
    private readonly emitter: IAgentEventEmitter,
    workspace?: string,
  ) {
    this.conversation_id = conversationId;
    this.workspace = workspace ?? process.cwd();
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'gpt-4o';
  }

  async sendMessage(data: { content: string }): Promise<void> {
    this.status = 'running';
    this.emitter.emitMessage(this.conversation_id, { type: 'status', data: { status: 'running' } });
    this.abortController = new AbortController();
    this.history.push({ role: 'user', content: data.content });

    let fullText = '';
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: this.history,
          stream: true,
        },
        { signal: this.abortController.signal },
      );

      for await (const chunk of stream) {
        if (this.abortController.signal.aborted) break;
        const text = chunk.choices[0]?.delta?.content ?? '';
        if (text) {
          fullText += text;
          this.emitter.emitMessage(this.conversation_id, {
            type: 'text',
            data: { content: text, msg_id: randomUUID() },
          });
        }
      }
    } catch (err) {
      let message: string;
      if (err instanceof AuthenticationError) {
        message = 'API Key 无效，请检查 OPENAI_API_KEY 环境变量';
      } else if (err instanceof RateLimitError) {
        message = '请求频率过高，请稍等片刻再试';
      } else if (err instanceof APIConnectionError) {
        message = '无法连接到 OpenAI API，请检查网络';
      } else {
        message = String(err);
      }
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
    this.abortController?.abort();
    this.status = 'finished';
  }

  confirm(_msgId: string, _callId: string, _data: unknown): void {
    // No confirmation dialogs in CLI mode
  }

  getConfirmations(): IConfirmation[] {
    return [];
  }

  kill(): void {
    this.abortController?.abort();
  }
}
