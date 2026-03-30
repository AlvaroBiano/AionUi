/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchMcpServer.ts

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
 *
 * Tools match CC's dispatch tool set:
 * start_task, start_code_task, read_transcript, list_sessions,
 * send_message, stop_child, send_user_message
 */
export type DispatchToolHandler = {
  parentSessionId: string;
  startChildSession(params: StartChildTaskParams): Promise<string>;
  readTranscript(options: ReadTranscriptOptions): Promise<TranscriptResult>;
  listChildren(): Promise<ChildTaskInfo[]>;
  sendMessageToChild(params: SendMessageToChildParams): Promise<string>;
  listSessions(params: ListSessionsParams): Promise<string>;
  stopChild(sessionId: string, reason?: string): Promise<string>;
  sendUserMessage?(message: string): Promise<string>;
};

/**
 * Dispatch MCP tool handler.
 * Receives tool calls from the HTTP MCP server and delegates to DispatchAgentManager.
 */
export class DispatchMcpServer {
  private handler: DispatchToolHandler;
  private disposed = false;

  constructor(handler: DispatchToolHandler) {
    this.handler = handler;
  }

  /**
   * Handle a tool call from the MCP transport.
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

        if (typeof args.agent_type === 'string' && args.agent_type.trim()) {
          params.agent_type = args.agent_type.trim() as (typeof params)['agent_type'];
        }

        if (typeof args.member_id === 'string' && args.member_id.trim()) {
          params.member_id = args.member_id.trim();
        }

        if (args.isolation === 'worktree') {
          params.isolation = 'worktree';
        }

        if (args.teammate && typeof args.teammate === 'object') {
          const t = args.teammate as Record<string, unknown>;
          params.teammate = {
            id: String(t.id ?? `teammate_${Date.now()}`),
            name: String(t.name ?? 'Assistant'),
            avatar: t.avatar ? String(t.avatar) : undefined,
            presetRules: t.presetRules ? String(t.presetRules) : undefined,
            agentType: params.agent_type || 'gemini',
            createdAt: Date.now(),
          };
        }

        if (typeof args.workspace === 'string' && args.workspace.trim()) {
          params.workspace = args.workspace.trim();
        }

        if (args.model && typeof args.model === 'object') {
          const m = args.model as Record<string, unknown>;
          const providerId = String(m.provider_id ?? '').trim();
          const modelName = String(m.model_name ?? '').trim();
          if (providerId && modelName) {
            params.model = { providerId, modelName };
          }
        }

        if (Array.isArray(args.allowed_tools)) {
          params.allowedTools = args.allowed_tools.map(String).filter(Boolean);
        }

        const sessionId = await this.handler.startChildSession(params);
        const children = await this.handler.listChildren();
        const existingList = children.map((c) => `- ${c.title} (${c.sessionId}): ${c.status}`).join('\n');

        return {
          session_id: sessionId,
          message: `Task started. Session ID: ${sessionId}\n\nExisting tasks:\n${existingList}`,
        };
      }

      case 'start_code_task': {
        const params: StartChildTaskParams = {
          prompt: String(args.prompt ?? ''),
          title: String(args.title ?? 'Code Task'),
          isolation: 'worktree',
        };

        if (typeof args.workspace === 'string' && args.workspace.trim()) {
          params.workspace = args.workspace.trim();
        }

        if (typeof args.agent_type === 'string' && args.agent_type.trim()) {
          params.agent_type = args.agent_type.trim() as (typeof params)['agent_type'];
        }

        if (typeof args.member_id === 'string' && args.member_id.trim()) {
          params.member_id = args.member_id.trim();
        }

        if (args.teammate && typeof args.teammate === 'object') {
          const t = args.teammate as Record<string, unknown>;
          params.teammate = {
            id: String(t.id ?? `teammate_${Date.now()}`),
            name: String(t.name ?? 'Coder'),
            avatar: t.avatar ? String(t.avatar) : undefined,
            presetRules: t.presetRules ? String(t.presetRules) : undefined,
            agentType: params.agent_type || 'gemini',
            createdAt: Date.now(),
          };
        }

        const sessionId = await this.handler.startChildSession(params);
        const children = await this.handler.listChildren();
        const existingList = children.map((c) => `- ${c.title} (${c.sessionId}): ${c.status}`).join('\n');

        return {
          session_id: sessionId,
          message: `Code task started with worktree isolation. Session ID: ${sessionId}\n\nExisting tasks:\n${existingList}`,
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

      case 'list_sessions': {
        mainLog('[DispatchMcpServer:list_sessions]', `parentId=${this.handler.parentSessionId}`);
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        const result = await this.handler.listSessions({ limit });
        mainLog('[DispatchMcpServer:list_sessions]', `success, parentId=${this.handler.parentSessionId}`);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'send_message': {
        const sessionId = String(args.session_id ?? '');
        const message = String(args.message ?? '');
        mainLog(
          '[DispatchMcpServer:send_message]',
          `received: childId=${sessionId}, parentId=${this.handler.parentSessionId}`
        );

        if (!sessionId || !message) {
          return { content: 'session_id and message are required', isError: true };
        }

        try {
          const resultMsg = await this.handler.sendMessageToChild({ sessionId, message });
          mainLog('[DispatchMcpServer:send_message]', `success: childId=${sessionId}`);
          return { session_id: sessionId, message: resultMsg };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          mainWarn('[DispatchMcpServer:send_message]', `failed: childId=${sessionId}, error=${errMsg}`);
          return { content: `Failed to send message: ${errMsg}`, isError: true };
        }
      }

      case 'stop_child': {
        const sessionId = String(args.session_id ?? '');
        const reason = typeof args.reason === 'string' ? args.reason : undefined;

        if (!sessionId) {
          return { content: 'session_id is required', isError: true };
        }

        try {
          const result = await this.handler.stopChild(sessionId, reason);
          return { session_id: sessionId, message: result };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { content: `Failed to stop child: ${errMsg}`, isError: true };
        }
      }

      case 'send_user_message': {
        const message = String(args.message ?? '');
        if (!message) {
          return { content: 'message is required', isError: true };
        }
        if (!this.handler.sendUserMessage) {
          return { content: 'send_user_message not supported', isError: true };
        }
        try {
          const result = await this.handler.sendUserMessage(message);
          return { message: result };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { content: `Failed to send message: ${errMsg}`, isError: true };
        }
      }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  /**
   * Get the tool schemas for MCP registration.
   * Matches CC's dispatch tool set.
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
          'Start a new isolated task session. Creates an independent agent that executes the given prompt. ' +
          'Returns a session_id for tracking.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed instructions for the child agent. Be specific and self-contained.',
            },
            title: {
              type: 'string',
              description: 'Short label for the task (3-6 words).',
            },
            teammate: {
              type: 'object',
              description: 'Optional teammate configuration for the child agent.',
              properties: {
                name: { type: 'string', description: 'Display name for the teammate' },
                avatar: { type: 'string', description: 'Avatar emoji or URL' },
                presetRules: { type: 'string', description: 'System instructions for the child agent' },
              },
            },
            model: {
              type: 'object',
              description: 'Optional model override for this child agent.',
              properties: {
                provider_id: { type: 'string', description: 'Provider ID' },
                model_name: { type: 'string', description: 'Model name' },
              },
              required: ['provider_id', 'model_name'],
            },
            workspace: {
              type: 'string',
              description: 'Optional working directory. Omit to inherit parent workspace.',
            },
            agent_type: {
              type: 'string',
              description: 'Engine type for the child agent.',
              enum: ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote'],
            },
            member_id: {
              type: 'string',
              description: 'Reference an existing group member by ID.',
            },
            isolation: {
              type: 'string',
              description: 'Isolation mode. "worktree" creates a git worktree for the child.',
              enum: ['worktree'],
            },
            allowed_tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional allowlist of tool names this child can use.',
            },
          },
          required: ['prompt', 'title'],
        },
      },
      {
        name: 'start_code_task',
        description:
          'Start a child task for code work with automatic git worktree isolation. ' +
          'Use this instead of start_task when the task involves writing or modifying code.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Detailed instructions for the child agent.' },
            title: { type: 'string', description: 'Short label for the task (3-6 words).' },
            workspace: { type: 'string', description: 'Working directory. Defaults to parent workspace.' },
            agent_type: {
              type: 'string',
              description: 'Engine type for the child agent.',
              enum: ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote'],
            },
            member_id: { type: 'string', description: 'Reference an existing group member by ID.' },
            teammate: {
              type: 'object',
              description: 'Optional teammate configuration.',
              properties: {
                name: { type: 'string', description: 'Display name' },
                avatar: { type: 'string', description: 'Avatar emoji or URL' },
                presetRules: { type: 'string', description: 'System instructions' },
              },
            },
          },
          required: ['prompt', 'title'],
        },
      },
      {
        name: 'read_transcript',
        description:
          'Read the conversation transcript of a task session. ' +
          'If the task is still running, waits up to max_wait_seconds for completion.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: { type: 'string', description: 'The session ID returned by start_task.' },
            limit: { type: 'number', description: 'Maximum number of messages to return. Default 20.' },
            max_wait_seconds: { type: 'number', description: 'Seconds to wait for task completion. Default 30.' },
            format: {
              type: 'string',
              enum: ['auto', 'full'],
              description: '"auto" returns summary when running, full when done. "full" always returns full transcript.',
            },
          },
          required: ['session_id'],
        },
      },
      {
        name: 'list_sessions',
        description:
          'List all task sessions. Shows session ID, title, status, and last activity time. ' +
          'Use session IDs with read_transcript or send_message.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max sessions to return (default 20, most recent first)' },
          },
          required: [],
        },
      },
      {
        name: 'send_message',
        description:
          'Send a follow-up message to a task session. ' +
          'Works on running and idle tasks. Idle tasks will be automatically resumed.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: { type: 'string', description: 'session_id from start_task or list_sessions' },
            message: { type: 'string', description: 'The follow-up message to send' },
          },
          required: ['session_id', 'message'],
        },
      },
      {
        name: 'stop_child',
        description:
          'Stop a running task and clean up its resources. ' +
          'Use read_transcript to see partial results.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: { type: 'string', description: 'The session_id of the task to stop.' },
            reason: { type: 'string', description: 'Optional reason for stopping.' },
          },
          required: ['session_id'],
        },
      },
      {
        name: 'send_user_message',
        description:
          'Send a message to the user in the group chat. ' +
          'This is the ONLY way to communicate with the user. ' +
          'Your plain text replies are internal reasoning and NOT shown to the user.',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to display to the user.' },
          },
          required: ['message'],
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
