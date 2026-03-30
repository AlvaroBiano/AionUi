/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * E2E tests for the `aion team` command pipeline.
 *
 * Verifies the complete flow driven by `runTeam`:
 *   1. 3 agents are dispatched in parallel (no dependsOn)
 *   2. Coordinator collects all 3 results
 *   3. Synthesis fires and writes non-empty output to stdout
 *
 * Strategy:
 *   - Mock Orchestrator to capture dispatched tasks and return substantial results
 *   - Mock CoordinatorSession.synthesize to call onText (drives synthesis_chunk → stdout)
 *   - Spy on process.stdout.write to capture synthesized output
 *   - Missing decide on mock → .catch(() => null) → loop breaks after round 1 → synthesis runs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubTask, SubTaskResult } from '@process/task/orchestrator/types';
import type { SpecialistResult } from '@/cli/agents/coordinator';

// ── Hoist shared mock state ────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const orchestratorRunSpy = vi.fn<[string, SubTask[]], Promise<SubTaskResult[]>>();
  // synthesizeSpy must be hoisted so the vi.mock factory can reference it
  const synthesizeSpy = vi.fn<
    [string, SpecialistResult[], (text: string) => void, AbortSignal?],
    Promise<void>
  >();
  return { orchestratorRunSpy, synthesizeSpy };
});

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('@process/task/orchestrator/Orchestrator', () => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  class MockOrchestrator extends EventEmitter {
    run(...args: [string, SubTask[]]): Promise<SubTaskResult[]> {
      return mocks.orchestratorRunSpy(...args);
    }
  }
  return { Orchestrator: MockOrchestrator };
});

vi.mock('@/cli/config/loader', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('@/cli/agents/factory', () => ({
  createCliAgentFactory: vi.fn(function () {
    return vi.fn();
  }),
}));

vi.mock('@/cli/ui/teamPanel', () => {
  class MockTeamPanel {
    setGoal = vi.fn();
    setLabel = vi.fn();
    setAgentKey = vi.fn();
    setDependsOn = vi.fn();
    setCoordinatorPhase = vi.fn();
    setRound = vi.fn();
    update = vi.fn();
    start = vi.fn();
    clear = vi.fn();
  }
  return { TeamPanel: MockTeamPanel };
});

vi.mock('@/cli/ui/format', () => ({
  fmt: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
  },
  hr: () => '---',
  Spinner: class {
    start() {}
    stop() {}
  },
}));

vi.mock('@/cli/agents/coordinator', () => {
  // synthesize is bound to the hoisted spy so per-test mockImplementation applies
  class MockCoordinatorSession {
    plan = vi.fn().mockResolvedValue(null);
    synthesize = mocks.synthesizeSpy;
    // decide must return a Promise so .catch() can be chained on it.
    // Returning null causes PersistentCoordinatorLoop to break after round 1 → synthesis runs.
    decide = vi.fn().mockResolvedValue(null);
    stop = vi.fn().mockResolvedValue(undefined);
  }
  return { CoordinatorSession: MockCoordinatorSession };
});

vi.mock('@/cli/ui/markdown', () => ({
  renderMarkdown: (s: string) => s,
}));

vi.mock('@/cli/ui/stdinDedup', () => ({
  createDedupStdin: vi.fn(() => process.stdin),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { runTeam } from '@/cli/commands/team';
import { loadConfig } from '@/cli/config/loader';
import type { AionCliConfig } from '@/cli/config/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AionCliConfig>): AionCliConfig {
  return {
    defaultAgent: 'claude',
    agents: { claude: { provider: 'claude-cli', bin: '/usr/bin/claude' } },
    ...overrides,
  };
}

/** 100+ char output that passes the >50-char synthesis filter. */
function makeSubstantialOutput(label: string): string {
  return `[${label}] Comprehensive analysis: detailed findings covering architecture, performance, and scalability considerations across the entire system.`;
}

/** Capture stdout.write calls; returns collected chunks and a restore fn. */
function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = vi.fn((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as unknown as typeof process.stdout.write;
  return { chunks, restore: () => { process.stdout.write = orig; } };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.orchestratorRunSpy.mockReset();
  mocks.synthesizeSpy.mockReset();
  vi.mocked(loadConfig).mockReset();
  vi.mocked(loadConfig).mockReturnValue(makeConfig());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('E2E: aion team — 3 agents parallel + collect + synthesis', () => {
  it('dispatches exactly 3 SubTasks with no inter-dependencies (true parallel)', async () => {
    const captured = captureStdout();
    let capturedTasks: SubTask[] = [];

    mocks.orchestratorRunSpy.mockImplementation((_goal, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(
        tasks.map((t) => ({
          subTaskId: t.id,
          conversationId: `conv-${t.id}`,
          outputText: makeSubstantialOutput(t.label),
          completedAt: Date.now(),
        })),
      );
    });
    mocks.synthesizeSpy.mockResolvedValue(undefined);

    await runTeam({ goal: 'analyze the system architecture', concurrency: 3 });
    captured.restore();

    // Exactly 3 tasks
    expect(capturedTasks).toHaveLength(3);
    // All IDs are unique
    expect(new Set(capturedTasks.map((t) => t.id)).size).toBe(3);
    // No dependsOn → all run in parallel in round 1
    expect(capturedTasks.every((t) => !t.dependsOn || t.dependsOn.length === 0)).toBe(true);
  });

  it('coordinator collects all 3 results (one Orchestrator.run call returns 3 SubTaskResults)', async () => {
    const captured = captureStdout();
    let capturedResults: SubTaskResult[] = [];
    let capturedTasks: SubTask[] = [];

    mocks.orchestratorRunSpy.mockImplementation((_goal, tasks) => {
      capturedTasks = tasks;
      capturedResults = tasks.map((t) => ({
        subTaskId: t.id,
        conversationId: `conv-${t.id}`,
        outputText: makeSubstantialOutput(t.label),
        completedAt: Date.now(),
      }));
      return Promise.resolve(capturedResults);
    });
    mocks.synthesizeSpy.mockResolvedValue(undefined);

    await runTeam({ goal: 'analyze the system architecture', concurrency: 3 });
    captured.restore();

    // All 3 task IDs appear in the results
    expect(capturedResults).toHaveLength(3);
    const resultIds = new Set(capturedResults.map((r) => r.subTaskId));
    for (const task of capturedTasks) {
      expect(resultIds.has(task.id)).toBe(true);
    }
    // Orchestrator called exactly once (round 1, no refinement triggers)
    expect(mocks.orchestratorRunSpy).toHaveBeenCalledTimes(1);
  });

  it('synthesis output is non-empty and written to stdout', async () => {
    const { chunks, restore } = captureStdout();

    mocks.orchestratorRunSpy.mockImplementation((_goal, tasks) =>
      Promise.resolve(
        tasks.map((t) => ({
          subTaskId: t.id,
          conversationId: `conv-${t.id}`,
          outputText: makeSubstantialOutput(t.label),
          completedAt: Date.now(),
        })),
      ),
    );

    // synthesize calls onText → triggers synthesis_chunk → written to stdout
    mocks.synthesizeSpy.mockImplementation(async (_goal, _results, onText) => {
      onText('Unified synthesis: all three agents provided comprehensive architectural analysis. ');
      onText('Key findings: modular design, separation of concerns, scalable infrastructure.');
    });

    await runTeam({ goal: 'analyze the system architecture', concurrency: 3 });
    restore();

    const allOutput = chunks.join('');
    expect(allOutput.length).toBeGreaterThan(0);
    expect(allOutput).toContain('Unified synthesis');
    expect(allOutput).toContain('three agents');
  });

  it('full pipeline: 3 agents → all collected → synthesize called with 3 specialist results', async () => {
    const { chunks, restore } = captureStdout();
    let capturedTasks: SubTask[] = [];

    mocks.orchestratorRunSpy.mockImplementation((_goal, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(
        tasks.map((t) => ({
          subTaskId: t.id,
          conversationId: `conv-${t.id}`,
          outputText: makeSubstantialOutput(t.label),
          completedAt: Date.now(),
        })),
      );
    });

    mocks.synthesizeSpy.mockImplementation(async (_goal, results, onText) => {
      const roles = (results as SpecialistResult[]).map((r) => r.role).join(', ');
      onText(`Synthesis from ${results.length} agents (${roles}): unified recommendation.`);
    });

    await runTeam({ goal: 'analyze the system architecture', concurrency: 3 });
    restore();

    // 1. Exactly 3 tasks dispatched
    expect(capturedTasks).toHaveLength(3);

    // 2. synthesize called once with exactly 3 specialist results
    expect(mocks.synthesizeSpy).toHaveBeenCalledOnce();
    const [, synthResults] = mocks.synthesizeSpy.mock.calls[0]!;
    expect((synthResults as SpecialistResult[]).length).toBe(3);

    // 3. Each specialist result's output is non-trivial (>50 chars — synthesis filter)
    for (const sr of synthResults as SpecialistResult[]) {
      expect(sr.output.trim().length).toBeGreaterThan(50);
    }

    // 4. Synthesis text appears in stdout
    const allOutput = chunks.join('');
    expect(allOutput).toContain('Synthesis from 3 agents');
  });
});

// ── Real-scenario tests: PersistentCoordinatorLoop peer-context injection ──────

/**
 * These tests exercise PersistentCoordinatorLoop directly (without runTeam) to
 * verify that refinement task prompts actually contain peer outputs — the
 * core requirement for meaningful multi-agent debate / mutual review.
 */

import { EventEmitter } from 'node:events';
import { PersistentCoordinatorLoop } from '@/cli/agents/PersistentCoordinatorLoop';
import type { CoordinatorSession } from '@/cli/agents/coordinator';
import type { Orchestrator } from '@process/task/orchestrator/Orchestrator';
import type { CoordinatorLoopEvent } from '@/cli/agents/ICoordinatorLoop';

// ── Helpers for direct loop tests ─────────────────────────────────────────────

/** Build a minimal SubTask fixture. */
function makeTask(id: string, label: string, prompt: string): SubTask {
  return { id, label, prompt, agentType: 'acp' };
}

/** Build a SubTaskResult fixture with the given output text. */
function makeResult(subTaskId: string, outputText: string): SubTaskResult {
  return { subTaskId, conversationId: `conv-${subTaskId}`, outputText, completedAt: Date.now() };
}

/**
 * Create a mock Orchestrator whose `run()` implementation can be swapped per
 * test via the returned `impl` setter.  Extends EventEmitter so the loop's
 * orch.on('*', …) / orch.off('*', …) calls don't throw.
 */
function makeMockOrch(): {
  orch: Orchestrator;
  setImpl: (fn: (goal: string, tasks: SubTask[]) => Promise<SubTaskResult[]>) => void;
  callArgs: Array<[string, SubTask[]]>;
} {
  const callArgs: Array<[string, SubTask[]]> = [];
  let impl: (goal: string, tasks: SubTask[]) => Promise<SubTaskResult[]> = (_g, tasks) =>
    Promise.resolve(tasks.map((t) => makeResult(t.id, makeSubstantialOutput(t.label))));

  class MockOrch extends EventEmitter {
    run(goal: string, tasks: SubTask[]): Promise<SubTaskResult[]> {
      callArgs.push([goal, tasks]);
      return impl(goal, tasks);
    }
  }

  const orch = new MockOrch() as unknown as Orchestrator;
  return {
    orch,
    setImpl: (fn) => { impl = fn; },
    callArgs,
  };
}

type CoordinatorDecision =
  | { action: 'accept'; reason: string }
  | { action: 'refine'; targets: Array<{ role: string; issue: string; guidance: string }>; reason: string };

/**
 * Create a mock CoordinatorSession.
 * `decideImpl` drives whether refinement is triggered.
 */
function makeMockCoordinator(opts: {
  decideImpl?: (
    goal: string,
    results: SpecialistResult[],
    round: number,
    maxRounds: number,
  ) => Promise<CoordinatorDecision | null>;
} = {}): CoordinatorSession {
  return {
    plan: vi.fn().mockResolvedValue(null),
    synthesize: vi.fn().mockResolvedValue(undefined),
    review: vi.fn().mockResolvedValue(null),
    decide: vi.fn().mockImplementation(
      opts.decideImpl ??
        (() => Promise.resolve(null)), // default: no refinement (loop stops after round 1)
    ),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as CoordinatorSession;
}

/** Collect all events emitted by a loop run. */
async function runLoop(
  loop: PersistentCoordinatorLoop,
  goal: string,
  tasks: SubTask[],
): Promise<CoordinatorLoopEvent[]> {
  const events: CoordinatorLoopEvent[] = [];
  await loop.run(goal, tasks, (e) => events.push(e));
  return events;
}

// ── Scenario 1: Two PMs debating B端 vs C端 ───────────────────────────────────

describe('Scenario 1: two PMs debate B-side vs C-side — peer output injected into round-2 prompts', () => {
  it('round-2 refinement prompts contain the peer PM output from round 1', async () => {
    const pmBOutput =
      'PM-B端观点：企业客户付费意愿强，客单价高，合同周期稳定，' +
      '定制化需求驱动深度绑定，早期聚焦 B 端可快速建立现金流正循环。' +
      '竞争格局相对清晰，销售漏斗可量化，ROI 评估周期短，便于融资叙事。' +
      '技术债可通过大客户定制反哺产品标准化。先 B 后 C 是经典路径，' +
      '企业级口碑建立后 C 端溢出效应显著，成功案例：Slack、Notion、Figma。' +
      '建议首年聚焦 3-5 个标杆行业，形成可复制的解决方案模板，降低获客成本。';

    const pmCOutput =
      'PM-C端观点：消费者市场规模是 B 端的数量级倍数，网络效应壁垒更高。' +
      '用户行为数据积累带来算法护城河，DAU/MAU 指标驱动估值逻辑有别于 ARR。' +
      'C 端产品可通过病毒传播实现低成本扩张，爆款效应难以在 B 端复制。' +
      '先 C 后 B 路径的代表：微信、抖音、美团，均是先占领用户心智再商业化。' +
      '即时反馈循环使产品迭代速度远快于 B 端，有助于快速找到 PMF。' +
      '风险在于货币化路径较长，建议通过增值订阅先行变现，控制 burn rate。';

    // Round 1: both PMs produce their full arguments
    // Round 2: low quality → coordinator requires refinement for BOTH roles
    let round = 0;
    const { orch, callArgs } = makeMockOrch();

    // Override run: round 1 returns the two PM outputs, round 2 returns anything
    const orchImpl = vi.fn<[string, SubTask[]], Promise<SubTaskResult[]>>();
    (orch as unknown as EventEmitter & { run: typeof orchImpl }).run = function (
      goal: string,
      tasks: SubTask[],
    ) {
      callArgs.push([goal, tasks]);
      return orchImpl(goal, tasks);
    };

    orchImpl
      .mockImplementationOnce((_goal, tasks) =>
        // Round 1: fixed PM outputs
        Promise.resolve([
          makeResult(tasks[0]!.id, pmBOutput),
          makeResult(tasks[1]!.id, pmCOutput),
        ]),
      )
      .mockImplementationOnce((_goal, tasks) =>
        // Round 2: refined (content doesn't matter for this assertion)
        Promise.resolve(tasks.map((t) => makeResult(t.id, makeSubstantialOutput(t.label)))),
      );

    const coordinator = makeMockCoordinator({
      decideImpl: async (_goal, _results, r) => {
        round = r;
        if (r === 1) {
          // Low quality → require BOTH PMs to refine
          return {
            action: 'refine' as const,
            reason: 'Both PMs need to address each other',
            targets: [
              {
                role: 'PM-B端',
                issue: 'Does not address C-side counter-arguments.',
                guidance: "Respond to PM-C端's points on network effects and PMF speed.",
              },
              {
                role: 'PM-C端',
                issue: 'Does not address B-side counter-arguments.',
                guidance: "Respond to PM-B端's points on cash flow and enterprise stickiness.",
              },
            ],
          };
        }
        // Round 2: quality passes, stop
        return { action: 'accept' as const, reason: 'Both PMs have responded to each other' };
      },
    });

    const tasks: SubTask[] = [
      makeTask('pm-b', 'PM-B端', '请论证为什么应该先做 B 端市场'),
      makeTask('pm-c', 'PM-C端', '请论证为什么应该先做 C 端市场'),
    ];

    const loop = new PersistentCoordinatorLoop(coordinator, orch, {
      maxIterations: 3,
      qualityThreshold: 0.85,
    });

    await runLoop(loop, '应该先做 B 端还是 C 端？', tasks);

    // Orchestrator was called twice (round 1 + round 2 refinement)
    expect(callArgs).toHaveLength(2);

    // Round-2 tasks are the refinement tasks
    const [, round2Tasks] = callArgs[1]!;
    expect(round2Tasks).toHaveLength(2);

    // Each refinement task prompt must contain the OTHER PM's round-1 output
    const pmBRefinement = round2Tasks.find((t) => t.label === 'PM-B端');
    const pmCRefinement = round2Tasks.find((t) => t.label === 'PM-C端');

    expect(pmBRefinement).toBeDefined();
    expect(pmCRefinement).toBeDefined();

    // PM-B端 refinement should see PM-C端's output
    expect(pmBRefinement!.prompt).toContain("Your team's current outputs");
    expect(pmBRefinement!.prompt).toContain('PM-C端');
    // The actual content from PM-C's round-1 output should appear in the prompt
    expect(pmBRefinement!.prompt).toContain('消费者市场规模');

    // PM-C端 refinement should see PM-B端's output
    expect(pmCRefinement!.prompt).toContain("Your team's current outputs");
    expect(pmCRefinement!.prompt).toContain('PM-B端');
    // The actual content from PM-B's round-1 output should appear in the prompt
    expect(pmCRefinement!.prompt).toContain('企业客户付费意愿强');
  });
});

// ── Scenario 2: Three-way architecture review ─────────────────────────────────

describe('Scenario 2: architect + performance engineer + security expert mutual review', () => {
  it('each refinement prompt sees at most 3 peers, all truncated to ≤1200 chars', async () => {
    // Outputs longer than 1200 chars to trigger truncation
    const longArchOutput =
      '架构方案：采用 Kafka 作为核心消息队列，结合 ZooKeeper 做 broker 协调。' +
      '消费者组支持水平扩展，分区数建议与消费者数量匹配（默认 12 分区）。' +
      '持久化层使用 RocksDB，LSM-Tree 结构保证写入吞吐。副本因子设置为 3，' +
      '跨 AZ 部署确保单 AZ 故障不丢消息。Producer 端启用幂等性（enable.idempotence=true）' +
      '并配合 acks=all 确保 exactly-once 语义。Consumer offset 提交策略建议手动提交，' +
      '避免批量消费中途崩溃导致重复消费。Schema Registry 强制 Avro/Protobuf 格式，' +
      '防止消费者因格式变更崩溃。监控层面集成 Prometheus + Grafana，关键指标：' +
      'consumer_lag、throughput_bytes_per_sec、request_latency_p99。'.repeat(2);

    const longPerfOutput =
      '性能考量：消息队列的吞吐瓶颈通常在网络 I/O 和磁盘顺序写。' +
      '建议使用零拷贝（sendfile syscall）减少内核态/用户态切换。' +
      '批量发送（batch.size=64KB, linger.ms=5）显著提升吞吐。' +
      '压缩算法选择 LZ4（延迟低）而非 GZIP（压缩率高但 CPU 开销大）。' +
      '消费者端 fetch.min.bytes 和 fetch.max.wait.ms 需根据业务延迟 SLA 调整。' +
      '避免 rebalance 风暴：session.timeout.ms 建议 45s，heartbeat.interval.ms=15s。' +
      '大消息（>1MB）建议拆分或存 S3 + 传引用，避免 broker 内存压力。'.repeat(2);

    const longSecOutput =
      '安全要求：传输层必须启用 TLS 1.3，禁用弱密码套件。' +
      'SASL/SCRAM-SHA-512 做客户端身份验证，ACL 按 topic 粒度控制读写权限。' +
      '敏感消息 payload 应用字段级加密（AES-256-GCM），密钥管理交由 Vault。' +
      '审计日志记录所有 produce/consume 操作，保留 90 天供合规审查。' +
      '防止未授权 schema 注册：Schema Registry 启用基于角色的访问控制。' +
      'broker 间通信启用 mTLS，防止中间人攻击。' +
      '定期轮换客户端证书（建议 90 天），自动化续签避免服务中断。'.repeat(2);

    let orchCallCount = 0;
    const capturedRound2Tasks: SubTask[] = [];

    const { orch } = makeMockOrch();
    const orchImpl = vi.fn<[string, SubTask[]], Promise<SubTaskResult[]>>();
    (orch as unknown as EventEmitter & { run: typeof orchImpl }).run = function (
      goal: string,
      tasks: SubTask[],
    ) {
      orchCallCount++;
      orchImpl(goal, tasks);
      if (orchCallCount === 1) {
        return Promise.resolve([
          makeResult(tasks[0]!.id, longArchOutput),
          makeResult(tasks[1]!.id, longPerfOutput),
          makeResult(tasks[2]!.id, longSecOutput),
        ]);
      }
      // Round 2: capture tasks for assertion, return adequate outputs
      capturedRound2Tasks.push(...tasks);
      return Promise.resolve(tasks.map((t) => makeResult(t.id, makeSubstantialOutput(t.label))));
    };

    let reviewCallCount = 0;
    const coordinator = makeMockCoordinator({
      decideImpl: async (_goal, _results, r) => {
        reviewCallCount = r;
        if (r === 1) {
          return {
            action: 'refine' as const,
            reason: 'All three specialists need to address cross-cutting concerns',
            targets: [
              {
                role: '系统架构师',
                issue: 'Security concerns not addressed.',
                guidance: 'Incorporate security expert recommendations.',
              },
              {
                role: '性能工程师',
                issue: 'Architecture constraints not considered.',
                guidance: 'Align performance tuning with the proposed Kafka topology.',
              },
              {
                role: '安全专家',
                issue: 'Performance impact of security controls not analyzed.',
                guidance: 'Assess TLS and encryption overhead on latency.',
              },
            ],
          };
        }
        return { action: 'accept' as const, reason: 'All specialists have addressed cross-cutting concerns' };
      },
    });

    const tasks: SubTask[] = [
      makeTask('arch-1', '系统架构师', '设计高可用消息队列系统架构'),
      makeTask('perf-1', '性能工程师', '分析消息队列系统的性能考量'),
      makeTask('sec-1', '安全专家', '评估消息队列系统的安全要求'),
    ];

    const loop = new PersistentCoordinatorLoop(coordinator, orch, {
      maxIterations: 3,
      qualityThreshold: 0.85,
    });

    await runLoop(loop, '设计一个高可用的消息队列系统', tasks);

    // Exactly 2 orchestrator calls (round 1 + refinement)
    expect(orchCallCount).toBe(2);

    // 3 refinement tasks created
    expect(capturedRound2Tasks).toHaveLength(3);

    for (const task of capturedRound2Tasks) {
      // Each refinement prompt must contain peer context header
      expect(task.prompt).toContain("Your team's current outputs");

      // Count how many peer sections appear (each starts with "### [")
      const peerSectionMatches = task.prompt.match(/### \[/g) ?? [];
      // At most 3 peers injected
      expect(peerSectionMatches.length).toBeLessThanOrEqual(3);

      // Each peer output block must be ≤1200 chars (plus truncation marker)
      // Extract peer blocks: content between "### [RoleName]\n" and next "### [" or end-of-peers
      const peerBlockRegex = /### \[[^\]]+\]\n([\s\S]*?)(?=### \[|---\n)/g;
      let match: RegExpExecArray | null;
      while ((match = peerBlockRegex.exec(task.prompt)) !== null) {
        const block = match[1]!;
        // The block content should be at most charLimit + truncation marker length
        // charLimit = 1200, truncation marker = '\n...[truncated]' (16 chars)
        expect(block.length).toBeLessThanOrEqual(1200 + '\n...[truncated]'.length + 5);
      }
    }

    // The architect's refinement should contain peer sections for the other two roles
    const archRefinement = capturedRound2Tasks.find((t) => t.label === '系统架构师');
    expect(archRefinement).toBeDefined();
    expect(archRefinement!.prompt).toContain('性能工程师');
    expect(archRefinement!.prompt).toContain('安全专家');
  });
});

// ── Scenario 3: single agent — no peer context injected ───────────────────────

describe('Scenario 3: single agent — refinement prompt must NOT include peer context header', () => {
  it('solo agent refinement prompt does not contain "Your team\'s current outputs"', async () => {
    const soloOutput =
      'Single-agent analysis: comprehensive review of the authentication system. ' +
      'Identified 3 key vulnerabilities: SQL injection in login endpoint, ' +
      'missing rate limiting on password reset, and JWT secret hardcoded in config. ' +
      'Recommended fixes: parameterized queries, Redis-backed rate limiter, ' +
      'and secrets management via environment variables or Vault. '.repeat(3);

    let orchCallCount = 0;
    const capturedRound2Tasks: SubTask[] = [];

    const { orch } = makeMockOrch();
    const orchImpl = vi.fn<[string, SubTask[]], Promise<SubTaskResult[]>>();
    (orch as unknown as EventEmitter & { run: typeof orchImpl }).run = function (
      goal: string,
      tasks: SubTask[],
    ) {
      orchCallCount++;
      orchImpl(goal, tasks);
      if (orchCallCount === 1) {
        return Promise.resolve([makeResult(tasks[0]!.id, soloOutput)]);
      }
      capturedRound2Tasks.push(...tasks);
      return Promise.resolve(tasks.map((t) => makeResult(t.id, makeSubstantialOutput(t.label))));
    };

    let reviewCallCount = 0;
    const coordinator = makeMockCoordinator({
      decideImpl: async (_goal, _results, r) => {
        reviewCallCount = r;
        if (r === 1) {
          return {
            action: 'refine' as const,
            reason: 'Audit report is missing a remediation timeline',
            targets: [
              {
                role: '安全审计师',
                issue: 'Missing remediation timeline.',
                guidance: 'Add a prioritized fix schedule with estimated effort.',
              },
            ],
          };
        }
        return { action: 'accept' as const, reason: 'Audit report now includes a remediation timeline' };
      },
    });

    const tasks: SubTask[] = [makeTask('solo-1', '安全审计师', '对系统进行全面安全审计')];

    const loop = new PersistentCoordinatorLoop(coordinator, orch, {
      maxIterations: 3,
      qualityThreshold: 0.85,
    });

    await runLoop(loop, '对认证系统进行安全审计', tasks);

    // Orchestrator called twice
    expect(orchCallCount).toBe(2);

    // One refinement task
    expect(capturedRound2Tasks).toHaveLength(1);

    const refinementTask = capturedRound2Tasks[0]!;

    // MUST NOT contain peer context — there are no peers
    expect(refinementTask.prompt).not.toContain("Your team's current outputs");
    // Still contains coordinator feedback
    expect(refinementTask.prompt).toContain('Coordinator Feedback');
  });
});
