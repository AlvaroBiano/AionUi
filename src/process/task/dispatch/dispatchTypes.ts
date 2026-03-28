/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/dispatchTypes.ts

import type { AgentStatus } from '../agentTypes';

/** Dispatch session role type, maps to CC's agent/dispatch_child/scheduled */
export type DispatchSessionType = 'dispatcher' | 'dispatch_child' | 'normal';

/** Maximum concurrent child tasks per dispatcher */
export const MAX_CONCURRENT_CHILDREN = 3;

/** Temporary teammate config (unsaved assistant) */
export type TemporaryTeammateConfig = {
  /** Unique identifier for correlating child sessions */
  id: string;
  /** Display name (3-6 words) */
  name: string;
  /** Avatar URL or emoji */
  avatar?: string;
  /** System rules */
  presetRules?: string;
  /**
   * Phase 1: fixed to 'gemini', not configurable.
   * Phase 2 will open agentType selection.
   */
  agentType: 'gemini';
  /** Creation timestamp */
  createdAt: number;
};

/** Parameters for creating a child task */
export type StartChildTaskParams = {
  /** Initial prompt */
  prompt: string;
  /** Short title (3-6 words) */
  title: string;
  /** Optional temporary teammate config */
  teammate?: TemporaryTeammateConfig;
  /** F-4.2: Optional model override for child agent */
  model?: {
    providerId: string;
    modelName: string;
  };
};

/** Child task info (for listing/querying) */
export type ChildTaskInfo = {
  sessionId: string;
  title: string;
  /** Unified AgentStatus, no separate DispatchLifecycleState */
  status: AgentStatus;
  teammateName?: string;
  createdAt: number;
  lastActivityAt: number;
};

/** Options for reading child task transcript */
export type ReadTranscriptOptions = {
  sessionId: string;
  /** Max messages to return (default 20) */
  limit?: number;
  /** Seconds to wait for completion (default 30, 0 for immediate) */
  maxWaitSeconds?: number;
  /**
   * Output format:
   *   - 'auto': running -> progress summary (template); completed -> full transcript
   *   - 'full': always return full transcript
   */
  format?: 'auto' | 'full';
};

/** Result of reading child task transcript */
export type TranscriptResult = {
  sessionId: string;
  title: string;
  status: AgentStatus;
  /** Formatted conversation text */
  transcript: string;
  /** Whether still running */
  isRunning: boolean;
};

/** Parameters for send_message tool */
export type SendMessageToChildParams = {
  sessionId: string;
  message: string;
};

/** Parameters for list_sessions tool */
export type ListSessionsParams = {
  limit?: number;
};

/** Structured pending notification for deduplication and correlation */
export type PendingNotification = {
  childSessionId: string;
  childTitle: string;
  result: 'completed' | 'failed' | 'cancelled' | 'context_resume';
  message: string;
  timestamp: number;
};

/** Child task completion notification */
export type ChildCompletionNotification = {
  childSessionId: string;
  parentSessionId: string;
  title: string;
  result: 'completed' | 'failed' | 'cancelled';
  /** Notification message to inject into parent agent */
  message: string;
};

/** Dispatch event types emitted via IPC */
export type DispatchEventData =
  | { type: 'dispatch:child_started'; childId: string; title: string; teammateName?: string }
  | { type: 'dispatch:child_progress'; childId: string; summary: string }
  | { type: 'dispatch:child_completed'; childId: string; title: string; resultSummary: string }
  | { type: 'dispatch:child_failed'; childId: string; title: string; error: string }
  | { type: 'dispatch:child_cancelled'; childId: string; title: string };

/** Group chat aggregated message type */
export type GroupChatMessage = {
  /** Source session ID */
  sourceSessionId: string;
  /** Source role: dispatcher / child / user */
  sourceRole: 'dispatcher' | 'child' | 'user';
  /** Display name */
  displayName: string;
  /** Message content */
  content: string;
  /** Message type */
  messageType:
    | 'text'
    | 'system'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'task_progress'
    | 'task_cancelled';
  /** Timestamp */
  timestamp: number;
  /** Associated child task ID (optional) */
  childTaskId?: string;
  /** Avatar */
  avatar?: string;
  /** Progress summary for task_progress messages, separate from content (CF-2) */
  progressSummary?: string;
};
