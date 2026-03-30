/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistentCoordinatorLoop, buildPeerContextBlock } from '../../../src/cli/agents/PersistentCoordinatorLoop';
import type { CoordinatorSession } from '../../../src/cli/agents/coordinator';
import type { Orchestrator } from '../../../src/process/task/orchestrator/Orchestrator';
import type { SubTask, SubTaskResult, OrchestratorEvent } from '../../../src/process/task/orchestrator/types';
import type { CoordinatorLoopEvent } from '../../../src/cli/agents/ICoordinatorLoop';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeTask = (id: string, label: string): SubTask => ({
  id,
  label,
  prompt: `${label}: analyze the codebase`,
  agentType: 'acp',
});

const makeResult = (subTaskId: string, output: string): SubTaskResult => ({
  subTaskId,
  conversationId: `conv-${subTaskId}`,
  outputText: output,
  completedAt: Date.now(),
});

// ── Mock factories ────────────────────────────────────────────────────────────

const makeCoordinator = (overrides?: Partial<CoordinatorSession>): CoordinatorSession =>
  ({
    decide: vi.fn().mockResolvedValue({ action: 'accept', reason: 'work is complete' }),
    synthesize: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue({ passed: true, notes: '', failedRoles: [] }),
    ...overrides,
  }) as unknown as CoordinatorSession;

/**
 * Creates a mock Orchestrator that fires subtask:done events during run()
 * in the order matching the tasks array, then returns the results.
 */
const makeOrch = (results: SubTaskResult[]): Orchestrator => {
  const handlers = new Map<string, Set<(e: OrchestratorEvent) => void>>();

  return {
    run: vi.fn().mockImplementation(async (_goal: string, tasks: SubTask[]) => {
      // Simulate subtask:done events for each task that has a matching result
      for (const r of results) {
        const task = tasks.find((t) => t.id === r.subTaskId);
        if (task) {
          const eventHandlers = handlers.get('*') ?? new Set();
          for (const h of eventHandlers) {
            h({ type: 'subtask:done', subTaskId: r.subTaskId, result: r });
          }
        }
      }
      return results;
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

describe('PersistentCoordinatorLoop', () => {
  let events: CoordinatorLoopEvent[];

  beforeEach(() => {
    events = [];
  });

  // 1. Basic round execution
  it('runs orch.run() once, calls decide, calls synthesize', async () => {
    const tasks = [makeTask('t1', 'Architect')];
    const results = [
      makeResult('t1', 'Architecture plan with detailed microservices design and component breakdown.'),
    ];
    const coordinator = makeCoordinator();
    const orch = makeOrch(results);
    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 1 });

    await loop.run('Design a system', tasks, (e) => events.push(e));

    expect(orch.run).toHaveBeenCalledTimes(1);
    expect(coordinator.decide).toHaveBeenCalledTimes(1);
    expect(coordinator.synthesize).not.toHaveBeenCalled(); // single specialist skips synthesis
  });

  it('calls synthesize when there are multiple specialists', async () => {
    const tasks = [makeTask('t1', 'Architect'), makeTask('t2', 'Developer')];
    const results = [
      makeResult('t1', 'Architecture plan with detailed microservices design and component breakdown.'),
      makeResult('t2', 'Implementation details with TypeScript, Fastify, PostgreSQL, and Drizzle ORM.'),
    ];
    const coordinator = makeCoordinator();
    const orch = makeOrch(results);
    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 1 });

    await loop.run('Design a system', tasks, (e) => events.push(e));

    expect(coordinator.synthesize).toHaveBeenCalledTimes(1);
  });

  // 2. Accept decision
  it('stops after round 1 if coordinator returns accept', async () => {
    const tasks = [makeTask('t1', 'Architect'), makeTask('t2', 'Developer')];
    const results = [
      makeResult('t1', 'Detailed architecture with full explanation of all components and tradeoffs.'),
      makeResult('t2', 'Complete implementation guide with code examples and deployment steps.'),
    ];
    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({ action: 'accept', reason: 'outputs are thorough and complete' }),
    });
    const orch = makeOrch(results);
    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 5 });

    await loop.run('Design a system', tasks, (e) => events.push(e));

    expect(orch.run).toHaveBeenCalledTimes(1);
    expect(coordinator.decide).toHaveBeenCalledTimes(1);
  });

  // 3. Refinement round triggered
  it('triggers refinement round when coordinator returns refine', async () => {
    const tasks = [makeTask('t1', 'Architect'), makeTask('t2', 'Developer')];
    const round1Results = [
      makeResult('t1', 'Architecture plan — brief sketch of microservices approach.'),
      makeResult('t2', 'Implementation plan.'),
    ];
    const round2Results = [
      makeResult('t1-r', 'Fully detailed architecture with all components, APIs, and data flows explained.'),
    ];

    let callCount = 0;
    const coordinator = makeCoordinator({
      decide: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            action: 'refine',
            targets: [{ role: 'Architect', issue: 'Too brief', guidance: 'Add more detail to each component' }],
            reason: 'Architect output lacks sufficient detail',
          };
        }
        return { action: 'accept', reason: 'fixed' };
      }),
    });

    // Second call to orch.run returns round2Results
    let orchCallCount = 0;
    const orch = {
      run: vi.fn().mockImplementation(async (_goal: string, _tasks: SubTask[]) => {
        orchCallCount++;
        return orchCallCount === 1 ? round1Results : round2Results;
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Orchestrator;

    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 3 });

    await loop.run('Design a system', tasks, (e) => events.push(e));

    expect(orch.run).toHaveBeenCalledTimes(2);
    expect(coordinator.decide).toHaveBeenCalledTimes(2);
  });

  // 4. Abort signal respected
  it('stops cleanly when signal is aborted', async () => {
    const tasks = [makeTask('t1', 'Architect')];
    const controller = new AbortController();

    const orch = {
      run: vi.fn().mockImplementation(async () => {
        controller.abort();
        return [makeResult('t1', 'Partial output before abort.')];
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Orchestrator;

    const coordinator = makeCoordinator();
    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 5 });

    await loop.run('Design a system', tasks, (e) => events.push(e), controller.signal);

    // decide should not be called if aborted after orch.run
    expect(coordinator.decide).not.toHaveBeenCalled();

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
  });

  // 5. Max iterations enforced
  it('stops at maxIterations even if coordinator keeps returning refine', async () => {
    const tasks = [makeTask('t1', 'Architect'), makeTask('t2', 'Developer')];
    const results = [
      makeResult('t1', 'Minimal architecture sketch without any detailed component breakdown.'),
      makeResult('t2', 'Basic implementation notes without code examples or deployment details.'),
    ];
    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({
        action: 'refine',
        targets: [
          { role: 'Architect', issue: 'Too brief', guidance: 'Add more detail' },
          { role: 'Developer', issue: 'Too brief', guidance: 'Add code examples' },
        ],
        reason: 'outputs are insufficient',
      }),
    });

    let orchCallCount = 0;
    const orch = {
      run: vi.fn().mockImplementation(async () => {
        orchCallCount++;
        return results;
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Orchestrator;

    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 2 });

    await loop.run('Design a system', tasks, (e) => events.push(e));

    // Should run exactly maxIterations times
    expect(orch.run).toHaveBeenCalledTimes(2);
  });

  // 6. Max retries per role
  it('same role not re-dispatched more than maxRetriesPerRole times', async () => {
    const tasks = [makeTask('t1', 'Architect'), makeTask('t2', 'Developer')];
    const results = [
      makeResult('t1', 'Architecture notes — incomplete design missing major components.'),
      makeResult('t2', 'Dev notes — incomplete implementation without real detail.'),
    ];

    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({
        action: 'refine',
        targets: [{ role: 'Architect', issue: 'Too brief', guidance: 'Expand all sections' }],
        reason: 'architect output is too brief',
      }),
    });

    let orchCallCount = 0;
    const orch = {
      run: vi.fn().mockImplementation(async () => {
        orchCallCount++;
        return results;
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Orchestrator;

    // maxRetriesPerRole: 1 means Architect can be retried only once
    const loop = new PersistentCoordinatorLoop(coordinator, orch, {
      maxIterations: 5,
      maxRetriesPerRole: 1,
    });

    await loop.run('Design a system', tasks, (e) => events.push(e));

    // Round 1: original tasks, Round 2: one refinement (Architect retry 1/1)
    // Round 3 would need Architect again but maxRetriesPerRole=1, so stops
    expect(orch.run).toHaveBeenCalledTimes(2);
  });

  // 7. Convergence detection
  it('stops when coordinator returns same targets two rounds in a row (convergence)', async () => {
    const tasks = [makeTask('t1', 'Architect'), makeTask('t2', 'Developer')];
    const results = [
      makeResult('t1', 'Architecture notes — incomplete design missing major components and decisions.'),
      makeResult('t2', 'Dev notes — incomplete implementation without real code examples or deployment.'),
    ];

    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({
        action: 'refine',
        targets: [{ role: 'Architect', issue: 'Still too brief', guidance: 'Expand all sections further' }],
        reason: 'architect output remains insufficient',
      }),
    });

    let orchCallCount = 0;
    const orch = {
      run: vi.fn().mockImplementation(async () => {
        orchCallCount++;
        return results;
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Orchestrator;

    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 5 });

    await loop.run('Design a system', tasks, (e) => events.push(e));

    // Round 1: original run, refine Architect
    // Round 2: refine run, refine Architect again (same targets) → convergence stop
    expect(orch.run).toHaveBeenCalledTimes(2);
  });
});

// ── Real scenario ─────────────────────────────────────────────────────────────

describe('Real scenario: coordinator monitors individual agents', () => {
  it('coordinator decide() is called after each round with all results', async () => {
    const tasks = [
      makeTask('arch1', 'Software Architect'),
      makeTask('dev1', 'Backend Developer'),
      makeTask('qa1', 'QA Engineer'),
    ];
    const results = [
      makeResult(
        'arch1',
        'Architecture: use microservices with event sourcing. This covers scalability, fault tolerance, and the tech stack decisions in detail with specific recommendations.',
      ),
      makeResult(
        'dev1',
        'Implementation: Node.js with TypeScript, Fastify framework, PostgreSQL with Drizzle ORM. Full API routes designed.',
      ),
      makeResult(
        'qa1',
        'Testing plan: unit tests with Vitest, integration tests with Supertest, load testing with k6. Coverage targets defined.',
      ),
    ];

    const coordinator = makeCoordinator({
      decide: vi.fn().mockResolvedValue({ action: 'accept', reason: 'all outputs are thorough and ready to synthesize' }),
    });

    const orch = makeOrch(results);
    const loop = new PersistentCoordinatorLoop(coordinator, orch, { maxIterations: 1 });

    const collectedEvents: CoordinatorLoopEvent[] = [];
    await loop.run('Design a scalable API system', tasks, (e) => collectedEvents.push(e));

    // Coordinator decide() should have been called once after the round
    expect(coordinator.decide).toHaveBeenCalledTimes(1);

    // Verify action was 'accept' and synthesis ran (3 specialists)
    const decisionCall = (coordinator.decide as ReturnType<typeof vi.fn>).mock.results[0];
    expect(decisionCall.value).resolves.toMatchObject({ action: 'accept' });

    expect(coordinator.synthesize).toHaveBeenCalledTimes(1);
  });
});

// ── buildPeerContextBlock unit tests ─────────────────────────────────────────

/**
 * Helper to build a SubTaskResult stub for use in Map entries.
 */
const makePeerResult = (subTaskId: string, output: string): SubTaskResult => ({
  subTaskId,
  conversationId: `conv-${subTaskId}`,
  outputText: output,
  completedAt: Date.now(),
});

describe('buildPeerContextBlock', () => {
  // 1. Basic injection: 2 peers, target not among them → non-empty string
  it('returns non-empty string when allResults has 2 peers and target is not among them', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['Architect', makePeerResult('t1', 'Architecture plan with detailed microservices design and full component breakdown.')],
      ['Developer', makePeerResult('t2', 'Implementation guide with TypeScript, Fastify, and PostgreSQL including schema details.')],
    ]);
    const result = buildPeerContextBlock('QA', allResults, new Set());
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Architect');
    expect(result).toContain('Developer');
  });

  // 2. Exclude self: target role's output does NOT appear in the injection
  it('does not include the target role output in the returned block', () => {
    const targetOutput = 'QA analysis: test coverage is insufficient and needs improvement across all modules.';
    const allResults = new Map<string, SubTaskResult>([
      ['Architect', makePeerResult('t1', 'Architecture plan with detailed microservices design and component descriptions.')],
      ['QA', makePeerResult('t3', targetOutput)],
    ]);
    const result = buildPeerContextBlock('QA', allResults, new Set());
    expect(result).not.toContain(targetOutput);
    expect(result).not.toContain('### [QA]');
  });

  // 3. Short output filtered: peer with < 50 chars is skipped
  it('skips peers whose output is shorter than 50 characters', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['Architect', makePeerResult('t1', 'Short.')], // < 50 chars
      ['Developer', makePeerResult('t2', 'Implementation guide with TypeScript, Fastify, and PostgreSQL including schema details.')],
    ]);
    const result = buildPeerContextBlock('QA', allResults, new Set());
    expect(result).not.toContain('### [Architect]');
    expect(result).toContain('### [Developer]');
  });

  // 4. Truncation: output > 1200 chars → block contains '...[truncated]'
  it('truncates long peer output and appends ...[truncated] marker', () => {
    const longOutput = 'A'.repeat(1300);
    const allResults = new Map<string, SubTaskResult>([
      ['Architect', makePeerResult('t1', longOutput)],
    ]);
    const result = buildPeerContextBlock('QA', allResults, new Set());
    expect(result).toContain('...[truncated]');
  });

  // 5. No truncation: output <= 1200 chars → no '...[truncated]' in result
  it('does not truncate output that is within the char limit', () => {
    const shortEnoughOutput = 'B'.repeat(1000) + ' architecture decisions documented here.';
    const allResults = new Map<string, SubTaskResult>([
      ['Architect', makePeerResult('t1', shortEnoughOutput)],
    ]);
    const result = buildPeerContextBlock('QA', allResults, new Set());
    expect(result).not.toContain('...[truncated]');
  });

  // 6. maxPeers limit: 5 peers available but only 3 injected
  it('respects maxPeers and includes at most 3 peers by default', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['RoleA', makePeerResult('a', 'Role A output with enough characters to pass the fifty character filter threshold.')],
      ['RoleB', makePeerResult('b', 'Role B output with enough characters to pass the fifty character filter threshold.')],
      ['RoleC', makePeerResult('c', 'Role C output with enough characters to pass the fifty character filter threshold.')],
      ['RoleD', makePeerResult('d', 'Role D output with enough characters to pass the fifty character filter threshold.')],
      ['RoleE', makePeerResult('e', 'Role E output with enough characters to pass the fifty character filter threshold.')],
    ]);
    const result = buildPeerContextBlock('Target', allResults, new Set());
    // Default maxPeers is 3; count how many role headers appear
    const headerMatches = (result.match(/### \[Role[A-E]\]/g) ?? []).length;
    expect(headerMatches).toBe(3);
  });

  // 7. Priority: non-flagged peers appear before flagged peers in the output
  it('places non-flagged peers before flagged peers in the output block', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['FlaggedRole', makePeerResult('f', 'Flagged role output with enough characters to pass the fifty char filter threshold.')],
      ['GoodRole', makePeerResult('g', 'Good role output with enough characters to pass the fifty char filter threshold easily.')],
    ]);
    const flaggedRoles = new Set(['FlaggedRole']);
    const result = buildPeerContextBlock('Target', allResults, flaggedRoles);
    const goodIdx = result.indexOf('### [GoodRole]');
    const flaggedIdx = result.indexOf('### [FlaggedRole]');
    // GoodRole (non-flagged) must appear first
    expect(goodIdx).toBeLessThan(flaggedIdx);
  });

  // 8. Empty allResults → returns empty string
  it('returns empty string when allResults is empty', () => {
    const result = buildPeerContextBlock('Target', new Map(), new Set());
    expect(result).toBe('');
  });

  // 9. Single agent scenario: only the target itself in allResults → empty string
  it('returns empty string when allResults contains only the target role', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['Target', makePeerResult('t', 'Target output with many characters exceeding the fifty character threshold easily.')],
    ]);
    const result = buildPeerContextBlock('Target', allResults, new Set());
    expect(result).toBe('');
  });

  // 10. All peers filtered: every peer output < 50 chars → empty string
  it('returns empty string when all peer outputs are below the 50-char minimum', () => {
    const allResults = new Map<string, SubTaskResult>([
      ['RoleA', makePeerResult('a', 'Too short.')],
      ['RoleB', makePeerResult('b', 'Also short.')],
      ['RoleC', makePeerResult('c', 'Tiny.')],
    ]);
    const result = buildPeerContextBlock('Target', allResults, new Set());
    expect(result).toBe('');
  });
});
