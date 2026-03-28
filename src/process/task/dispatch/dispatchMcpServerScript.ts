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

const TOOL_SCHEMAS = [
  {
    name: 'start_task',
    description: 'Start a new child task. Creates an independent agent session. Returns session_id. Max 3 concurrent.',
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
      },
      required: ['prompt', 'title'],
    },
  },
  {
    name: 'read_transcript',
    description: 'Read conversation transcript of a child task. Waits for completion if running.',
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
];

let buffer = '';
let pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let requestIdCounter = 0;

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
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

/**
 * Forward a tool call to the main process via IPC and wait for result.
 *
 * CR-008: When launched via spawn() (no IPC channel), falls back to writing
 * the tool call request to stderr as a JSON envelope. The parent process
 * (DispatchAgentManager) monitors stderr for these messages and responds
 * via stdin. This ensures the MCP server works regardless of whether
 * Gemini CLI uses fork() or spawn() to start it.
 */
function callMainProcess(tool: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = `mcp_${++requestIdCounter}`;
    pendingRequests.set(callId, { resolve, reject });

    const message = { type: 'tool_call', id: callId, tool, args };

    if (process.send) {
      // Primary path: Node.js IPC channel (fork)
      process.send(message);
    } else {
      // Fallback path: write to stderr as JSON envelope (spawn)
      // The parent process reads stderr and responds via a separate channel.
      process.stderr.write(`__DISPATCH_IPC__${JSON.stringify(message)}__DISPATCH_IPC_END__\n`);
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
 * Parse JSON-RPC messages from stdin (Content-Length framing).
 */
function processBuffer(): void {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    try {
      const request = JSON.parse(body);
      void handleRequest(request);
    } catch (err) {
      process.stderr.write(`[MCP Server Script] Failed to parse JSON-RPC message: ${err}\n`);
    }
  }
}

// Listen for IPC responses from main process
process.on('message', (msg: { type: string; id: string; result?: unknown; error?: string }) => {
  if (msg.type === 'tool_result' && pendingRequests.has(msg.id)) {
    const pending = pendingRequests.get(msg.id)!;
    pendingRequests.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }
});

// Read stdin
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  processBuffer();
});

process.stdin.on('end', () => {
  process.exit(0);
});

// Signal ready to parent
if (process.send) {
  process.send({ type: 'ready' });
} else {
  // CR-008 fallback: signal ready via stderr when no IPC channel
  process.stderr.write(`__DISPATCH_IPC__${JSON.stringify({ type: 'ready' })}__DISPATCH_IPC_END__\n`);
}
