/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CliAgentManager — standalone IAgentManager for the Aion CLI.
 *
 * Unlike the Electron-coupled agent managers (GeminiAgentManager, AcpAgentManager),
 * this implementation:
 *   - Has zero Electron / IPC dependencies
 *   - Communicates results via an injected IAgentEventEmitter (typically a CaptureEmitter
 *     from SubTaskSession, or a passthrough emitter in solo mode)
 *   - Uses the Anthropic SDK directly for Claude models (already a project dependency)
 *   - Maintains multi-turn conversation history for follow-up messages (消息续发)
 *   - Supports tool use (bash) so agents can read files, run commands, etc.
 */
import { randomUUID } from 'node:crypto';
import Anthropic, {
  AuthenticationError,
  RateLimitError,
  APIConnectionError,
  InternalServerError,
} from '@anthropic-ai/sdk';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter } from '@process/task/IAgentEventEmitter';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { AgentType, AgentStatus } from '@process/task/agentTypes';
import type { AgentConfig } from '../config/types';
import { ANTHROPIC_BASH_TOOL, executeToolCall } from './toolExecutor';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export class CliAgentManager implements IAgentManager {
  // IAgentManager requires AgentType; 'acp' is the most generic non-Gemini type
  readonly type: AgentType = 'acp';
  status: AgentStatus | undefined = 'pending';
  readonly workspace: string;
  readonly conversation_id: string;

  private readonly client: Anthropic;
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
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.systemPrompt = systemPrompt ?? '';
  }

  async sendMessage(data: { content: string }): Promise<void> {
    this.status = 'running';
    this.emitter.emitMessage(this.conversation_id, { type: 'status', data: { status: 'running' } });
    this.abortController = new AbortController();

    // Build local messages array for the tool-use loop (do NOT mutate this.history yet)
    const messages: Anthropic.MessageParam[] = [
      ...this.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: data.content },
    ];

    let fullText = '';
    try {
      let continueLoop = true;

      while (continueLoop && !this.abortController.signal.aborted) {
        // Stream the response — text chunks are emitted immediately
        const stream = this.client.messages.stream({
          model: this.config.model,
          max_tokens: 8192,
          ...(this.systemPrompt ? { system: this.systemPrompt } : {}),
          messages,
          tools: [ANTHROPIC_BASH_TOOL],
        });

        for await (const chunk of stream) {
          if (this.abortController.signal.aborted) break;
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const text = chunk.delta.text;
            fullText += text;
            this.emitter.emitMessage(this.conversation_id, {
              type: 'text',
              data: { content: text, msg_id: randomUUID() },
            });
          }
        }

        if (this.abortController.signal.aborted) break;

        const finalMsg = await stream.finalMessage();
        messages.push({ role: 'assistant', content: finalMsg.content });

        // Collect and execute any tool calls from this turn
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of finalMsg.content) {
          if (block.type === 'tool_use') {
            const cmd = (block.input as { command?: string }).command ?? '';
            this.emitter.emitMessage(this.conversation_id, {
              type: 'text',
              data: { content: `\x1b[2m[bash: ${cmd}]\x1b[0m\n`, msg_id: randomUUID() },
            });
            const result = executeToolCall(
              block.name,
              block.input as Record<string, unknown>,
              this.workspace,
            );
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }

        if (toolResults.length > 0 && !this.abortController.signal.aborted) {
          messages.push({ role: 'user', content: toolResults });
        } else {
          continueLoop = false;
        }
      }
    } catch (err) {
      let message: string;
      if (err instanceof AuthenticationError) {
        message = 'Invalid API key — check ANTHROPIC_API_KEY';
      } else if (err instanceof RateLimitError) {
        message = 'Rate limit exceeded — please wait and retry';
      } else if (err instanceof APIConnectionError) {
        message = 'Cannot connect to Anthropic API — check your network';
      } else if (err instanceof InternalServerError) {
        message = 'Anthropic service temporarily unavailable — retry later';
      } else {
        message = String(err);
      }
      this.emitter.emitMessage(this.conversation_id, {
        type: 'text',
        data: { content: `Error: ${message}\n`, msg_id: randomUUID() },
      });
    } finally {
      // Persist simplified history for multi-turn continuity
      this.history.push({ role: 'user', content: data.content });
      if (fullText) {
        this.history.push({ role: 'assistant', content: fullText });
      }
      this.status = 'finished';
      // Signal turn completion — CaptureEmitter watches for this
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
