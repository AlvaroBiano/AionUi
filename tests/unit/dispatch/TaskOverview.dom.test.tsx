/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

// --- Mocks --- //

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.count !== undefined) return `${key}:${params.count}`;
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@icon-park/react', () => ({
  Down: (props: Record<string, unknown>) => <span data-testid='icon-down' {...props} />,
  Up: (props: Record<string, unknown>) => <span data-testid='icon-up' {...props} />,
  People: (props: Record<string, unknown>) => <span data-testid='icon-people' {...props} />,
}));

// CSS Modules mock — return class names as-is
vi.mock('@/renderer/pages/conversation/dispatch/components/TaskOverview.module.css', () => ({
  default: new Proxy(
    {},
    {
      get: (_target, prop) => String(prop),
    }
  ),
}));

import type { ChildTaskInfoVO } from '@/renderer/pages/conversation/dispatch/types';
import TaskOverview from '@/renderer/pages/conversation/dispatch/components/TaskOverview';

// --- Helpers --- //

const makeChild = (overrides: Partial<ChildTaskInfoVO> = {}): ChildTaskInfoVO => ({
  sessionId: `child-${Math.random().toString(36).slice(2, 8)}`,
  title: 'Default Task',
  status: 'running',
  teammateName: 'Agent',
  teammateAvatar: undefined,
  createdAt: Date.now() - 60000,
  lastActivityAt: Date.now(),
  ...overrides,
});

const defaultProps = {
  dispatcherName: 'Orchestrator',
  dispatcherAvatar: undefined as string | undefined,
  children: [] as ChildTaskInfoVO[],
  selectedChildTaskId: null as string | null,
  onSelectChild: vi.fn(),
  collapsed: false,
  onToggleCollapse: vi.fn(),
};

// --- Tests --- //

describe('TaskOverview', () => {
  // TO-001: Renders task statistics (total, running, completed, failed)
  it('TO-001: renders task statistics summary', () => {
    const children = [
      makeChild({ sessionId: 'c1', status: 'running' }),
      makeChild({ sessionId: 'c2', status: 'completed' }),
      makeChild({ sessionId: 'c3', status: 'failed' }),
      makeChild({ sessionId: 'c4', status: 'pending' }),
    ];

    render(<TaskOverview {...defaultProps} children={children} />);

    // "total:4" appears in both header and summary bar, so use getAllByText
    const totalElements = screen.getAllByText('dispatch.overview.total:4');
    expect(totalElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('dispatch.overview.running:1')).toBeInTheDocument();
    expect(screen.getByText('dispatch.overview.completed:1')).toBeInTheDocument();
    expect(screen.getByText('dispatch.overview.failed:1')).toBeInTheDocument();
    expect(screen.getByText('dispatch.overview.pending:1')).toBeInTheDocument();
  });

  // TO-002: Click header triggers collapse toggle
  it('TO-002: clicking header triggers onToggleCollapse', () => {
    const onToggle = vi.fn();
    render(<TaskOverview {...defaultProps} onToggleCollapse={onToggle} children={[makeChild()]} />);

    // The header div has role="button" with aria-label for collapse/expand
    // There may be multiple elements with the same aria-label, use getAllByRole
    const buttons = screen.getAllByRole('button', {
      name: /dispatch\.overview\.collapse/,
    });
    // Click the first one (the header row)
    fireEvent.click(buttons[0]);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // TO-003: Click task row triggers onSelectChild
  it('TO-003: clicking a task row triggers onSelectChild', () => {
    const onSelect = vi.fn();
    const children = [makeChild({ sessionId: 'child-abc', teammateName: 'Agent X' })];

    render(<TaskOverview {...defaultProps} onSelectChild={onSelect} children={children} />);

    // Find the child row by agent name text
    const agentText = screen.getByText('Agent X');
    fireEvent.click(agentText);

    expect(onSelect).toHaveBeenCalledWith('child-abc');
  });

  // TO-004: Status indicator class names are correct
  it('TO-004: status dot has correct class for each status', () => {
    const children = [
      makeChild({ sessionId: 'c1', status: 'running', teammateName: 'Runner' }),
      makeChild({ sessionId: 'c2', status: 'completed', teammateName: 'Finisher' }),
      makeChild({ sessionId: 'c3', status: 'failed', teammateName: 'Failer' }),
    ];

    const { container } = render(<TaskOverview {...defaultProps} children={children} />);

    // Status dots are spans with statusDot + statusRunning/statusCompleted/statusFailed classes
    const dots = container.querySelectorAll('.statusDot');
    expect(dots.length).toBe(3);

    // First child (running) should have statusRunning class
    expect(dots[0].classList.contains('statusRunning')).toBe(true);
    // Second child (completed) should have statusCompleted class
    expect(dots[1].classList.contains('statusCompleted')).toBe(true);
    // Third child (failed) should have statusFailed class
    expect(dots[2].classList.contains('statusFailed')).toBe(true);
  });

  // TO-005: Empty data shows total:0 summary
  it('TO-005: empty children shows zero total', () => {
    render(<TaskOverview {...defaultProps} children={[]} />);

    // "total:0" appears in both header and summary bar
    const totalElements = screen.getAllByText('dispatch.overview.total:0');
    expect(totalElements.length).toBeGreaterThanOrEqual(1);
  });

  // TO-006: Dispatcher name and avatar are rendered
  it('TO-006: renders dispatcher name and avatar', () => {
    render(
      <TaskOverview
        {...defaultProps}
        dispatcherName='My Orchestrator'
        dispatcherAvatar='star'
        children={[makeChild()]}
      />
    );

    expect(screen.getByText('My Orchestrator')).toBeInTheDocument();
    expect(screen.getByText('star')).toBeInTheDocument();
  });

  // TO-007: Falls back to People icon when no dispatcher avatar
  it('TO-007: shows People icon when no dispatcher avatar', () => {
    // Use a child with an avatar so only the dispatcher People icon shows
    render(
      <TaskOverview {...defaultProps} dispatcherAvatar={undefined} children={[makeChild({ teammateAvatar: 'star' })]} />
    );

    // At least one People icon should be present (from the dispatcher header)
    const peopleIcons = screen.getAllByTestId('icon-people');
    expect(peopleIcons.length).toBeGreaterThanOrEqual(1);
  });

  // TO-008: Collapsed state hides content area
  it('TO-008: collapsed state adds collapsed CSS class', () => {
    const { container } = render(<TaskOverview {...defaultProps} collapsed={true} children={[makeChild()]} />);

    const contentArea = container.querySelector('.contentArea');
    expect(contentArea?.classList.contains('contentAreaCollapsed')).toBe(true);
  });

  // TO-009: Expanded state shows arrow Up icon
  it('TO-009: expanded state shows Up icon', () => {
    render(<TaskOverview {...defaultProps} collapsed={false} children={[makeChild()]} />);

    expect(screen.getByTestId('icon-up')).toBeInTheDocument();
  });

  // TO-010: Collapsed state shows arrow Down icon
  it('TO-010: collapsed state shows Down icon', () => {
    render(<TaskOverview {...defaultProps} collapsed={true} children={[makeChild()]} />);

    expect(screen.getByTestId('icon-down')).toBeInTheDocument();
  });

  // TO-011: Selected child row gets selected class
  it('TO-011: selected child row has selected class', () => {
    const children = [makeChild({ sessionId: 'child-sel', teammateName: 'Selected Agent' })];

    const { container } = render(
      <TaskOverview {...defaultProps} selectedChildTaskId='child-sel' children={children} />
    );

    const selectedRow = container.querySelector('.childRowSelected');
    expect(selectedRow).toBeInTheDocument();
  });

  // TO-012: Keyboard Enter triggers onSelectChild
  it('TO-012: Enter key on child row triggers onSelectChild', () => {
    const onSelect = vi.fn();
    const children = [makeChild({ sessionId: 'child-kb', teammateName: 'KB Agent' })];

    render(<TaskOverview {...defaultProps} onSelectChild={onSelect} children={children} />);

    // Find the child row by its role="button" and tabIndex
    const rows = screen.getAllByRole('button');
    // The last button-role elements are child rows (after the header and collapse button)
    const childRow = rows.find((r) => r.textContent?.includes('KB Agent'));
    expect(childRow).toBeDefined();

    fireEvent.keyDown(childRow!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('child-kb');
  });

  // TO-013: Only shows non-zero status counts in summary
  it('TO-013: omits zero-count statuses from summary bar', () => {
    const children = [
      makeChild({ sessionId: 'c1', status: 'running' }),
      makeChild({ sessionId: 'c2', status: 'running' }),
    ];

    render(<TaskOverview {...defaultProps} children={children} />);

    // Running count should show
    expect(screen.getByText('dispatch.overview.running:2')).toBeInTheDocument();
    // Completed and failed should NOT appear
    expect(screen.queryByText(/dispatch\.overview\.completed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dispatch\.overview\.failed/)).not.toBeInTheDocument();
  });
});
