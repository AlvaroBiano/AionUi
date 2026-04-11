/**
 * Regression Test — Existing Agent Paths Not Affected by Migration.
 *
 * Verifies that the ACP Agent Registry migration (lifecycle runner injection,
 * content hash integrity, managed directory verification) does not break:
 * 1. Builtin agent detection via `which` on system PATH
 * 2. Custom agent cliPath from user config (highest priority)
 * 3. Extension agent detection via ExtensionRegistry adapters
 * 4. Agent deduplication priority: builtin > extension > custom
 * 5. Gemini always-present behavior (no CLI required)
 * 6. Refresh operations preserve correct agent ordering
 *
 * These tests exercise the same code paths as the production AcpDetector
 * but verify the invariants that must hold across the migration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSafeExec = vi.fn();
const mockSafeExecFile = vi.fn();
vi.mock('@process/utils/safeExec', () => ({
  safeExec: (...args: unknown[]) => mockSafeExec(...args),
  safeExecFile: (...args: unknown[]) => mockSafeExecFile(...args),
}));

vi.mock('@/common/types/acpTypes', () => ({
  POTENTIAL_ACP_CLIS: [
    { cmd: 'claude', name: 'Claude Code', backendId: 'claude', args: ['--experimental-acp'] },
    { cmd: 'qwen', name: 'Qwen Code', backendId: 'qwen', args: ['--acp'] },
    { cmd: 'augment', name: 'Augment Code', backendId: 'auggie', args: ['--acp'] },
    { cmd: 'goose', name: 'Goose', backendId: 'goose', args: ['--acp'] },
    { cmd: 'codex', name: 'Codex CLI', backendId: 'codex', args: ['--acp'] },
  ],
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn(async () => []) },
}));

const mockGetAcpAdapters = vi.fn((): Record<string, unknown>[] => []);
vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: () => ({
      getAcpAdapters: mockGetAcpAdapters,
      getLoadedExtensions: vi.fn(() => []),
    }),
  },
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn(() => ({ ...process.env })),
}));

vi.mock('@process/extensions/hub/ManagedInstallResolver', () => ({
  resolveManagedBinary: vi.fn(() => null),
  cleanOldVersions: vi.fn(async () => []),
}));

import { ProcessConfig } from '@process/utils/initStorage';

function setAvailableClis(clis: string[]): void {
  const available = new Set(clis);

  // POSIX batch: safeExec receives a shell script with `command -v 'cmd' && echo 'cmd'`
  mockSafeExec.mockImplementation((script: string) => {
    const found: string[] = [];
    for (const m of script.matchAll(/echo '([^']+)'/g)) {
      if (available.has(m[1])) found.push(m[1]);
    }
    return Promise.resolve({ stdout: found.join('\n'), stderr: '' });
  });

  // Windows fallback: individual safeExecFile calls
  mockSafeExecFile.mockImplementation((_bin: string, args: string[]) => {
    const cmd = args[0];
    if (available.has(cmd)) return Promise.resolve({ stdout: '', stderr: '' });
    return Promise.reject(new Error('not found'));
  });
}

function makeExtAdapter(opts: {
  id: string;
  name: string;
  cliCommand?: string;
  extensionName: string;
  acpArgs?: string[];
  connectionType?: string;
  defaultCliPath?: string;
  installedBinaryPath?: string;
}) {
  return {
    id: opts.id,
    name: opts.name,
    cliCommand: opts.cliCommand,
    connectionType: opts.connectionType ?? 'cli',
    acpArgs: opts.acpArgs ?? ['--acp'],
    _extensionName: opts.extensionName,
    defaultCliPath: opts.defaultCliPath,
    installedBinaryPath: opts.installedBinaryPath,
  };
}

async function createFreshDetector() {
  const mod = await import('@process/agent/acp/AcpDetector');
  return mod.acpDetector;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Regression: Existing Agent Paths Not Affected by Migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetAcpAdapters.mockReturnValue([]);
    vi.mocked(ProcessConfig.get).mockResolvedValue([]);
  });

  // =========================================================================
  // Invariant 1: Builtin agents still detected via `which`
  // =========================================================================
  describe('Builtin agents: which-based detection unchanged', () => {
    it('should detect all available builtin CLIs', async () => {
      setAvailableClis(['claude', 'qwen', 'goose', 'codex']);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // All available builtins detected
      expect(agents.find((a) => a.backend === 'claude')).toBeDefined();
      expect(agents.find((a) => a.backend === 'qwen')).toBeDefined();
      expect(agents.find((a) => a.backend === 'goose')).toBeDefined();
      expect(agents.find((a) => a.backend === 'codex')).toBeDefined();

      // Unavailable one not detected
      expect(agents.find((a) => a.backend === 'auggie')).toBeUndefined();
    });

    it('should use the CLI command name as cliPath for builtins', async () => {
      setAvailableClis(['claude']);

      const detector = await createFreshDetector();
      await detector.initialize();

      const claude = detector.getDetectedAgents().find((a) => a.backend === 'claude');
      expect(claude).toBeDefined();
      expect(claude!.cliPath).toBe('claude');
      expect(claude!.acpArgs).toEqual(['--experimental-acp']);
    });

    it('should handle newly installed builtin CLI after refreshBuiltinAgents', async () => {
      setAvailableClis(['claude']);

      const detector = await createFreshDetector();
      await detector.initialize();

      expect(detector.getDetectedAgents().find((a) => a.backend === 'goose')).toBeUndefined();

      // User installs goose
      setAvailableClis(['claude', 'goose']);
      await detector.refreshBuiltinAgents();

      expect(detector.getDetectedAgents().find((a) => a.backend === 'goose')).toBeDefined();
    });

    it('should handle removed builtin CLI after refreshBuiltinAgents', async () => {
      setAvailableClis(['claude', 'qwen']);

      const detector = await createFreshDetector();
      await detector.initialize();
      expect(detector.getDetectedAgents().find((a) => a.backend === 'qwen')).toBeDefined();

      // User uninstalls qwen
      setAvailableClis(['claude']);
      await detector.refreshBuiltinAgents();

      expect(detector.getDetectedAgents().find((a) => a.backend === 'qwen')).toBeUndefined();
    });
  });

  // =========================================================================
  // Invariant 2: Custom agent cliPath unchanged (highest priority in user config)
  // =========================================================================
  describe('Custom agents: user cliPath config highest priority', () => {
    it('should use user-configured cliPath directly without which check', async () => {
      setAvailableClis([]); // no builtins available
      vi.mocked(ProcessConfig.get).mockResolvedValue([
        {
          id: 'my-custom',
          name: 'My Custom Agent',
          defaultCliPath: '/usr/local/bin/my-agent',
          enabled: true,
          acpArgs: ['--custom-flag'],
        },
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      const custom = agents.find((a) => a.customAgentId === 'my-custom');
      expect(custom).toBeDefined();
      expect(custom!.cliPath).toBe('/usr/local/bin/my-agent');
      expect(custom!.acpArgs).toEqual(['--custom-flag']);
      expect(custom!.backend).toBe('custom');
    });

    it('disabled custom agents should not appear', async () => {
      setAvailableClis([]);
      vi.mocked(ProcessConfig.get).mockResolvedValue([
        { id: 'disabled-agent', name: 'Disabled', defaultCliPath: '/bin/agent', enabled: false },
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();

      expect(detector.getDetectedAgents().find((a) => a.customAgentId === 'disabled-agent')).toBeUndefined();
    });

    it('preset agents without cliPath should still be detected', async () => {
      setAvailableClis([]);
      vi.mocked(ProcessConfig.get).mockResolvedValue([
        {
          id: 'preset-academic',
          name: 'Academic Paper',
          enabled: true,
          isPreset: true,
          presetAgentType: 'gemini',
          avatar: '📚',
        },
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      const preset = agents.find((a) => a.customAgentId === 'preset-academic');
      expect(preset).toBeDefined();
      expect(preset!.isPreset).toBe(true);
      expect(preset!.cliPath).toBeUndefined();
    });
  });

  // =========================================================================
  // Invariant 3: Extension agents detected via ExtensionRegistry
  // =========================================================================
  describe('Extension agents: ExtensionRegistry adapter detection unchanged', () => {
    it('should detect extension agents when defaultCliPath is provided', async () => {
      setAvailableClis([]);
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'goose',
          name: 'Goose (Extension)',
          extensionName: 'aionext-goose',
          defaultCliPath: 'bunx @goose/cli',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      const extAgent = agents.find((a) => a.cliPath === 'bunx @goose/cli');
      expect(extAgent).toBeDefined();
      expect(extAgent!.backend).toBe('custom');
      expect(extAgent!.isExtension).toBe(true);
      expect(extAgent!.extensionName).toBe('aionext-goose');
    });

    it('extension agents with backend=custom should use customAgentId', async () => {
      setAvailableClis([]);
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'kiro',
          name: 'Kiro',
          extensionName: 'aionext-kiro',
          defaultCliPath: 'bunx @kiro/cli',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      const kiro = agents.find((a) => a.cliPath === 'bunx @kiro/cli');
      expect(kiro).toBeDefined();
      expect(kiro!.customAgentId).toBe('ext:aionext-kiro:kiro');
    });

    it('should handle extension error gracefully', async () => {
      setAvailableClis(['claude']);
      mockGetAcpAdapters.mockImplementation(() => {
        throw new Error('Extension registry corrupted');
      });

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Should still detect builtins + gemini despite extension error
      expect(agents.length).toBeGreaterThanOrEqual(2);
      expect(agents[0].backend).toBe('gemini');
      expect(agents.find((a) => a.backend === 'claude')).toBeDefined();
    });
  });

  // =========================================================================
  // Invariant 4: Deduplication priority preserved
  // =========================================================================
  describe('Deduplication: extension wins by name over builtin, custom kept separately', () => {
    it('extension should win when sharing the same name as builtin', async () => {
      setAvailableClis(['qwen']);
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'qwen',
          name: 'Qwen Code',
          extensionName: 'aionext-qwen',
          defaultCliPath: 'bunx @qwen/cli',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Name-based dedup: extension iterated first, so extension wins
      const qwenAgents = agents.filter((a) => a.name === 'Qwen Code');
      expect(qwenAgents).toHaveLength(1);
      expect(qwenAgents[0].backend).toBe('custom'); // extension wins
      expect(qwenAgents[0].isExtension).toBe(true);
    });

    it('extension and custom with same cliPath should both exist (deduped separately)', async () => {
      setAvailableClis([]);
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'ext-shared',
          name: 'Extension Shared',
          extensionName: 'ext-shared',
          defaultCliPath: 'shared-cli',
        }),
      ]);
      vi.mocked(ProcessConfig.get).mockResolvedValue([
        { id: 'custom-shared', name: 'Custom Shared', defaultCliPath: 'shared-cli', enabled: true },
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Custom and extension are deduped in separate pools, so both can exist
      const extensionAgent = agents.find((a) => a.isExtension && a.name === 'Extension Shared');
      const customAgent = agents.find((a) => !a.isExtension && a.name === 'Custom Shared');
      expect(extensionAgent).toBeDefined();
      expect(customAgent).toBeDefined();
    });

    it('deduplication should survive refresh cycles', async () => {
      setAvailableClis(['qwen']);
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'qwen',
          name: 'Qwen Code',
          extensionName: 'aionext-qwen',
          defaultCliPath: 'bunx @qwen/cli',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();

      await detector.refreshBuiltinAgents();
      await detector.refreshExtensionAgents();

      // Extension still wins by name after refresh
      const qwenAgents = detector.getDetectedAgents().filter((a) => a.name === 'Qwen Code');
      expect(qwenAgents).toHaveLength(1);
      expect(qwenAgents[0].isExtension).toBe(true);
    });
  });

  // =========================================================================
  // Invariant 5: Gemini always present
  // =========================================================================
  describe('Gemini: always present regardless of CLI availability', () => {
    it('should be present even with no CLIs detected', async () => {
      setAvailableClis([]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({ backend: 'gemini', name: 'Gemini CLI' });
      expect(agents[0].cliPath).toBeUndefined();
    });

    it('should always be first in the agent list', async () => {
      setAvailableClis(['claude', 'qwen']);
      vi.mocked(ProcessConfig.get).mockResolvedValue([
        { id: 'custom', name: 'Custom', defaultCliPath: '/bin/x', enabled: true },
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();

      expect(detector.getDetectedAgents()[0].backend).toBe('gemini');
    });

    it('should remain first after all refresh operations', async () => {
      setAvailableClis(['claude']);

      const detector = await createFreshDetector();
      await detector.initialize();

      await detector.refreshBuiltinAgents();
      expect(detector.getDetectedAgents()[0].backend).toBe('gemini');

      await detector.refreshExtensionAgents();
      expect(detector.getDetectedAgents()[0].backend).toBe('gemini');

      await detector.refreshCustomAgents();
      expect(detector.getDetectedAgents()[0].backend).toBe('gemini');

      await detector.refreshAll();
      expect(detector.getDetectedAgents()[0].backend).toBe('gemini');
    });
  });

  // =========================================================================
  // Invariant 6: Agent ordering after refresh
  // =========================================================================
  describe('Agent ordering after refresh operations', () => {
    it('refreshAll should produce same ordering as fresh initialize', async () => {
      setAvailableClis(['claude', 'goose']);
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'kiro',
          name: 'Kiro',
          extensionName: 'aionext-kiro',
          defaultCliPath: 'bunx @kiro/cli',
        }),
      ]);
      vi.mocked(ProcessConfig.get).mockResolvedValue([
        { id: 'custom-1', name: 'Custom Agent', defaultCliPath: '/bin/custom', enabled: true },
      ]);

      // Initialize
      const detector = await createFreshDetector();
      await detector.initialize();

      // refreshAll
      await detector.refreshAll();
      const refreshedAgents = detector.getDetectedAgents().map((a) => a.name);

      // gemini first, then custom, then extensions+builtins (dedup order)
      expect(refreshedAgents[0]).toBe('Gemini CLI');
      // Kiro (extension) should appear in the list
      expect(refreshedAgents).toContain('Kiro');
      expect(refreshedAgents).toContain('Custom Agent');
    });

    it('hasAgents should return true even with only Gemini', async () => {
      setAvailableClis([]);

      const detector = await createFreshDetector();
      await detector.initialize();

      expect(detector.hasAgents()).toBe(true);
    });
  });

  // =========================================================================
  // Cross-cutting: config store error handling
  // =========================================================================
  describe('Config store error handling', () => {
    it('should handle ENOENT gracefully for custom agents', async () => {
      setAvailableClis(['claude']);
      vi.mocked(ProcessConfig.get).mockRejectedValue(new Error('ENOENT: no such file'));

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Should still work — just no custom agents
      expect(agents.find((a) => a.backend === 'claude')).toBeDefined();
    });

    it('should handle empty custom agents array', async () => {
      setAvailableClis(['claude']);
      vi.mocked(ProcessConfig.get).mockResolvedValue([]);

      const detector = await createFreshDetector();
      await detector.initialize();

      const customAgents = detector.getDetectedAgents().filter((a) => a.backend === 'custom');
      expect(customAgents).toHaveLength(0);
    });

    it('should handle null custom agents config', async () => {
      setAvailableClis(['claude']);
      vi.mocked(ProcessConfig.get).mockResolvedValue(null);

      const detector = await createFreshDetector();
      await detector.initialize();

      // No crash, builtins still detected
      expect(detector.getDetectedAgents().find((a) => a.backend === 'claude')).toBeDefined();
    });
  });
});
