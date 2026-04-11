import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * White-box tests for HubInstallerImpl.verifyIntegrity() (private method).
 * We test via the install() flow, controlling the mock contentHash return
 * and the dist.integrity field to exercise all integrity branches.
 */

// ---------------------------------------------------------------------------
// Mocks — same pattern as hubInstaller.test.ts
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    network: { fetch: (...args: unknown[]) => mockFetch(...args) },
  }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
  };
});

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('util', () => ({ promisify: () => vi.fn(async () => ({ stdout: '', stderr: '' })) }));

vi.mock('@process/utils', () => ({
  getDataPath: () => '/data',
  getAgentInstallBasePath: () => '/agents',
}));

vi.mock('@process/extensions/constants', () => ({
  EXTENSION_MANIFEST_FILE: 'aion-extension.json',
  HUB_REMOTE_URLS: ['https://mirror1.com'],
  getHubResourcesDir: vi.fn(() => '/resources/hub'),
  getInstallTargetDir: vi.fn(() => '/ext-install-dir'),
}));

const mockComputeContentHash = vi.fn(() => 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344');

vi.mock('@process/extensions/lifecycle/contentHash', () => ({
  computeContentHash: (...args: unknown[]) => mockComputeContentHash(...args),
}));

vi.mock('../../src/process/extensions/ExtensionRegistry', () => ({
  ExtensionRegistry: {
    hotReload: vi.fn(async () => {}),
    getInstance: vi.fn(() => ({
      getLoadedExtensions: () => [],
    })),
  },
}));

vi.mock('../../src/process/extensions/hub/HubIndexManager', () => ({
  hubIndexManager: { getExtension: () => mocks.extInfo },
}));

vi.mock('@process/extensions/lifecycle/statePersistence', () => ({
  markExtensionForReinstall: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  extInfo: undefined as unknown,
  stateChanges: [] as unknown[][],
}));

vi.mock('../../src/process/extensions/hub/HubStateManager', () => ({
  hubStateManager: {
    setTransientState: (...args: unknown[]) => {
      mocks.stateChanges.push(args);
    },
  },
}));

vi.mock('@process/agent/acp/AcpDetector', () => ({
  acpDetector: { refreshExtensionAgents: vi.fn(async () => {}) },
}));

import * as fs from 'fs';
import { hubInstaller } from '../../src/process/extensions/hub/HubInstaller';

const mockedExistsSync = vi.mocked(fs.existsSync);

function makeExtInfo(integrity: string) {
  return {
    name: 'integrity-ext',
    displayName: 'Integrity Test',
    description: 'test',
    author: 'test',
    dist: { tarball: 'extensions/integrity-ext.zip', integrity, unpackedSize: 100 },
    engines: { aionui: '>=1.0.0' },
    hubs: ['acpAdapters'],
    bundled: true,
  };
}

describe('HubInstaller.verifyIntegrity (white-box)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mocks.extInfo = undefined;
    mocks.stateChanges = [];
    mockComputeContentHash.mockReturnValue('aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344');
  });

  function setupBundledInstall(integrity: string) {
    mocks.extInfo = makeExtInfo(integrity);
    mockedExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes('integrity-ext.zip') && s.includes('resources')) return true;
      if (s.includes('aion-extension.json')) return true;
      return false;
    });
  }

  // ----------------------------------------------------------------
  // SHA-256 integrity — matching hash
  // ----------------------------------------------------------------
  it('passes when sha256 hash matches computed content hash', async () => {
    setupBundledInstall('sha256-aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344');

    await hubInstaller.install('integrity-ext');
    expect(mocks.stateChanges.at(-1)).toEqual(['integrity-ext', 'installed']);
  });

  // ----------------------------------------------------------------
  // SHA-256 integrity — mismatched hash
  // ----------------------------------------------------------------
  it('fails when sha256 hash does not match computed content hash', async () => {
    setupBundledInstall('sha256-0000000000000000000000000000000000000000000000000000000000000000');

    await expect(hubInstaller.install('integrity-ext')).rejects.toThrow('Integrity verification failed');
    expect(mocks.stateChanges.at(-1)?.[1]).toBe('install_failed');
  });

  // ----------------------------------------------------------------
  // Legacy SHA-512 format — warn and skip
  // ----------------------------------------------------------------
  it('skips verification for legacy sha512 integrity (backward compat)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupBundledInstall('sha512-somelegacyhashvalue');

    await hubInstaller.install('integrity-ext');
    expect(mocks.stateChanges.at(-1)).toEqual(['integrity-ext', 'installed']);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Legacy sha512'));
    consoleWarnSpy.mockRestore();
  });

  // ----------------------------------------------------------------
  // Unknown algorithm format — warn and skip
  // ----------------------------------------------------------------
  it('skips verification for unknown integrity algorithm', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupBundledInstall('md5-abc123');

    await hubInstaller.install('integrity-ext');
    expect(mocks.stateChanges.at(-1)).toEqual(['integrity-ext', 'installed']);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported integrity algorithm'));
    consoleWarnSpy.mockRestore();
  });

  // ----------------------------------------------------------------
  // Empty integrity string
  // ----------------------------------------------------------------
  it('skips verification for empty integrity string', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupBundledInstall('');

    await hubInstaller.install('integrity-ext');
    expect(mocks.stateChanges.at(-1)).toEqual(['integrity-ext', 'installed']);
    consoleWarnSpy.mockRestore();
  });

  // ----------------------------------------------------------------
  // sha256- prefix with empty hash
  // ----------------------------------------------------------------
  it('fails when sha256 prefix has empty hash after prefix', async () => {
    setupBundledInstall('sha256-');

    // computeContentHash returns a non-empty string, so empty !== non-empty
    await expect(hubInstaller.install('integrity-ext')).rejects.toThrow('Integrity verification failed');
  });
});
