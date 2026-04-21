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

import { EventDispatcher } from './EventDispatcher';
import type { AgentEventMap } from './AgentEvents';
import {
  registerBridgeSubscriber,
  registerTeamSubscriber,
  registerChannelSubscriber,
  registerCronSubscriber,
  registerSkillSuggestSubscriber,
} from './subscribers';

// Lazy imports to avoid circular dependencies at module scope.
// These are resolved once when createAgentEventDispatcher() is called.

let _dispatcher: EventDispatcher<AgentEventMap> | null = null;

/**
 * Create and configure the shared agent event dispatcher.
 * Returns the same instance on subsequent calls (singleton).
 */
export function getAgentEventDispatcher(): EventDispatcher<AgentEventMap> {
  if (_dispatcher) return _dispatcher;

  _dispatcher = new EventDispatcher<AgentEventMap>();

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
