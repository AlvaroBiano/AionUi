/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchMcpServer.ts

import path from 'node:path';
import type {
  StartChildTaskParams,
  ReadTranscriptOptions,
  TranscriptResult,
  ChildTaskInfo,
  SendMessageToChildParams,
  ListSessionsParams,
} from './dispatchTypes';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Tool handler interface that the DispatchAgentManager implements.
 * The MCP server delegates tool calls to these handlers.
 */
export type DispatchToolHandler = {
  parentSessionId: string;
  startChildSession(params: StartChildTaskParams): Promise<string>;
  readTranscript(options: ReadTranscriptOptions): Promise<TranscriptResult>;
  listChildren(): Promise<ChildTaskInfo[]>;
  // Phase 2a additions:
  sendMessageToChild(params: SendMessageToChildParams): Promise<string>;
  listSessions(params: ListSessionsParams): Promise<string>;
};

/**
 * Manages a dispatch MCP server child process.
 * The MCP server provides start_task, read_transcript, send_message,
 * and list_sessions tools to the Gemini CLI running in the dispatcher worker.
 *
 * Architecture:
 *   [Gemini CLI Worker] <--stdio MCP--> [MCP Server Process] <--IPC--> [Main Process (handler)]
 */
export class DispatchMcpServer {
  private handler: DispatchToolHandler;
  private disposed = false;

  constructor(handler: DispatchToolHandler) {
    this.handler = handler;
  }

  /**
   * Handle a tool call from the MCP server child process.
   * This is called via IPC when the Gemini CLI invokes an MCP tool.
   */
  async handleToolCall(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) {
      throw new Error('MCP server has been disposed');
    }

    switch (tool) {
      case 'start_task': {
        const params: StartChildTaskParams = {
          prompt: String(args.prompt ?? ''),
          title: String(args.title ?? 'Untitled Task'),
        };

        // Parse teammate config if provided
        if (args.teammate && typeof args.teammate === 'object') {
          const t = args.teammate as Record<string, unknown>;
          params.teammate = {
            id: String(t.id ?? `teammate_${Date.now()}`),
            name: String(t.name ?? 'Assistant'),
            avatar: t.avatar ? String(t.avatar) : undefined,
            presetRules: t.presetRules ? String(t.presetRules) : undefined,
            agentType: 'gemini',
            createdAt: Date.now(),
          };
        }

        // F-6.1: Parse workspace override if provided
        if (typeof args.workspace === 'string' && args.workspace.trim()) {
          params.workspace = args.workspace.trim();
        }

        // F-4.2: Parse model override if provided
        if (args.model && typeof args.model === 'object') {
          const m = args.model as Record<string, unknown>;
          const providerId = String(m.provider_id ?? '').trim();
          const modelName = String(m.model_name ?? '').trim();
          if (providerId && modelName) {
            params.model = { providerId, modelName };
          }
        }

        const sessionId = await this.handler.startChildSession(params);
        const children = await this.handler.listChildren();
        const existingList = children.map((c) => `- ${c.title} (${c.sessionId}): ${c.status}`).join('\n');

        return {
          session_id: sessionId,
          message: `Task started. Session ID: ${sessionId}\n\nExisting tasks:\n${existingList}`,
        };
      }

      case 'read_transcript': {
        const options: ReadTranscriptOptions = {
          sessionId: String(args.session_id ?? ''),
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          maxWaitSeconds: typeof args.max_wait_seconds === 'number' ? args.max_wait_seconds : undefined,
          format: args.format === 'full' ? 'full' : 'auto',
        };

        const result = await this.handler.readTranscript(options);
        return {
          session_id: result.sessionId,
          title: result.title,
          status: result.status,
          is_running: result.isRunning,
          transcript: result.transcript,
        };
      }

      // F-2.2: list_sessions replaces list_children
      case 'list_sessions': {
        mainLog('[DispatchMcpServer:list_sessions]', `parentId=${this.handler.parentSessionId}`);
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        const result = await this.handler.listSessions({ limit });
        mainLog('[DispatchMcpServer:list_sessions]', `success, parentId=${this.handler.parentSessionId}`);
        return { content: [{ type: 'text', text: result }] };
      }

      // C-PM-2a-008: Keep list_children as deprecated alias
      case 'list_children': {
        mainWarn('[DispatchMcpServer:list_children]', 'Deprecated: use list_sessions instead');
        const result = await this.handler.listSessions({ limit: 20 });
        return { content: [{ type: 'text', text: result }] };
      }

      // F-2.1: send_message tool
      case 'send_message': {
        const sessionId = String(args.session_id ?? '');
        const message = String(args.message ?? '');
        mainLog(
          '[DispatchMcpServer:send_message]',
          `received: childId=${sessionId}, parentId=${this.handler.parentSessionId}`
        );

        if (!sessionId || !message) {
          return {
            content: 'session_id and message are required',
            isError: true,
          };
        }

        try {
          const resultMsg = await this.handler.sendMessageToChild({
            sessionId,
            message,
          });
          mainLog('[DispatchMcpServer:send_message]', `success: childId=${sessionId}`);
          return {
            session_id: sessionId,
            message: resultMsg,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          mainWarn('[DispatchMcpServer:send_message]', `failed: childId=${sessionId}, error=${errMsg}`);
          return {
            content: `Failed to send message: ${errMsg}`,
            isError: true,
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  /**
   * Get MCP server configuration for Gemini CLI.
   * Returns the command/args to start the inline MCP server script.
   */
  getMcpServerConfig(): { command: string; args: string[]; env: Record<string, string> } {
    return {
      command: process.execPath,
      args: [path.resolve(__dirname, 'dispatchMcpServerScript.js'), this.handler.parentSessionId],
      env: {},
    };
  }

  /**
   * Get the tool schemas for MCP registration.
   *
   * IMPORTANT: Keep in sync with TOOL_SCHEMAS in dispatchMcpServerScript.ts.
   * When adding or modifying dispatch tools, update BOTH locations.
   */
  static getToolSchemas(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'start_task',
        description:
          'Start a new child task. Creates an independent agent session that executes the given prompt. ' +
          'Returns a session_id for tracking. Maximum concurrent tasks per session constraints.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed instructions for the child agent. Be specific and self-contained.',
            },
            title: {
              type: 'string',
              description: 'Short label for the task (3-6 words), shown in the UI status card.',
            },
            teammate: {
              type: 'object',
              description: 'Optional teammate configuration for the child agent.',
              properties: {
                name: { type: 'string', description: 'Display name for the teammate' },
                avatar: { type: 'string', description: 'Avatar emoji or URL' },
                presetRules: {
                  type: 'string',
                  description: 'System instructions for the child agent',
                },
              },
            },
            model: {
              type: 'object',
              description: 'Optional model override for this child agent. Omit to use the default dispatcher model.',
              properties: {
                provider_id: {
                  type: 'string',
                  description: 'Provider ID from the configured model list',
                },
                model_name: {
                  type: 'string',
                  description: 'Model name (e.g., "gemini-2.5-pro", "gemini-2.0-flash")',
                },
              },
              required: ['provider_id', 'model_name'],
            },
            workspace: {
              type: 'string',
              description:
                'Optional working directory for the child agent. Must be an existing directory. Omit to inherit parent workspace.',
            },
          },
          required: ['prompt', 'title'],
        },
      },
      {
        name: 'read_transcript',
        description:
          'Read the conversation transcript of a child task. ' +
          'If the task is still running, waits up to max_wait_seconds for completion. ' +
          'Returns formatted [user]/[assistant] conversation text.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'The session ID returned by start_task.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to return. Default 20.',
            },
            max_wait_seconds: {
              type: 'number',
              description: 'Seconds to wait for task completion. Default 30. Use 0 for immediate return.',
            },
            format: {
              type: 'string',
              enum: ['auto', 'full'],
              description:
                'Output format. "auto" returns summary when running, full when done. "full" always returns full transcript.',
            },
          },
          required: ['session_id'],
        },
      },
      // F-2.2: list_sessions replaces list_children
      {
        name: 'list_sessions',
        description:
          'List all child sessions spawned by this dispatcher. ' +
          'Shows session ID, title, status (running/idle/cancelled/failed), and last activity time. ' +
          'Sorted by most recent activity first. Use session IDs with read_transcript or send_message.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max sessions to return (default 20, most recent first)',
            },
          },
          required: [],
        },
      },
      // F-2.1: send_message tool
      {
        name: 'send_message',
        description:
          'Send a follow-up message to a child task. ' +
          'Works on running and idle tasks. Idle tasks will be automatically resumed. ' +
          'For new work, use start_task instead. ' +
          'Returns confirmation; use read_transcript to see the response.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'session_id from start_task or list_sessions',
            },
            message: {
              type: 'string',
              description: 'The follow-up user message to send',
            },
          },
          required: ['session_id', 'message'],
        },
      },
    ];
  }

  /**
   * Dispose the MCP server and release resources.
   */
  dispose(): void {
    this.disposed = true;
    mainLog('[DispatchMcpServer]', `Disposed for session: ${this.handler.parentSessionId}`);
  }
}
