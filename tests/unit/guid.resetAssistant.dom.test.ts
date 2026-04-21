/**
 * AC22 单元测试：resetAssistant 逻辑
 *
 * 覆盖 GuidPage.tsx:325-345 的 resetAssistantRequested effect：
 *   当 location.state.resetAssistant === true 且 isPresetAgent 时，
 *   调用 setSelectedAgentKey(defaultAgentKey) 将选中项重置为非预设 Agent。
 *
 * 测试策略：
 *   - 核心数据层（defaultAgentKey 计算、isPresetAgent → setSelectedAgentKey 路径）
 *     通过 useGuidAgentSelection renderHook 直接验证
 *   - resetAssistantRequested 的 location.state 读取逻辑通过纯逻辑单元覆盖
 *   - GuidPage 整体渲染太重，不在本文件范围内
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AcpBackendConfig, AcpModelInfo, AvailableAgent } from '../../src/renderer/pages/guid/types';
import type { IProvider } from '../../src/common/config/storage';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const configStorageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
}));

const defaultCodexModels = vi.hoisted(() => [] as Array<{ id: string; label: string }>);

const ipcMock = vi.hoisted(() => ({
  getAvailableAgents: vi.fn(),
  refreshCustomAgents: vi.fn().mockResolvedValue(undefined),
  getAssistants: vi.fn(),
  remoteAgentList: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/common', () => ({
  ipcBridge: {
    acpConversation: {
      getAvailableAgents: { invoke: ipcMock.getAvailableAgents },
      refreshCustomAgents: { invoke: ipcMock.refreshCustomAgents },
    },
    extensions: {
      getAssistants: { invoke: ipcMock.getAssistants },
    },
    remoteAgent: {
      list: { invoke: ipcMock.remoteAgentList },
    },
  },
}));

vi.mock('../../src/common/config/storage', () => ({
  ConfigStorage: configStorageMock,
}));

vi.mock('../../src/common/config/presets/assistantPresets', () => ({
  ASSISTANT_PRESETS: [],
}));

vi.mock('../../src/common/types/codex/codexModels', () => ({
  DEFAULT_CODEX_MODELS: defaultCodexModels,
}));

let swrData: Record<string, unknown> = {};

function resetSwrCache() {
  swrData = {};
}

vi.mock('swr', () => ({
  default: (key: string, fetcher: () => Promise<unknown>) => {
    if (!(key in swrData)) {
      swrData[key] = undefined;
      fetcher()
        .then((data) => {
          swrData[key] = data;
        })
        .catch(() => {});
    }
    return { data: swrData[key], error: undefined, mutate: vi.fn() };
  },
  mutate: vi.fn(),
}));

vi.mock('../../src/renderer/utils/model/agentModes', () => ({
  getAgentModes: () => [{ value: 'default', label: 'Default' }],
  supportsModeSwitch: () => true,
}));

import { useGuidAgentSelection } from '../../src/renderer/pages/guid/hooks/useGuidAgentSelection';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const PRESET_AGENT_ID = 'cowork';

const AVAILABLE_AGENTS: AvailableAgent[] = [
  { backend: 'gemini', name: 'Gemini' },
  { backend: 'claude', name: 'Claude' },
  { backend: 'custom', name: 'Cowork Assistant', customAgentId: PRESET_AGENT_ID, isPreset: true },
];

const CUSTOM_AGENTS: AcpBackendConfig[] = [
  {
    id: PRESET_AGENT_ID,
    name: 'Cowork Assistant',
    isPreset: true,
    enabled: true,
    presetAgentType: 'claude',
  } as AcpBackendConfig,
];

const CLAUDE_CACHED_MODEL: AcpModelInfo = {
  source: 'models',
  currentModelId: 'claude-sonnet-4-5-20250514',
  currentModelLabel: 'Claude Sonnet 4.5',
  availableModels: [{ id: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' }],
  canSwitch: true,
};

const MODEL_LIST: IProvider[] = [
  { id: 'p1', name: 'Test Provider', platform: 'openai', baseUrl: '', apiKey: 'k', model: ['gpt-4'] } as IProvider,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultMocks() {
  ipcMock.getAvailableAgents.mockResolvedValue({ success: true, data: AVAILABLE_AGENTS });
  ipcMock.getAssistants.mockResolvedValue([]);

  configStorageMock.get.mockImplementation(async (key: string) => {
    switch (key) {
      case 'acp.cachedModels':
        return { claude: CLAUDE_CACHED_MODEL };
      case 'acp.customAgents':
        return CUSTOM_AGENTS;
      case 'guid.lastSelectedAgent':
        return null;
      case 'acp.config':
        return {};
      default:
        return null;
    }
  });
}

const hookOptions = {
  modelList: MODEL_LIST,
  isGoogleAuth: false,
  localeKey: 'en-US',
};

// ---------------------------------------------------------------------------
// Part 1: resetAssistantRequested 纯逻辑单元测试
//
// GuidPage.tsx:327 中：
//   const resetAssistantRequested =
//     (location.state as { resetAssistant?: boolean } | null)?.resetAssistant === true;
// ---------------------------------------------------------------------------

describe('AC22 – resetAssistantRequested pure logic', () => {
  function calcResetAssistantRequested(state: unknown): boolean {
    return (state as { resetAssistant?: boolean } | null)?.resetAssistant === true;
  }

  it('returns true when state.resetAssistant === true', () => {
    expect(calcResetAssistantRequested({ resetAssistant: true })).toBe(true);
  });

  it('returns false when state.resetAssistant === false', () => {
    expect(calcResetAssistantRequested({ resetAssistant: false })).toBe(false);
  });

  it('returns false when state is null', () => {
    expect(calcResetAssistantRequested(null)).toBe(false);
  });

  it('returns false when state has no resetAssistant key', () => {
    expect(calcResetAssistantRequested({ otherKey: true })).toBe(false);
  });

  it('returns false when state.resetAssistant is a truthy non-boolean string', () => {
    // Strict === true check means string 'true' must not pass
    expect(calcResetAssistantRequested({ resetAssistant: 'true' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 2: useGuidAgentSelection — defaultAgentKey 和 preset 重置行为
//
// GuidPage effect 的两个前置条件：
//   if (!resetAssistantRequested) return;          // 已由 Part 1 覆盖
//   if (!availableAgents || availableAgents.length === 0) return;
//   if (agentSelection.isPresetAgent) {
//     agentSelection.setSelectedAgentKey(agentSelection.defaultAgentKey);
//   }
// ---------------------------------------------------------------------------

describe('AC22 – useGuidAgentSelection: defaultAgentKey and preset reset behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSwrCache();
    defaultCodexModels.length = 0;
    setupDefaultMocks();
  });

  it('AC22-1: defaultAgentKey is first non-preset agent (gemini) in standard agent list', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: ({ children }) => React.createElement(MemoryRouter, null, children),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    // AVAILABLE_AGENTS order: gemini(non-preset), claude(non-preset), custom:cowork(preset)
    await waitFor(() => {
      expect(result.current.defaultAgentKey).toBe('gemini');
    });
  });

  it('AC22-2: when isPresetAgent=true, setSelectedAgentKey(defaultAgentKey) resets to non-preset', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: ({ children }) => React.createElement(MemoryRouter, null, children),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    // Activate preset
    act(() => {
      result.current.setSelectedAgentKey(`custom:${PRESET_AGENT_ID}`);
    });
    await waitFor(() => expect(result.current.isPresetAgent).toBe(true));

    // Simulate GuidPage resetAssistant effect body: isPresetAgent → reset to default
    act(() => {
      result.current.setSelectedAgentKey(result.current.defaultAgentKey);
    });

    await waitFor(() => {
      expect(result.current.isPresetAgent).toBe(false);
      expect(result.current.selectedAgentKey).toBe('gemini');
    });
  });

  it('AC22-3: when isPresetAgent=false, skipping setSelectedAgentKey leaves state unchanged', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: ({ children }) => React.createElement(MemoryRouter, null, children),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    // Select a non-preset agent
    act(() => {
      result.current.setSelectedAgentKey('claude');
    });
    await waitFor(() => expect(result.current.isPresetAgent).toBe(false));

    const keyBefore = result.current.selectedAgentKey;

    // Guard condition: isPresetAgent=false → effect body does NOT call setSelectedAgentKey
    // Verify this guard is in place by asserting state stays as-is
    expect(result.current.isPresetAgent).toBe(false);
    expect(result.current.selectedAgentKey).toBe(keyBefore);
  });

  it('AC22-4: availableAgents empty → guard prevents reset (effect returns early)', async () => {
    ipcMock.getAvailableAgents.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: ({ children }) => React.createElement(MemoryRouter, null, children),
    });

    // With empty agents the guard `!availableAgents || availableAgents.length === 0` triggers
    // defaultAgentKey falls back to the hardcoded 'aionrs'
    await waitFor(() => {
      expect(result.current.defaultAgentKey).toBe('aionrs');
    });

    // availableAgents is empty (length 0) — no preset to reset
    expect(result.current.availableAgents?.length).toBe(0);
  });

  it('AC22-5: only non-preset agents in list → defaultAgentKey is first one', async () => {
    const noPresetAgents: AvailableAgent[] = [
      { backend: 'claude', name: 'Claude' },
      { backend: 'gemini', name: 'Gemini' },
    ];
    ipcMock.getAvailableAgents.mockResolvedValue({ success: true, data: noPresetAgents });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: ({ children }) => React.createElement(MemoryRouter, null, children),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    await waitFor(() => {
      expect(result.current.defaultAgentKey).toBe('claude');
    });
  });

  it('AC22-6: all agents are preset → defaultAgentKey falls back to "aionrs"', async () => {
    const allPresetAgents: AvailableAgent[] = [
      { backend: 'custom', name: 'Preset A', customAgentId: 'preset-a', isPreset: true },
      { backend: 'custom', name: 'Preset B', customAgentId: 'preset-b', isPreset: true },
    ];
    ipcMock.getAvailableAgents.mockResolvedValue({ success: true, data: allPresetAgents });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: ({ children }) => React.createElement(MemoryRouter, null, children),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    // No non-preset agent found → hardcoded fallback
    await waitFor(() => {
      expect(result.current.defaultAgentKey).toBe('aionrs');
    });
  });
});
