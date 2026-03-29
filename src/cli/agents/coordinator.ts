/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CoordinatorSession — persistent coordinator session across all phases.
 *
 * Uses a SINGLE manager instance for both plan and synthesis, so the
 * coordinator remembers why it made its planning decisions when it synthesizes.
 * (Claude Operon: coordinator is a long-running session, not a one-shot call.)
 *
 * Phase 1 (plan): sends one structured JSON prompt, parses the response.
 * Phase 3 (synthesize): sends synthesis prompt to the SAME session, streams output.
 *   The coordinator has full context of its own planning intent.
 */

import { randomUUID } from 'node:crypto';
import type { AgentManagerFactory } from '@process/task/orchestrator/SubTaskSession';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter, AgentMessageEvent } from '@process/task/IAgentEventEmitter';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SpecialistPlan = {
  role: string;
  focus: string;
  /** 1 = first phase, 2 = second phase (for sequential execution) */
  phase?: number;
  /** Role names this specialist must wait for (sequential deps) */
  dependsOn?: string[];
};

export type CoordinatorPlan = {
  goal_analysis: string;
  /** Whether specialists run all at once or in dependency order */
  execution_mode: 'parallel' | 'sequential';
  specialists: SpecialistPlan[];
};

export type SpecialistResult = {
  role: string;
  output: string;
};

export type ReviewPlan = {
  needs_refinement: Array<{
    role: string;
    issue: string;
    guidance: string;
  }>;
};

export type ScoredReviewPlan = ReviewPlan & { qualityScore: number };

export type MidFlightAdjustment = {
  addTasks: Array<{ label: string; focus: string; dependsOn?: string[] }>;
  cancelTaskIds: string[];
  reasoning: string;
};

export type VerificationResult = {
  passed: boolean;
  notes: string;
  failedRoles: string[];
};

// ── CoordinatorSession ────────────────────────────────────────────────────────

/**
 * A single coordinator agent session that handles both planning and synthesis.
 * The same LLM context is reused across calls — synthesis has full memory of
 * why the coordinator assigned specific roles.
 */
export class CoordinatorSession {
  private readonly manager: IAgentManager;
  private onTextChunk: (chunk: string) => void = () => {};
  private onStatusDone: (success: boolean) => void = () => {};
  /** Incremented before each sendMessage call — stale done events are ignored. */
  private callNonce = 0;

  constructor(factory: AgentManagerFactory) {
    const emitter = this._makeEmitter();
    this.manager = factory(`coordinator-${randomUUID().slice(0, 8)}`, '', emitter);
  }

  /** Phase 1: ask coordinator to produce a structured JSON team plan. */
  async plan(
    goal: string,
    teamSize: number,
    signal?: AbortSignal,
  ): Promise<CoordinatorPlan | null> {
    if (signal?.aborted) return null;

    return new Promise<CoordinatorPlan | null>((resolve) => {
      let accumulated = '';
      let settled = false;

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) { resolve(null); return; }
        try {
          const match = accumulated.match(/\{[\s\S]*\}/);
          if (!match) { resolve(null); return; }
          const raw = JSON.parse(match[0]) as Partial<CoordinatorPlan>;
          const rawSpecs = Array.isArray(raw.specialists) ? raw.specialists : [];

          // Pad to exactly teamSize
          const specs: SpecialistPlan[] = [...rawSpecs];
          while (specs.length < teamSize) {
            specs.push({ role: `Specialist ${specs.length + 1}`, focus: `Provide additional perspective on: ${goal}`, phase: 1 });
          }

          resolve({
            goal_analysis: String(raw.goal_analysis ?? goal),
            execution_mode: raw.execution_mode === 'sequential' ? 'sequential' : 'parallel',
            specialists: specs.slice(0, teamSize),
          });
        } catch {
          resolve(null);
        }
      };

      this.onTextChunk = (chunk) => { accumulated += chunk; };
      this.onStatusDone = settle;
      this.callNonce++;
      signal?.addEventListener('abort', () => settle(false), { once: true });
      this.manager.sendMessage({ content: buildPlanPrompt(goal, teamSize) }).catch(() => settle(false));
    });
  }

  /** Phase 3: synthesize all specialist outputs into one unified answer (streaming). */
  async synthesize(
    goal: string,
    results: SpecialistResult[],
    onText: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted || results.length === 0) return;

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };

      this.onTextChunk = (chunk) => { if (chunk) onText(chunk); };
      this.onStatusDone = settle;
      this.callNonce++;
      signal?.addEventListener('abort', settle, { once: true });
      this.manager.sendMessage({ content: buildSynthesisPrompt(goal, results) }).catch(settle);
    });
  }

  /** Phase 2.5: review specialist outputs — identify which need follow-up. */
  async review(
    goal: string,
    results: SpecialistResult[],
    signal?: AbortSignal,
  ): Promise<ReviewPlan | null> {
    if (signal?.aborted || results.length === 0) return null;

    return new Promise<ReviewPlan | null>((resolve) => {
      let accumulated = '';
      let settled = false;

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) { resolve(null); return; }
        try {
          const match = accumulated.match(/\{[\s\S]*\}/);
          if (!match) { resolve(null); return; }
          const raw = JSON.parse(match[0]) as Partial<ReviewPlan>;
          resolve({
            needs_refinement: Array.isArray(raw.needs_refinement) ? raw.needs_refinement : [],
          });
        } catch {
          resolve(null);
        }
      };

      this.onTextChunk = (chunk) => { accumulated += chunk; };
      this.onStatusDone = settle;
      this.callNonce++;
      signal?.addEventListener('abort', () => settle(false), { once: true });
      this.manager.sendMessage({ content: buildReviewPrompt(goal, results) }).catch(() => settle(false));
    });
  }

  /**
   * Phase 2.5 (iterative): review specialist outputs with a quality score.
   * Returns needs_refinement items AND a qualityScore (0–1) for loop decisions.
   */
  async reviewWithScore(
    goal: string,
    results: SpecialistResult[],
    signal?: AbortSignal,
  ): Promise<ScoredReviewPlan | null> {
    if (signal?.aborted || results.length === 0) return null;

    return new Promise<ScoredReviewPlan | null>((resolve) => {
      let accumulated = '';
      let settled = false;

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) { resolve(null); return; }
        try {
          const match = accumulated.match(/\{[\s\S]*\}/);
          if (!match) { resolve(null); return; }
          const raw = JSON.parse(match[0]) as Partial<ReviewPlan & { quality_score?: unknown }>;
          const needs_refinement = Array.isArray(raw.needs_refinement) ? raw.needs_refinement : [];
          // Parse quality_score with fallback heuristic
          let qualityScore: number;
          if (typeof raw.quality_score === 'number') {
            qualityScore = Math.min(1, Math.max(0, raw.quality_score));
          } else {
            qualityScore = needs_refinement.length === 0 ? 1.0 : 0.5;
          }
          resolve({ needs_refinement, qualityScore });
        } catch {
          resolve(null);
        }
      };

      this.onTextChunk = (chunk) => { accumulated += chunk; };
      this.onStatusDone = settle;
      this.callNonce++;
      signal?.addEventListener('abort', () => settle(false), { once: true });
      this.manager.sendMessage({ content: buildScoredReviewPrompt(goal, results) }).catch(() => settle(false));
    });
  }

  /**
   * Mid-flight adjustment: ask the coordinator whether the current plan needs
   * modification based on an in-progress observation.
   */
  async adjust(
    observation: string,
    signal?: AbortSignal,
  ): Promise<MidFlightAdjustment | null> {
    if (signal?.aborted) return null;

    return new Promise<MidFlightAdjustment | null>((resolve) => {
      let accumulated = '';
      let settled = false;

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) { resolve(null); return; }
        try {
          const match = accumulated.match(/\{[\s\S]*\}/);
          if (!match) { resolve(null); return; }
          const raw = JSON.parse(match[0]) as Partial<MidFlightAdjustment>;
          resolve({
            addTasks: Array.isArray(raw.addTasks) ? raw.addTasks : [],
            cancelTaskIds: Array.isArray(raw.cancelTaskIds) ? raw.cancelTaskIds : [],
            reasoning: String(raw.reasoning ?? 'no change needed'),
          });
        } catch {
          resolve(null);
        }
      };

      this.onTextChunk = (chunk) => { accumulated += chunk; };
      this.onStatusDone = settle;
      this.callNonce++;
      signal?.addEventListener('abort', () => settle(false), { once: true });
      const prompt =
        `You are mid-execution. Based on this observation, decide if the plan needs adjustment.\n\n` +
        `Observation: ${observation}\n\n` +
        `Return ONLY JSON: { "addTasks": [{"label": "...", "focus": "..."}], "cancelTaskIds": [], "reasoning": "..." }\n` +
        `If no change needed: { "addTasks": [], "cancelTaskIds": [], "reasoning": "no change needed" }`;
      this.manager.sendMessage({ content: prompt }).catch(() => settle(false));
    });
  }

  /**
   * Verification phase: ask the coordinator to verify team outputs against the
   * original goal, identifying any roles whose output is inadequate or missing.
   */
  async verify(
    goal: string,
    results: Array<{ role: string; output: string }>,
    signal?: AbortSignal,
  ): Promise<VerificationResult | null> {
    if (signal?.aborted || results.length === 0) return null;

    return new Promise<VerificationResult | null>((resolve) => {
      let accumulated = '';
      let settled = false;

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) { resolve(null); return; }
        try {
          const match = accumulated.match(/\{[\s\S]*\}/);
          if (!match) { resolve(null); return; }
          const raw = JSON.parse(match[0]) as Partial<VerificationResult>;
          resolve({
            passed: raw.passed === true,
            notes: String(raw.notes ?? ''),
            failedRoles: Array.isArray(raw.failedRoles) ? raw.failedRoles : [],
          });
        } catch {
          resolve(null);
        }
      };

      this.onTextChunk = (chunk) => { accumulated += chunk; };
      this.onStatusDone = settle;
      this.callNonce++;
      signal?.addEventListener('abort', () => settle(false), { once: true });
      const formattedResults = results
        .map((r, i) => `[${i + 1}] ${r.role}:\n${r.output.trim()}`)
        .join('\n\n');
      const prompt =
        `Verify your team's work. Goal: "${goal}"\n\n` +
        `Team outputs:\n${formattedResults}\n\n` +
        `Return ONLY JSON: { "passed": true/false, "notes": "...", "failedRoles": ["RoleName"] }\n` +
        `failedRoles should list roles whose output is inadequate or missing.`;
      this.manager.sendMessage({ content: prompt }).catch(() => settle(false));
    });
  }

  async stop(): Promise<void> {
    await this.manager.stop();
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _makeEmitter(): IAgentEventEmitter {
    return {
      emitMessage: (_cid: string, event: AgentMessageEvent) => {
        if (event.type === 'text') {
          const content = (event.data as { content?: string })?.content ?? '';
          if (content) this.onTextChunk(content);
        } else if (event.type === 'status') {
          const status = (event.data as { status?: string })?.status;
          if (status === 'done') {
            const nonce = this.callNonce;
            // Yield to event loop so the current sendMessage's Promise settles first,
            // then fire onStatusDone — prevents stale done events from prior calls
            // from prematurely resolving the next call's Promise.
            setTimeout(() => { if (this.callNonce === nonce) this.onStatusDone(true); }, 0);
          }
        }
      },
      emitConfirmationAdd: () => {},
      emitConfirmationUpdate: () => {},
      emitConfirmationRemove: () => {},
    };
  }
}

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildPlanPrompt(goal: string, teamSize: number): string {
  return `You are a team coordinator. Analyze the goal and assign roles to exactly ${teamSize} specialists.

Goal: "${goal}"

**DEFAULT: Use PARALLEL mode.** Specialists work simultaneously unless one literally cannot start without another's output.

Output ONLY valid JSON (no markdown, no explanation):
{
  "goal_analysis": "one sentence: what needs to be accomplished and how",
  "execution_mode": "parallel",
  "specialists": [
    { "role": "RoleName", "focus": "Specific aspect this specialist addresses", "phase": 1 }
  ]
}

Only use sequential mode when there is a hard data dependency (e.g. a compiler needs source code written first). In that case add "dependsOn": ["RoleName"] ONLY to specialists that literally cannot proceed without the output:
{
  "goal_analysis": "...",
  "execution_mode": "sequential",
  "specialists": [
    { "role": "Researcher", "focus": "...", "phase": 1 },
    { "role": "Implementer", "focus": "...", "phase": 2, "dependsOn": ["Researcher"] }
  ]
}

Rules:
- Exactly ${teamSize} items in the specialists array
- Roles must be distinct and complementary
- Focus must be specific to THIS goal
- STRONGLY prefer parallel — most tasks (review, analysis, design, planning) can run independently
- Use sequential ONLY when one specialist's output is the literal input for another
- Output ONLY the JSON object, nothing else`;
}

function buildReviewPrompt(goal: string, results: SpecialistResult[]): string {
  const reports = results
    .map((r, i) => `### [${i + 1}] ${r.role}\n${r.output.trim()}`)
    .join('\n\n');

  return `You coordinated a team of specialists for this goal: "${goal}"

Here are their outputs:

${reports}

---
Review each specialist's contribution. Identify any that are:
- Too brief or superficial (under 80 words of real substance)
- Off-topic or clearly misunderstood their assigned focus
- Missing critical aspects they were specifically asked to cover

Output ONLY valid JSON (no markdown, no explanation):
{
  "needs_refinement": [
    {
      "role": "ExactRoleName",
      "issue": "One sentence: what is wrong or missing",
      "guidance": "Specific instruction: what to add or fix in the revision"
    }
  ]
}

If all outputs are satisfactory, return: { "needs_refinement": [] }
Be conservative — only flag truly weak outputs, not ones that are merely short.`;
}

function buildScoredReviewPrompt(goal: string, results: SpecialistResult[]): string {
  const reports = results
    .map((r, i) => `### [${i + 1}] ${r.role}\n${r.output.trim()}`)
    .join('\n\n');

  return `You coordinated a team of specialists for this goal: "${goal}"

Here are their outputs:

${reports}

---
Review each specialist's contribution and score overall quality.

Output ONLY valid JSON (no markdown, no explanation):
{
  "quality_score": 0.75,
  "needs_refinement": [
    {
      "role": "ExactRoleName",
      "issue": "One sentence: what is wrong or missing",
      "guidance": "Specific instruction: what to add or fix in the revision"
    }
  ]
}

quality_score: a number from 0.0 to 1.0 representing the overall quality of ALL outputs combined.
  - 1.0 = all outputs are thorough, specific, and fully address their assigned focus
  - 0.75 = mostly good, minor gaps
  - 0.5 = some outputs are weak or superficial
  - 0.25 = most outputs are poor

needs_refinement: list ONLY specialists whose output is:
- Too brief or superficial (under 80 words of real substance)
- Off-topic or clearly misunderstood their assigned focus
- Missing critical aspects they were specifically asked to cover

If all outputs are satisfactory, return: { "quality_score": 1.0, "needs_refinement": [] }
Be conservative — only flag truly weak outputs, not ones that are merely short.`;
}

function buildSynthesisPrompt(goal: string, results: SpecialistResult[]): string {
  const reports = results
    .map((r, i) => `### [${i + 1}] ${r.role}\n${r.output.trim()}`)
    .join('\n\n');

  return `Your team has completed their work. Synthesize their reports into ONE unified answer.

Original Goal: "${goal}"

Specialist Reports:
${reports}

---
Instructions:
1. Extract the most important insights from each specialist
2. Resolve contradictions — explain trade-offs where they exist
3. Produce ONE coherent, actionable response as if written by a single senior expert
4. Do NOT list reports one by one — fully integrate the perspectives
5. Lead with the most important conclusion or recommendation
6. Be specific, concrete, and actionable`;
}
