/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PersistentCoordinatorLoop — multi-round iterative coordinator loop.
 *
 * Replaces the single-pass batch pipeline with a loop that:
 *   1. Runs specialist tasks via the Orchestrator.
 *   2. Asks the coordinator to review and score all results.
 *   3. If quality is below threshold, rebuilds refinement tasks for weak agents.
 *   4. Repeats until quality passes, no refinements needed, or max iterations hit.
 *   5. Synthesizes all results into a final answer.
 *
 * Stop conditions (any one triggers synthesis):
 *   - signal.aborted
 *   - qualityScore >= options.qualityThreshold (default 0.85)
 *   - needs_refinement.length === 0
 *   - round >= options.maxIterations (default 3)
 *   - marginal gain < marginalGainThreshold (if round >= 2, default 0.10)
 *   - all refinement targets hit maxRetriesPerRole (default 2)
 */

import { randomUUID } from 'node:crypto';
import type { Orchestrator } from '@process/task/orchestrator/Orchestrator';
import type { SubTask, SubTaskResult, OrchestratorEvent } from '@process/task/orchestrator/types';
import type { CoordinatorSession, SpecialistResult } from './coordinator';
import type { ICoordinatorLoop, CoordinatorLoopEvent } from './ICoordinatorLoop';
import type { LiveCoordinatorAgent } from './LiveCoordinatorAgent';

export type PersistentCoordinatorLoopOptions = {
  /** Maximum number of refinement rounds (default 3). */
  maxIterations?: number;
  /** Quality score (0–1) to stop early (default 0.85). */
  qualityThreshold?: number;
  /** Minimum score gain to justify another round (default 0.10). */
  marginalGainThreshold?: number;
  /** Max times the same role can be re-dispatched (default 2). */
  maxRetriesPerRole?: number;
};

export class PersistentCoordinatorLoop implements ICoordinatorLoop {
  private readonly maxIterations: number;
  private readonly qualityThreshold: number;
  private readonly marginalGainThreshold: number;
  private readonly maxRetriesPerRole: number;

  constructor(
    private readonly coordinator: CoordinatorSession,
    private readonly orch: Orchestrator,
    options: PersistentCoordinatorLoopOptions = {},
  ) {
    this.maxIterations = options.maxIterations ?? 3;
    this.qualityThreshold = options.qualityThreshold ?? 0.85;
    this.marginalGainThreshold = options.marginalGainThreshold ?? 0.10;
    this.maxRetriesPerRole = options.maxRetriesPerRole ?? 2;
  }

  async run(
    goal: string,
    initialTasks: SubTask[],
    onEvent: (event: CoordinatorLoopEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    // allResults: role label → latest SubTaskResult
    const allResults = new Map<string, SubTaskResult>();
    // retryCount: role label → number of times re-dispatched
    const retryCount = new Map<string, number>();

    let currentTasks: SubTask[] = initialTasks.map((t) => ({ ...t, iterationRound: 1 }));
    let prevQualityScore = 0;

    onEvent({ type: 'phase_changed', phase: 'executing' });

    for (let round = 1; round <= this.maxIterations; round++) {
      if (signal?.aborted) break;

      onEvent({ type: 'round_started', round });
      onEvent({ type: 'round_display', round, maxRounds: this.maxIterations });

      // Subscribe to real-time progress from agents
      const currentRoundTasks = currentTasks;
      const progressHandler = (event: OrchestratorEvent) => {
        if (event.type === 'subtask:progress') {
          const task = currentRoundTasks.find((t) => t.id === event.subTaskId);
          if (task) {
            onEvent({
              type: 'agent_progress',
              subTaskId: event.subTaskId,
              label: task.label,
              progressLine: event.text,
            });
          }
        }
      };
      this.orch.on('*', progressHandler);

      // Run this round's tasks
      let roundResults: SubTaskResult[];
      try {
        roundResults = await this.orch.run(goal, currentTasks);
      } catch {
        // If orchestrator throws (e.g. abort), stop gracefully
        this.orch.off('*', progressHandler);
        break;
      }
      this.orch.off('*', progressHandler);

      if (signal?.aborted) break;

      // Emit raw results so team.ts can display agent output
      onEvent({ type: 'round_results', results: roundResults, tasks: currentTasks });

      // Merge round results into allResults (replace same-role entries)
      for (const result of roundResults) {
        const task = currentTasks.find((t) => t.id === result.subTaskId);
        const roleKey = task?.label ?? result.subTaskId;
        allResults.set(roleKey, result);
      }

      // Build specialist results for review (only roles with non-trivial output)
      const specialistResults: SpecialistResult[] = [];
      for (const [role, result] of allResults) {
        if (result.outputText.trim().length > 50) {
          specialistResults.push({ role, output: result.outputText.trim() });
        }
      }

      if (specialistResults.length === 0) break;

      // Review with quality score
      onEvent({ type: 'phase_changed', phase: 'reviewing' });

      const assessment = await this.coordinator
        .reviewWithScore(goal, specialistResults, signal)
        .catch((): null => null);

      if (signal?.aborted) break;

      if (!assessment) break;

      const { qualityScore, needs_refinement } = assessment;

      onEvent({
        type: 'round_assessed',
        round,
        qualityScore,
        needsRefinement: needs_refinement.length,
      });
      onEvent({ type: 'quality_score_updated', score: qualityScore });

      // Stop condition: quality threshold met
      if (qualityScore >= this.qualityThreshold) break;

      // Stop condition: no refinements needed
      if (needs_refinement.length === 0) break;

      // Stop condition: marginal gain too small (only after round 1)
      if (round >= 2 && qualityScore - prevQualityScore < this.marginalGainThreshold) break;

      // Stop condition: last iteration
      if (round >= this.maxIterations) break;

      prevQualityScore = qualityScore;

      // Build refinement tasks, respecting per-role retry limits
      const refinementTasks: SubTask[] = [];
      for (const item of needs_refinement) {
        const roleRetries = retryCount.get(item.role) ?? 0;
        if (roleRetries >= this.maxRetriesPerRole) continue;

        // Find original task for this role
        const origTask = initialTasks.find((t) => t.label === item.role);
        if (!origTask) continue;

        retryCount.set(item.role, roleRetries + 1);

        const refinedId = randomUUID().slice(0, 8);
        refinementTasks.push({
          id: refinedId,
          label: item.role,
          prompt: `${origTask.prompt}\n\n**Coordinator Feedback (Round ${round}):**\nIssue: ${item.issue}\nRequired: ${item.guidance}\n\nRevise and expand your response accordingly.`,
          presetContext: origTask.presetContext,
          agentType: origTask.agentType,
          iterationRound: round + 1,
          refinementOf: origTask.id,
        });
      }

      // Stop condition: all targets already at max retries
      if (refinementTasks.length === 0) break;

      onEvent({ type: 'phase_changed', phase: 'refining' });
      currentTasks = refinementTasks;
    }

    if (signal?.aborted) {
      onEvent({ type: 'done' });
      return;
    }

    // Verification phase (LiveCoordinatorAgent only)
    const liveCoordinator = this.coordinator as LiveCoordinatorAgent;
    const enableVerification =
      liveCoordinator.liveOptions !== undefined
        ? (liveCoordinator.liveOptions.enableVerification ?? true)
        : false;

    // Snapshot all accumulated results as a flat array for verification
    const allResultsArray: SubTaskResult[] = [...allResults.values()];

    if (enableVerification && allResultsArray.length > 0 && !signal?.aborted) {
      onEvent({ type: 'verification_started' });
      onEvent({ type: 'phase_changed', phase: 'verifying' });

      const verificationInputs = allResultsArray
        .map((r) => {
          // Find the label for this result by looking up initialTasks (best effort)
          const task = initialTasks.find((t) => t.id === r.subTaskId);
          return {
            role: task?.label ?? r.subTaskId,
            output: r.outputText,
          };
        })
        .filter((r) => r.output.trim().length > 50);

      const verification = await (this.coordinator as CoordinatorSession)
        .verify(goal, verificationInputs, signal)
        .catch((): null => null);

      const passed = verification?.passed ?? true;
      const failedRoles = verification?.failedRoles ?? [];

      onEvent({ type: 'verification_done', passed, failedRoles });

      // If verification failed, run one more targeted pass for failed roles
      if (!passed && failedRoles.length > 0 && !signal?.aborted) {
        const verifyTasks: SubTask[] = failedRoles.map((roleName) => {
          const original = initialTasks.find((t) => t.label === roleName);
          return {
            id: `verify-${randomUUID().slice(0, 8)}`,
            label: roleName,
            prompt: original
              ? `Your previous output was insufficient. ${verification?.notes ?? ''}. Please redo: ${original.prompt}`
              : `Retry your task. ${verification?.notes ?? ''}. Goal: ${goal}`,
            agentType: original?.agentType ?? 'acp',
            presetContext: original?.presetContext,
            phase: 99,
          };
        });

        const verifyResults = await this.orch.run(goal, verifyTasks).catch((): SubTaskResult[] => []);
        // Replace failed results with verified ones
        for (const vr of verifyResults) {
          const failedTask = verifyTasks.find((t) => t.id === vr.subTaskId);
          const roleName = failedTask?.label;
          if (roleName) {
            // Replace the matching role entry in allResults
            for (const [key, existing] of allResults) {
              if (key === roleName || initialTasks.find((t) => t.id === existing.subTaskId)?.label === roleName) {
                allResults.set(key, vr);
                break;
              }
            }
          }
        }
      }
    }

    // Phase 3: Synthesize
    const specialistResultsForSynth: SpecialistResult[] = [];
    for (const [role, result] of allResults) {
      if (result.outputText.trim().length > 50) {
        specialistResultsForSynth.push({ role, output: result.outputText.trim() });
      }
    }

    if (specialistResultsForSynth.length > 1) {
      onEvent({ type: 'phase_changed', phase: 'synthesizing' });

      await this.coordinator
        .synthesize(
          goal,
          specialistResultsForSynth,
          (text) => onEvent({ type: 'synthesis_chunk', text }),
          signal,
        )
        .catch((): void => {});
    }

    onEvent({ type: 'phase_changed', phase: 'done' });
    onEvent({ type: 'done' });
  }
}
