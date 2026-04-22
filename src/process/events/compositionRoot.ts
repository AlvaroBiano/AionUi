// src/process/events/compositionRoot.ts

/**
 * Composition Root: creates the shared EventDispatcher and registers all subscribers.
 *
 * This is the ONE place where all event wiring is visible.
 * Called once at application startup (from workerTaskManagerSingleton or index.ts).
 *
 * To add a new subscriber: add a register call here. Nothing else changes.
 * To see all active subscribers: read this file top to bottom.
 */

import type { AgentEventPayloadMap } from '@process/events/AgentEvents';
import { registerTeamGuideConfiguringHandler, registerUserMcpConfiguringHandler } from '@process/events/configuringHandlers';
import { EventDispatcher } from '@process/events/EventDispatcher';
import {
  registerBridgeSubscriber,
  registerChannelSubscriber,
  registerCronSubscriber,
  registerSkillSuggestSubscriber,
  registerTeamSubscriber,
} from '@process/events/subscribers';

// Lazy imports to avoid circular dependencies at module scope.
// These are resolved once when createAgentEventDispatcher() is called.

let _dispatcher: EventDispatcher<AgentEventPayloadMap> | null = null;

/**
 * Create and configure the shared agent event dispatcher.
 * Returns the same instance on subsequent calls (singleton).
 */
export function getAgentEventDispatcher(): EventDispatcher<AgentEventPayloadMap> {
  if (_dispatcher) return _dispatcher;

  _dispatcher = new EventDispatcher<AgentEventPayloadMap>();

  // ── Register subscribers ──────────────────────────────────────

  // 1. Bridge: push all agent events to renderer via ipcBridge
  //    Lazy-imported because ipcBridge has side effects at import time.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcBridge } = require('@/common/adapter/ipcBridge');
    registerBridgeSubscriber(_dispatcher, ipcBridge.conversation.responseStream);
  } catch {
    console.warn('[compositionRoot] ipcBridge not available — BridgeSubscriber skipped');
  }

  // 2. Team: forward terminal events to TeammateManager
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { teamEventBus } = require('@process/team/teamEventBus');
    registerTeamSubscriber(_dispatcher, teamEventBus);
  } catch {
    console.warn('[compositionRoot] teamEventBus not available — TeamSubscriber skipped');
  }

  // 3. Channel: forward all events to ChannelMessageService
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { channelEventBus } = require('@process/channels/agent/ChannelEventBus');
    registerChannelSubscriber(_dispatcher, channelEventBus);
  } catch {
    console.warn('[compositionRoot] channelEventBus not available — ChannelSubscriber skipped');
  }

  // 4. Cron: track conversation processing state
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cronBusyGuard } = require('@process/services/cron/CronBusyGuard');
    registerCronSubscriber(_dispatcher, cronBusyGuard);
  } catch {
    console.warn('[compositionRoot] cronBusyGuard not available — CronSubscriber skipped');
  }

  // 5. Skill suggest: trigger SKILL_SUGGEST.md check on turn completion
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { skillSuggestWatcher } = require('@process/services/cron/SkillSuggestWatcher');
    registerSkillSuggestSubscriber(_dispatcher, skillSuggestWatcher);
  } catch {
    console.warn('[compositionRoot] skillSuggestWatcher not available — SkillSuggestSubscriber skipped');
  }

  // ── Waterfall: agent:configuring ──────────────────────────────

  // 6. Team guide MCP: inject aion_create_team tool for solo agents
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shouldInjectTeamGuideMcp } = require('@process/team/prompts/teamGuideCapability');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTeamGuideStdioConfig } = require('@/process/team/mcp/guide/teamGuideSingleton');
    registerTeamGuideConfiguringHandler(_dispatcher, {
      shouldInject: shouldInjectTeamGuideMcp,
      getStdioConfig: getTeamGuideStdioConfig,
    });
  } catch {
    console.warn('[compositionRoot] team guide not available — TeamGuideConfiguringHandler skipped');
  }

  // 7. User MCP: inject user-configured MCP servers from settings
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProcessConfig } = require('@process/utils/initStorage');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { McpConfig } = require('@process/acp/session/McpConfig');
    registerUserMcpConfiguringHandler(_dispatcher, {
      getUserServers: async (backend: string) => {
        const rawMcpServers = await ProcessConfig.get('mcp.config');
        if (!Array.isArray(rawMcpServers) || rawMcpServers.length === 0) return [];
        const cachedInit = await ProcessConfig.get('acp.cachedInitializeResult');
        const caps = cachedInit?.[backend]?.capabilities?.mcpCapabilities;
        return McpConfig.fromStorageConfig(rawMcpServers, caps);
      },
    });
  } catch {
    console.warn('[compositionRoot] user MCP config not available — UserMcpConfiguringHandler skipped');
  }

  // ── Debug: log all registrations ──────────────────────────────

  if (process.env.NODE_ENV === 'development') {
    const registrations = _dispatcher.inspect();
    console.log(`[compositionRoot] ${registrations.length} handlers registered:`);
    for (const r of registrations) {
      console.log(`  ${r.type} ${r.event} → ${r.label ?? '(unnamed)'}`);
    }
  }

  return _dispatcher;
}

/**
 * Reset the singleton (for testing).
 */
export function resetAgentEventDispatcher(): void {
  _dispatcher?.clear();
  _dispatcher = null;
}
