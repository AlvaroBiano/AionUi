/**
 * Unit tests — HubIndexManager schema version compatibility matrix.
 *
 * Tests the isSchemaCompatible() behavior through the public loadIndexes() API.
 * Covers the full matrix defined in the ACP Agent Registry migration plan.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHubIndex, IHubExtension } from '@/common/types/hub';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module-under-test is imported
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
  };
});

let mockSupportedVersion = 1;

vi.mock('@process/extensions/constants', () => ({
  get HUB_SUPPORTED_SCHEMA_VERSION() {
    return mockSupportedVersion;
  },
  HUB_REMOTE_URLS: ['https://mirror1.test/'],
  HUB_INDEX_FILE: 'index.json',
  getHubResourcesDir: vi.fn(() => '/resources/hub'),
}));

vi.mock('@process/utils', () => ({ getDataPath: () => '/data' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExtension(name: string, overrides?: Partial<IHubExtension>): IHubExtension {
  return {
    name,
    displayName: name,
    description: `Test extension ${name}`,
    author: 'test',
    dist: { tarball: `extensions/${name}.tgz`, integrity: 'sha512-test', unpackedSize: 100 },
    engines: { aionui: '>=1.0.0' },
    hubs: ['acpAdapters'],
    ...overrides,
  };
}

function makeIndex(
  schemaVersion: number,
  extensions: Record<string, IHubExtension>,
  extraFields?: Record<string, unknown>
): IHubIndex & Record<string, unknown> {
  return {
    schemaVersion,
    generatedAt: '2026-04-09T00:00:00Z',
    extensions,
    ...extraFields,
  };
}

/**
 * Set up local index: mockExistsSync returns true for index.json path,
 * mockReadFileSync returns the serialized index.
 */
function setupLocalIndex(index: IHubIndex & Record<string, unknown>): void {
  mockExistsSync.mockImplementation((p: unknown) => {
    const s = String(p);
    if (s.endsWith('index.json')) return true;
    return false;
  });
  mockReadFileSync.mockReturnValue(JSON.stringify(index));
}

/**
 * Set up remote index: mockFetch resolves with a Response-like object.
 */
function setupRemoteIndex(index: IHubIndex & Record<string, unknown>): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => index,
  });
}

/** Set up remote to be unreachable. */
function setupRemoteUnreachable(): void {
  mockFetch.mockRejectedValue(new Error('Network unreachable'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HubIndexManager — Schema Version Compatibility Matrix', () => {
  let hubIndexManager: (typeof import('@process/extensions/hub/HubIndexManager'))['hubIndexManager'];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSupportedVersion = 1;
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
    mockFetch.mockRejectedValue(new Error('no network'));

    // Re-import to get a fresh singleton (reset localLoaded/remoteLoaded)
    vi.resetModules();
    const mod = await import('@process/extensions/hub/HubIndexManager');
    hubIndexManager = mod.hubIndexManager;
  });

  // =========================================================================
  // Scenario 1: local=1, remote=1, supported=1
  //   → Remote overrides local same-name entries, merge succeeds
  // =========================================================================
  describe('Scenario 1: local=1, remote=1, supported=1', () => {
    it('should merge both indexes, remote wins on name conflict', async () => {
      const localExt = makeExtension('ext-a', { description: 'local version' });
      const localOnly = makeExtension('ext-local-only');
      const remoteExt = makeExtension('ext-a', { description: 'remote version' });
      const remoteOnly = makeExtension('ext-remote-only');

      setupLocalIndex(makeIndex(1, { 'ext-a': localExt, 'ext-local-only': localOnly }));
      setupRemoteIndex(makeIndex(1, { 'ext-a': remoteExt, 'ext-remote-only': remoteOnly }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // All three unique names present
      expect(Object.keys(list)).toHaveLength(3);
      expect(list['ext-a']).toBeDefined();
      expect(list['ext-local-only']).toBeDefined();
      expect(list['ext-remote-only']).toBeDefined();

      // Remote wins on conflict
      expect(list['ext-a'].description).toBe('remote version');
    });
  });

  // =========================================================================
  // Scenario 2: local=1, remote=2, supported=1
  //   → Remote skipped (log warn), only local used
  // =========================================================================
  describe('Scenario 2: local=1, remote=2, supported=1', () => {
    it('should skip remote index and use only local', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const localExt = makeExtension('ext-a');
      const remoteExt = makeExtension('ext-b');

      setupLocalIndex(makeIndex(1, { 'ext-a': localExt }));
      setupRemoteIndex(makeIndex(2, { 'ext-b': remoteExt }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // Only local extension present
      expect(Object.keys(list)).toHaveLength(1);
      expect(list['ext-a']).toBeDefined();
      expect(list['ext-b']).toBeUndefined();

      // Warning logged with useful information
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Remote'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('schemaVersion 2'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('supported 1'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipping'));

      warnSpy.mockRestore();
    });

    it('should retry remote on subsequent loadIndexes() calls', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      setupLocalIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteIndex(makeIndex(2, { 'ext-b': makeExtension('ext-b') }));

      await hubIndexManager.loadIndexes();

      // Remote was incompatible, so remoteLoaded should still be false.
      // When we call loadIndexes() again with a now-compatible remote,
      // it should retry.
      setupRemoteIndex(makeIndex(1, { 'ext-b': makeExtension('ext-b') }));
      await hubIndexManager.loadIndexes();

      const list = hubIndexManager.getExtensionList();
      expect(list['ext-b']).toBeDefined();

      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // Scenario 3: local=2, remote=2, supported=1
  //   → Both skipped, extension list is empty
  // =========================================================================
  describe('Scenario 3: local=2, remote=2, supported=1', () => {
    it('should return empty extension list when both indexes are incompatible', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      setupLocalIndex(makeIndex(2, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteIndex(makeIndex(2, { 'ext-b': makeExtension('ext-b') }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(Object.keys(list)).toHaveLength(0);

      // Both sources should have logged warnings
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Local'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Remote'));

      warnSpy.mockRestore();
    });

    it('getExtension() returns undefined when list is empty', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      setupLocalIndex(makeIndex(2, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteIndex(makeIndex(2, { 'ext-b': makeExtension('ext-b') }));

      await hubIndexManager.loadIndexes();

      expect(hubIndexManager.getExtension('ext-a')).toBeUndefined();
      expect(hubIndexManager.getExtension('ext-b')).toBeUndefined();
    });
  });

  // =========================================================================
  // Scenario 4: local=1, remote=1(+unknown fields), supported=1
  //   → Schema compatible, unknown fields ignored
  // =========================================================================
  describe('Scenario 4: local=1, remote=1 (+unknown fields), supported=1', () => {
    it('should accept index with unknown top-level fields', async () => {
      const localExt = makeExtension('ext-a');
      const remoteExt = makeExtension('ext-b');

      setupLocalIndex(makeIndex(1, { 'ext-a': localExt }));

      const remoteIndex = {
        ...makeIndex(1, { 'ext-b': remoteExt }),
        unknownField: 'should be ignored',
        futureFeature: { nested: true },
      };
      setupRemoteIndex(remoteIndex);

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(Object.keys(list)).toHaveLength(2);
      expect(list['ext-a']).toBeDefined();
      expect(list['ext-b']).toBeDefined();
    });

    it('should accept extensions with unknown fields on individual entries', async () => {
      const extWithExtra = {
        ...makeExtension('ext-extra'),
        futureCapability: 'some-new-feature',
        experimentalConfig: { enabled: true },
      } as IHubExtension;

      setupLocalIndex(makeIndex(1, {}));
      setupRemoteIndex(makeIndex(1, { 'ext-extra': extWithExtra }));

      await hubIndexManager.loadIndexes();
      const ext = hubIndexManager.getExtension('ext-extra');

      expect(ext).toBeDefined();
      expect(ext!.name).toBe('ext-extra');
      // Unknown fields pass through (TypeScript cast, no runtime stripping)
      expect((ext as Record<string, unknown>)['futureCapability']).toBe('some-new-feature');
    });
  });

  // =========================================================================
  // Scenario 5: local=1, remote=1 (-required fields), supported=1
  //   → Parse behavior: missing extensions / missing generatedAt
  // =========================================================================
  describe('Scenario 5: local=1, remote=1 (-required fields), supported=1', () => {
    it('should handle missing extensions field gracefully (returns empty)', async () => {
      setupLocalIndex(makeIndex(1, {}));

      // Remote index without extensions field
      const remoteIndex = { schemaVersion: 1, generatedAt: '2026-04-09T00:00:00Z' } as unknown as IHubIndex;
      setupRemoteIndex(remoteIndex);

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // No crash, just empty
      expect(Object.keys(list)).toHaveLength(0);
    });

    it('should handle missing generatedAt field (no runtime impact)', async () => {
      const ext = makeExtension('ext-a');

      // Local index missing generatedAt
      const localIndex = { schemaVersion: 1, extensions: { 'ext-a': ext } } as unknown as IHubIndex;
      setupLocalIndex(localIndex);
      setupRemoteUnreachable();

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // generatedAt is not consumed at runtime, so it should not affect behavior
      expect(list['ext-a']).toBeDefined();
    });

    it('should handle remote index with null extensions', async () => {
      setupLocalIndex(makeIndex(1, { 'ext-local': makeExtension('ext-local') }));

      const remoteIndex = { schemaVersion: 1, generatedAt: '2026-04-09', extensions: null } as unknown as IHubIndex;
      setupRemoteIndex(remoteIndex);

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // extensions ?? {} — null is coerced to empty by nullish coalescing
      expect(list['ext-local']).toBeDefined();
    });
  });

  // =========================================================================
  // Scenario 6: local=0, remote=1, supported=1
  //   → Both compatible (<= supported), normal merge
  // =========================================================================
  describe('Scenario 6: local=0, remote=1, supported=1', () => {
    it('should accept schemaVersion 0 as compatible', async () => {
      const localExt = makeExtension('ext-legacy');
      const remoteExt = makeExtension('ext-current');

      setupLocalIndex(makeIndex(0, { 'ext-legacy': localExt }));
      setupRemoteIndex(makeIndex(1, { 'ext-current': remoteExt }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(Object.keys(list)).toHaveLength(2);
      expect(list['ext-legacy']).toBeDefined();
      expect(list['ext-current']).toBeDefined();
    });

    it('should accept schemaVersion 0 for both sources', async () => {
      setupLocalIndex(makeIndex(0, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteIndex(makeIndex(0, { 'ext-b': makeExtension('ext-b') }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(Object.keys(list)).toHaveLength(2);
    });
  });

  // =========================================================================
  // Console.warn content validation
  // =========================================================================
  describe('console.warn content', () => {
    it('should include source name, schema versions, and action in warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      setupLocalIndex(makeIndex(1, {}));
      setupRemoteIndex(makeIndex(5, {}));

      await hubIndexManager.loadIndexes();

      // Find the schema-related warning
      const schemaWarns = warnSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('schemaVersion')
      );

      expect(schemaWarns.length).toBeGreaterThanOrEqual(1);

      const warnMsg = schemaWarns[0][0] as string;
      // Must contain: [HubIndexManager], source, versions, action
      expect(warnMsg).toContain('[HubIndexManager]');
      expect(warnMsg).toContain('Remote');
      expect(warnMsg).toContain('5');
      expect(warnMsg).toContain(`${mockSupportedVersion}`);
      expect(warnMsg).toContain('skipping');

      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // Remote unreachable → fallback to local
  // =========================================================================
  describe('Remote unreachable → fallback to local', () => {
    it('should use only local index when remote is unreachable', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const localExt = makeExtension('ext-a');
      setupLocalIndex(makeIndex(1, { 'ext-a': localExt }));
      setupRemoteUnreachable();

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(list['ext-a']).toBeDefined();
      expect(Object.keys(list)).toHaveLength(1);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should retry remote on next loadIndexes() call after failure', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setupLocalIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteUnreachable();

      await hubIndexManager.loadIndexes();
      expect(Object.keys(hubIndexManager.getExtensionList())).toHaveLength(1);

      // Now remote becomes available
      setupRemoteIndex(makeIndex(1, { 'ext-b': makeExtension('ext-b') }));
      await hubIndexManager.loadIndexes();

      const list = hubIndexManager.getExtensionList();
      expect(list['ext-b']).toBeDefined();
      expect(Object.keys(list)).toHaveLength(2);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should not re-load local index on retry (localLoaded flag)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setupLocalIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));
      setupRemoteUnreachable();

      await hubIndexManager.loadIndexes();

      // Change local data — should NOT be picked up on second call
      mockReadFileSync.mockReturnValue(JSON.stringify(makeIndex(1, { 'ext-replaced': makeExtension('ext-replaced') })));
      setupRemoteUnreachable();

      await hubIndexManager.loadIndexes();

      const list = hubIndexManager.getExtensionList();
      // Still the original local, not the replaced one
      expect(list['ext-a']).toBeDefined();
      expect(list['ext-replaced']).toBeUndefined();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('should handle local index file not existing', async () => {
      // existsSync returns false for index.json
      mockExistsSync.mockReturnValue(false);
      setupRemoteIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(list['ext-a']).toBeDefined();
    });

    it('should handle corrupted local index JSON', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('index.json'));
      mockReadFileSync.mockReturnValue('{ not valid json !!!');
      setupRemoteIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      // Local failed to parse, remote still works
      expect(list['ext-a']).toBeDefined();

      errorSpy.mockRestore();
    });

    it('should handle remote returning non-ok status', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setupLocalIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(list['ext-a']).toBeDefined();
      expect(Object.keys(list)).toHaveLength(1);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should handle fetch timeout', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setupLocalIndex(makeIndex(1, { 'ext-a': makeExtension('ext-a') }));
      // Fetch never resolves (simulates timeout)
      mockFetch.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), 100))
      );

      await hubIndexManager.loadIndexes();
      const list = hubIndexManager.getExtensionList();

      expect(list['ext-a']).toBeDefined();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
