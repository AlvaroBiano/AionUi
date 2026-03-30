/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TeamPanel — real-time terminal display of multi-agent team progress.
 *
 * Subscribes to OrchestratorEvent and renders a live status panel showing
 * each agent's label, status icon, and a rolling preview of streaming output.
 * Uses terminal escape codes to update in place (no external deps).
 */
import type { OrchestratorEvent } from '@process/task/orchestrator/types';
import { fmt, clearLines, hr, physicalRows, STATUS_ICONS } from './format';
import { stripMarkdown } from './markdown';
import { displayWidth, truncateToWidth } from './termUtils';
import { parseProgressChunk } from './progressParser';
import { TodoTracker } from './todoDisplay';
import type { TodoItem } from '../agents/ICoordinatorLoop';

type AgentState = {
  label: string;
  agentKey?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  preview: string;
  startedAt?: number;
  dependsOnLabels?: string[];
  todos?: TodoItem[];
};

type CoordinatorPhase =
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'refining'
  | 'synthesizing'
  | 'verifying'
  | 'done';

const COORDINATOR_PHASE_LABELS: Record<CoordinatorPhase, string> = {
  planning: 'Planning team',
  executing: 'Executing',
  reviewing: 'Reviewing outputs',
  refining: 'Refining',
  synthesizing: 'Synthesizing',
  verifying: 'Verifying outputs',
  done: '',
};

export class TeamPanel {
  private agents = new Map<string, AgentState>();
  private lastLineCount = 0;
  private goal = '';
  private coordinatorPhase: CoordinatorPhase | null = null;
  private spinnerFrame = 0;
  private readonly SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private renderTimer: NodeJS.Timeout | null = null;
  private currentRound: number | null = null;
  private maxRounds: number | null = null;
  private readonly todoTracker = new TodoTracker();

  setGoal(goal: string): void {
    this.goal = goal;
  }

  /** Update the coordinator workflow phase shown at the top of the panel. */
  setCoordinatorPhase(phase: CoordinatorPhase): void {
    this.coordinatorPhase = phase;
  }

  setRound(round: number, maxRounds: number): void {
    this.currentRound = round;
    this.maxRounds = maxRounds;
  }

  setLabel(subTaskId: string, label: string): void {
    const agent = this.agents.get(subTaskId);
    if (agent) {
      agent.label = label;
    } else {
      this.agents.set(subTaskId, { label, status: 'pending', preview: '' });
    }
  }

  /** Set the agent key (model name) shown in brackets next to the role label. */
  setAgentKey(subTaskId: string, agentKey: string): void {
    const agent = this.agents.get(subTaskId);
    if (agent) {
      agent.agentKey = agentKey;
    } else {
      this.agents.set(subTaskId, { label: subTaskId, agentKey, status: 'pending', preview: '' });
    }
  }

  /** Record which roles this task is waiting on (shown in "waiting for X" status). */
  setDependsOn(subTaskId: string, dependsOnLabels: string[]): void {
    const agent = this.agents.get(subTaskId);
    if (agent) agent.dependsOnLabels = dependsOnLabels;
  }

  /** Start rendering immediately — shows pending state before first event fires. */
  start(): void {
    if (this.renderTimer) return;
    this.renderTimer = setInterval(() => {
      this.spinnerFrame++;
      this.render();
    }, 100);
    this.renderTimer.unref();
    this.render(); // immediate first paint
  }

  update(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'subtask:started': {
        const existing = this.agents.get(event.subTaskId);
        this.agents.set(event.subTaskId, {
          label: existing?.label ?? event.subTaskId,
          status: 'running',
          preview: '',
          startedAt: Date.now(),
        });
        break;
      }
      case 'subtask:progress': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) {
          const rawText = event.text;
          // Use progressParser to filter noise and surface meaningful lines
          const lines = parseProgressChunk(rawText);
          if (lines.length > 0) {
            const cleaned = lines
              .map((l) => stripMarkdown(l.text))
              .join(' ')
              .replace(/\n/g, ' ');
            const combined = (agent.preview + ' ' + cleaned).replace(/\n/g, ' ');
            agent.preview = Array.from(combined.trim()).slice(-200).join('');
          }
          // Track todo items from the raw text
          const updatedTodos = this.todoTracker.feed(event.subTaskId, rawText);
          if (updatedTodos !== null) {
            agent.todos = updatedTodos;
          }
        }
        break;
      }
      case 'subtask:done': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) agent.status = 'done';
        this.todoTracker.clear(event.subTaskId);
        break;
      }
      case 'subtask:failed': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) {
          agent.status = 'failed';
          agent.preview = event.error;
        }
        break;
      }
      case 'orchestrator:failed': {
        // Mark any still-running or pending agents as cancelled
        for (const agent of this.agents.values()) {
          if (agent.status === 'running' || agent.status === 'pending') {
            agent.status = 'cancelled';
          }
        }
        break;
      }
    }
    // Start throttled render timer (idempotent — only one timer runs at a time)
    if (!this.renderTimer) {
      this.renderTimer = setInterval(() => {
        this.spinnerFrame++;
        this.render();
      }, 100);
      this.renderTimer.unref();
    }
  }

  render(): void {
    if (!process.stdout.isTTY) return; // non-TTY: don't mess with escape codes
    if (!this.renderTimer) return; // already cleared, don't render
    if (this.lastLineCount > 0) {
      clearLines(this.lastLineCount);
    }

    const lines: string[] = [];

    if (this.goal) {
      lines.push(`${fmt.dim('▸')} ${fmt.bold(this.goal)}`);
      lines.push(fmt.dim(hr()));
    }

    if (this.coordinatorPhase && this.coordinatorPhase !== 'done') {
      const spin = this.SPIN[this.spinnerFrame % this.SPIN.length]!;
      const phaseLabel = COORDINATOR_PHASE_LABELS[this.coordinatorPhase];
      const roundSuffix =
        this.currentRound !== null && this.currentRound > 1
          ? `  Round ${this.currentRound}/${this.maxRounds}`
          : '';
      lines.push(
        `  ${fmt.cyan(spin)} ${fmt.dim(`coordinator · ${phaseLabel}${roundSuffix}`)}`,
      );
    }

    for (const [id, state] of this.agents) {
      const agentTag = state.agentKey ? fmt.dim(` [${state.agentKey}]`) : '';
      const label = fmt.bold(state.label || id) + agentTag;

      let coloredIcon: string;
      let statusSuffix = '';

      if (state.status === 'running') {
        const spin = this.SPIN[this.spinnerFrame % this.SPIN.length]!;
        coloredIcon = fmt.cyan(spin);
        if (state.startedAt !== undefined) {
          const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
          statusSuffix = ' ' + fmt.dim(`${elapsed}s`);
        }
      } else if (state.status === 'done') {
        coloredIcon = fmt.green(STATUS_ICONS.done);
      } else if (state.status === 'failed') {
        coloredIcon = fmt.red(STATUS_ICONS.failed);
      } else if (state.status === 'cancelled') {
        coloredIcon = fmt.dim(STATUS_ICONS.cancelled);
        statusSuffix = ' ' + fmt.dim('cancelled');
      } else {
        coloredIcon = fmt.dim(STATUS_ICONS.pending);
        const depText = state.dependsOnLabels?.length
          ? `waiting for ${state.dependsOnLabels.join(', ')}`
          : 'waiting';
        statusSuffix = ' ' + fmt.dim(depText);
      }

      let preview = '';
      const cols = process.stdout.columns ?? 80;
      const agentTagText = state.agentKey ? ` [${state.agentKey}]` : '';
      const labelWidth = displayWidth(state.label || id) + displayWidth(agentTagText);
      // Measure actual suffix visual width (strip ANSI codes first)
      // eslint-disable-next-line no-control-regex
      const suffixText = statusSuffix.replace(/\u001b\[[0-9;]*m/g, '');
      const suffixCols = displayWidth(suffixText);
      // prefix: "  " (2) + icon (1) + " " (1) + label + suffix + " " (1) padding
      const prefixCols = 2 + 1 + 1 + labelWidth + suffixCols + 2;
      const maxPreviewCols = Math.max(0, cols - prefixCols - 2);
      if (state.status === 'failed' && state.preview) {
        preview = fmt.red(' ' + truncateToWidth(state.preview.trim(), maxPreviewCols));
      } else if (state.preview) {
        preview = fmt.dim(' ' + truncateToWidth(state.preview.trim(), maxPreviewCols));
      }

      lines.push(`  ${coloredIcon} ${label}${statusSuffix}${preview}`);

      const todos = state.todos;
      if (todos && todos.length > 0) {
        const shown = todos.slice(0, 3);
        for (const todo of shown) {
          const icon =
            todo.status === 'done'
              ? fmt.green('✓')
              : todo.status === 'in_progress'
                ? fmt.cyan('◐')
                : fmt.dim('·');
          lines.push(`    ${icon} ${fmt.dim(todo.text.slice(0, 60))}`);
        }
        if (todos.length > 3) {
          lines.push(`    ${fmt.dim(`+${todos.length - 3} more`)}`);
        }
      }
    }

    if (lines.length > 0) {
      process.stdout.write(lines.join('\n') + '\n');
    }
    // Count physical rows (accounts for line wrapping on narrow terminals)
    const rendered = lines.join('\n') + '\n';
    this.lastLineCount = physicalRows(rendered);
  }

  clear(): void {
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
    if (this.lastLineCount > 0) {
      clearLines(this.lastLineCount);
      this.lastLineCount = 0;
    }
  }
}
