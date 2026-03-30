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
 *   2. Asks the coordinator to decide: accept or refine.
 *   3. If refine, rebuilds refinement tasks for flagged agents.
 *   4. Repeats until a stop condition triggers.
 *   5. Synthesizes all results into a final answer.
 *
 * Stop conditions (any one triggers synthesis):
 *   - signal.aborted
 *   - coordinator decision: action === 'accept'
 *   - round >= options.maxIterations (default 3)
 *   - convergence: same targets two rounds in a row
 *   - all refinement targets hit maxRetriesPerRole (default 2)
 */

import { randomUUID } from 'node:crypto';
import type { Orchestrator } from '@process/task/orchestrator/Orchestrator';
import type { SubTask, SubTaskResult, OrchestratorEvent } from '@process/task/orchestrator/types';
import type { CoordinatorSession, SpecialistResult } from './coordinator';
import type { ICoordinatorLoop, CoordinatorLoopEvent } from './ICoordinatorLoop';
import { LiveCoordinatorAgent } from './LiveCoordinatorAgent';

export type PersistentCoordinatorLoopOptions = {
  /** Maximum number of refinement rounds (default 3). */
  maxIterations?: number;
  /** Max times the same role can be re-dispatched (default 2). */
  maxRetriesPerRole?: number;
};

/**
 * Build a peer outputs block to inject into a refinement task's prompt.
 * Lets the target agent see what peers have contributed so far.
 */
export function buildPeerContextBlock(
  targetRole: string,
  allResults: Map<string, SubTaskResult>,
  flaggedRoles: Set<string>,
  opts: { charLimit?: number; maxPeers?: number } = {},
): string {
  const charLimit = opts.charLimit ?? 1200;
  const maxPeers = opts.maxPeers ?? 3;

  // Collect peers: prefer non-flagged (higher quality), then flagged
  const peers: Array<{ role: string; output: string }> = [];
  const flagged: Array<{ role: string; output: string }> = [];

  for (const [role, result] of allResults) {
    if (role === targetRole) continue;
    const text = result.outputText.trim();
    if (text.length < 50) continue;
    const truncated = text.length > charLimit ? text.slice(0, charLimit) + '\n...[truncated]' : text;
    if (flaggedRoles.has(role)) {
      flagged.push({ role, output: truncated });
    } else {
      peers.push({ role, output: truncated });
    }
  }

  const selected = [...peers, ...flagged].slice(0, maxPeers);
  if (selected.length === 0) return '';

  const blocks = selected.map((p) => `### [${p.role}]\n${p.output}`).join('\n\n');
  return (
    `\n\n**Your team's current outputs (read critically — identify gaps and disagreements):**\n\n` +
    blocks +
    `\n\n---\n` +
    `Do NOT repeat what your peers have said. Instead: identify what they missed, ` +
    `challenge assumptions where you disagree, and make your own contribution specific and complementary.`
  );
}

export class PersistentCoordinatorLoop implements ICoordinatorLoop {
  private readonly maxIterations: number;
  private readonly maxRetriesPerRole: number;

  constructor(
    private readonly coordinator: CoordinatorSession,
    private readonly orch: Orchestrator,
    options: PersistentCoordinatorLoopOptions = {},
  ) {
    this.maxIterations = options.maxIterations ?? 3;
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
    let prevTargetSet: string | null = null;

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

      onEvent({ type: 'phase_changed', phase: 'reviewing' });

      const decision = await this.coordinator
        .decide(goal, specialistResults, round, this.maxIterations, signal)
        .catch((): null => null);

      if (signal?.aborted) break;
      if (!decision) break;

      onEvent({
        type: 'round_assessed',
        round,
        needsRefinement: decision.action === 'refine' ? decision.targets.length : 0,
        reason: decision.reason,
      });
      onEvent({
        type: 'coordinator_decision',
        round,
        action: decision.action,
        reason: decision.reason,
      });

      // Stop: coordinator is satisfied
      if (decision.action === 'accept') break;

      // Stop: no targets to refine
      if (decision.targets.length === 0) break;

      // Stop: last iteration
      if (round >= this.maxIterations) break;

      // Convergence detection: same targets two rounds in a row → stop
      const currentTargetSet = decision.targets
        .map((t) => t.role)
        .sort()
        .join(',');
      if (prevTargetSet !== null && currentTargetSet === prevTargetSet) break;
      prevTargetSet = currentTargetSet;

      // Build refinement tasks, respecting per-role retry limits
      const flaggedRoles = new Set(decision.targets.map((item) => item.role));
      const refinementTasks: SubTask[] = [];
      for (const item of decision.targets) {
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
          prompt:
            `${origTask.prompt}` +
            `\n\n**Coordinator Feedback (Round ${round}):**\n` +
            `Issue: ${item.issue}\nRequired: ${item.guidance}` +
            buildPeerContextBlock(item.role, allResults, flaggedRoles) +
            `\n\nRevise and expand your response accordingly.`,
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
    const enableVerification =
      this.coordinator instanceof LiveCoordinatorAgent
        ? (this.coordinator.liveOptions.enableVerification ?? true)
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

      const verification = await this.coordinator
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
