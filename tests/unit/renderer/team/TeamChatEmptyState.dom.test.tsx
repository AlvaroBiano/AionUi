/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMutate = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

vi.mock('@renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: () => () => ({ mutate: mockMutate }),
}));

const mockGetAgentLogo = vi.fn();
vi.mock('@renderer/utils/model/agentLogo', () => ({
  getAgentLogo: (...args: unknown[]) => mockGetAgentLogo(...args),
}));

import TeamChatEmptyState from '@/renderer/pages/team/components/TeamChatEmptyState';

describe('TeamChatEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentLogo.mockReturnValue(null);
  });

  it('renders agent name and subtitle', () => {
    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='claude' />);

    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText("Describe your goal and I'll get the team working on it")).toBeInTheDocument();
  });

  it('renders all three suggestion chips', () => {
    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='claude' />);

    expect(screen.getByText('Organize a debate with agents taking different sides')).toBeInTheDocument();
    expect(screen.getByText('Plan an in-depth interview between agents')).toBeInTheDocument();
    expect(screen.getByText('Have multiple experts analyze the same problem')).toBeInTheDocument();
  });

  it('renders emoji icons for each chip', () => {
    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='claude' />);

    expect(screen.getByText('🎭')).toBeInTheDocument();
    expect(screen.getByText('🎙️')).toBeInTheDocument();
    expect(screen.getByText('🧠')).toBeInTheDocument();
  });

  it('shows img when getAgentLogo returns a path', () => {
    mockGetAgentLogo.mockReturnValue('/path/to/claude.svg');

    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='claude' />);

    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/path/to/claude.svg');
    expect(img).toHaveAttribute('alt', 'Claude');
  });

  it('shows fallback avatar with first letter when no logo found', () => {
    mockGetAgentLogo.mockReturnValue(null);

    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='unknown-agent' />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('calls mutate with chip label when chip is clicked', () => {
    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='claude' />);

    const debateChip = screen.getByText('Organize a debate with agents taking different sides');
    fireEvent.click(debateChip);

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const mutateFn = mockMutate.mock.calls[0][0];
    const prev = { _type: 'acp', content: '', atPath: [], uploadFile: [] };
    const result = mutateFn(prev);
    expect(result).toEqual({ ...prev, content: 'Organize a debate with agents taking different sides' });
  });

  it('fills draft with correct text for each chip', () => {
    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='claude' />);

    const chips = [
      'Organize a debate with agents taking different sides',
      'Plan an in-depth interview between agents',
      'Have multiple experts analyze the same problem',
    ];

    chips.forEach((chipText, i) => {
      fireEvent.click(screen.getByText(chipText));
      const mutateFn = mockMutate.mock.calls[i][0];
      const prev = { _type: 'acp', content: '', atPath: [], uploadFile: [] };
      expect(mutateFn(prev).content).toBe(chipText);
    });

    expect(mockMutate).toHaveBeenCalledTimes(3);
  });

  it('calls getAgentLogo with the agentType', () => {
    render(<TeamChatEmptyState conversationId='conv-1' agentName='Claude' agentType='claude' />);

    expect(mockGetAgentLogo).toHaveBeenCalledWith('claude');
  });
});
