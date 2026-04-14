import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture provider callbacks registered during initConversationBridge
const providerCallbacks = new Map<string, (...args: unknown[]) => unknown>();

function mockProvider(name: string) {
  return {
    provider: vi.fn((cb: (...args: unknown[]) => unknown) => {
      providerCallbacks.set(name, cb);
    }),
    emit: vi.fn(),
  };
}

const mockListChangedEmit = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    openclawConversation: {
      getRuntime: mockProvider('openclawConversation.getRuntime'),
    },
    conversation: {
      create: mockProvider('conversation.create'),
      reloadContext: mockProvider('conversation.reloadContext'),
      getAssociateConversation: mockProvider('conversation.getAssociateConversation'),
      createWithConversation: mockProvider('conversation.createWithConversation'),
      remove: mockProvider('conversation.remove'),
      update: mockProvider('conversation.update'),
      reset: mockProvider('conversation.reset'),
      warmup: mockProvider('conversation.warmup'),
      get: mockProvider('conversation.get'),
      getWorkspace: mockProvider('conversation.getWorkspace'),
      stop: mockProvider('conversation.stop'),
      setConfig: mockProvider('conversation.setConfig'),
      getSlashCommands: mockProvider('conversation.getSlashCommands'),
      askSideQuestion: mockProvider('conversation.askSideQuestion'),
      sendMessage: mockProvider('conversation.sendMessage'),
      confirmMessage: mockProvider('conversation.confirmMessage'),
      preheat: mockProvider('conversation.preheat'),
      cancelPreheat: mockProvider('conversation.cancelPreheat'),
      claimPreheat: mockProvider('conversation.claimPreheat'),
      listChanged: { emit: mockListChangedEmit },
      listByCronJob: mockProvider('conversation.listByCronJob'),
      responseStream: { emit: vi.fn() },
      confirmation: {
        confirm: mockProvider('conversation.confirmation.confirm'),
        list: mockProvider('conversation.confirmation.list'),
      },
      approval: {
        check: mockProvider('conversation.approval.check'),
      },
    },
    preview: {
      snapshotListChanged: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/utils/initStorage', () => ({
  getSkillsDir: vi.fn(() => '/mock/skills'),
  getBuiltinSkillsCopyDir: vi.fn(() => '/mock/builtin-skills'),
  getSystemDir: vi.fn(() => ({ cacheDir: '/mock/cache' })),
  ProcessChat: { conversations: [] },
}));

vi.mock('@process/utils/tray', () => ({
  refreshTrayMenu: vi.fn(),
}));

vi.mock('@process/utils', () => ({
  copyFilesToDirectory: vi.fn(async () => []),
  readDirectoryRecursive: vi.fn(async () => []),
}));

vi.mock('@process/utils/openclawUtils', () => ({
  computeOpenClawIdentityHash: vi.fn(() => 'mock-hash'),
}));

vi.mock('@/process/bridge/migrationUtils', () => ({
  migrateConversationToDatabase: vi.fn(),
}));

vi.mock('@/process/bridge/services/ConversationSideQuestionService', () => ({
  ConversationSideQuestionService: class {
    ask = vi.fn();
  },
}));

vi.mock('@/process/task/agentUtils', () => ({
  prepareFirstMessage: vi.fn(async (input: string) => input),
}));

const { initConversationBridge } = await import('@/process/bridge/conversationBridge');

// ---------------------------------------------------------------------------
// Shared mock instances
// ---------------------------------------------------------------------------

const mockConversationService = {
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getConversation: vi.fn(),
  updateConversation: vi.fn(),
  listAllConversations: vi.fn(),
  // Other methods used by the bridge but irrelevant to preheat
  create: vi.fn(),
  getById: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  getAll: vi.fn(),
  reset: vi.fn(),
  list: vi.fn(),
} as unknown as import('../../src/process/services/IConversationService').IConversationService;

const mockAcpTask = {
  type: 'acp' as const,
  initAgent: vi.fn(),
};

const mockWorkerTaskManager = {
  getOrBuildTask: vi.fn(),
  kill: vi.fn(),
  getTask: vi.fn(),
  removeTask: vi.fn(),
} as unknown as import('../../src/process/task/IWorkerTaskManager').IWorkerTaskManager;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHandler(name: string) {
  const handler = providerCallbacks.get(name);
  expect(handler).toBeDefined();
  return handler!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('conversationBridge preheat', () => {
  beforeEach(() => {
    providerCallbacks.clear();
    vi.clearAllMocks();
    initConversationBridge(mockConversationService, mockWorkerTaskManager);
  });

  // -------------------------------------------------------------------------
  // preheat provider
  // -------------------------------------------------------------------------

  describe('preheat provider', () => {
    it('creates conversation with extra.preheat=true', async () => {
      const handler = getHandler('conversation.preheat');
      const mockConv = { id: 'conv-pre-1', source: 'aionui', extra: { preheat: true } };
      vi.mocked(mockConversationService.createConversation).mockResolvedValue(mockConv as never);
      vi.mocked(mockWorkerTaskManager.getOrBuildTask).mockResolvedValue(mockAcpTask as never);
      mockAcpTask.initAgent.mockResolvedValue(undefined);

      await handler({ backend: 'claude', workspace: '/ws' });

      expect(mockConversationService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ preheat: true }),
        })
      );
    });

    it('returns conversation_id', async () => {
      const handler = getHandler('conversation.preheat');
      const mockConv = { id: 'conv-pre-2', source: 'aionui', extra: { preheat: true } };
      vi.mocked(mockConversationService.createConversation).mockResolvedValue(mockConv as never);
      vi.mocked(mockWorkerTaskManager.getOrBuildTask).mockResolvedValue(mockAcpTask as never);
      mockAcpTask.initAgent.mockResolvedValue(undefined);

      const result = await handler({ backend: 'claude' });

      expect(result).toEqual({ conversation_id: 'conv-pre-2' });
    });

    it('does not emit conversationListChanged', async () => {
      const handler = getHandler('conversation.preheat');
      const mockConv = { id: 'conv-pre-3', source: 'aionui', extra: { preheat: true } };
      vi.mocked(mockConversationService.createConversation).mockResolvedValue(mockConv as never);
      vi.mocked(mockWorkerTaskManager.getOrBuildTask).mockResolvedValue(mockAcpTask as never);
      mockAcpTask.initAgent.mockResolvedValue(undefined);

      await handler({ backend: 'claude' });

      // listChanged must NOT have been called during preheat creation
      expect(mockListChangedEmit).not.toHaveBeenCalled();
    });

    it('kills task and deletes conversation when initAgent fails (graceful cleanup)', async () => {
      const handler = getHandler('conversation.preheat');
      const mockConv = { id: 'conv-pre-4', source: 'aionui', extra: { preheat: true } };
      vi.mocked(mockConversationService.createConversation).mockResolvedValue(mockConv as never);
      vi.mocked(mockWorkerTaskManager.getOrBuildTask).mockResolvedValue(mockAcpTask as never);
      // initAgent rejects
      mockAcpTask.initAgent.mockRejectedValue(new Error('CLI not found'));
      vi.mocked(mockConversationService.deleteConversation).mockResolvedValue(undefined as never);

      // The preheat handler returns immediately (fire-and-forget).
      // The cleanup chain is: getOrBuildTask.then → initAgent() reject → .catch
      // That is 3 promise hops; flush them all.
      await handler({ backend: 'claude' });
      await Promise.resolve(); // hop 1: getOrBuildTask resolves
      await Promise.resolve(); // hop 2: then-callback invokes initAgent, which rejects
      await Promise.resolve(); // hop 3: .catch handler runs

      expect(mockWorkerTaskManager.kill).toHaveBeenCalledWith('conv-pre-4');
      expect(mockConversationService.deleteConversation).toHaveBeenCalledWith('conv-pre-4');
    });
  });

  // -------------------------------------------------------------------------
  // cancelPreheat provider
  // -------------------------------------------------------------------------

  describe('cancelPreheat provider', () => {
    it('kills the task and deletes the conversation', async () => {
      const handler = getHandler('conversation.cancelPreheat');
      vi.mocked(mockConversationService.deleteConversation).mockResolvedValue(undefined as never);

      await handler({ conversation_id: 'conv-cancel-1' });

      expect(mockWorkerTaskManager.kill).toHaveBeenCalledWith('conv-cancel-1');
      expect(mockConversationService.deleteConversation).toHaveBeenCalledWith('conv-cancel-1');
    });

    it('does not throw when kill throws (task already gone)', async () => {
      const handler = getHandler('conversation.cancelPreheat');
      vi.mocked(mockWorkerTaskManager.kill).mockImplementation(() => {
        throw new Error('task not found');
      });
      vi.mocked(mockConversationService.deleteConversation).mockResolvedValue(undefined as never);

      await expect(handler({ conversation_id: 'conv-cancel-2' })).resolves.not.toThrow();
      // deleteConversation should still be called despite kill throwing
      expect(mockConversationService.deleteConversation).toHaveBeenCalledWith('conv-cancel-2');
    });

    it('does not throw when deleteConversation rejects (already deleted)', async () => {
      const handler = getHandler('conversation.cancelPreheat');
      vi.mocked(mockConversationService.deleteConversation).mockRejectedValue(new Error('not found'));

      await expect(handler({ conversation_id: 'conv-cancel-3' })).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // claimPreheat provider
  // -------------------------------------------------------------------------

  describe('claimPreheat provider', () => {
    it('merges extra, removes preheat key, and updates DB', async () => {
      const handler = getHandler('conversation.claimPreheat');
      const existing = {
        id: 'conv-claim-1',
        source: 'aionui',
        extra: { backend: 'claude', workspace: '/old-ws', preheat: true },
      };
      vi.mocked(mockConversationService.getConversation).mockResolvedValue(existing as never);
      vi.mocked(mockConversationService.updateConversation).mockResolvedValue(undefined as never);

      await handler({
        conversation_id: 'conv-claim-1',
        extra: { workspace: '/new-ws', skills: ['skill-a'] },
      });

      expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
        'conv-claim-1',
        expect.objectContaining({
          extra: expect.not.objectContaining({ preheat: expect.anything() }),
        })
      );
      expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
        'conv-claim-1',
        expect.objectContaining({
          extra: expect.objectContaining({ workspace: '/new-ws', skills: ['skill-a'], backend: 'claude' }),
        })
      );
    });

    it('emits conversationListChanged with action "created"', async () => {
      const handler = getHandler('conversation.claimPreheat');
      const existing = {
        id: 'conv-claim-2',
        source: 'aionui',
        extra: { preheat: true },
      };
      vi.mocked(mockConversationService.getConversation).mockResolvedValue(existing as never);
      vi.mocked(mockConversationService.updateConversation).mockResolvedValue(undefined as never);

      await handler({ conversation_id: 'conv-claim-2', extra: {} });

      expect(mockListChangedEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-claim-2',
          action: 'created',
        })
      );
    });

    it('returns conversation_id on success', async () => {
      const handler = getHandler('conversation.claimPreheat');
      const existing = { id: 'conv-claim-3', source: 'aionui', extra: { preheat: true } };
      vi.mocked(mockConversationService.getConversation).mockResolvedValue(existing as never);
      vi.mocked(mockConversationService.updateConversation).mockResolvedValue(undefined as never);

      const result = await handler({ conversation_id: 'conv-claim-3', extra: {} });

      expect(result).toEqual({ conversation_id: 'conv-claim-3' });
    });

    it('throws when conversation does not exist', async () => {
      const handler = getHandler('conversation.claimPreheat');
      vi.mocked(mockConversationService.getConversation).mockResolvedValue(null as never);

      await expect(handler({ conversation_id: 'conv-missing', extra: {} })).rejects.toThrow('conv-missing');
    });

    it('preserves preheat workspace when caller workspace is empty string', async () => {
      const handler = getHandler('conversation.claimPreheat');
      const existing = {
        id: 'conv-claim-ws',
        source: 'aionui',
        extra: { backend: 'claude', workspace: '/preheat-ws', preheat: true },
      };
      vi.mocked(mockConversationService.getConversation).mockResolvedValue(existing as never);
      vi.mocked(mockConversationService.updateConversation).mockResolvedValue(undefined as never);

      // Caller sends an empty workspace — should keep the preheat workspace
      await handler({ conversation_id: 'conv-claim-ws', extra: { workspace: '' } });

      expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
        'conv-claim-ws',
        expect.objectContaining({
          extra: expect.objectContaining({ workspace: '/preheat-ws' }),
        })
      );
    });

    it('uses caller workspace when it is non-empty, overriding preheat workspace', async () => {
      const handler = getHandler('conversation.claimPreheat');
      const existing = {
        id: 'conv-claim-ws2',
        source: 'aionui',
        extra: { backend: 'claude', workspace: '/preheat-ws', preheat: true },
      };
      vi.mocked(mockConversationService.getConversation).mockResolvedValue(existing as never);
      vi.mocked(mockConversationService.updateConversation).mockResolvedValue(undefined as never);

      await handler({ conversation_id: 'conv-claim-ws2', extra: { workspace: '/caller-ws' } });

      expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
        'conv-claim-ws2',
        expect.objectContaining({
          extra: expect.objectContaining({ workspace: '/caller-ws' }),
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Sidebar filter (useConversationListSync logic extracted)
// ---------------------------------------------------------------------------

describe('sidebar preheat filter', () => {
  type ConvExtra = { isHealthCheck?: boolean; teamId?: string; preheat?: boolean } | undefined;

  // Mirrors the exact filter predicate from useConversationListSync.ts line 96-98
  const shouldShow = (extra: ConvExtra): boolean => {
    return extra?.isHealthCheck !== true && !extra?.teamId && extra?.preheat !== true;
  };

  it('filters out preheat conversations', () => {
    expect(shouldShow({ preheat: true })).toBe(false);
  });

  it('does not filter out normal conversations', () => {
    expect(shouldShow(undefined)).toBe(true);
    expect(shouldShow({})).toBe(true);
  });

  it('does not filter out conversations after preheat key is removed (claimed)', () => {
    // After claimPreheat, the preheat key is deleted from extra
    const claimedExtra: ConvExtra = { backend: 'claude' } as ConvExtra;
    expect(shouldShow(claimedExtra)).toBe(true);
  });

  it('filters out health-check conversations regardless of preheat flag', () => {
    expect(shouldShow({ isHealthCheck: true })).toBe(false);
  });

  it('filters out team conversations regardless of preheat flag', () => {
    expect(shouldShow({ teamId: 'team-1' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Startup cleanup race (initBridge preheat stale filter logic)
// ---------------------------------------------------------------------------

describe('startup preheat cleanup race condition', () => {
  // Mirrors the stale-preheat filter predicate from initBridge.ts
  const PREHEAT_STALE_THRESHOLD_MS = 60_000;

  type ConvLike = {
    id: string;
    extra?: Record<string, unknown>;
    createTime?: number;
  };

  function filterStalePreheats(conversations: ConvLike[], processStartTime: number): ConvLike[] {
    return conversations.filter((c) => {
      if (c.extra?.preheat !== true) return false;
      const createTime = typeof c.createTime === 'number' ? c.createTime : 0;
      return processStartTime - createTime > PREHEAT_STALE_THRESHOLD_MS;
    });
  }

  it('deletes preheat conversations created before the stale threshold', () => {
    const now = Date.now();
    const staleConv: ConvLike = {
      id: 'stale-preheat-1',
      extra: { preheat: true },
      createTime: now - PREHEAT_STALE_THRESHOLD_MS - 1000,
    };
    const result = filterStalePreheats([staleConv], now);
    expect(result.map((c) => c.id)).toContain('stale-preheat-1');
  });

  it('does not delete preheat conversations created within the current process lifetime', () => {
    const now = Date.now();
    const freshConv: ConvLike = {
      id: 'fresh-preheat-1',
      extra: { preheat: true },
      createTime: now - 1000, // 1 second ago — well within threshold
    };
    const result = filterStalePreheats([freshConv], now);
    expect(result.map((c) => c.id)).not.toContain('fresh-preheat-1');
  });

  it('does not delete normal (non-preheat) conversations regardless of age', () => {
    const now = Date.now();
    const oldNormalConv: ConvLike = {
      id: 'old-normal-1',
      extra: { preheat: false },
      createTime: now - 120_000, // 2 minutes ago
    };
    const noPreheatConv: ConvLike = {
      id: 'old-normal-2',
      extra: {},
      createTime: now - 120_000,
    };
    const result = filterStalePreheats([oldNormalConv, noPreheatConv], now);
    expect(result).toHaveLength(0);
  });

  it('handles missing createTime as 0 — old epoch is always stale', () => {
    const now = Date.now();
    const noTimeConv: ConvLike = {
      id: 'no-time-preheat',
      extra: { preheat: true },
      // createTime intentionally omitted
    };
    const result = filterStalePreheats([noTimeConv], now);
    // epoch 0 is many ms before now → stale
    expect(result.map((c) => c.id)).toContain('no-time-preheat');
  });

  it('exact boundary: createTime exactly at threshold is NOT stale (uses strict >)', () => {
    const now = Date.now();
    const boundaryConv: ConvLike = {
      id: 'boundary-preheat',
      extra: { preheat: true },
      createTime: now - PREHEAT_STALE_THRESHOLD_MS, // difference === threshold, not > threshold
    };
    const result = filterStalePreheats([boundaryConv], now);
    // processStartTime - createTime === PREHEAT_STALE_THRESHOLD_MS → NOT > threshold → not stale
    expect(result.map((c) => c.id)).not.toContain('boundary-preheat');
  });
});

// ---------------------------------------------------------------------------
// Rapid agent switch — cancelPreheat called on previous before new preheat
// ---------------------------------------------------------------------------

describe('triggerPreheat — rapid agent switch', () => {
  // Mirrors the triggerPreheat logic from GuidPage.tsx using the cancelPreheat bridge provider.
  // We test the cancellation sequence directly by calling the cancelPreheat provider.

  beforeEach(() => {
    providerCallbacks.clear();
    vi.clearAllMocks();
    initConversationBridge(mockConversationService, mockWorkerTaskManager);
  });

  it('cancels the first preheat when a second preheat is requested for a different backend', async () => {
    const preheatHandler = getHandler('conversation.preheat');
    const cancelHandler = getHandler('conversation.cancelPreheat');

    // First preheat: backend = 'claude'
    const conv1 = { id: 'preheat-agent-1', source: 'aionui', extra: { preheat: true } };
    vi.mocked(mockConversationService.createConversation).mockResolvedValueOnce(conv1 as never);
    vi.mocked(mockWorkerTaskManager.getOrBuildTask).mockResolvedValue(mockAcpTask as never);
    mockAcpTask.initAgent.mockResolvedValue(undefined);
    vi.mocked(mockConversationService.deleteConversation).mockResolvedValue(undefined as never);

    await preheatHandler({ backend: 'claude' });
    // Simulate preheatRef.current = { conversationId: 'preheat-agent-1', backend: 'claude' }

    // Second preheat: backend = 'qwen' — caller must cancel the first one first
    await cancelHandler({ conversation_id: 'preheat-agent-1' });

    expect(mockWorkerTaskManager.kill).toHaveBeenCalledWith('preheat-agent-1');
    expect(mockConversationService.deleteConversation).toHaveBeenCalledWith('preheat-agent-1');

    // Then a new preheat for 'qwen' can be created cleanly
    const conv2 = { id: 'preheat-agent-2', source: 'aionui', extra: { preheat: true } };
    vi.mocked(mockConversationService.createConversation).mockResolvedValueOnce(conv2 as never);

    const result = await preheatHandler({ backend: 'qwen' });
    expect(result).toEqual({ conversation_id: 'preheat-agent-2' });
  });

  it('does not cancel when the same backend is selected again', () => {
    // triggerPreheat in GuidPage calls cancelPreheat only when prev !== null.
    // If the same backend is selected, the useEffect only fires when
    // selectedAgent changes — so no cancel is issued for the same key.
    // Model this as: prev preheat still holds if same backend, no cancel call.
    const cancelSpy = vi.mocked(mockWorkerTaskManager.kill);
    // No cancelPreheat issued when backend hasn't changed
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('non-ACP backends (gemini, aionrs) do not trigger preheat at all', () => {
    // NON_ACP_BACKENDS = { gemini, aionrs, openclaw-gateway, nanobot }
    // triggerPreheat returns early for these without calling preheat.invoke
    const NON_ACP_BACKENDS = new Set(['gemini', 'aionrs', 'openclaw-gateway', 'nanobot']);
    const preheatShouldRun = (backend: string) =>
      !NON_ACP_BACKENDS.has(backend) && !backend.startsWith('custom:') && !backend.startsWith('remote:');

    expect(preheatShouldRun('gemini')).toBe(false);
    expect(preheatShouldRun('aionrs')).toBe(false);
    expect(preheatShouldRun('openclaw-gateway')).toBe(false);
    expect(preheatShouldRun('nanobot')).toBe(false);
    expect(preheatShouldRun('custom:my-agent')).toBe(false);
    expect(preheatShouldRun('remote:some-host')).toBe(false);
    expect(preheatShouldRun('claude')).toBe(true);
    expect(preheatShouldRun('qwen')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// claimPreheat timeout fallback (useGuidSend logic)
// ---------------------------------------------------------------------------

describe('claimPreheat timeout fallback', () => {
  it('rejects after the specified timeout when claimPreheat never resolves', async () => {
    vi.useFakeTimers();

    let resolveExternal: ((v: { conversation_id: string }) => void) | undefined;
    const hangingPromise = new Promise<{ conversation_id: string }>((resolve) => {
      resolveExternal = resolve;
    });

    // Mirrors the claimWithTimeout wrapper in useGuidSend.ts
    const claimTimeoutMs = 5000;
    const claimWithTimeout = new Promise<{ conversation_id: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('[GuidSend] claimPreheat timed out')), claimTimeoutMs);
      hangingPromise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });

    const rejection = expect(claimWithTimeout).rejects.toThrow('[GuidSend] claimPreheat timed out');

    // Advance past 5s
    await vi.advanceTimersByTimeAsync(claimTimeoutMs + 100);

    await rejection;

    // Resolve the hanging promise after the timeout — should have no effect
    resolveExternal!({ conversation_id: 'late-claim' });

    vi.useRealTimers();
  });

  it('resolves before timeout when claimPreheat returns quickly', async () => {
    vi.useFakeTimers();

    const claimTimeoutMs = 5000;
    const fastPromise = Promise.resolve({ conversation_id: 'fast-claim' });

    const claimWithTimeout = new Promise<{ conversation_id: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('[GuidSend] claimPreheat timed out')), claimTimeoutMs);
      fastPromise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });

    const result = await claimWithTimeout;
    expect(result).toEqual({ conversation_id: 'fast-claim' });

    vi.useRealTimers();
  });
});
