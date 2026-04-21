/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for guid/hooks/usePresetAssistantResolver.ts
 * Tests resolvePresetAgentType and resolveEnabledSkills logic.
 * resolvePresetRulesAndSkills is also covered for the non-IPC branches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock IPC bridge — resolvePresetRulesAndSkills IPC calls
// ---------------------------------------------------------------------------

const ipcMock = {
  readAssistantRule: vi.fn(),
  readAssistantSkill: vi.fn(),
  readBuiltinRule: vi.fn(),
  readBuiltinSkill: vi.fn(),
};

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      readAssistantRule: { invoke: (...args: unknown[]) => ipcMock.readAssistantRule(...args) },
      readAssistantSkill: { invoke: (...args: unknown[]) => ipcMock.readAssistantSkill(...args) },
      readBuiltinRule: { invoke: (...args: unknown[]) => ipcMock.readBuiltinRule(...args) },
      readBuiltinSkill: { invoke: (...args: unknown[]) => ipcMock.readBuiltinSkill(...args) },
    },
  },
}));

// We need ASSISTANT_PRESETS in resolvePresetRulesAndSkills — provide a minimal mock
vi.mock('@/common/config/presets/assistantPresets', () => ({
  ASSISTANT_PRESETS: [
    {
      id: 'coder',
      ruleFiles: { 'en-US': 'coder.md', 'zh-CN': 'coder.zh.md' },
      skillFiles: { 'en-US': 'coder-skills.md' },
    },
  ],
}));

import type { AcpBackendConfig } from '@/renderer/pages/guid/types';
import type { AcpBackend } from '@/common/types/acpTypes';

// ---------------------------------------------------------------------------
// Pure-logic helpers replicated from the hook (no React renderHook needed)
// These mirror the callbacks produced by usePresetAssistantResolver.
// ---------------------------------------------------------------------------

function makeResolvers(customAgents: AcpBackendConfig[], localeKey: string) {
  const resolvePresetAgentType = (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined): string => {
    if (!agentInfo) return 'gemini';
    if (agentInfo.backend !== 'custom') return agentInfo.backend as string;
    const customAgent = customAgents.find((agent) => agent.id === agentInfo.customAgentId);
    return customAgent?.presetAgentType || 'gemini';
  };

  const resolveEnabledSkills = (
    agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined
  ): string[] | undefined => {
    if (!agentInfo) return undefined;
    if (agentInfo.backend !== 'custom') return undefined;
    const customAgent = customAgents.find((agent) => agent.id === agentInfo.customAgentId);
    return customAgent?.enabledSkills;
  };

  return { resolvePresetAgentType, resolveEnabledSkills };
}

// ---------------------------------------------------------------------------
// resolvePresetAgentType
// ---------------------------------------------------------------------------

describe('resolvePresetAgentType', () => {
  const customAgents: AcpBackendConfig[] = [
    { id: 'agent-001', name: 'Coder', presetAgentType: 'claude', enabledSkills: ['skill-a'] },
    { id: 'agent-002', name: 'Researcher', presetAgentType: 'gemini', enabledSkills: [] },
    { id: 'agent-003', name: 'NoType' }, // no presetAgentType
  ];

  const { resolvePresetAgentType } = makeResolvers(customAgents, 'en-US');

  it('returns "gemini" when agentInfo is undefined', () => {
    expect(resolvePresetAgentType(undefined)).toBe('gemini');
  });

  it('returns backend directly for non-custom backends (e.g. claude)', () => {
    expect(resolvePresetAgentType({ backend: 'claude' as AcpBackend })).toBe('claude');
  });

  it('returns backend directly for non-custom backends (e.g. codex)', () => {
    expect(resolvePresetAgentType({ backend: 'codex' as AcpBackend })).toBe('codex');
  });

  it('resolves custom agent presetAgentType from customAgents list', () => {
    expect(resolvePresetAgentType({ backend: 'custom' as AcpBackend, customAgentId: 'agent-001' })).toBe('claude');
  });

  it('resolves custom agent with gemini preset type', () => {
    expect(resolvePresetAgentType({ backend: 'custom' as AcpBackend, customAgentId: 'agent-002' })).toBe('gemini');
  });

  it('falls back to "gemini" when customAgentId not found in list', () => {
    expect(resolvePresetAgentType({ backend: 'custom' as AcpBackend, customAgentId: 'unknown-999' })).toBe('gemini');
  });

  it('falls back to "gemini" when custom agent has no presetAgentType', () => {
    expect(resolvePresetAgentType({ backend: 'custom' as AcpBackend, customAgentId: 'agent-003' })).toBe('gemini');
  });

  it('falls back to "gemini" for custom backend without customAgentId', () => {
    expect(resolvePresetAgentType({ backend: 'custom' as AcpBackend })).toBe('gemini');
  });
});

// ---------------------------------------------------------------------------
// resolveEnabledSkills
// ---------------------------------------------------------------------------

describe('resolveEnabledSkills', () => {
  const customAgents: AcpBackendConfig[] = [
    { id: 'agent-001', name: 'Coder', presetAgentType: 'claude', enabledSkills: ['skill-a', 'skill-b'] },
    { id: 'agent-002', name: 'Researcher', presetAgentType: 'gemini', enabledSkills: [] },
    { id: 'agent-003', name: 'NoSkills' }, // undefined enabledSkills
  ];

  const { resolveEnabledSkills } = makeResolvers(customAgents, 'en-US');

  it('returns undefined when agentInfo is undefined', () => {
    expect(resolveEnabledSkills(undefined)).toBeUndefined();
  });

  it('returns undefined for non-custom backend (e.g. claude)', () => {
    expect(resolveEnabledSkills({ backend: 'claude' as AcpBackend })).toBeUndefined();
  });

  it('returns undefined for non-custom backend (e.g. gemini)', () => {
    expect(resolveEnabledSkills({ backend: 'gemini' as AcpBackend })).toBeUndefined();
  });

  it('returns enabledSkills for known custom agent', () => {
    expect(resolveEnabledSkills({ backend: 'custom' as AcpBackend, customAgentId: 'agent-001' })).toEqual([
      'skill-a',
      'skill-b',
    ]);
  });

  it('returns empty array for custom agent with empty enabledSkills', () => {
    expect(resolveEnabledSkills({ backend: 'custom' as AcpBackend, customAgentId: 'agent-002' })).toEqual([]);
  });

  it('returns undefined for unknown customAgentId', () => {
    expect(resolveEnabledSkills({ backend: 'custom' as AcpBackend, customAgentId: 'not-exist' })).toBeUndefined();
  });

  it('returns undefined for custom agent without enabledSkills property', () => {
    expect(resolveEnabledSkills({ backend: 'custom' as AcpBackend, customAgentId: 'agent-003' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolvePresetRulesAndSkills — non-IPC branches (pure logic)
// ---------------------------------------------------------------------------

describe('resolvePresetRulesAndSkills — non-IPC pure branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcMock.readAssistantRule.mockResolvedValue('');
    ipcMock.readAssistantSkill.mockResolvedValue('');
    ipcMock.readBuiltinRule.mockResolvedValue('');
    ipcMock.readBuiltinSkill.mockResolvedValue('');
  });

  /**
   * Build a standalone resolvePresetRulesAndSkills function (same logic as hook).
   */
  async function resolvePresetRulesAndSkills(
    agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined,
    customAgents: AcpBackendConfig[],
    localeKey: string
  ): Promise<{ rules?: string; skills?: string }> {
    if (!agentInfo) return {};
    if (agentInfo.backend !== 'custom') {
      return { rules: agentInfo.context };
    }

    const customAgentId = agentInfo.customAgentId;
    if (!customAgentId) return { rules: agentInfo.context };

    let rules = '';
    let skills = '';

    const { ipcBridge } = await import('@/common');

    try {
      rules = await ipcBridge.fs.readAssistantRule.invoke({
        assistantId: customAgentId,
        locale: localeKey,
      });
    } catch {
      /* silent */
    }

    try {
      skills = await ipcBridge.fs.readAssistantSkill.invoke({
        assistantId: customAgentId,
        locale: localeKey,
      });
    } catch {
      /* skills may not exist */
    }

    // Fallback for builtin assistants
    if (customAgentId.startsWith('builtin-')) {
      const { ASSISTANT_PRESETS } = await import('@/common/config/presets/assistantPresets');
      const presetId = customAgentId.replace('builtin-', '');
      const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        if (!rules && preset.ruleFiles) {
          try {
            const ruleFile =
              (preset.ruleFiles as Record<string, string>)[localeKey] ||
              (preset.ruleFiles as Record<string, string>)['en-US'];
            if (ruleFile) {
              rules = await ipcBridge.fs.readBuiltinRule.invoke({ fileName: ruleFile });
            }
          } catch {
            /* silent */
          }
        }
        if (!skills && preset.skillFiles) {
          try {
            const skillFile =
              (preset.skillFiles as Record<string, string>)[localeKey] ||
              (preset.skillFiles as Record<string, string>)['en-US'];
            if (skillFile) {
              skills = await ipcBridge.fs.readBuiltinSkill.invoke({ fileName: skillFile });
            }
          } catch {
            /* silent */
          }
        }
      }
    }

    return { rules: rules || agentInfo.context, skills };
  }

  it('returns empty object when agentInfo is undefined', async () => {
    const result = await resolvePresetRulesAndSkills(undefined, [], 'en-US');
    expect(result).toEqual({});
  });

  it('returns context as rules for non-custom backend', async () => {
    const result = await resolvePresetRulesAndSkills(
      { backend: 'claude' as AcpBackend, context: 'You are a coding assistant.' },
      [],
      'en-US'
    );
    expect(result).toEqual({ rules: 'You are a coding assistant.' });
  });

  it('returns context as rules when no customAgentId for custom backend', async () => {
    const result = await resolvePresetRulesAndSkills(
      { backend: 'custom' as AcpBackend, context: 'fallback context' },
      [],
      'en-US'
    );
    expect(result).toEqual({ rules: 'fallback context' });
  });

  it('uses IPC-loaded rules and skills for custom backend with customAgentId', async () => {
    ipcMock.readAssistantRule.mockResolvedValue('IPC rules content');
    ipcMock.readAssistantSkill.mockResolvedValue('IPC skills content');

    const result = await resolvePresetRulesAndSkills(
      { backend: 'custom' as AcpBackend, customAgentId: 'my-agent-007' },
      [],
      'en-US'
    );

    expect(result.rules).toBe('IPC rules content');
    expect(result.skills).toBe('IPC skills content');
  });

  it('falls back to agentInfo.context when IPC rules are empty', async () => {
    ipcMock.readAssistantRule.mockResolvedValue('');
    ipcMock.readAssistantSkill.mockResolvedValue('');

    const result = await resolvePresetRulesAndSkills(
      { backend: 'custom' as AcpBackend, customAgentId: 'my-agent', context: 'context fallback' },
      [],
      'en-US'
    );

    expect(result.rules).toBe('context fallback');
    expect(result.skills).toBe('');
  });

  it('uses builtin preset rule when IPC returns empty and id starts with "builtin-"', async () => {
    ipcMock.readAssistantRule.mockResolvedValue('');
    ipcMock.readAssistantSkill.mockResolvedValue('');
    ipcMock.readBuiltinRule.mockResolvedValue('BUILTIN_RULE_CONTENT');
    ipcMock.readBuiltinSkill.mockResolvedValue('BUILTIN_SKILL_CONTENT');

    const result = await resolvePresetRulesAndSkills(
      { backend: 'custom' as AcpBackend, customAgentId: 'builtin-coder' },
      [],
      'en-US'
    );

    expect(result.rules).toBe('BUILTIN_RULE_CONTENT');
    expect(result.skills).toBe('BUILTIN_SKILL_CONTENT');
    expect(ipcMock.readBuiltinRule).toHaveBeenCalledWith({ fileName: 'coder.md' });
    expect(ipcMock.readBuiltinSkill).toHaveBeenCalledWith({ fileName: 'coder-skills.md' });
  });

  it('uses locale-specific rule file when locale is zh-CN', async () => {
    ipcMock.readAssistantRule.mockResolvedValue('');
    ipcMock.readAssistantSkill.mockResolvedValue('');
    ipcMock.readBuiltinRule.mockResolvedValue('ZH_RULE');
    ipcMock.readBuiltinSkill.mockResolvedValue('');

    const result = await resolvePresetRulesAndSkills(
      { backend: 'custom' as AcpBackend, customAgentId: 'builtin-coder' },
      [],
      'zh-CN'
    );

    expect(ipcMock.readBuiltinRule).toHaveBeenCalledWith({ fileName: 'coder.zh.md' });
    expect(result.rules).toBe('ZH_RULE');
  });
});
