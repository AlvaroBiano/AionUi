/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/dispatchMcpServerScript.ts
//
// Lightweight stdio MCP server for dispatch tools.
// Spawned as a child process by Gemini CLI via MCP config.
// Communicates with the main process via IPC (process.send/on).
//
// JSON-RPC 2.0 over stdio (MCP protocol).
//
// IMPORTANT: TOOL_SCHEMAS must stay in sync with DispatchMcpServer.getToolSchemas().
// When adding or modifying dispatch tools, update BOTH locations.

// Immediate startup log — must be BEFORE any async work
import * as _startupFs from 'node:fs';
_startupFs.appendFileSync(
  '/tmp/mcp-script-startup.log',
  `[${new Date().toISOString()}] MCP script started. PID=${process.pid} argv=${JSON.stringify(process.argv)} env.AIONUI_DISPATCH_SOCKET=${process.env.AIONUI_DISPATCH_SOCKET ?? 'undefined'}\n`,
);

const TOOL_SCHEMAS = [
  {
    name: 'start_task',
    description:
      'Start a new child task. Creates an independent agent session. Returns session_id. Maximum concurrent tasks per session constraints.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'Instructions for the child agent' },
        title: { type: 'string', description: 'Short task label (3-6 words)' },
        teammate: {
          type: 'object',
          description: 'Optional teammate config',
          properties: {
            name: { type: 'string' },
            avatar: { type: 'string' },
            presetRules: { type: 'string' },
          },
        },
        model: {
          type: 'object',
          description: 'Optional model override for the child agent',
          properties: {
            provider_id: { type: 'string', description: 'Provider ID' },
            model_name: { type: 'string', description: 'Model name' },
          },
          required: ['provider_id', 'model_name'],
        },
        workspace: {
          type: 'string',
          description:
            'Optional working directory for the child agent. Must be an existing directory. Omit to inherit parent workspace.',
        },
        agent_type: {
          type: 'string',
          description:
            'Engine type for the child agent. Options: gemini, acp, codex, openclaw-gateway, nanobot, remote. ' +
            'Defaults to gemini if omitted.',
          enum: ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote'],
        },
        member_id: {
          type: 'string',
          description: 'Reference an existing group member by ID. Auto-fills config from their profile.',
        },
        isolation: {
          type: 'string',
          description: 'Isolation mode for the child workspace. Currently only "worktree" is planned (G2).',
          enum: ['worktree'],
        },
        allowed_tools: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional allowlist of tool names this child can use (e.g., ["Read", "Edit", "Bash"]). ' +
            'Omit to allow all tools. Safe tools (Read, Grep, Glob) are always allowed.',
        },
      },
      required: ['prompt', 'title'],
    },
  },
  // Gap-5: start_code_task
  {
    name: 'start_code_task',
    description:
      'Start a code task with automatic git worktree isolation. ' +
      'Use instead of start_task when writing or modifying code.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'Instructions for the child agent' },
        title: { type: 'string', description: 'Short label (3-6 words)' },
        workspace: { type: 'string', description: 'Working directory (default: parent workspace)' },
        agent_type: {
          type: 'string',
          description: 'Engine type',
          enum: ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote'],
        },
        member_id: { type: 'string', description: 'Existing group member ID' },
      },
      required: ['prompt', 'title'],
    },
  },
  {
    name: 'read_transcript',
    description: 'Read conversation transcript of a child task. Waits for completion if running. Includes tool call summaries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID from start_task' },
        limit: { type: 'number', description: 'Max messages (default 20)' },
        max_wait_seconds: { type: 'number', description: 'Wait timeout (default 30)' },
        format: { type: 'string', enum: ['auto', 'full'] },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'list_sessions',
    description:
      'List all child sessions spawned by this dispatcher. ' +
      'Shows session ID, title, status (running/idle/cancelled/failed), and last activity time. ' +
      'Sorted by most recent activity first. Use session IDs with read_transcript or send_message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max sessions to return (default 20, most recent first)' },
      },
      required: [] as string[],
    },
  },
  {
    name: 'send_message',
    description:
      'Send a follow-up message to a child task. ' +
      'Works on running and idle tasks. Idle tasks will be automatically resumed. ' +
      'For new work, use start_task instead. ' +
      'Returns confirmation; use read_transcript to see the response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'session_id from start_task or list_sessions' },
        message: { type: 'string', description: 'The follow-up user message to send' },
      },
      required: ['session_id', 'message'],
    },
  },
  // G2.3: stop_child tool
  {
    name: 'stop_child',
    description:
      'Stop a running child task and clean up its resources (including worktree if any). ' +
      'The child process is killed immediately. Use read_transcript to see partial results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'The session_id of the child task to stop.' },
        reason: {
          type: 'string',
          description: 'Optional reason for stopping (logged and included in notification).',
        },
      },
      required: ['session_id'],
    },
  },
  // G2.4: ask_user tool
  {
    name: 'ask_user',
    description:
      'Ask the user a question when you cannot make a decision autonomously. ' +
      'The question is relayed to the group chat. ' +
      'Use sparingly -- only for critical decisions that require human judgment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'The question to ask the user.' },
        context: { type: 'string', description: 'Optional additional context.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of suggested answers.',
        },
      },
      required: ['question'],
    },
  },
  // G4.6: generate_plan tool
  {
    name: 'generate_plan',
    description:
      'Generate a structured execution plan before delegating tasks. ' +
      'Does NOT start any tasks. Returns a plan with phases, dependencies, and estimates. ' +
      'Use this for complex multi-step requests before calling start_task.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'The high-level task description from the user.' },
        constraints: { type: 'string', description: 'Optional constraints (time, cost, quality priorities).' },
      },
      required: ['task'],
    },
  },
  // Gap-3: send_user_message tool (channel isolation)
  {
    name: 'send_user_message',
    description:
      'Send a message to the user in the group chat. ' +
      'This is the ONLY way to communicate with the user when channel isolation is enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'The message to display to the user.' },
      },
      required: ['message'],
    },
  },
  // G4.7: save_memory tool
  {
    name: 'save_memory',
    description:
      'Save an important piece of information to persistent memory. ' +
      'Memories persist across sessions and are auto-loaded in future conversations. ' +
      'Use for: user preferences, project decisions, feedback, important references.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description: 'Memory category.',
        },
        title: { type: 'string', description: 'Short title for this memory entry.' },
        content: { type: 'string', description: 'The memory content to save.' },
      },
      required: ['type', 'title', 'content'],
    },
  },
];

import fs from 'node:fs';
import net from 'node:net';

let buffer = '';
let pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let requestIdCounter = 0;
let socketClient: net.Socket | null = null;
let socketBuffer = '';

/**
 * Send a JSON-RPC response to stdout.
 */
function sendResponse(id: string | number | null, result: unknown, error?: { code: number; message: string }): void {
  const response: Record<string, unknown> = { jsonrpc: '2.0', id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  const json = JSON.stringify(response);
  // Send both Content-Length framing (MCP standard) and newline (Gemini CLI compatibility)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\n`);
}

/**
 * Forward a tool call to the main process and wait for result.
 *
 * Communication channel priority:
 * 1. Unix domain socket (AIONUI_DISPATCH_SOCKET env var) — works with ALL agent types
 * 2. Node.js IPC channel (process.send) — only available with child_process.fork()
 *
 * The MCP SDK (StdioClientTransport) uses child_process.spawn() which does NOT
 * create an IPC channel. The Unix socket is the primary reliable communication path.
 */
function callMainProcess(tool: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = `mcp_${++requestIdCounter}`;
    pendingRequests.set(callId, { resolve, reject });

    const message = { type: 'tool_call', id: callId, tool, args };

    if (socketClient && !socketClient.destroyed) {
      // Primary path: Unix domain socket (works with all agent types)
      socketClient.write(JSON.stringify(message) + '\n');
    } else if (process.send) {
      // Legacy path: Node.js IPC channel (only available with fork)
      process.send(message);
    } else {
      pendingRequests.delete(callId);
      reject(new Error(`No IPC channel available for tool call: ${tool}. Socket not connected and process.send unavailable.`));
      return;
    }

    // Timeout after 120 seconds
    setTimeout(() => {
      if (pendingRequests.has(callId)) {
        pendingRequests.delete(callId);
        reject(new Error(`Tool call timeout: ${tool}`));
      }
    }, 120_000);
  });
}

/**
 * Handle incoming JSON-RPC request.
 */
async function handleRequest(request: { id: string | number | null; method: string; params?: unknown }): Promise<void> {
  const { id, method, params } = request;
  fs.appendFileSync('/tmp/mcp-script-debug.log', `[${new Date().toISOString()}] handleRequest: method=${method}, id=${id}\n`);

  switch (method) {
    case 'initialize': {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'aionui-dispatch', version: '1.0.0' },
      });
      break;
    }

    case 'notifications/initialized': {
      // Client acknowledged initialization, no response needed
      break;
    }

    case 'tools/list': {
      sendResponse(id, { tools: TOOL_SCHEMAS });
      break;
    }

    case 'tools/call': {
      const p = params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!p?.name) {
        sendResponse(id, null, { code: -32602, message: 'Missing tool name' });
        break;
      }
      try {
        const result = await callMainProcess(p.name, p.arguments ?? {});
        sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse(id, { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
      }
      break;
    }

    default: {
      if (id !== null && id !== undefined) {
        sendResponse(id, null, { code: -32601, message: `Method not found: ${method}` });
      }
    }
  }
}

/**
 * Parse JSON-RPC messages from stdin.
 * Supports both Content-Length framing (standard MCP) and newline-delimited JSON (Gemini CLI).
 */
function processBuffer(): void {
  while (true) {
    // Try Content-Length framing first
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (match) {
        const contentLength = parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + contentLength) break;

        const body = buffer.slice(bodyStart, bodyStart + contentLength);
        buffer = buffer.slice(bodyStart + contentLength);

        try {
          const request = JSON.parse(body);
          void handleRequest(request);
        } catch (err) {
          process.stderr.write(`[MCP Server Script] Failed to parse Content-Length message: ${err}\n`);
        }
        continue;
      }
    }

    // Fall back to newline-delimited JSON (Gemini CLI sends this format)
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex === -1) {
      // No newline yet — try to parse the entire buffer as a single JSON object
      // (handles case where message arrives without trailing newline)
      const trimmed = buffer.trim();
      if (trimmed && trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const request = JSON.parse(trimmed);
          buffer = '';
          void handleRequest(request);
          continue;
        } catch {
          // Incomplete JSON, wait for more data
        }
      }
      break;
    }

    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;

    try {
      const request = JSON.parse(line);
      void handleRequest(request);
    } catch (err) {
      process.stderr.write(`[MCP Server Script] Failed to parse NDJSON message: ${err}\n`);
    }
  }
}

/**
 * Handle a tool_result message from the main process (via socket or IPC).
 */
function handleToolResult(msg: { type: string; id: string; result?: unknown; error?: string }): void {
  if (msg.type === 'tool_result' && pendingRequests.has(msg.id)) {
    const pending = pendingRequests.get(msg.id)!;
    pendingRequests.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }
}

/**
 * Connect to the main process via Unix domain socket.
 * Returns a promise that resolves when connected.
 */
function connectSocket(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      socketClient = client;
      // Signal ready to main process
      client.write(JSON.stringify({ type: 'ready' }) + '\n');
      resolve();
    });

    client.on('data', (chunk) => {
      socketBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = socketBuffer.indexOf('\n')) !== -1) {
        const line = socketBuffer.slice(0, newlineIndex).trim();
        socketBuffer = socketBuffer.slice(newlineIndex + 1);
        if (line) {
          try {
            handleToolResult(JSON.parse(line));
          } catch {
            process.stderr.write(`[MCP Server Script] Failed to parse socket message: ${line.slice(0, 200)}\n`);
          }
        }
      }
    });

    client.on('error', (err) => {
      process.stderr.write(`[MCP Server Script] Socket error: ${err.message}\n`);
      if (!socketClient) reject(err);
    });

    client.on('close', () => {
      socketClient = null;
    });

    // Timeout connection attempt
    setTimeout(() => {
      if (!socketClient) {
        client.destroy();
        reject(new Error(`Socket connection timeout: ${socketPath}`));
      }
    }, 10_000);
  });
}

// Listen for IPC responses from main process (legacy fork path)
process.on('message', (msg: { type: string; id: string; result?: unknown; error?: string }) => {
  handleToolResult(msg);
});

// Read MCP JSON-RPC from stdin
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  fs.appendFileSync('/tmp/mcp-script-debug.log', `[${new Date().toISOString()}] stdin data: ${chunk.slice(0, 200)}\n`);
  buffer += chunk;
  processBuffer();
});

process.stdin.on('end', () => {
  if (socketClient) socketClient.destroy();
  process.exit(0);
});

// Initialize: connect via Unix socket if available, otherwise fall back to IPC
const dispatchSocketPath = process.env.AIONUI_DISPATCH_SOCKET;
if (dispatchSocketPath) {
  connectSocket(dispatchSocketPath).catch((err) => {
    process.stderr.write(`[MCP Server Script] Socket connect failed: ${err.message}, falling back to IPC\n`);
    // Fall back to IPC ready signal
    if (process.send) {
      process.send({ type: 'ready' });
    }
  });
} else if (process.send) {
  process.send({ type: 'ready' });
} else {
  process.stderr.write('[MCP Server Script] Warning: No IPC channel available (no socket path, no process.send)\n');
}
