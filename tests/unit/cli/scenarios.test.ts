/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-scenario regression tests for Aion CLI.
 *
 * Each test simulates a complete user-facing journey end-to-end.
 * These run on every `npm run test` to catch regressions before release.
 *
 * ── SCENARIO INDEX ───────────────────────────────────────────────────────────
 *
 *  1. 用户输入目标 → 3 agents 并行执行 → coordinator accept → synthesis 输出
 *  2. Coordinator 要求精修 → 2nd round 重试特定 agent → accept → synthesis
 *  3. 收敛检测：同一批 targets 连续两轮 → 循环终止，不无限重试
 *  4. maxRounds 到达 → 强制综合，不挂起
 *  5. 用户中途 ESC/abort → 循环立即停止，不崩溃，emits done
 *  6. 某 agent 输出为空 → 该 agent 被排除出 synthesis，其他正常汇总
 *  7. Coordinator decide() 返回损坏 JSON → 降级 accept，synthesis 仍运行
 *  8. Peer context 注入：精修轮次中 agent prompt 包含其他人的输出片段
 *  9. 单 agent 场景：不调用 synthesize（只有一人时无需汇总）
 * 10. round_display 事件携带正确的 round / maxRounds 数值
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PersistentCoordinatorLoop,
  buildPeerContextBlock,
} from '../../../src/cli/agents/PersistentCoordinatorLoop';
import type { CoordinatorSession } from '../../../src/cli/agents/coordinator';
import type { Orchestrator } from '../../../src/process/task/orchestrator/Orchestrator';
import type { SubTask, SubTaskResult, OrchestratorEvent } from '../../../src/process/task/orchestrator/types';
import type { CoordinatorLoopEvent } from '../../../src/cli/agents/ICoordinatorLoop';

// ── Shared helpers ────────────────────────────────────────────────────────────

const task = (id: string, label: string): SubTask => ({
  id,
  label,
  prompt: `${label}: ${id}`,
  agentType: 'acp',
});

const result = (subTaskId: string, output: string): SubTaskResult => ({
  subTaskId,
  conversationId: `conv-${subTaskId}`,
  outputText: output,
  completedAt: Date.now(),
});

/** Output that passes the >50-char synthesis filter. */
const substantialOutput = (label: string) =>
  `[${label}] Comprehensive analysis covering architecture, performance, and scalability in full detail.`;

const makeCoordinator = (overrides?: Partial<CoordinatorSession>): CoordinatorSession =>
  ({
    decide: vi.fn().mockResolvedValue({ action: 'accept', reason: 'looks good' }),
    synthesize: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue({ passed: true, notes: '', failedRoles: [] }),
    ...overrides,
  }) as unknown as CoordinatorSession;

/**
 * Builds a mock Orchestrator.
 * `rounds` is an array of per-round result arrays; calls cycle through them
 * (last round repeats if more calls than entries).
 */
const makeOrch = (rounds: SubTaskResult[][]): Orchestrator => {
  const handlers = new Map<string, Set<(e: OrchestratorEvent) => void>>();
  let callIdx = 0;

  return {
    run: vi.fn().mockImplementation(async (_goal: string, tasks: SubTask[]) => {
      const roundResults = rounds[Math.min(callIdx, rounds.length - 1)]!;
      callIdx++;
      // Emit subtask:done for each result
      const wildHandlers = handlers.get('*') ?? new Set();
      for (const r of roundResults) {
        if (tasks.find((t) => t.id === r.subTaskId)) {
          for (const h of wildHandlers) {
            h({ type: 'subtask:done', subTaskId: r.subTaskId, result: r });
          }
        }
      }
      return roundResults;
    }),
    on: vi.fn().mockImplementation((event: string, handler: (e: OrchestratorEvent) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn().mockImplementation((event: string, handler: (e: OrchestratorEvent) => void) => {
      handlers.get(event)?.delete(handler);
    }),
  } as unknown as Orchestrator;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Scenario 1 — 用户目标 → 并行执行 → coordinator accept → synthesis 输出', () => {
  it('3 agents run in parallel, coordinator accepts, synthesize is called with all 3 results', async () => {
    const tasks = [task('t1', 'Architect'), task('t2', 'Developer'), task('t3', 'Reviewer')];
    const results = tasks.map((t) => result(t.id, substantialOutput(t.label)));
    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({ action: 'accept', reason: 'all outputs are thorough' }),
    });
    const orch = makeOrch([results]);
    const events: CoordinatorLoopEvent[] = [];

    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 3 })
      .run('Design a scalable API', tasks, (e) => events.push(e));

    // Orchestrator ran exactly once (accept on round 1)
    expect(orch.run).toHaveBeenCalledTimes(1);
    // Coordinator made one decision
    expect(coordinator.decide).toHaveBeenCalledTimes(1);
    // Synthesis fires because there are 3 specialists
    expect(coordinator.synthesize).toHaveBeenCalledTimes(1);
    // Synthesize receives all 3 specialist results
    const [, synthResults] = (coordinator.synthesize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Array<{ role: string; output: string }>,
    ];
    expect(synthResults).toHaveLength(3);
    expect(synthResults.map((r) => r.role)).toEqual(
      expect.arrayContaining(['Architect', 'Developer', 'Reviewer']),
    );
    // Final event is 'done'
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('Scenario 2 — Coordinator 要求精修 → 2nd round 重试 → accept → synthesis', () => {
  it('refine on round 1 re-dispatches only flagged agent; accept on round 2 triggers synthesis', async () => {
    const tasks = [task('t1', 'Architect'), task('t2', 'Developer')];
    const round1 = [
      result('t1', 'High-level architecture sketch — lacks component detail and API specifications.'),
      result('t2', substantialOutput('Developer')),
    ];
    const round2 = [result('t1-r2', substantialOutput('Architect'))];

    let decideCall = 0;
    const coordinator = makeCoordinator({
      decide: vi.fn().mockImplementation(async () => {
        decideCall++;
        if (decideCall === 1) {
          return {
            action: 'refine',
            targets: [{ role: 'Architect', issue: 'Too brief', guidance: 'Add component breakdown and API list' }],
            reason: 'Architect output lacks required depth',
          };
        }
        return { action: 'accept', reason: 'architecture is now complete' };
      }),
    });
    const orch = makeOrch([round1, round2]);
    const events: CoordinatorLoopEvent[] = [];
    const capturedRoundTasks: SubTask[][] = [];
    (orch.run as ReturnType<typeof vi.fn>).mockImplementation(
      async (_goal: string, tasks: SubTask[]) => {
        capturedRoundTasks.push(tasks);
        const callIdx = capturedRoundTasks.length - 1;
        return callIdx === 0 ? round1 : round2;
      },
    );

    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 5 })
      .run('Build a microservices platform', tasks, (e) => events.push(e));

    // Round 1: both agents; Round 2: only Architect (flagged)
    expect(capturedRoundTasks[0]).toHaveLength(2);
    expect(capturedRoundTasks[1]).toHaveLength(1);
    expect(capturedRoundTasks[1]![0]!.label).toBe('Architect');
    // decide called twice
    expect(coordinator.decide).toHaveBeenCalledTimes(2);
    // synthesis runs after accept
    expect(coordinator.synthesize).toHaveBeenCalledTimes(1);
    // coordinator_decision events carry correct actions
    const decisions = events.filter((e) => e.type === 'coordinator_decision') as Array<{
      type: 'coordinator_decision';
      action: string;
    }>;
    expect(decisions[0]?.action).toBe('refine');
    expect(decisions[1]?.action).toBe('accept');
  });
});

describe('Scenario 3 — 收敛检测：同一批 targets 连续两轮 → 循环终止', () => {
  it('convergence stops the loop when the same roles are flagged two rounds in a row', async () => {
    const tasks = [task('t1', 'Architect'), task('t2', 'Developer')];
    const sameResults = [
      result('t1', 'Architecture sketch — still brief despite refinement attempt.'),
      result('t2', 'Dev plan — still brief despite refinement attempt.'),
    ];
    // Always returns refine for the same roles
    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({
        action: 'refine',
        targets: [{ role: 'Architect', issue: 'Still too brief', guidance: 'Expand substantially' }],
        reason: 'still insufficient',
      }),
    });
    let orchCalls = 0;
    const orch = makeOrch([sameResults, sameResults, sameResults]);
    (orch.run as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      orchCalls++;
      return sameResults;
    });

    const events: CoordinatorLoopEvent[] = [];
    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 10, maxRetriesPerRole: 5 })
      .run('Write a report', tasks, (e) => events.push(e));

    // Convergence kicks in after round 2 (same Architect target twice) — should NOT run 10 times
    expect(orchCalls).toBeLessThan(5);
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('Scenario 4 — maxRounds 到达 → 强制综合，不挂起', () => {
  it('always reaches synthesis even when coordinator keeps returning refine', async () => {
    const tasks = [task('t1', 'Architect'), task('t2', 'Developer')];
    const results = [
      result('t1', substantialOutput('Architect')),
      result('t2', substantialOutput('Developer')),
    ];
    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({
        action: 'refine',
        targets: [
          { role: 'Architect', issue: 'Could be better', guidance: 'Add more' },
          { role: 'Developer', issue: 'Could be better', guidance: 'Add more' },
        ],
        reason: 'always needs more',
      }),
    });
    const orch = makeOrch([results]);
    (orch.run as ReturnType<typeof vi.fn>).mockResolvedValue(results);
    const events: CoordinatorLoopEvent[] = [];

    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 2 })
      .run('Research a topic', tasks, (e) => events.push(e));

    // Loop ran at most maxIterations times, then stopped
    expect((orch.run as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(3);
    // synthesis still runs
    expect(coordinator.synthesize).toHaveBeenCalledTimes(1);
    // done event emitted — no hang
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('Scenario 5 — 用户中途 ESC/abort → 循环立即停止，emits done', () => {
  it('AbortSignal fires during orch.run → decide not called, done event still emitted', async () => {
    const controller = new AbortController();
    const tasks = [task('t1', 'Researcher'), task('t2', 'Analyst')];
    const coordinator = makeCoordinator();
    const orch = {
      run: vi.fn().mockImplementation(async () => {
        // Simulate user pressing ESC while agents are running
        controller.abort();
        return [result('t1', substantialOutput('Researcher'))];
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Orchestrator;

    const events: CoordinatorLoopEvent[] = [];
    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 5 })
      .run('Analyze the market', tasks, (e) => events.push(e), controller.signal);

    // Loop respected abort — no decide, no synthesize
    expect(coordinator.decide).not.toHaveBeenCalled();
    expect(coordinator.synthesize).not.toHaveBeenCalled();
    // Still emits done so upstream can clean up
    expect(events.at(-1)?.type).toBe('done');
    // Ran exactly once (abort happened during first run)
    expect(orch.run).toHaveBeenCalledTimes(1);
  });
});

describe('Scenario 6 — agent 输出为空 → 被排除出 synthesis', () => {
  it('agent with short/empty output is excluded from synthesize input', async () => {
    const tasks = [task('t1', 'Architect'), task('t2', 'Developer'), task('t3', 'Designer')];
    const results = [
      result('t1', substantialOutput('Architect')),
      result('t2', 'ok'), // too short — excluded from synthesis (< 50 chars)
      result('t3', substantialOutput('Designer')),
    ];
    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({ action: 'accept', reason: 'good enough' }),
    });
    const orch = makeOrch([results]);
    const events: CoordinatorLoopEvent[] = [];

    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 3 })
      .run('Design a product', tasks, (e) => events.push(e));

    expect(coordinator.synthesize).toHaveBeenCalledTimes(1);
    const [, synthResults] = (coordinator.synthesize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Array<{ role: string; output: string }>,
    ];
    // Developer's empty output excluded
    expect(synthResults.map((r) => r.role)).not.toContain('Developer');
    expect(synthResults.map((r) => r.role)).toEqual(
      expect.arrayContaining(['Architect', 'Designer']),
    );
  });
});

describe('Scenario 7 — coordinator decide() 返回损坏 JSON → 降级 accept，synthesis 仍运行', () => {
  it('null decision (broken JSON) causes loop to break and synthesize still runs', async () => {
    const tasks = [task('t1', 'Architect'), task('t2', 'Developer')];
    const results = [
      result('t1', substantialOutput('Architect')),
      result('t2', substantialOutput('Developer')),
    ];
    const coordinator = makeCoordinator({
      // Simulates what CoordinatorSession.decide() returns when JSON is unparseable
      decide: vi.fn().mockResolvedValue(null),
    });
    const orch = makeOrch([results]);
    const events: CoordinatorLoopEvent[] = [];

    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 3 })
      .run('Analyze performance', tasks, (e) => events.push(e));

    // Loop breaks on null decision
    expect(orch.run).toHaveBeenCalledTimes(1);
    // Synthesis still runs — user gets output despite coordinator failure
    expect(coordinator.synthesize).toHaveBeenCalledTimes(1);
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('Scenario 8 — Peer context 注入：精修 prompt 包含其他人的输出', () => {
  it('buildPeerContextBlock injects non-flagged peer outputs before flagged ones', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['Architect', result('t1', 'Architecture: detailed microservices breakdown with APIs and data models.')],
      ['Developer', result('t2', 'Implementation: TypeScript, Fastify, PostgreSQL with full code examples.')],
      ['Reviewer', result('t3', 'Review: identified 3 critical gaps in error handling and observability.')],
    ]);
    const flaggedRoles = new Set(['Developer']); // Developer is being refined

    const peerBlock = buildPeerContextBlock('Developer', allResults, flaggedRoles);

    // Peer block contains the other agents' outputs
    expect(peerBlock).toContain('Architect');
    expect(peerBlock).toContain('Reviewer');
    // Does not include the target agent itself
    expect(peerBlock).not.toMatch(/\[Developer\]/);
    // Peer block has the critical thinking instruction
    expect(peerBlock).toContain('identify what they missed');
  });

  it('buildPeerContextBlock returns empty string when no meaningful peer outputs exist', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['Architect', result('t1', 'ok')], // too short (<50 chars) — excluded
    ]);
    const peerBlock = buildPeerContextBlock('Developer', allResults, new Set());
    expect(peerBlock).toBe('');
  });

  it('flagged roles appear after non-flagged peers in peer context block', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['QA', result('t3', 'QA: verified all edge cases and wrote 50 regression tests for the platform.')],
      ['Reviewer', result('t2', 'Review: surface-level pass, missed several critical security issues in auth.')],
    ]);
    // Reviewer is flagged (weak); QA is not
    const flaggedRoles = new Set(['Reviewer']);
    const peerBlock = buildPeerContextBlock('Developer', allResults, flaggedRoles);

    // QA (non-flagged) should appear before Reviewer (flagged) in the block
    const qaPos = peerBlock.indexOf('QA');
    const reviewerPos = peerBlock.indexOf('Reviewer');
    expect(qaPos).toBeLessThan(reviewerPos);
  });
});

describe('Scenario 9 — 单 agent：不调用 synthesize', () => {
  it('single specialist produces output but synthesis is skipped (one voice needs no integration)', async () => {
    const tasks = [task('t1', 'Expert')];
    const results = [result('t1', substantialOutput('Expert'))];
    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({ action: 'accept', reason: 'expert output is complete' }),
    });
    const orch = makeOrch([results]);
    const events: CoordinatorLoopEvent[] = [];

    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 3 })
      .run('Explain quantum computing', tasks, (e) => events.push(e));

    // Single agent → no synthesize needed
    expect(coordinator.synthesize).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('Scenario 10 — round_display 事件携带正确的 round / maxRounds', () => {
  it('emits round_display with correct round number and maxRounds on each iteration', async () => {
    const tasks = [task('t1', 'Architect'), task('t2', 'Developer')];
    const results = [
      result('t1', substantialOutput('Architect')),
      result('t2', substantialOutput('Developer')),
    ];

    let decideCall = 0;
    const coordinator = makeCoordinator({
      decide: vi.fn().mockImplementation(async () => {
        decideCall++;
        // Round 1: refine; Round 2: accept
        if (decideCall === 1) {
          return {
            action: 'refine',
            targets: [{ role: 'Architect', issue: 'Need more detail', guidance: 'Expand' }],
            reason: 'incomplete',
          };
        }
        return { action: 'accept', reason: 'done' };
      }),
    });
    const orch = makeOrch([results, results]);
    (orch.run as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const events: CoordinatorLoopEvent[] = [];
    const MAX = 3;
    await new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: MAX })
      .run('Review codebase', tasks, (e) => events.push(e));

    const roundDisplays = events.filter((e) => e.type === 'round_display') as Array<{
      type: 'round_display';
      round: number;
      maxRounds: number;
    }>;

    // At least round 1 and round 2 display events
    expect(roundDisplays.length).toBeGreaterThanOrEqual(2);
    // First event is round 1 with correct maxRounds
    expect(roundDisplays[0]?.round).toBe(1);
    expect(roundDisplays[0]?.maxRounds).toBe(MAX);
    // Second event is round 2
    expect(roundDisplays[1]?.round).toBe(2);
    expect(roundDisplays[1]?.maxRounds).toBe(MAX);
  });
});
