/**
 * AC21 单元测试：/guid?agent= URL 参数优先级逻辑
 *
 * 覆盖 useGuidAgentSelection（src/renderer/pages/guid/hooks/useGuidAgentSelection.ts:124-272）
 * 中 urlAgentParam 的三条分支：
 *   1. 合法参数（在 availableAgents 中）→ 自动切换，写回 ConfigStorage
 *   2. 非法参数（不在列表中）→ 忽略，回退到 lastSelectedAgent
 *   3. 无参数 → 读 lastSelectedAgent
 * 以及边界情况：
 *   4. availableAgents 仍为空时参数存在 → 不崩溃，等 agents 加载后再匹配
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

function setupDefaultMocks(lastSelectedAgent: string | null = null) {
  ipcMock.getAvailableAgents.mockResolvedValue({ success: true, data: AVAILABLE_AGENTS });
  ipcMock.getAssistants.mockResolvedValue([]);

  configStorageMock.get.mockImplementation(async (key: string) => {
    switch (key) {
      case 'acp.cachedModels':
        return { claude: CLAUDE_CACHED_MODEL };
      case 'acp.customAgents':
        return CUSTOM_AGENTS;
      case 'guid.lastSelectedAgent':
        return lastSelectedAgent;
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

function makeWrapper(url: string) {
  return ({ children }: React.PropsWithChildren) =>
    React.createElement(MemoryRouter, { initialEntries: [url] }, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AC21 – useGuidAgentSelection: URL ?agent= param priority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSwrCache();
    defaultCodexModels.length = 0;
    setupDefaultMocks();
  });

  it('AC21-1: valid ?agent=claude overrides lastSelectedAgent=gemini', async () => {
    setupDefaultMocks('gemini');

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid?agent=claude'),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    // URL param 'claude' wins over saved 'gemini'
    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('claude');
    });
  });

  it('AC21-2: valid ?agent=gemini overrides lastSelectedAgent=claude', async () => {
    setupDefaultMocks('claude');

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid?agent=gemini'),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('gemini');
    });
  });

  it('AC21-3: ?agent= matching custom preset key selects that preset (isPreset=true)', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper(`/guid?agent=custom:${PRESET_AGENT_ID}`),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe(`custom:${PRESET_AGENT_ID}`);
      expect(result.current.isPresetAgent).toBe(true);
    });
  });

  it('AC21-4: invalid ?agent=nonexistent falls back to lastSelectedAgent', async () => {
    setupDefaultMocks('claude');

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid?agent=nonexistent-agent'),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    // 'nonexistent-agent' not in AVAILABLE_AGENTS → ignored → lastSelectedAgent='claude'
    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('claude');
    });
  });

  it('AC21-5: no ?agent= param → reads lastSelectedAgent from storage', async () => {
    setupDefaultMocks('claude');

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid'),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('claude');
    });
  });

  it('AC21-6: no ?agent= param and no lastSelectedAgent → selects first available agent', async () => {
    setupDefaultMocks(null); // no saved agent

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid'),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());

    // First agent in AVAILABLE_AGENTS is 'gemini'
    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('gemini');
    });
  });

  it('AC21-7: valid ?agent= param writes back to ConfigStorage for persistence', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid?agent=gemini'),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());
    await waitFor(() => expect(result.current.selectedAgentKey).toBe('gemini'));

    // Should write back so next navigation without URL param restores this choice
    await waitFor(() => {
      const saveCall = configStorageMock.set.mock.calls.find(([key]: [string]) => key === 'guid.lastSelectedAgent');
      expect(saveCall).toBeDefined();
      expect(saveCall?.[1]).toBe('gemini');
    });
  });

  it('AC21-8: invalid ?agent= param does NOT write back to ConfigStorage', async () => {
    setupDefaultMocks('claude');

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid?agent=bogus'),
    });

    await waitFor(() => expect(result.current.availableAgents).toBeDefined());
    await waitFor(() => expect(result.current.selectedAgentKey).toBe('claude'));

    // Invalid key → URL branch was skipped → no ConfigStorage.set for lastSelectedAgent
    act(() => {
      const saveCall = configStorageMock.set.mock.calls.find(([key]: [string]) => key === 'guid.lastSelectedAgent');
      expect(saveCall).toBeUndefined();
    });
  });

  it('AC21-9: availableAgents initially empty, then loads — hook does not crash', async () => {
    // Simulate delayed agent load
    let resolveAgents!: (v: unknown) => void;
    ipcMock.getAvailableAgents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAgents = resolve;
        })
    );

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions), {
      wrapper: makeWrapper('/guid?agent=claude'),
    });

    // Before agents load: no crash, availableAgents still undefined
    expect(result.current.availableAgents).toBeUndefined();

    // Resolve agents
    await act(async () => {
      resolveAgents({ success: true, data: AVAILABLE_AGENTS });
      await Promise.resolve();
    });

    // After load: URL param 'claude' should be applied
    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('claude');
    });
  });
});
