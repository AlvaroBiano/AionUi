/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before any imports
// ---------------------------------------------------------------------------

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: vi.fn((backend: string) => (backend === 'claude' ? '/claude.svg' : null)),
  resolveAgentLogo: vi.fn((opts: { backend?: string }) => (opts.backend === 'claude' ? '/claude.svg' : null)),
}));

vi.mock('@/renderer/utils/platform', () => ({
  resolveExtensionAssetUrl: vi.fn(() => undefined),
}));

vi.mock('@/common/types/acpTypes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/types/acpTypes')>();
  return {
    ...actual,
    getAcpBackendConfig: vi.fn((backend: string) => ({
      id: backend,
      name: backend,
      description: `Description for ${backend}`,
      descriptionI18n: { 'en-US': `Description for ${backend}` },
    })),
  };
});

vi.mock('@icon-park/react', () => ({
  Down: () => <span data-testid='icon-down'>DownIcon</span>,
  Robot: () => <span data-testid='icon-robot'>RobotIcon</span>,
  Comment: () => <span data-testid='icon-comment'>CommentIcon</span>,
}));

vi.mock('../../src/renderer/pages/guid/index.module.css', () => ({
  default: {
    heroAgentNameRow: 'hero-agent-name-row',
    heroAgentName: 'hero-agent-name',
    agentSelectorPanel: 'agent-selector-panel',
    agentSelectorSearch: 'agent-selector-search',
    agentSelectorList: 'agent-selector-list',
    agentSelectorSectionLabel: 'agent-selector-section-label',
    agentSelectorItem: 'agent-selector-item',
    agentSelectorItemActive: 'agent-selector-item-active',
    agentSelectorAvatar: 'agent-selector-avatar',
    agentSelectorAvatarImg: 'agent-selector-avatar-img',
    agentSelectorItemInfo: 'agent-selector-item-info',
    agentSelectorItemName: 'agent-selector-item-name',
    agentSelectorItemDesc: 'agent-selector-item-desc',
    agentSelectorCheck: 'agent-selector-check',
    agentSelectorDivider: 'agent-selector-divider',
    agentSelectorFooter: 'agent-selector-footer',
    agentSelectorSearchInput: 'agent-selector-search-input',
  },
}));

vi.mock('../../src/renderer/pages/guid/constants', () => ({
  CUSTOM_AVATAR_IMAGE_MAP: {},
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Dropdown: ({
      droplist,
      children,
    }: {
      droplist: React.ReactNode;
      children: React.ReactNode;
      [key: string]: unknown;
    }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
    Input: ({ value, onChange, placeholder }: { value?: string; onChange?: (v: string) => void; placeholder?: string }) => (
      <input value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} />
    ),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AgentSelectorPopover from '../../src/renderer/pages/guid/components/AgentPillBar';
import type { AvailableAgent } from '../../src/renderer/pages/guid/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getAgentKey = (agent: { backend: string; customAgentId?: string }) =>
  agent.customAgentId ? `${agent.backend}:${agent.customAgentId}` : agent.backend;

const makeAgent = (overrides: Partial<AvailableAgent> & { backend: AvailableAgent['backend'] }): AvailableAgent => ({
  name: overrides.backend,
  ...overrides,
});

const defaultProps = {
  displayAgentName: 'Claude Code',
  regularAgents: [makeAgent({ backend: 'claude', name: 'Claude Code' })],
  presetAssistants: [],
  selectedAgentKey: 'claude',
  isPresetAgent: false,
  localeKey: 'en-US',
  selectedCustomAgentId: undefined,
  getAgentKey,
  onSelect: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentSelectorPopover', () => {
  it('renders trigger with displayAgentName', () => {
    render(<AgentSelectorPopover {...defaultProps} />);
    expect(screen.getAllByText('Claude Code').length).toBeGreaterThanOrEqual(1);
  });

  it('renders down chevron icon in trigger', () => {
    render(<AgentSelectorPopover {...defaultProps} />);
    expect(screen.getByTestId('icon-down')).toBeTruthy();
  });

  it('shows agent names in popup list', () => {
    const agents: AvailableAgent[] = [
      makeAgent({ backend: 'claude', name: 'Claude Code' }),
      makeAgent({ backend: 'gemini', name: 'Gemini CLI' }),
    ];
    render(
      <AgentSelectorPopover
        {...defaultProps}
        regularAgents={agents}
        displayAgentName='Claude Code'
        selectedAgentKey='claude'
      />
    );
    expect(screen.getAllByText('Claude Code').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Gemini CLI')).toBeTruthy();
  });

  it('calls onSelect with agent key when item clicked', () => {
    const onSelect = vi.fn();
    const agents: AvailableAgent[] = [
      makeAgent({ backend: 'claude', name: 'Claude Code' }),
      makeAgent({ backend: 'gemini', name: 'Gemini CLI' }),
    ];
    render(
      <AgentSelectorPopover {...defaultProps} regularAgents={agents} selectedAgentKey='claude' onSelect={onSelect} />
    );
    const geminiItem = screen.getAllByText('Gemini CLI')[0].closest('.agent-selector-item') as HTMLElement;
    fireEvent.click(geminiItem);
    expect(onSelect).toHaveBeenCalledWith('gemini');
  });

  it('applies active style on selected agent item', () => {
    const agents: AvailableAgent[] = [makeAgent({ backend: 'claude', name: 'Claude Code' })];
    render(
      <AgentSelectorPopover {...defaultProps} regularAgents={agents} selectedAgentKey='claude' isPresetAgent={false} />
    );
    const items = document.querySelectorAll('.agent-selector-item');
    const activeItems = Array.from(items).filter((el) => el.classList.contains('agent-selector-item-active'));
    expect(activeItems.length).toBeGreaterThanOrEqual(1);
  });

  it('renders preset assistants section when provided', () => {
    const presets = [
      {
        id: 'my-assistant',
        name: 'My Assistant',
        description: 'A helpful assistant',
        isPreset: true,
        enabled: true,
      },
    ];
    render(<AgentSelectorPopover {...defaultProps} presetAssistants={presets as never} />);
    expect(screen.getByText('My Assistant')).toBeTruthy();
  });

  it('navigates to /assistants when footer clicked', () => {
    render(<AgentSelectorPopover {...defaultProps} />);
    const footer = document.querySelector('.agent-selector-footer') as HTMLElement;
    fireEvent.click(footer);
    expect(mockNavigate).toHaveBeenCalledWith('/assistants');
  });
});
