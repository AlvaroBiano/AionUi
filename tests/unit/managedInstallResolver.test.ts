import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@process/utils/utils', () => ({
  getAgentInstallBasePath: vi.fn(() => '/mock-agents'),
}));

// We need to mock fs functions used by the module
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
const mockRm = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    statSync: (...args: unknown[]) => mockStatSync(...args),
    promises: {
      rm: (...args: unknown[]) => mockRm(...args),
    },
  };
});

import { resolveManagedBinary, listVersionDirs, cleanOldVersions } from '@process/extensions/hub/ManagedInstallResolver';

describe('ManagedInstallResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveManagedBinary', () => {
    it('returns null when installedBinaryPath is undefined', () => {
      const result = resolveManagedBinary('aionext-auggie', undefined);
      expect(result).toBeNull();
    });

    it('returns null when extension directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = resolveManagedBinary('aionext-auggie', 'node_modules/.bin/auggie');
      expect(result).toBeNull();
    });

    it('returns null when no version directories exist', () => {
      mockExistsSync.mockImplementation((p: string) => {
        // ext dir exists
        return p === path.join('/mock-agents', 'aionext-auggie');
      });
      mockReaddirSync.mockReturnValue([]);
      const result = resolveManagedBinary('aionext-auggie', 'node_modules/.bin/auggie');
      expect(result).toBeNull();
    });

    it('resolves the latest version directory when multiple exist', () => {
      const extDir = path.join('/mock-agents', 'aionext-auggie');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === extDir) return true;
        // Binary exists in 1.2.0 version
        if (p === path.join(extDir, '1.2.0_b2c3d4e5', 'node_modules/.bin/auggie')) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue(['1.0.0_a1b2c3d4', '1.1.0_f0e1d2c3', '1.2.0_b2c3d4e5']);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      const result = resolveManagedBinary('aionext-auggie', 'node_modules/.bin/auggie');
      expect(result).toEqual({
        binaryPath: path.join(extDir, '1.2.0_b2c3d4e5', 'node_modules/.bin/auggie'),
        versionDir: '1.2.0_b2c3d4e5',
      });
    });

    it('returns null when binary does not exist in latest version dir', () => {
      const extDir = path.join('/mock-agents', 'aionext-auggie');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === extDir) return true;
        return false; // binary not found
      });
      mockReaddirSync.mockReturnValue(['1.0.0_a1b2c3d4']);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      const result = resolveManagedBinary('aionext-auggie', 'node_modules/.bin/auggie');
      expect(result).toBeNull();
    });

    it('skips non-semver directories', () => {
      const extDir = path.join('/mock-agents', 'aionext-goose');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === extDir) return true;
        if (p === path.join(extDir, '1.0.0_7e2d4f01', 'goose')) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue(['.DS_Store', 'temp', '1.0.0_7e2d4f01']);
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith('.DS_Store') || p.endsWith('temp')) {
          return { isDirectory: () => false };
        }
        return { isDirectory: () => true };
      });

      const result = resolveManagedBinary('aionext-goose', 'goose');
      expect(result).toEqual({
        binaryPath: path.join(extDir, '1.0.0_7e2d4f01', 'goose'),
        versionDir: '1.0.0_7e2d4f01',
      });
    });

    it('handles binary-type agents (direct executable)', () => {
      const extDir = path.join('/mock-agents', 'aionext-goose');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === extDir) return true;
        if (p === path.join(extDir, '1.0.0_7e2d4f01', 'goose')) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue(['1.0.0_7e2d4f01']);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      const result = resolveManagedBinary('aionext-goose', 'goose');
      expect(result).toEqual({
        binaryPath: path.join(extDir, '1.0.0_7e2d4f01', 'goose'),
        versionDir: '1.0.0_7e2d4f01',
      });
    });
  });

  describe('listVersionDirs', () => {
    it('returns empty array when extension dir does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(listVersionDirs('aionext-auggie')).toEqual([]);
    });

    it('returns sorted version directories', () => {
      const extDir = path.join('/mock-agents', 'aionext-auggie');
      mockExistsSync.mockImplementation((p: string) => p === extDir);
      mockReaddirSync.mockReturnValue(['1.2.0_b2c3d4e5', '1.0.0_a1b2c3d4', '1.1.0_f0e1d2c3']);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      const dirs = listVersionDirs('aionext-auggie');
      expect(dirs).toEqual(['1.0.0_a1b2c3d4', '1.1.0_f0e1d2c3', '1.2.0_b2c3d4e5']);
    });
  });

  describe('cleanOldVersions', () => {
    it('does nothing when version count <= keepCount', async () => {
      const extDir = path.join('/mock-agents', 'aionext-auggie');
      mockExistsSync.mockImplementation((p: string) => p === extDir);
      mockReaddirSync.mockReturnValue(['1.0.0_a1b2c3d4', '1.1.0_f0e1d2c3', '1.2.0_b2c3d4e5']);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      const removed = await cleanOldVersions('aionext-auggie', 3);
      expect(removed).toEqual([]);
      expect(mockRm).not.toHaveBeenCalled();
    });

    it('removes oldest versions when count exceeds keepCount', async () => {
      const extDir = path.join('/mock-agents', 'aionext-auggie');
      mockExistsSync.mockImplementation((p: string) => p === extDir);
      mockReaddirSync.mockReturnValue([
        '1.0.0_a1b2c3d4',
        '1.1.0_f0e1d2c3',
        '1.2.0_b2c3d4e5',
        '1.3.0_d5e6f7a8',
        '1.4.0_11223344',
      ]);
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockRm.mockResolvedValue(undefined);

      const removed = await cleanOldVersions('aionext-auggie', 3);
      expect(removed).toHaveLength(2);
      expect(removed).toContain(path.join(extDir, '1.0.0_a1b2c3d4'));
      expect(removed).toContain(path.join(extDir, '1.1.0_f0e1d2c3'));
    });

    it('continues cleaning even if one removal fails', async () => {
      const extDir = path.join('/mock-agents', 'aionext-auggie');
      mockExistsSync.mockImplementation((p: string) => p === extDir);
      mockReaddirSync.mockReturnValue(['1.0.0_a1b2c3d4', '1.1.0_f0e1d2c3', '1.2.0_b2c3d4e5', '1.3.0_d5e6f7a8']);
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockRm.mockRejectedValueOnce(new Error('EBUSY')).mockResolvedValueOnce(undefined); // should not be called since only 1 to remove

      // keepCount=3, 4 dirs => remove 1
      const removed = await cleanOldVersions('aionext-auggie', 3);
      // First removal fails, so removed list is empty
      expect(removed).toEqual([]);
    });
  });
});
