/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * HTTP MCP server for dispatch (aionui-team) tools.
 *
 * Runs directly in the main process — no child process, no Unix socket.
 * Agent CLIs (Gemini, Claude, Codex, etc.) connect to it via HTTP MCP transport.
 */

import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { DispatchMcpServer } from './DispatchMcpServer';

const MCP_SERVER_NAME = 'aionui-team';

/**
 * HTTP-based MCP server that exposes dispatch tools to any agent CLI.
 * One instance per dispatch conversation (group chat).
 */
export class DispatchHttpMcpServer {
  private httpServer: http.Server | null = null;
  private mcpServer: McpServer | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private disposed = false;

  /** The URL agent CLIs should connect to */
  url: string = '';

  /** The port the server is listening on */
  port: number = 0;

  constructor(
    private readonly conversationId: string,
    private readonly toolHandler: DispatchMcpServer,
  ) {}

  /**
   * Start the HTTP MCP server on a random available port.
   */
  async start(): Promise<void> {
    if (this.disposed) return;

    // Create MCP server with tool schemas
    this.mcpServer = new McpServer(
      { name: MCP_SERVER_NAME, version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    // Register all dispatch tools
    this.registerTools();

    // Create HTTP server
    this.httpServer = http.createServer();

    // Create transport (stateless — each request is independent)
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    // Connect MCP server to transport
    await this.mcpServer.connect(this.transport);

    // Route HTTP requests to MCP transport
    this.httpServer.on('request', async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!this.transport) {
        res.writeHead(503);
        res.end('MCP server not ready');
        return;
      }

      try {
        await this.transport.handleRequest(req, res);
      } catch (err) {
        mainError('[DispatchHttpMcpServer]', `Request handling error: ${err}`);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal server error');
        }
      }
    });

    // Listen on random port (0 = OS assigns)
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(0, '127.0.0.1', () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.url = `http://127.0.0.1:${this.port}/mcp`;
          mainLog('[DispatchHttpMcpServer]', `Started on ${this.url} for conversation ${this.conversationId}`);
        }
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  /**
   * Register all dispatch tools on the MCP server.
   */
  private registerTools(): void {
    if (!this.mcpServer) return;

    const schemas = DispatchMcpServer.getToolSchemas();
    for (const schema of schemas) {
      this.mcpServer.tool(
        schema.name,
        schema.description,
        schema.inputSchema.properties as Record<string, unknown>,
        async (args: Record<string, unknown>) => {
          try {
            const result = await this.toolHandler.handleToolCall(schema.name, args);
            return {
              content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result) }],
            };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            mainWarn('[DispatchHttpMcpServer]', `Tool ${schema.name} error: ${errMsg}`);
            return {
              content: [{ type: 'text' as const, text: errMsg }],
              isError: true,
            };
          }
        },
      );
    }
  }

  /**
   * Get MCP config for Gemini agent (HTTP type).
   */
  getGeminiMcpConfig(): { url: string; type: 'http'; description: string } {
    return {
      url: this.url,
      type: 'http',
      description: 'AionUi Team - multi-agent orchestration tools',
    };
  }

  /**
   * Get MCP config for ACP agents (Claude, Codex, etc.).
   */
  getAcpMcpConfig(): { type: 'http'; name: string; url: string } {
    return {
      type: 'http',
      name: MCP_SERVER_NAME,
      url: this.url,
    };
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.disposed = true;

    if (this.transport) {
      this.transport.close?.();
      this.transport = null;
    }

    if (this.mcpServer) {
      this.mcpServer.close?.();
      this.mcpServer = null;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    mainLog('[DispatchHttpMcpServer]', `Disposed for conversation ${this.conversationId}`);
  }
}
