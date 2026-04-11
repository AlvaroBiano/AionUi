/**
 * L1 Integration Test — Lifecycle → Install → Managed Directory.
 *
 * Tests the chain: HubInstaller downloads/extracts → lifecycle runner executes
 * onInstall → verifyInstallation checks managed directory.
 *
 * Since the full chain involves fork(), shell commands, and real filesystem,
 * these tests mock at the process boundary and verify the data flow through:
 * 1. HubInstaller.install() calls correct sequence (index → zip → extract → verify)
 * 2. verifyInstallation() checks managed directory paths correctly
 * 3. Content hash drives directory naming ({version}_{hashPrefix})
 * 4. HubInstaller integrity verification (sha256 content hash)
 * 5. Security: absolute URL rejection
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import type { IHubExtension } from '@/common/types/hub';

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

/** Central path-matching helper used by all existsSync mocks. */
type PathMatcher = (p: string) => boolean;
let existsSyncMatcher: PathMatcher = () => false;

const mockExistsSync = vi.fn((p: unknown) => existsSyncMatcher(String(p)));
const mockReadFileSync = vi.fn(() => '{}');
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRmSync = vi.fn();
const mockRenameSync = vi.fn();
const mockReaddirSync = vi.fn(() => []);

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
    renameSync: (...args: unknown[]) => mockRenameSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  };
});

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('util', () => ({ promisify: () => vi.fn(async () => ({ stdout: '', stderr: '' })) }));

vi.mock('@process/utils', () => ({
  getDataPath: () => '/data',
  getAgentInstallBasePath: () => '/home/user/.aionui-agents',
}));

vi.mock('@process/extensions/constants', () => ({
  HUB_SUPPORTED_SCHEMA_VERSION: 1,
  HUB_REMOTE_URLS: ['https://mirror1.test/', 'https://mirror2.test/'],
  HUB_INDEX_FILE: 'index.json',
  EXTENSION_MANIFEST_FILE: 'aion-extension.json',
  getHubResourcesDir: vi.fn(() => '/resources/hub'),
  getInstallTargetDir: vi.fn(() => '/ext-install-dir'),
}));

// Mock computeContentHash to return a deterministic value
const MOCK_CONTENT_HASH = 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890';
vi.mock('@process/extensions/lifecycle/contentHash', () => ({
  computeContentHash: vi.fn(() => MOCK_CONTENT_HASH),
}));

const mockHotReload = vi.fn(async () => {});
const mockGetLoadedExtensions = vi.fn(() => [] as Array<Record<string, unknown>>);

vi.mock('@process/extensions/ExtensionRegistry', () => ({
  ExtensionRegistry: {
    hotReload: (...args: unknown[]) => mockHotReload(...args),
    getInstance: () => ({
      getLoadedExtensions: () => mockGetLoadedExtensions(),
    }),
  },
}));

const mockMarkForReinstall = vi.fn(async () => {});
vi.mock('@process/extensions/lifecycle/statePersistence', () => ({
  markExtensionForReinstall: (...args: unknown[]) => mockMarkForReinstall(...args),
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

function makeExtension(name: string, overrides?: Partial<IHubExtension>): IHubExtension {
  return {
    name,
    displayName: name,
    description: `Test ${name}`,
    author: 'test',
    dist: {
      tarball: `extensions/${name}.zip`,
      integrity: `sha256-${MOCK_CONTENT_HASH}`,
      unpackedSize: 1000,
    },
    engines: { aionui: '>=1.0.0' },
    hubs: ['acpAdapters'],
    ...overrides,
  };
}

/**
 * Load HubIndexManager with a given extension in the local index.
 * Sets up readFileSync to return the index JSON.
 * existsSyncMatcher must already be configured before calling.
 */
async function loadIndexWithExtension(
  hubIndexManager: { loadIndexes: () => Promise<void> },
  ext: IHubExtension
): Promise<void> {
  mockReadFileSync.mockImplementation((p: unknown) => {
    const s = String(p);
    if (s.endsWith('index.json')) {
      return JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-04-09T00:00:00Z',
        extensions: { [ext.name]: ext },
      });
    }
    return '{}';
  });
  await hubIndexManager.loadIndexes();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('L1 Hub Lifecycle -> Install -> Managed Directory', () => {
  let hubIndexManager: (typeof import('@process/extensions/hub/HubIndexManager'))['hubIndexManager'];
  let hubInstaller: (typeof import('@process/extensions/hub/HubInstaller'))['hubInstaller'];

  beforeEach(async () => {
    vi.clearAllMocks();
    existsSyncMatcher = () => false;
    mockReadFileSync.mockReturnValue('{}');
    mockFetch.mockRejectedValue(new Error('no network'));
    mockGetLoadedExtensions.mockReturnValue([]);

    vi.resetModules();
    const indexMod = await import('@process/extensions/hub/HubIndexManager');
    hubIndexManager = indexMod.hubIndexManager;
    const installerMod = await import('@process/extensions/hub/HubInstaller');
    hubInstaller = installerMod.hubInstaller;
  });

  // =========================================================================
  // Install flow: bundled extension
  // =========================================================================
  describe('Install flow: bundled extension (zip in Resources)', () => {
    it('should try remote first, then fall back to bundled zip when remote fails', async () => {
      const ext = makeExtension('ext-bundled');

      // existsSync: local index.json exists, bundled zip exists, manifest exists after extract
      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        // Bundled zip in resources (for loadIndexes bundled resolution + resolveZipPath fallback)
        if (s === path.join('/resources/hub', 'ext-bundled.zip')) return true;
        // Manifest exists after extraction
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);

      // After loadIndexes, ext.bundled should be true (zip exists in resources)
      const loaded = hubIndexManager.getExtension('ext-bundled');
      expect(loaded).toBeDefined();
      expect(loaded!.bundled).toBe(true);

      // mockFetch defaults to rejected — remote will fail, triggering bundled fallback
      await hubInstaller.install('ext-bundled');

      // Remote download should have been attempted (and failed) before falling back to bundled
      const zipFetchCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('ext-bundled')
      );
      expect(zipFetchCalls.length).toBeGreaterThanOrEqual(1);

      expect(mockMarkForReinstall).toHaveBeenCalledWith('ext-bundled');
      expect(mockHotReload).toHaveBeenCalled();
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-bundled', 'installing');
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-bundled', 'installed');
    });

    it('should use remote zip when remote succeeds even for bundled extension', async () => {
      const ext = makeExtension('ext-bundled-remote');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-bundled-remote.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      expect(hubIndexManager.getExtension('ext-bundled-remote')!.bundled).toBe(true);

      // Remote succeeds — should use remote, not bundled
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

      await hubInstaller.install('ext-bundled-remote');

      const zipFetchCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('ext-bundled-remote')
      );
      expect(zipFetchCalls.length).toBeGreaterThanOrEqual(1);
      expect(zipFetchCalls[0][0]).toContain('mirror1.test');

      expect(mockSetTransientState).toHaveBeenCalledWith('ext-bundled-remote', 'installed');
    });
  });

  // =========================================================================
  // Install flow: remote download
  // =========================================================================
  describe('Install flow: remote download', () => {
    it('should download from remote when not bundled', async () => {
      const ext = makeExtension('ext-remote');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        // No bundled zip → bundled will be false
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      expect(hubIndexManager.getExtension('ext-remote')!.bundled).toBe(false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

      await hubInstaller.install('ext-remote');

      // Find the call that downloaded the zip (not the index fetch)
      const zipFetchCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('ext-remote')
      );
      expect(zipFetchCalls.length).toBeGreaterThanOrEqual(1);
      expect(zipFetchCalls[0][0]).toContain('mirror1.test');
      expect(zipFetchCalls[0][0]).toContain('extensions/ext-remote.zip');

      expect(mockSetTransientState).toHaveBeenCalledWith('ext-remote', 'installed');
    });

    it('should fall back to second mirror when first fails', async () => {
      const ext = makeExtension('ext-mirror');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);

      mockFetch.mockRejectedValueOnce(new Error('mirror1 down')).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

      await hubInstaller.install('ext-mirror');

      const zipFetchCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('ext-mirror')
      );
      expect(zipFetchCalls).toHaveLength(2);
      expect(zipFetchCalls[1][0]).toContain('mirror2.test');

      expect(mockSetTransientState).toHaveBeenCalledWith('ext-mirror', 'installed');
    });

    it('should fail when all mirrors are down', async () => {
      const ext = makeExtension('ext-fail');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);

      await expect(hubInstaller.install('ext-fail')).rejects.toThrow('Failed to download');

      const failCalls = mockSetTransientState.mock.calls.filter(
        (c) => c[0] === 'ext-fail' && c[1] === 'install_failed'
      );
      expect(failCalls.length).toBe(1);
      expect(failCalls[0][2]).toContain('Failed to download');
    });
  });

  // =========================================================================
  // Integrity verification (sha256 content hash)
  // =========================================================================
  describe('Integrity verification', () => {
    it('should pass when content hash matches', async () => {
      const ext = makeExtension('ext-integrity', {
        dist: {
          tarball: 'extensions/ext-integrity.zip',
          integrity: `sha256-${MOCK_CONTENT_HASH}`,
          unpackedSize: 100,
        },
      });

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-integrity.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await hubInstaller.install('ext-integrity');
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-integrity', 'installed');
    });

    it('should fail when content hash does not match', async () => {
      const ext = makeExtension('ext-tampered', {
        dist: {
          tarball: 'extensions/ext-tampered.zip',
          integrity: 'sha256-0000000000000000000000000000000000000000000000000000000000000000',
          unpackedSize: 100,
        },
      });

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-tampered.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await expect(hubInstaller.install('ext-tampered')).rejects.toThrow('Integrity verification failed');
    });

    it('should skip check for legacy sha512 integrity format', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const ext = makeExtension('ext-legacy', {
        dist: {
          tarball: 'extensions/ext-legacy.zip',
          integrity: 'sha512-legacyhashvalue',
          unpackedSize: 100,
        },
      });

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-legacy.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await hubInstaller.install('ext-legacy');
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-legacy', 'installed');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Legacy sha512'));
      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // Managed directory path format
  // =========================================================================
  describe('Managed directory path: {basePath}/{name}/{version}_{hashPrefix}', () => {
    const hashPrefix = MOCK_CONTENT_HASH.substring(0, 8); // 'a1b2c3d4'

    it('verifyInstallation checks correct managed directory path', async () => {
      const ext = makeExtension('ext-managed');

      const expectedBinaryPath = path.join(
        '/home/user/.aionui-agents',
        'ext-managed',
        `1.0.0_${hashPrefix}`,
        'bin',
        'managed-agent'
      );

      // Simulate loaded extension with acpAdapters including cliCommand
      mockGetLoadedExtensions.mockReturnValue([
        {
          manifest: {
            name: 'ext-managed',
            version: '1.0.0',
            contributes: {
              acpAdapters: [
                {
                  id: 'ext-managed-agent',
                  cliCommand: 'managed-agent',
                },
              ],
            },
          },
          directory: '/ext-install-dir/ext-managed',
        },
      ]);

      // Binary does NOT exist -> verification should fail
      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-managed.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        // Binary not found
        if (s === expectedBinaryPath) return false;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await expect(hubInstaller.install('ext-managed')).rejects.toThrow(
        'Agent binaries not found in managed directory'
      );

      // Now make binary exist
      vi.clearAllMocks();
      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-managed.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        if (s === expectedBinaryPath) return true;
        return false;
      };

      // Need a fresh HubIndexManager + HubInstaller since the previous ones
      // have state (localLoaded=true, remoteLoaded=false)
      vi.resetModules();
      const indexMod2 = await import('@process/extensions/hub/HubIndexManager');
      const installerMod2 = await import('@process/extensions/hub/HubInstaller');

      mockReadFileSync.mockImplementation((p: unknown) => {
        if (String(p).endsWith('index.json')) {
          return JSON.stringify({
            schemaVersion: 1,
            generatedAt: '2026-04-09T00:00:00Z',
            extensions: { 'ext-managed': ext },
          });
        }
        return '{}';
      });

      await indexMod2.hubIndexManager.loadIndexes();
      await installerMod2.hubInstaller.install('ext-managed');
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-managed', 'installed');
    });

    it('should skip verification when extension has no acpAdapters', async () => {
      const ext = makeExtension('ext-no-adapters');

      mockGetLoadedExtensions.mockReturnValue([
        {
          manifest: {
            name: 'ext-no-adapters',
            version: '1.0.0',
            contributes: {},
          },
          directory: '/ext-install-dir/ext-no-adapters',
        },
      ]);

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-no-adapters.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await hubInstaller.install('ext-no-adapters');
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-no-adapters', 'installed');
    });

    it('should skip verification when extension is not yet loaded', async () => {
      const ext = makeExtension('ext-not-loaded');
      mockGetLoadedExtensions.mockReturnValue([]);

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-not-loaded.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await hubInstaller.install('ext-not-loaded');
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-not-loaded', 'installed');
    });
  });

  // =========================================================================
  // retryInstall flow
  // =========================================================================
  describe('retryInstall flow', () => {
    it('should run full install when target directory does not exist', async () => {
      const ext = makeExtension('ext-retry');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-retry.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        // Target dir does not exist
        if (s === path.join('/ext-install-dir', 'ext-retry')) return false;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await hubInstaller.retryInstall('ext-retry');
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-retry', 'installed');
    });

    it('should fail when target dir exists but manifest is missing', async () => {
      existsSyncMatcher = (s) => {
        if (s === path.join('/ext-install-dir', 'ext-broken')) return true;
        return false;
      };

      await expect(hubInstaller.retryInstall('ext-broken')).rejects.toThrow('manifest missing');
    });

    it('should re-run lifecycle via hotReload when target dir and manifest exist', async () => {
      existsSyncMatcher = (s) => {
        if (s === path.join('/ext-install-dir', 'ext-existing')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await hubInstaller.retryInstall('ext-existing');

      expect(mockMarkForReinstall).toHaveBeenCalledWith('ext-existing');
      expect(mockHotReload).toHaveBeenCalled();
      expect(mockSetTransientState).toHaveBeenCalledWith('ext-existing', 'installed');
    });
  });

  // =========================================================================
  // State transitions
  // =========================================================================
  describe('State transitions during install', () => {
    it('should transition: installing -> installed on success', async () => {
      const ext = makeExtension('ext-states');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-states.zip')) return true;
        if (s.includes('aion-extension.json')) return true;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await hubInstaller.install('ext-states');

      const calls = mockSetTransientState.mock.calls.filter((c) => c[0] === 'ext-states');
      expect(calls[0]).toEqual(['ext-states', 'installing']);
      expect(calls[calls.length - 1]).toEqual(['ext-states', 'installed']);
    });

    it('should transition: installing -> install_failed on error', async () => {
      const ext = makeExtension('ext-fail-states');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        // No bundled zip, no remote → will fail
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await expect(hubInstaller.install('ext-fail-states')).rejects.toThrow();

      const calls = mockSetTransientState.mock.calls.filter((c) => c[0] === 'ext-fail-states');
      expect(calls[0]).toEqual(['ext-fail-states', 'installing']);
      expect(calls[calls.length - 1][1]).toBe('install_failed');
      expect(calls[calls.length - 1][2]).toBeDefined();
    });
  });

  // =========================================================================
  // Extension not in index
  // =========================================================================
  describe('Extension not in hub index', () => {
    it('should fail with clear error when extension is unknown', async () => {
      existsSyncMatcher = () => false;
      mockFetch.mockRejectedValue(new Error('no network'));

      await hubIndexManager.loadIndexes();

      await expect(hubInstaller.install('nonexistent-ext')).rejects.toThrow('not found in Hub Index');

      expect(mockSetTransientState).toHaveBeenCalledWith('nonexistent-ext', 'installing');
      const failCalls = mockSetTransientState.mock.calls.filter(
        (c) => c[0] === 'nonexistent-ext' && c[1] === 'install_failed'
      );
      expect(failCalls.length).toBe(1);
    });
  });

  // =========================================================================
  // Security: absolute URL rejection
  // =========================================================================
  describe('Security: absolute URL rejection', () => {
    it('should reject absolute tarball URLs to prevent bypass', async () => {
      const ext = makeExtension('ext-malicious', {
        dist: {
          tarball: 'https://evil.com/malware.zip',
          integrity: `sha256-${MOCK_CONTENT_HASH}`,
          unpackedSize: 100,
        },
      });

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        // Not bundled
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await expect(hubInstaller.install('ext-malicious')).rejects.toThrow('Untrusted absolute tarball URL');
    });
  });

  // =========================================================================
  // Manifest missing after extraction
  // =========================================================================
  describe('Manifest validation after extraction', () => {
    it('should fail when aion-extension.json is missing from extracted package', async () => {
      const ext = makeExtension('ext-bad-pkg');

      existsSyncMatcher = (s) => {
        if (s === '/resources/hub/index.json') return true;
        if (s === path.join('/resources/hub', 'ext-bad-pkg.zip')) return true;
        // Manifest NOT found after extraction
        if (s.includes('aion-extension.json')) return false;
        return false;
      };

      await loadIndexWithExtension(hubIndexManager, ext);
      await expect(hubInstaller.install('ext-bad-pkg')).rejects.toThrow('aion-extension.json missing');
    });
  });
});
