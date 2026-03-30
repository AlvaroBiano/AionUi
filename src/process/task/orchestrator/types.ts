/**
 * Multi-Agent Orchestrator — shared types.
 *
 * Defines the data shapes used across all orchestrator components:
 * SubTask definitions, runtime state snapshots, results, and the
 * discriminated-union event bus contract.
 */

/** Sub-task lifecycle status */
export type SubTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** A single sub-task definition */
export type SubTask = {
  /** Unique ID (generated) */
  id: string;
  /** Human-readable label */
  label: string;
  /** The prompt/instruction to send to the agent */
  prompt: string;
  /** Which agent backend to use */
  agentType: string;
  /** Optional extra context injected as preset */
  presetContext?: string;
  /**
   * IDs of sub-tasks that must complete before this one can start.
   * Their outputs are automatically prepended to this task's prompt.
   * Enables sequential / DAG execution (like Claude Operon's depends_on).
   */
  dependsOn?: string[];
  /** Structured outputs from dependency agents (replaces raw text prepend). */
  dependencyOutputs?: DependencyOutput[];
  /** Display phase number (1 = first wave, 2 = second wave, etc.) */
  phase?: number;
  /** Which iteration round this task belongs to (1-based). */
  iterationRound?: number;
  /** subTaskId of the original task being refined (set for refinement tasks). */
  refinementOf?: string;
  /** Whether this task should produce files/code (execution) or just analysis. */
  taskKind?: 'analysis' | 'execution';
};

/** Runtime state snapshot of a sub-task */
export type SubTaskState = {
  id: string;
  label: string;
  status: SubTaskStatus;
  /** conversation_id of the spawned agent session */
  conversationId: string;
  /** Accumulated text output so far */
  outputText: string;
  /** Error message if status === 'failed' */
  error?: string;
  startedAt?: number;
  completedAt?: number;
};

/** Structured handoff from a completed dependency agent. */
export type DependencyOutput = {
  subTaskId: string;
  label: string;
  outputText: string;
  completedAt: number;
};

/** Final result when a sub-task completes successfully */
export type SubTaskResult = {
  subTaskId: string;
  conversationId: string;
  outputText: string;
  completedAt: number;
  /** Partial output captured before timeout (populated when timedOut === true). */
  partialOutput?: string;
  /** True when this result was produced by a timeout, not a clean finish. */
  timedOut?: boolean;
};

/** Orchestrator-level state */
export type OrchestratorState = {
  /** Unique run ID */
  runId: string;
  /** High-level goal */
  goal: string;
  /** All sub-tasks */
  subTasks: Map<string, SubTaskState>;
  /** Overall status */
  status: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
};

/** Events emitted by the orchestrator */
export type OrchestratorEvent =
  | { type: 'subtask:started'; subTaskId: string; conversationId: string }
  | { type: 'subtask:progress'; subTaskId: string; text: string }
  | { type: 'subtask:done'; subTaskId: string; result: SubTaskResult }
  | { type: 'subtask:failed'; subTaskId: string; error: string }
  | { type: 'subtask:partial'; subTaskId: string; partialText: string }
  | { type: 'subtask:conflict_warning'; subTaskId: string; paths: string[] }
  | { type: 'orchestrator:done'; results: SubTaskResult[] }
  | { type: 'orchestrator:failed'; error: string };
