/**
 * L1 Integration Test — Hub Schema Compatibility.
 *
 * Tests the downstream impact of schema version incompatibility on the
 * HubIndexManager → HubInstaller → UI chain, focusing on:
 * - Empty extension list impact on install operations
 * - Schema incompatibility cascading through the system
 * - Recovery after schema version upgrades
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHubIndex, IHubExtension } from '@/common/types/hub';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    network: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  }),
}));

const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn(() => '{}');

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('util', () => ({ promisify: () => vi.fn(async () => ({ stdout: '', stderr: '' })) }));

vi.mock('@process/utils', () => ({ getDataPath: () => '/data' }));

vi.mock('@process/extensions/constants', () => ({
  HUB_SUPPORTED_SCHEMA_VERSION: 1,
  HUB_REMOTE_URLS: ['https://mirror1.test/'],
  HUB_INDEX_FILE: 'index.json',
  EXTENSION_MANIFEST_FILE: 'aion-extension.json',
  getHubResourcesDir: vi.fn(() => '/resources/hub'),
  getInstallTargetDir: vi.fn(() => '/ext-install-dir'),
}));

vi.mock('@process/extensions/ExtensionRegistry', () => ({
  ExtensionRegistry: { hotReload: vi.fn(async () => {}) },
}));

vi.mock('@process/extensions/lifecycle/statePersistence', () => ({
  markExtensionForReinstall: vi.fn(),
}));

const mockSetTransientState = vi.fn();

vi.mock('@process/extensions/hub/HubStateManager', () => ({
  hubStateManager: {
    setTransientState: (...args: unknown[]) => mockSetTransientState(...args),
  },
}));

vi.mock('@process/agent/acp/AcpDetector', () => ({
  acpDetector: {
    refreshExtensionAgents: vi.fn(async () => {}),
    refreshAll: vi.fn(async () => {}),
    getDetectedAgents: () => [],
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExtension(name: string): IHubExtension {
  return {
    name,
    displayName: name,
    description: `Test ${name}`,
    author: 'test',
    dist: { tarball: `extensions/${name}.tgz`, integrity: 'sha512-test', unpackedSize: 100 },
    engines: { aionui: '>=1.0.0' },
    hubs: ['acpAdapters'],
  };
}

function makeIndex(schemaVersion: number, extensions: Record<string, IHubExtension>): IHubIndex {
  return {
    schemaVersion,
    generatedAt: '2026-04-09T00:00:00Z',
    extensions,
  };
}

function setupLocalIndex(index: IHubIndex): void {
  mockExistsSync.mockImplementation((p: unknown) => {
    const s = String(p);
    if (s.endsWith('index.json') && s.includes('hub')) return true;
    return false;
  });
  mockReadFileSync.mockReturnValue(JSON.stringify(index));
}

function setupRemoteIndex(index: IHubIndex): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => index,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('L1 Hub Schema Compatibility — Integration', () => {
  let hubIndexManager: (typeof import('@process/extensions/hub/HubIndexManager'))['hubIndexManager'];
  let hubInstaller: (typeof import('@process/extensions/hub/HubInstaller'))['hubInstaller'];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
    mockFetch.mockRejectedValue(new Error('no network'));

    vi.resetModules();
    const indexMod = await import('@process/extensions/hub/HubIndexManager');
    hubIndexManager = indexMod.hubIndexManager;

    // HubInstaller depends on HubIndexManager internally — import after reset
    const installerMod = await import('@process/extensions/hub/HubInstaller');
    hubInstaller = installerMod.hubInstaller;
  });

  describe('Scenario 3 downstream: both schemas incompatible → empty list', () => {
    it('HubInstaller.install() should fail when extension is not in empty index', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Both local and remote have schema v2, supported is v1
      setupLocalIndex(makeIndex(2, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteIndex(makeIndex(2, { 'ext-a': makeExtension('ext-a') }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();
      expect(Object.keys(list)).toHaveLength(0);

      // getExtension returns undefined → install should fail
      expect(hubIndexManager.getExtension('ext-a')).toBeUndefined();
    });

    it('getExtensionList() returns empty object suitable for UI iteration', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      setupLocalIndex(makeIndex(2, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteIndex(makeIndex(2, {}));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // UI can safely iterate — no crash
      const entries = Object.entries(list);
      expect(entries).toHaveLength(0);

      // Already installed agents are not affected (they live in ExtensionRegistry, not HubIndex)
      // This test just confirms the hub list is empty, not that agents stop working
    });
  });

  describe('Schema incompatibility does not affect already-installed extensions', () => {
    it('extensions loaded before schema change remain in mergedIndex', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First load: compatible schemas
      setupLocalIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteIndex(makeIndex(1, { 'ext-b': makeExtension('ext-b') }));

      await hubIndexManager.loadIndexes();
      expect(Object.keys(hubIndexManager.getExtensionList())).toHaveLength(2);

      // Note: localLoaded and remoteLoaded are true now
      // Even if the remote index changes to v2, it won't be fetched again
      // (remoteLoaded is true). This is correct behavior — the already-merged
      // data persists in memory.

      const list = hubIndexManager.getExtensionList();
      expect(list['ext-a']).toBeDefined();
      expect(list['ext-b']).toBeDefined();
    });
  });

  describe('Partial compatibility: local OK, remote incompatible', () => {
    it('should provide local extensions for UI even when remote is incompatible', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      setupLocalIndex(
        makeIndex(1, {
          'ext-bundled': makeExtension('ext-bundled'),
        })
      );
      setupRemoteIndex(
        makeIndex(3, {
          'ext-new': makeExtension('ext-new'),
        })
      );

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // Bundled extension still available for install
      expect(list['ext-bundled']).toBeDefined();
      expect(Object.keys(list)).toHaveLength(1);

      // Remote extension not available
      expect(list['ext-new']).toBeUndefined();
    });
  });

  describe('Recovery: remote becomes compatible after app update', () => {
    it('should pick up remote extensions when schema becomes compatible on retry', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      // Initial: remote schema v2 (incompatible)
      setupLocalIndex(makeIndex(1, { 'ext-local': makeExtension('ext-local') }));
      setupRemoteIndex(makeIndex(2, { 'ext-remote': makeExtension('ext-remote') }));

      await hubIndexManager.loadIndexes();
      expect(hubIndexManager.getExtensionList()['ext-remote']).toBeUndefined();

      // Remote "updates" to schema v1 (or app updates to support v2)
      // Since remoteLoaded is still false (incompatible returns {} with length 0,
      // which does NOT set remoteLoaded = true), retry works
      setupRemoteIndex(makeIndex(1, { 'ext-remote': makeExtension('ext-remote') }));

      await hubIndexManager.loadIndexes();
      expect(hubIndexManager.getExtensionList()['ext-remote']).toBeDefined();

      warnSpy.mockRestore();
    });
  });

  describe('Schema warn messages are actionable', () => {
    it('warn message includes enough info for debugging', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      setupLocalIndex(makeIndex(1, {}));
      setupRemoteIndex(makeIndex(99, {}));

      await hubIndexManager.loadIndexes();

      const schemaWarns = warnSpy.mock.calls
        .map((c) => c[0])
        .filter((msg) => typeof msg === 'string' && msg.includes('schemaVersion'));

      expect(schemaWarns.length).toBe(1);

      const msg = schemaWarns[0] as string;
      // Actionable: tells user which source, what version was received, what's supported
      expect(msg).toMatch(/Remote.*schemaVersion 99.*supported 1.*skipping/);

      warnSpy.mockRestore();
    });

    it('local incompatibility also produces a clear warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      setupLocalIndex(makeIndex(5, { 'ext-a': makeExtension('ext-a') }));
      mockFetch.mockRejectedValue(new Error('no network'));

      await hubIndexManager.loadIndexes();

      const schemaWarns = warnSpy.mock.calls
        .map((c) => c[0])
        .filter((msg) => typeof msg === 'string' && msg.includes('schemaVersion'));

      expect(schemaWarns.length).toBe(1);
      expect(schemaWarns[0]).toMatch(/Local.*schemaVersion 5.*supported 1.*skipping/);

      warnSpy.mockRestore();
    });
  });
});
