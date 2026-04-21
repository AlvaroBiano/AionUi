// src/process/events/AgentEvents.ts

/**
 * Shared agent event catalog — used by ALL agent types, not ACP-specific.
 *
 * Events are split into three categories:
 * 1. Output (agent → consumers): stream messages, terminal signals
 * 2. Lifecycle (user action → consumers): turn, model, mode changes
 * 3. Waterfall (collaborative configuration): session setup
 *
 * Payload uses IResponseMessage (current universal format across all managers).
 * When renderer migrates to TMessage, the payload type can change here once.
 */

import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { AgentType } from '@process/task/agentTypes';

// ─── Event Payloads ─────────────────────────────────────────────

/** Base context included in every agent event. */
export type AgentEventContext = {
  conversationId: string;
  agentType: AgentType;
};

// -- Output events --

export type AgentStreamPayload = AgentEventContext & {
  message: IResponseMessage;
};

export type AgentFinishPayload = AgentEventContext & {
  message: IResponseMessage;
};

export type AgentErrorPayload = AgentEventContext & {
  message: IResponseMessage;
};

// -- Lifecycle events --

export type TurnStartedPayload = AgentEventContext & {
  /** Opaque turn ID from TurnTracker (ACP) or equivalent. */
  turnId?: number;
};

export type TurnCompletedPayload = AgentEventContext & {
  backend?: string;
  workspace?: string;
  modelId?: string;
  pendingConfirmations?: number;
};

export type ModelChangedPayload = AgentEventContext & {
  modelId: string;
  previousModelId?: string | null;
};

export type ModeChangedPayload = AgentEventContext & {
  modeId: string;
  isYolo: boolean;
};

export type ConfigChangedPayload = AgentEventContext & {
  config: unknown;
};

export type ContextUsagePayload = AgentEventContext & {
  used: number;
  total: number;
  percentage: number;
  cost?: { amount: number; currency: string };
};

export type SessionIdPayload = AgentEventContext & {
  sessionId: string;
};

// -- Waterfall events --

export type AgentConfiguringPayload = AgentEventContext & {
  /** Mutable config — waterfall handlers can modify mcpServers, presetContext, etc. */
  config: {
    mcpServers: Array<{ name: string; command: string; args?: string[]; env?: Array<{ name: string; value: string }> }>;
    presetContext?: string;
  };
};

// ─── Event Map ──────────────────────────────────────────────────

/**
 * Complete agent event map for EventDispatcher<AgentEventMap>.
 *
 * Naming convention: `domain:action`
 * - agent:*    — agent output
 * - turn:*     — turn lifecycle
 * - model:*    — model changes
 * - mode:*     — mode changes
 * - config:*   — config changes
 * - context:*  — context usage
 * - session:*  — session lifecycle
 */
export type AgentEventMap = {
  // ── Output (agent → consumers) ──
  // Every stream message (content, tool_call, thinking, plan, status, etc.)
  'agent:stream': AgentStreamPayload;
  // Turn finished normally
  'agent:finish': AgentFinishPayload;
  // Error signal
  'agent:error': AgentErrorPayload;

  // ── Lifecycle (user action / session lifecycle → consumers) ──
  // User sent a message (before agent processes it)
  'turn:started': TurnStartedPayload;
  // Turn fully completed (finish signal processed, all cleanup done)
  'turn:completed': TurnCompletedPayload;
  // Model switched
  'model:changed': ModelChangedPayload;
  // Mode switched
  'mode:changed': ModeChangedPayload;
  // Config options changed
  'config:changed': ConfigChangedPayload;
  // Context usage updated
  'context:usage': ContextUsagePayload;
  // Session ID assigned/changed
  'session:id': SessionIdPayload;

  // ── Waterfall (collaborative configuration) ──
  // Session being created — handlers can contribute MCP servers, config, etc.
  'agent:configuring': AgentConfiguringPayload;
};
