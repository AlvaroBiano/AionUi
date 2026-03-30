/**
 * Unit tests for DispatchMcpServer Phase 2a features.
 * Covers: send_message, list_sessions, list_children alias.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

import { DispatchMcpServer } from '../../../src/process/task/dispatch/DispatchMcpServer';
import type { DispatchToolHandler } from '../../../src/process/task/dispatch/DispatchMcpServer';

function makeHandler(overrides: Partial<DispatchToolHandler> = {}): DispatchToolHandler {
  return {
    parentSessionId: 'parent-1',
    startChildSession: vi.fn(async () => 'child-1'),
    readTranscript: vi.fn(async () => ({
      sessionId: 'child-1',
      title: 'Test',
      status: 'idle' as const,
      transcript: '[user] hello',
      isRunning: false,
    })),
    listChildren: vi.fn(async () => []),
    sendMessageToChild: vi.fn(async () => 'Message sent to "Test". Use read_transcript to see the response.'),
    listSessions: vi.fn(async () => 'Sessions (1):\n  - child-1 "Test" (running, is_child: true)'),
    ...overrides,
  };
}

describe('DispatchMcpServer Phase 2a', () => {
  let server: DispatchMcpServer;
  let handler: DispatchToolHandler;

  beforeEach(() => {
    handler = makeHandler();
    server = new DispatchMcpServer(handler);
  });

  // F-2.1: send_message tool
  describe('send_message', () => {
    it('returns success message for running child', async () => {
      const result = await server.handleToolCall('send_message', {
        session_id: 'child-1',
        message: 'Focus on tests',
      });
      const r = result as { session_id: string; message: string };

      expect(r.session_id).toBe('child-1');
      expect(r.message).toContain('Message sent');
      expect(handler.sendMessageToChild).toHaveBeenCalledWith({
        sessionId: 'child-1',
        message: 'Focus on tests',
      });
    });

    it('returns error when session_id is missing', async () => {
      const result = await server.handleToolCall('send_message', {
        message: 'hello',
      });
      const r = result as { isError: boolean };

      expect(r.isError).toBe(true);
    });

    it('returns error when message is missing', async () => {
      const result = await server.handleToolCall('send_message', {
        session_id: 'child-1',
      });
      const r = result as { isError: boolean };

      expect(r.isError).toBe(true);
    });

    it('returns error when handler throws', async () => {
      handler = makeHandler({
        sendMessageToChild: vi.fn(async () => {
          throw new Error('Session "Test" has been cancelled. Start a new task instead.');
        }),
      });
      server = new DispatchMcpServer(handler);

      const result = await server.handleToolCall('send_message', {
        session_id: 'child-1',
        message: 'hello',
      });
      const r = result as { content: string; isError: boolean };

      expect(r.isError).toBe(true);
      expect(r.content).toContain('cancelled');
    });
  });

  // F-2.2: list_sessions tool
  describe('list_sessions', () => {
    it('calls handler.listSessions with default limit', async () => {
      await server.handleToolCall('list_sessions', {});

      expect(handler.listSessions).toHaveBeenCalledWith({ limit: 20 });
    });

    it('passes custom limit', async () => {
      await server.handleToolCall('list_sessions', { limit: 5 });

      expect(handler.listSessions).toHaveBeenCalledWith({ limit: 5 });
    });

    it('returns formatted content', async () => {
      const result = await server.handleToolCall('list_sessions', {});
      const r = result as { content: Array<{ type: string; text: string }> };

      expect(r.content[0].text).toContain('Sessions');
    });
  });

  // C-PM-2a-008: list_children alias
  describe('list_children (deprecated alias)', () => {
    it('forwards to listSessions handler', async () => {
      await server.handleToolCall('list_children', {});

      expect(handler.listSessions).toHaveBeenCalledWith({ limit: 20 });
    });
  });

  // Disposed state
  describe('disposed state', () => {
    it('throws when disposed', async () => {
      server.dispose();
      await expect(server.handleToolCall('send_message', { session_id: 'x', message: 'y' })).rejects.toThrow(
        'disposed'
      );
    });
  });
});
