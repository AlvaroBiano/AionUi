// src/process/events/subscribers.ts

/**
 * Built-in event subscribers for AgentEventMap.
 *
 * Each subscriber is a function that registers handlers on the EventDispatcher.
 * Called at application startup in the Composition Root.
 *
 * These replace the hardcoded fan-out in AgentManagers:
 * - ipcBridge.*.responseStream.emit → BridgeSubscriber
 * - teamEventBus.emit('responseStream') → TeamSubscriber
 * - channelEventBus.emitAgentMessage → ChannelSubscriber
 * - cronBusyGuard.setProcessing → CronSubscriber
 * - skillSuggestWatcher.onFinish → SkillSuggestSubscriber
 */

import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { AgentEventPayloadMap } from '@process/events/AgentEvents';
import type { EventDispatcher } from '@process/events/EventDispatcher';

// ─── Dependency interfaces (injected, not imported) ─────────────

/** ipcBridge responseStream — main→renderer IPC push. */
export type IpcStreamEmitter = {
  emit: (msg: IResponseMessage) => void;
};

/** teamEventBus — main-process EventEmitter for TeammateManager. */
export type TeamBus = {
  emit: (event: 'responseStream', msg: IResponseMessage) => boolean;
};

/** channelEventBus — main-process EventEmitter for ChannelMessageService. */
export type ChannelBus = {
  emitAgentMessage: (conversationId: string, msg: IResponseMessage) => void;
};

/** cronBusyGuard — processing state tracker for cron service. */
export type CronGuard = {
  setProcessing: (conversationId: string, busy: boolean) => void;
};

/** skillSuggestWatcher — monitors agent-written SKILL_SUGGEST.md. */
export type SkillWatcher = {
  onFinish: (conversationId: string) => void;
};

// ─── Subscribers ────────────────────────────────────────────────

/**
 * Bridge subscriber: pushes all agent events to the renderer via ipcBridge.
 * Replaces direct `ipcBridge.*.responseStream.emit(msg)` calls in AgentManagers.
 */
export function registerBridgeSubscriber(
  dispatcher: EventDispatcher<AgentEventPayloadMap>,
  ipcStream: IpcStreamEmitter
): void {
  dispatcher.on('agent:stream', (p) => ipcStream.emit(p.message), 'BridgeSubscriber:stream');
  dispatcher.on('agent:finish', (p) => ipcStream.emit(p.message), 'BridgeSubscriber:finish');
  dispatcher.on('agent:error', (p) => ipcStream.emit(p.message), 'BridgeSubscriber:error');
}

/**
 * Team subscriber: forwards terminal events (finish/error) to TeammateManager.
 * Replaces `teamEventBus.emit('responseStream', msg)` — only finish and error.
 */
export function registerTeamSubscriber(dispatcher: EventDispatcher<AgentEventPayloadMap>, teamBus: TeamBus): void {
  dispatcher.on('agent:finish', (p) => teamBus.emit('responseStream', p.message), 'TeamSubscriber:finish');
  dispatcher.on('agent:error', (p) => teamBus.emit('responseStream', p.message), 'TeamSubscriber:error');
}

/**
 * Channel subscriber: forwards all agent events to ChannelMessageService.
 * Replaces `channelEventBus.emitAgentMessage(conversationId, msg)`.
 */
export function registerChannelSubscriber(
  dispatcher: EventDispatcher<AgentEventPayloadMap>,
  channelBus: ChannelBus
): void {
  dispatcher.on(
    'agent:stream',
    (p) => channelBus.emitAgentMessage(p.conversationId, p.message),
    'ChannelSubscriber:stream'
  );
  dispatcher.on(
    'agent:finish',
    (p) => channelBus.emitAgentMessage(p.conversationId, p.message),
    'ChannelSubscriber:finish'
  );
  dispatcher.on(
    'agent:error',
    (p) => channelBus.emitAgentMessage(p.conversationId, p.message),
    'ChannelSubscriber:error'
  );
}

/**
 * Cron subscriber: tracks conversation processing state for cron service.
 * Replaces `cronBusyGuard.setProcessing(id, true/false)` in AgentManagers.
 */
export function registerCronSubscriber(dispatcher: EventDispatcher<AgentEventPayloadMap>, cronGuard: CronGuard): void {
  dispatcher.on('turn:started', (p) => cronGuard.setProcessing(p.conversationId, true), 'CronSubscriber:started');
  dispatcher.on('turn:completed', (p) => cronGuard.setProcessing(p.conversationId, false), 'CronSubscriber:completed');
}

/**
 * Skill suggest subscriber: triggers SKILL_SUGGEST.md check on turn completion.
 * Replaces `skillSuggestWatcher.onFinish(conversationId)` in AgentManagers.
 */
export function registerSkillSuggestSubscriber(
  dispatcher: EventDispatcher<AgentEventPayloadMap>,
  skillWatcher: SkillWatcher
): void {
  dispatcher.on('turn:completed', (p) => skillWatcher.onFinish(p.conversationId), 'SkillSuggestSubscriber');
}
