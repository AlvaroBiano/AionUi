// src/process/events/configuringHandlers.ts

/**
 * Waterfall handlers for `agent:configuring` event.
 *
 * These run sequentially when a new agent session is being created.
 * Each handler can add MCP servers, modify presetContext, etc.
 *
 * Replaces hardcoded MCP injection in the old AcpRuntime.createConversation().
 */

import type { AgentConfiguringPayload, AgentEventPayloadMap } from '@process/events/AgentEvents';
import type { EventDispatcher } from '@process/events/EventDispatcher';

// ─── Dependency interfaces ──────────────────────────────────────

/** Provides team-guide MCP stdio config for solo agents. */
export type TeamGuideProvider = {
  shouldInject: (backend: string) => Promise<boolean>;
  getStdioConfig: () => {
    name: string;
    command: string;
    args: string[];
    env: Array<{ name: string; value: string }>;
  } | null;
};

/** Provides user-configured MCP servers from settings. */
export type UserMcpProvider = {
  getUserServers: (
    backend: string
  ) => Promise<Array<{ name: string; command: string; args?: string[]; env?: Array<{ name: string; value: string }> }>>;
};

// ─── Handlers ───────────────────────────────────────────────────

/**
 * Inject team-guide MCP server for solo agents (not in team mode).
 * Gives the agent access to the aion_create_team tool.
 */
export function registerTeamGuideConfiguringHandler(
  dispatcher: EventDispatcher<AgentEventPayloadMap>,
  provider: TeamGuideProvider
): void {
  dispatcher.onWaterfall(
    'agent:configuring',
    async (payload: AgentConfiguringPayload): Promise<AgentConfiguringPayload> => {
      const shouldInject = await provider.shouldInject(payload.agentType);
      if (!shouldInject) return payload;

      const stdioConfig = provider.getStdioConfig();
      if (!stdioConfig) return payload;

      payload.config.mcpServers.push({
        name: stdioConfig.name,
        command: stdioConfig.command,
        args: stdioConfig.args,
        env: [
          ...stdioConfig.env,
          { name: 'AION_MCP_BACKEND', value: payload.agentType },
          { name: 'AION_MCP_CONVERSATION_ID', value: payload.conversationId },
        ],
      });

      return payload;
    },
    'TeamGuideConfiguringHandler'
  );
}

/**
 * Inject user-configured MCP servers from settings.
 * Filtered by cached agent MCP capabilities.
 */
export function registerUserMcpConfiguringHandler(
  dispatcher: EventDispatcher<AgentEventPayloadMap>,
  provider: UserMcpProvider
): void {
  dispatcher.onWaterfall(
    'agent:configuring',
    async (payload: AgentConfiguringPayload): Promise<AgentConfiguringPayload> => {
      const servers = await provider.getUserServers(payload.agentType);
      if (servers.length > 0) {
        payload.config.mcpServers.push(...servers);
      }
      return payload;
    },
    'UserMcpConfiguringHandler'
  );
}
