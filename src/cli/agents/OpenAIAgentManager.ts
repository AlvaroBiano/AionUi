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
 * Supports function calling (bash tool) so agents can read files and run commands.
 */
import { randomUUID } from 'node:crypto';
import OpenAI, { AuthenticationError, RateLimitError, APIConnectionError } from 'openai';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter } from '@process/task/IAgentEventEmitter';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { AgentType, AgentStatus } from '@process/task/agentTypes';
import type { AgentConfig } from '../config/types';
import { OPENAI_BASH_TOOL, executeToolCall } from './toolExecutor';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export class OpenAIAgentManager implements IAgentManager {
  readonly type: AgentType = 'acp';
  status: AgentStatus | undefined = 'pending';
  readonly workspace: string;
  readonly conversation_id: string;

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly systemPrompt: string;
  private history: HistoryMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(
    conversationId: string,
    private readonly config: AgentConfig,
    private readonly emitter: IAgentEventEmitter,
    workspace?: string,
    systemPrompt?: string,
  ) {
    this.conversation_id = conversationId;
    this.workspace = workspace ?? process.cwd();
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'gpt-4o';
    this.systemPrompt = systemPrompt ?? '';
  }

  async sendMessage(data: { content: string }): Promise<void> {
    this.status = 'running';
    this.emitter.emitMessage(this.conversation_id, { type: 'status', data: { status: 'running' } });
    this.abortController = new AbortController();

    // Build local messages array — system prompt + history + new user turn
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(this.systemPrompt ? [{ role: 'system' as const, content: this.systemPrompt }] : []),
      ...this.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: data.content },
    ];

    let fullText = '';
    try {
      let continueLoop = true;

      while (continueLoop && !this.abortController.signal.aborted) {
        const response = await this.client.chat.completions.create(
          {
            model: this.model,
            messages,
            tools: [OPENAI_BASH_TOOL],
            tool_choice: 'auto',
            stream: false,
          },
          { signal: this.abortController.signal },
        );

        const choice = response.choices[0];
        if (!choice) break;

        const assistantMessage = choice.message;

        if (assistantMessage.content) {
          fullText += assistantMessage.content;
          this.emitter.emitMessage(this.conversation_id, {
            type: 'text',
            data: { content: assistantMessage.content, msg_id: randomUUID() },
          });
        }

        messages.push(assistantMessage);

        if (choice.finish_reason === 'tool_calls' && assistantMessage.tool_calls?.length) {
          for (const call of assistantMessage.tool_calls) {
            if (call.type !== 'function') continue;
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(call.function.arguments) as Record<string, unknown>;
            } catch {
              // malformed JSON args — skip
            }
            const cmd = String(input.command ?? '');
            this.emitter.emitMessage(this.conversation_id, {
              type: 'text',
              data: { content: `\x1b[2m[bash: ${cmd}]\x1b[0m\n`, msg_id: randomUUID() },
            });
            const result = executeToolCall(call.function.name, input, this.workspace);
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: result,
            });
          }
          // If only non-function tool calls existed, don't loop forever
          if (!assistantMessage.tool_calls.some((c) => c.type === 'function')) {
            continueLoop = false;
          }
        } else {
          continueLoop = false;
        }
      }
    } catch (err) {
      let message: string;
      if (err instanceof AuthenticationError) {
        message = 'Invalid API key — check OPENAI_API_KEY';
      } else if (err instanceof RateLimitError) {
        message = 'Rate limit exceeded — please wait and retry';
      } else if (err instanceof APIConnectionError) {
        message = 'Cannot connect to OpenAI API — check your network';
      } else {
        message = String(err);
      }
      this.emitter.emitMessage(this.conversation_id, {
        type: 'text',
        data: { content: `Error: ${message}\n`, msg_id: randomUUID() },
      });
    } finally {
      this.history.push({ role: 'user', content: data.content });
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
