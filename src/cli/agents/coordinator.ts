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

export type CoordinatorDecision =
  | { action: 'accept'; reason: string }
  | { action: 'refine'; targets: Array<{ role: string; issue: string; guidance: string }>; reason: string };

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
  private static readonly SYSTEM_PROMPT = `You are the lead coordinator of an expert team assembled to solve a specific goal.

Your responsibilities:
1. Plan: assign specialists with distinct focus areas for the goal
2. Review: after specialists complete their work, read every output carefully and decide: is the team's combined work good enough to synthesize into a final answer?
3. Refine: if the work is not yet good enough, identify EXACTLY who needs to redo their work and what they must fix — be specific, reference what peers have already covered
4. Synthesize: when you are satisfied, produce a single cohesive final answer

Key principles:
- You decide when you are satisfied. Do not produce a quality score.
- Your synthesis is not a summary — it is an integrated expert answer that leads with the most important conclusions.
- You are a long-running session: you remember your own planning decisions when you synthesize.`;

  private readonly manager: IAgentManager;
  private onTextChunk: (chunk: string) => void = () => {};
  private onStatusDone: (success: boolean) => void = () => {};
  /** Incremented before each sendMessage call — stale done events are ignored. */
  private callNonce = 0;

  constructor(factory: AgentManagerFactory) {
    const emitter = this._makeEmitter();
    this.manager = factory(
      `coordinator-${randomUUID().slice(0, 8)}`,
      CoordinatorSession.SYSTEM_PROMPT,
      emitter,
    );
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

  /** Phase 2.5 (iterative): coordinator self-decides accept or refine — no quality score. */
  async decide(
    goal: string,
    results: SpecialistResult[],
    round: number,
    maxRounds: number,
    signal?: AbortSignal,
  ): Promise<CoordinatorDecision | null> {
    if (signal?.aborted || results.length === 0) return null;

    return new Promise<CoordinatorDecision | null>((resolve) => {
      let accumulated = '';
      let settled = false;

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) { resolve(null); return; }
        resolve(parseDecision(accumulated, new Set(results.map((r) => r.role))));
      };

      this.onTextChunk = (chunk) => { accumulated += chunk; };
      this.onStatusDone = settle;
      this.callNonce++;
      signal?.addEventListener('abort', () => settle(false), { once: true });
      this.manager.sendMessage({ content: buildDecisionPrompt(goal, results, round, maxRounds) }).catch(() => settle(false));
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

For the "guidance" field, be specific and cross-referencing:
- If another specialist already covered something relevant, say so explicitly:
  "Note that [RoleName] addressed X — build on or challenge that specific point."
- If two specialists contradict each other, identify the conflict:
  "Your view conflicts with [RoleName]'s conclusion that Y — explain why or reconcile."
- Guidance must be actionable: tell the specialist exactly what gap to fill.
- Keep guidance under 120 words.

If all outputs are satisfactory, return: { "needs_refinement": [] }
Be conservative — only flag truly weak outputs, not ones that are merely short.`;
}

function buildSynthesisPrompt(goal: string, results: SpecialistResult[]): string {
  const SYNTHESIS_CHAR_LIMIT = 1500;
  const reports = results
    .map((r, i) => {
      const text = r.output.length > SYNTHESIS_CHAR_LIMIT
        ? r.output.slice(0, SYNTHESIS_CHAR_LIMIT) + '\n...[condensed for synthesis]'
        : r.output;
      return `### [${i + 1}] ${r.role}\n${text.trim()}`;
    })
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

function parseDecision(raw: string, validRoles: Set<string>): CoordinatorDecision {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return { action: 'accept', reason: 'coordinator output unparseable — accepting current results' };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch {
    return { action: 'accept', reason: 'coordinator output invalid JSON — accepting' };
  }
  const p = parsed as Record<string, unknown>;

  if (p.action === 'accept') {
    return { action: 'accept', reason: String(p.reason ?? 'coordinator accepted') };
  }

  if (p.action === 'refine') {
    const rawTargets = Array.isArray(p.targets) ? p.targets : [];
    // Fault-tolerant matching: case-insensitive + partial match
    const validTargets = rawTargets
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((t) => {
        const roleName = String(t.role ?? '');
        // Exact match
        if (validRoles.has(roleName)) return { role: roleName, issue: String(t.issue ?? ''), guidance: String(t.guidance ?? '') };
        // Case-insensitive match
        const lowerName = roleName.toLowerCase();
        const matched = [...validRoles].find((r) => r.toLowerCase() === lowerName);
        if (matched) return { role: matched, issue: String(t.issue ?? ''), guidance: String(t.guidance ?? '') };
        return null;
      })
      .filter((t): t is { role: string; issue: string; guidance: string } => t !== null);

    if (validTargets.length === 0) {
      return { action: 'accept', reason: 'no valid roles matched for refinement — accepting' };
    }
    return { action: 'refine', targets: validTargets, reason: String(p.reason ?? '') };
  }

  return { action: 'accept', reason: `unknown action "${String(p.action)}" — accepting` };
}

function buildDecisionPrompt(
  goal: string,
  results: SpecialistResult[],
  round: number,
  maxRounds: number,
): string {
  const roleList = results.map((r) => `"${r.role}"`).join(', ');
  const reports = results
    .map((r) => {
      const text = r.output.length > 800
        ? r.output.slice(0, 800) + '\n...[truncated for review]'
        : r.output;
      return `### ${r.role}\n${text.trim()}`;
    })
    .join('\n\n');

  const urgency = round >= maxRounds - 1
    ? `\n\nNOTE: This is round ${round} of maximum ${maxRounds}. Unless there is a critical gap, prefer "accept".`
    : '';

  return `Your team has submitted their work for the goal: "${goal}"

Available roles (use EXACT names in targets): [${roleList}]

Round ${round} of ${maxRounds} — Specialist outputs:

${reports}
${urgency}

Read every output. Decide: is this ready to synthesize, or does someone need to revise?

Output your decision as JSON only:

If ready: {"action": "accept", "reason": "one sentence why"}

If revision needed:
{
  "action": "refine",
  "reason": "one sentence why the work is not yet ready",
  "targets": [
    {
      "role": "EXACT role name from the list above",
      "issue": "one sentence: what is wrong",
      "guidance": "specific instruction: what to add or fix, max 100 words, reference peer outputs where relevant"
    }
  ]
}

Rules:
- role must exactly match one of: [${roleList}]
- Only flag specialists with a SPECIFIC, FIXABLE gap — not vague improvement
- If you cannot identify a specific fixable gap, output "action": "accept"
- Output ONLY valid JSON`;
}
