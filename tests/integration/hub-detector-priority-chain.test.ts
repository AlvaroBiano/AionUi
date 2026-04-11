/**
 * L1 Integration Test — Hub Install → Managed Directory → AcpDetector Priority Chain.
 *
 * Verifies the cross-module integration between:
 * 1. ManagedInstallResolver — finds binaries in managed install directory
 * 2. AcpDetector.detectExtensionAgents() — uses the priority chain:
 *    managed > defaultCliPath > which > skip
 * 3. Agent startup parameters — cliPath, acpArgs, env, resolvedFrom are correct
 *
 * These tests exercise the data flow from extension manifest → adapter resolution →
 * managed directory lookup → AcpDetector output, verifying that managed install
 * takes priority over system PATH when both are available.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before imports
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
    { cmd: 'goose', name: 'Goose', backendId: 'goose', args: ['--acp'] },
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

// Mock ManagedInstallResolver — controls whether a managed binary is found
const mockResolveManagedBinary = vi.fn(() => null);
const mockCleanOldVersions = vi.fn(async () => []);
vi.mock('@process/extensions/hub/ManagedInstallResolver', () => ({
  resolveManagedBinary: (...args: unknown[]) => mockResolveManagedBinary(...args),
  cleanOldVersions: (...args: unknown[]) => mockCleanOldVersions(...args),
}));

import { ProcessConfig } from '@process/utils/initStorage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function createFreshDetector() {
  const mod = await import('@process/agent/acp/AcpDetector');
  return mod.acpDetector;
}

function makeExtAdapter(opts: {
  id: string;
  name: string;
  cliCommand?: string;
  extensionName: string;
  acpArgs?: string[];
  connectionType?: string;
  defaultCliPath?: string;
  env?: Record<string, string>;
  skillsDirs?: string[];
  avatar?: string;
}) {
  return {
    id: opts.id,
    name: opts.name,
    cliCommand: opts.cliCommand,
    connectionType: opts.connectionType ?? 'cli',
    acpArgs: opts.acpArgs ?? ['--acp'],
    _extensionName: opts.extensionName,
    defaultCliPath: opts.defaultCliPath,
    env: opts.env,
    skillsDirs: opts.skillsDirs,
    avatar: opts.avatar,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('L1 Hub Install → AcpDetector Priority Chain', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetAcpAdapters.mockReturnValue([]);
    mockResolveManagedBinary.mockReturnValue(null);
    mockCleanOldVersions.mockResolvedValue([]);
    vi.mocked(ProcessConfig.get).mockResolvedValue([]);
  });

  // =========================================================================
  // Scenario: Managed install takes priority over system PATH
  // =========================================================================
  describe('Managed install overrides system PATH', () => {
    it('should use managed binary path when both managed and which are available', async () => {
      // goose is available on system PATH
      setAvailableClis(['goose']);

      // But also installed via Hub (managed directory)
      mockResolveManagedBinary.mockReturnValue({
        binaryPath: '/home/user/.aionui-agents/aionext-goose/1.0.0_a1b2c3d4/bin/goose',
        versionDir: '1.0.0_a1b2c3d4',
      });

      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'goose',
          name: 'Goose (Hub)',
          cliCommand: 'goose',
          extensionName: 'aionext-goose',
          env: { GOOSE_HOME: '/custom/goose' },
          acpArgs: ['--acp', '--mode=team'],
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Find the extension goose agent (not the builtin)
      const hubGoose = agents.find((a) => a.isExtension && a.extensionName === 'aionext-goose');
      expect(hubGoose).toBeDefined();

      // Managed path should be used, NOT system 'goose'
      expect(hubGoose!.cliPath).toBe('/home/user/.aionui-agents/aionext-goose/1.0.0_a1b2c3d4/bin/goose');
      expect(hubGoose!.resolvedFrom).toBe('managed');

      // env and acpArgs should be passed through
      expect(hubGoose!.env).toEqual({ GOOSE_HOME: '/custom/goose' });
      expect(hubGoose!.acpArgs).toEqual(['--acp', '--mode=team']);
    });

    it('should fall back to defaultCliPath when managed is not available', async () => {
      setAvailableClis([]);
      mockResolveManagedBinary.mockReturnValue(null);

      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'auggie',
          name: 'Auggie',
          extensionName: 'aionext-auggie',
          defaultCliPath: 'bunx @anthropic/auggie-cli@latest',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      const auggie = agents.find((a) => a.name === 'Auggie');
      expect(auggie).toBeDefined();
      expect(auggie!.cliPath).toBe('bunx @anthropic/auggie-cli@latest');
      expect(auggie!.resolvedFrom).toBe('default-cli-path');
    });

    it('should skip agent when managed and defaultCliPath are both unavailable (no which fallback)', async () => {
      setAvailableClis(['custom-agent']);
      mockResolveManagedBinary.mockReturnValue(null);

      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'custom',
          name: 'Custom Agent',
          cliCommand: 'custom-agent',
          extensionName: 'ext-custom',
          // no defaultCliPath → skipped
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Extension agents without defaultCliPath or cliCommand are skipped
      expect(agents.find((a) => a.name === 'Custom Agent')).toBeUndefined();
    });

    it('should skip agent when all resolution methods fail', async () => {
      setAvailableClis([]); // not on PATH
      mockResolveManagedBinary.mockReturnValue(null); // not managed

      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'unavailable',
          name: 'Unavailable Agent',
          cliCommand: 'no-such-cli',
          extensionName: 'ext-unavailable',
          // no defaultCliPath
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      expect(agents.find((a) => a.name === 'Unavailable Agent')).toBeUndefined();
    });
  });

  // =========================================================================
  // Scenario: Multiple extension agents with mixed resolution
  // =========================================================================
  describe('Multiple agents with mixed resolution methods', () => {
    it('each agent should resolve via its own best available method', async () => {
      setAvailableClis(['system-agent']);

      // Agent A: managed install available
      mockResolveManagedBinary.mockImplementation((extName: string, cliCommand: string | undefined) => {
        if (extName === 'ext-managed-agent' && cliCommand === 'managed-cli') {
          return {
            binaryPath: '/home/user/.aionui-agents/ext-managed-agent/2.0.0_ff001122/bin/managed-cli',
            versionDir: '2.0.0_ff001122',
          };
        }
        return null;
      });

      mockGetAcpAdapters.mockReturnValue([
        // Agent A: has cliCommand -> resolves via managed (bin/{cliCommand})
        makeExtAdapter({
          id: 'agent-a',
          name: 'Agent A (Managed)',
          cliCommand: 'managed-cli',
          extensionName: 'ext-managed-agent',
        }),
        // Agent B: has defaultCliPath -> resolves via bunx fallback
        makeExtAdapter({
          id: 'agent-b',
          name: 'Agent B (Bunx)',
          extensionName: 'ext-bunx-agent',
          defaultCliPath: 'bunx @example/agent-b',
        }),
        // Agent C: only defaultCliPath -> resolves via default-cli-path
        makeExtAdapter({
          id: 'agent-c',
          name: 'Agent C (Default)',
          extensionName: 'ext-system-agent',
          defaultCliPath: 'bunx @example/agent-c',
        }),
        // Agent D: nothing available -> skipped
        makeExtAdapter({
          id: 'agent-d',
          name: 'Agent D (Missing)',
          cliCommand: 'ghost-cli',
          extensionName: 'ext-ghost',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Agent A: managed
      const agentA = agents.find((a) => a.name === 'Agent A (Managed)');
      expect(agentA).toBeDefined();
      expect(agentA!.resolvedFrom).toBe('managed');
      expect(agentA!.cliPath).toContain('.aionui-agents');

      // Agent B: default-cli-path
      const agentB = agents.find((a) => a.name === 'Agent B (Bunx)');
      expect(agentB).toBeDefined();
      expect(agentB!.resolvedFrom).toBe('default-cli-path');
      expect(agentB!.cliPath).toBe('bunx @example/agent-b');

      // Agent C: default-cli-path
      const agentC = agents.find((a) => a.name === 'Agent C (Default)');
      expect(agentC).toBeDefined();
      expect(agentC!.resolvedFrom).toBe('default-cli-path');
      expect(agentC!.cliPath).toBe('bunx @example/agent-c');

      // Agent D: skipped
      expect(agents.find((a) => a.name === 'Agent D (Missing)')).toBeUndefined();
    });
  });

  // =========================================================================
  // Scenario: Managed agent and builtin agent coexistence
  // =========================================================================
  describe('Managed extension vs builtin agent coexistence', () => {
    it('managed extension should suppress builtin which check for the same agent', async () => {
      // 'goose' is available on system PATH AND installed via Hub
      setAvailableClis(['goose']);

      // Extension's managed binary resolves to absolute path
      mockResolveManagedBinary.mockReturnValue({
        binaryPath: '/home/user/.aionui-agents/aionext-goose/1.0.0_abc/bin/goose',
        versionDir: '1.0.0_abc',
      });

      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'goose',
          name: 'Goose (Hub)',
          cliCommand: 'goose',
          extensionName: 'aionext-goose',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      // Builtin goose should be SKIPPED (managed agent with same ID suppresses the which check)
      const builtinGoose = agents.find((a) => a.backend === 'goose' && !a.isExtension);
      expect(builtinGoose).toBeUndefined();

      // Only the managed extension goose should exist
      const extGoose = agents.find((a) => a.isExtension && a.extensionName === 'aionext-goose');
      expect(extGoose).toBeDefined();
      expect(extGoose!.cliPath).toBe('/home/user/.aionui-agents/aionext-goose/1.0.0_abc/bin/goose');
      expect(extGoose!.resolvedFrom).toBe('managed');
    });
  });

  // =========================================================================
  // Scenario: refreshExtensionAgents after new Hub install
  // =========================================================================
  describe('refreshExtensionAgents picks up newly installed managed agents', () => {
    it('should detect newly managed agent after refresh', async () => {
      setAvailableClis(['claude']);

      const detector = await createFreshDetector();
      await detector.initialize();

      // Initially: only Gemini + Claude
      expect(detector.getDetectedAgents()).toHaveLength(2);
      expect(detector.getDetectedAgents().find((a) => a.isExtension)).toBeUndefined();

      // User installs an extension via Hub
      mockResolveManagedBinary.mockReturnValue({
        binaryPath: '/home/user/.aionui-agents/aionext-auggie/1.0.0_abc/bin/auggie',
        versionDir: '1.0.0_abc',
      });
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'auggie',
          name: 'Auggie',
          cliCommand: 'auggie',
          extensionName: 'aionext-auggie',
          env: { NODE_OPTIONS: '--max-old-space-size=4096' },
        }),
      ]);

      await detector.refreshExtensionAgents();
      const agents = detector.getDetectedAgents();

      // Now: Gemini + Claude + Auggie
      expect(agents).toHaveLength(3);
      const auggie = agents.find((a) => a.name === 'Auggie');
      expect(auggie).toBeDefined();
      expect(auggie!.resolvedFrom).toBe('managed');
      expect(auggie!.env).toEqual({ NODE_OPTIONS: '--max-old-space-size=4096' });
    });
  });

  // =========================================================================
  // Scenario: Agent startup parameters correctness
  // =========================================================================
  describe('Agent startup parameters are correctly populated', () => {
    it('managed agent should have all required fields for spawning', async () => {
      setAvailableClis([]);
      mockResolveManagedBinary.mockReturnValue({
        binaryPath: '/home/user/.aionui-agents/aionext-codebuddy/3.1.0_deadbeef/bin/codebuddy',
        versionDir: '3.1.0_deadbeef',
      });

      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'codebuddy',
          name: 'CodeBuddy',
          cliCommand: 'codebuddy',
          extensionName: 'aionext-codebuddy',
          acpArgs: ['--acp', '--no-color'],
          env: { CB_MODE: 'acp', CB_LOG_LEVEL: 'debug' },
          avatar: 'https://example.com/avatar.png',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();
      const agents = detector.getDetectedAgents();

      const cb = agents.find((a) => a.name === 'CodeBuddy');
      expect(cb).toBeDefined();

      // All fields needed by AcpConnection for spawning:
      expect(cb!.backend).toBe('custom');
      expect(cb!.cliPath).toBe('/home/user/.aionui-agents/aionext-codebuddy/3.1.0_deadbeef/bin/codebuddy');
      expect(cb!.acpArgs).toEqual(['--acp', '--no-color']);
      expect(cb!.env).toEqual({ CB_MODE: 'acp', CB_LOG_LEVEL: 'debug' });
      expect(cb!.resolvedFrom).toBe('managed');
      expect(cb!.isExtension).toBe(true);
      expect(cb!.extensionName).toBe('aionext-codebuddy');
      expect(cb!.customAgentId).toBe('ext:aionext-codebuddy:codebuddy');
      expect(cb!.avatar).toBe('https://example.com/avatar.png');
    });
  });

  // =========================================================================
  // Scenario: Post-install version cleanup integration
  // =========================================================================
  describe('Post-install version cleanup integration', () => {
    it('initialize should trigger background cleanup for managed agents', async () => {
      setAvailableClis([]);
      mockResolveManagedBinary.mockReturnValue({
        binaryPath: '/managed/ext-a/1.0.0_abc/bin/agent',
        versionDir: '1.0.0_abc',
      });
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'agent-a',
          name: 'Agent A',
          cliCommand: 'agent-a',
          extensionName: 'ext-a',
        }),
      ]);
      mockCleanOldVersions.mockResolvedValue(['/managed/ext-a/0.1.0_old']);

      const detector = await createFreshDetector();
      await detector.initialize();

      // Wait for background cleanup
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCleanOldVersions).toHaveBeenCalledWith('ext-a', 3);
    });

    it('should not trigger cleanup for non-managed agents', async () => {
      setAvailableClis(['system-cli']);
      mockResolveManagedBinary.mockReturnValue(null);
      mockGetAcpAdapters.mockReturnValue([
        makeExtAdapter({
          id: 'sys',
          name: 'System Agent',
          cliCommand: 'system-cli',
          extensionName: 'ext-sys',
        }),
      ]);

      const detector = await createFreshDetector();
      await detector.initialize();

      await new Promise((r) => setTimeout(r, 50));

      expect(mockCleanOldVersions).not.toHaveBeenCalled();
    });
  });
});
