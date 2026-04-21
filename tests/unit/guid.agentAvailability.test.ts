/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for guid/hooks/useAgentAvailability.ts
 * Tests the core availability-checking logic extracted from the hook.
 *
 * Strategy: extract the pure functions from the hook callbacks and test them
 * directly — no React rendering required.
 */

import { describe, it, expect } from 'vitest';
import type { AvailableAgent } from '@/renderer/pages/guid/types';
import type { IProvider } from '@/common/config/storage';

// ---------------------------------------------------------------------------
// Helpers — replicate the logic from useAgentAvailability without React
// ---------------------------------------------------------------------------

function makeIsMainAgentAvailable(opts: {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  availableAgents: AvailableAgent[] | undefined;
}) {
  return (agentType: string): boolean => {
    if (agentType === 'gemini') {
      return opts.isGoogleAuth || (opts.modelList != null && opts.modelList.length > 0);
    }
    return opts.availableAgents?.some((agent) => agent.backend === agentType) ?? false;
  };
}

function makeGetAvailableFallbackAgent(isMainAgentAvailable: (t: string) => boolean): () => string | null {
  const fallbackOrder = ['gemini', 'claude', 'qwen', 'codex', 'codebuddy', 'opencode'];
  return () => {
    for (const agentType of fallbackOrder) {
      if (isMainAgentAvailable(agentType)) return agentType;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// isMainAgentAvailable
// ---------------------------------------------------------------------------

describe('isMainAgentAvailable — gemini branch', () => {
  it('returns true when isGoogleAuth=true regardless of modelList', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: true, availableAgents: [] });
    expect(check('gemini')).toBe(true);
  });

  it('returns true when modelList is non-empty even without google auth', () => {
    const model = { id: 'model-1' } as IProvider;
    const check = makeIsMainAgentAvailable({ modelList: [model], isGoogleAuth: false, availableAgents: [] });
    expect(check('gemini')).toBe(true);
  });

  it('returns false when no auth and empty modelList', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: [] });
    expect(check('gemini')).toBe(false);
  });

  it('returns false when no auth and null modelList', () => {
    const check = makeIsMainAgentAvailable({
      modelList: null as unknown as IProvider[],
      isGoogleAuth: false,
      availableAgents: [],
    });
    expect(check('gemini')).toBe(false);
  });
});

describe('isMainAgentAvailable — non-gemini branch', () => {
  const agents: AvailableAgent[] = [
    { backend: 'claude', name: 'Claude' },
    { backend: 'codex', name: 'Codex' },
  ];

  it('returns true when agent exists in availableAgents list', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: agents });
    expect(check('claude')).toBe(true);
    expect(check('codex')).toBe(true);
  });

  it('returns false when agent is NOT in availableAgents list', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: agents });
    expect(check('qwen')).toBe(false);
    expect(check('aionrs')).toBe(false);
  });

  it('returns false when availableAgents is undefined', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: undefined });
    expect(check('claude')).toBe(false);
  });

  it('returns false when availableAgents is empty', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: [] });
    expect(check('claude')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAvailableFallbackAgent
// ---------------------------------------------------------------------------

describe('getAvailableFallbackAgent', () => {
  it('returns gemini first when it is available', () => {
    const agents: AvailableAgent[] = [
      { backend: 'claude', name: 'Claude' },
      { backend: 'gemini', name: 'Gemini' },
    ];
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: true, availableAgents: agents });
    const fallback = makeGetAvailableFallbackAgent(check);
    expect(fallback()).toBe('gemini');
  });

  it('skips gemini and returns claude when gemini is unavailable', () => {
    const agents: AvailableAgent[] = [{ backend: 'claude', name: 'Claude' }];
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: agents });
    const fallback = makeGetAvailableFallbackAgent(check);
    expect(fallback()).toBe('claude');
  });

  it('follows fallback order: gemini > claude > qwen > codex > codebuddy > opencode', () => {
    // Only qwen is available
    const agents: AvailableAgent[] = [{ backend: 'qwen', name: 'Qwen' }];
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: agents });
    const fallback = makeGetAvailableFallbackAgent(check);
    expect(fallback()).toBe('qwen');
  });

  it('returns null when no fallback agent is available', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: [] });
    const fallback = makeGetAvailableFallbackAgent(check);
    expect(fallback()).toBeNull();
  });

  it('returns null when availableAgents is undefined and not google auth', () => {
    const check = makeIsMainAgentAvailable({ modelList: [], isGoogleAuth: false, availableAgents: undefined });
    const fallback = makeGetAvailableFallbackAgent(check);
    expect(fallback()).toBeNull();
  });
});
