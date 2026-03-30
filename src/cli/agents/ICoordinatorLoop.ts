/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ICoordinatorLoop — interface for the persistent iterative coordinator loop.
 *
 * Replaces the single-pass batch pipeline with a multi-round loop that keeps
 * evaluating quality and re-dispatching weak agents until the quality threshold
 * is met or max iterations are reached.
 */

import type { SubTask, SubTaskResult } from '@process/task/orchestrator/types';

export type TodoItem = {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
};

export type CoordinatorLoopEvent =
  | { type: 'phase_changed'; phase: 'planning' | 'executing' | 'reviewing' | 'refining' | 'synthesizing' | 'verifying' | 'done' }
  | { type: 'round_started'; round: number }
  | { type: 'round_display'; round: number; maxRounds: number }
  | { type: 'round_assessed'; round: number; needsRefinement: number; reason?: string }
  | { type: 'coordinator_decision'; round: number; action: 'accept' | 'refine'; reason: string }
  | { type: 'round_results'; results: SubTaskResult[]; tasks: SubTask[] }
  | { type: 'synthesis_chunk'; text: string }
  | { type: 'verification_started' }
  | { type: 'verification_done'; passed: boolean; failedRoles: string[] }
  | { type: 'agent_progress'; subTaskId: string; label: string; progressLine: string }
  | { type: 'done' };

export interface ICoordinatorLoop {
  run(
    goal: string,
    initialTasks: SubTask[],
    onEvent: (event: CoordinatorLoopEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
