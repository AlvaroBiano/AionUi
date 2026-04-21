// tests/unit/process/events/configuringHandlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventDispatcher } from '@process/events/EventDispatcher';
import type { AgentEventMap, AgentConfiguringPayload } from '@process/events/AgentEvents';
import {
  registerTeamGuideConfiguringHandler,
  registerUserMcpConfiguringHandler,
} from '@process/events/configuringHandlers';

describe('agent:configuring waterfall handlers', () => {
  let dispatcher: EventDispatcher<AgentEventMap>;

  beforeEach(() => {
    dispatcher = new EventDispatcher<AgentEventMap>();
  });

  function makePayload(overrides?: Partial<AgentConfiguringPayload>): AgentConfiguringPayload {
    return {
      conversationId: 'conv-1',
      agentType: 'acp',
      config: { mcpServers: [] },
      ...overrides,
    };
  }

  describe('TeamGuideConfiguringHandler', () => {
    it('injects team-guide MCP when shouldInject returns true', async () => {
      registerTeamGuideConfiguringHandler(dispatcher, {
        shouldInject: async () => true,
        getStdioConfig: () => ({
          name: 'aionui-team-guide',
          command: 'bun',
          args: ['run', 'guide'],
          env: [{ name: 'KEY', value: 'val' }],
        }),
      });

      const result = await dispatcher.waterfall('agent:configuring', makePayload());
      expect(result.config.mcpServers).toHaveLength(1);
      expect(result.config.mcpServers[0].name).toBe('aionui-team-guide');
      // Env should include original + AION_MCP_BACKEND + AION_MCP_CONVERSATION_ID
      expect(result.config.mcpServers[0].env).toHaveLength(3);
    });

    it('skips injection when shouldInject returns false', async () => {
      registerTeamGuideConfiguringHandler(dispatcher, {
        shouldInject: async () => false,
        getStdioConfig: () => ({
          name: 'aionui-team-guide',
          command: 'bun',
          args: [],
          env: [],
        }),
      });

      const result = await dispatcher.waterfall('agent:configuring', makePayload());
      expect(result.config.mcpServers).toHaveLength(0);
    });

    it('skips injection when stdio config is null', async () => {
      registerTeamGuideConfiguringHandler(dispatcher, {
        shouldInject: async () => true,
        getStdioConfig: () => null,
      });

      const result = await dispatcher.waterfall('agent:configuring', makePayload());
      expect(result.config.mcpServers).toHaveLength(0);
    });
  });

  describe('UserMcpConfiguringHandler', () => {
    it('injects user-configured MCP servers', async () => {
      registerUserMcpConfiguringHandler(dispatcher, {
        getUserServers: async () => [{ name: 'my-mcp', command: 'node', args: ['server.js'] }],
      });

      const result = await dispatcher.waterfall('agent:configuring', makePayload());
      expect(result.config.mcpServers).toHaveLength(1);
      expect(result.config.mcpServers[0].name).toBe('my-mcp');
    });

    it('skips when no user servers configured', async () => {
      registerUserMcpConfiguringHandler(dispatcher, {
        getUserServers: async () => [],
      });

      const result = await dispatcher.waterfall('agent:configuring', makePayload());
      expect(result.config.mcpServers).toHaveLength(0);
    });
  });

  describe('Combined waterfall', () => {
    it('both handlers contribute MCP servers sequentially', async () => {
      registerTeamGuideConfiguringHandler(dispatcher, {
        shouldInject: async () => true,
        getStdioConfig: () => ({
          name: 'aionui-team-guide',
          command: 'bun',
          args: [],
          env: [],
        }),
      });
      registerUserMcpConfiguringHandler(dispatcher, {
        getUserServers: async () => [{ name: 'user-mcp', command: 'node' }],
      });

      const result = await dispatcher.waterfall('agent:configuring', makePayload());
      expect(result.config.mcpServers).toHaveLength(2);
      expect(result.config.mcpServers[0].name).toBe('aionui-team-guide');
      expect(result.config.mcpServers[1].name).toBe('user-mcp');
    });

    it('preserves existing MCP servers from initial config', async () => {
      registerUserMcpConfiguringHandler(dispatcher, {
        getUserServers: async () => [{ name: 'added', command: 'node' }],
      });

      const result = await dispatcher.waterfall(
        'agent:configuring',
        makePayload({ config: { mcpServers: [{ name: 'existing', command: 'bun', args: [] }] } })
      );

      expect(result.config.mcpServers).toHaveLength(2);
      expect(result.config.mcpServers[0].name).toBe('existing');
      expect(result.config.mcpServers[1].name).toBe('added');
    });
  });
});
