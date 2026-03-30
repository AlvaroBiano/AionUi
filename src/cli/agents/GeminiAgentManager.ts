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
 * Supports function calling (bash tool) so agents can read files and run commands.
 */
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter } from '@process/task/IAgentEventEmitter';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { AgentType, AgentStatus } from '@process/task/agentTypes';
import type { AgentConfig } from '../config/types';
import { GEMINI_BASH_DECLARATION, executeToolCall } from './toolExecutor';

type HistoryMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };

export class GeminiAgentManager implements IAgentManager {
  readonly type: AgentType = 'acp';
  status: AgentStatus | undefined = 'pending';
  readonly workspace: string;
  readonly conversation_id: string;

  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly systemPrompt: string;
  private history: HistoryMessage[] = [];
  private aborted = false;

  constructor(
    conversationId: string,
    private readonly config: AgentConfig,
    private readonly emitter: IAgentEventEmitter,
    workspace?: string,
    systemPrompt?: string,
  ) {
    this.conversation_id = conversationId;
    this.workspace = workspace ?? process.cwd();
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'gemini-2.0-flash';
    this.systemPrompt = systemPrompt ?? '';
  }

  async sendMessage(data: { content: string }): Promise<void> {
    this.status = 'running';
    this.aborted = false;
    this.emitter.emitMessage(this.conversation_id, { type: 'status', data: { status: 'running' } });

    // Build local contents array for the tool-use loop
    const contents: HistoryMessage[] = [
      ...this.history,
      { role: 'user', parts: [{ text: data.content }] },
    ];

    let fullText = '';
    try {
      let continueLoop = true;

      while (continueLoop && !this.aborted) {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents,
          config: {
            ...(this.systemPrompt ? { systemInstruction: this.systemPrompt } : {}),
            tools: [{ functionDeclarations: [GEMINI_BASH_DECLARATION] }],
          },
        });

        const candidate = response.candidates?.[0];
        if (!candidate) break;

        const parts = candidate.content?.parts ?? [];
        let hasFunctionCall = false;
        const functionResponses: Array<{ functionResponse: { name: string; response: { output: string } } }> = [];

        for (const part of parts) {
          if (part.text) {
            fullText += part.text;
            this.emitter.emitMessage(this.conversation_id, {
              type: 'text',
              data: { content: part.text, msg_id: randomUUID() },
            });
          }
          if (part.functionCall) {
            hasFunctionCall = true;
            const name = part.functionCall.name ?? '';
            const args = (part.functionCall.args ?? {}) as Record<string, unknown>;
            const cmd = String(args.command ?? '');
            this.emitter.emitMessage(this.conversation_id, {
              type: 'text',
              data: { content: `\x1b[2m[bash: ${cmd}]\x1b[0m\n`, msg_id: randomUUID() },
            });
            const result = executeToolCall(name, args, this.workspace);
            functionResponses.push({
              functionResponse: { name, response: { output: result } },
            });
          }
        }

        // Add assistant turn to contents
        if (candidate.content) {
          contents.push({ role: 'model', parts: candidate.content.parts as Array<{ text: string }> });
        }

        if (hasFunctionCall && functionResponses.length > 0 && !this.aborted) {
          contents.push({ role: 'user', parts: functionResponses as unknown as Array<{ text: string }> });
        } else {
          continueLoop = false;
        }
      }
    } catch (err) {
      const message = String(err);
      this.emitter.emitMessage(this.conversation_id, {
        type: 'text',
        data: { content: `Error: ${message}\n`, msg_id: randomUUID() },
      });
    } finally {
      // Persist simplified history for multi-turn continuity
      this.history.push({ role: 'user', parts: [{ text: data.content }] });
      if (fullText) {
        this.history.push({ role: 'model', parts: [{ text: fullText }] });
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
