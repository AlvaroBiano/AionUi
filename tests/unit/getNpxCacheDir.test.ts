/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for getNpxCacheDir() in src/process/utils/shellEnv.ts
 *
 * Verifies cross-platform npx cache directory resolution:
 * - Windows: %LOCALAPPDATA%\npm-cache\_npx
 * - POSIX:   prefers ~/.npm-cache/_npx and falls back to ~/.npm/_npx
 * - Explicit npm_config_cache: <cacheDir>/_npx
 *
 * Uses process.env.HOME to control os.homedir() on POSIX (no module mock needed),
 * and process.platform mocking for Windows branch coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

describe('getNpxCacheDir', () => {
  const originalPlatform = process.platform;
  const originalHome = process.env.HOME;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalNpmConfigCache = process.env.npm_config_cache;
  const originalNpmConfigCacheUpper = process.env.NPM_CONFIG_CACHE;

  const restoreEnv = (
    key: 'HOME' | 'LOCALAPPDATA' | 'npm_config_cache' | 'NPM_CONFIG_CACHE',
    value: string | undefined,
  ) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    restoreEnv('HOME', originalHome);
    restoreEnv('LOCALAPPDATA', originalLocalAppData);
    restoreEnv('npm_config_cache', originalNpmConfigCache);
    restoreEnv('NPM_CONFIG_CACHE', originalNpmConfigCacheUpper);
    vi.doUnmock('child_process');
  });

  it('uses npm_config_cache when explicitly configured', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    process.env.npm_config_cache = path.join('/tmp', 'custom-npm-cache');

    vi.doMock('child_process', () => ({
      execFileSync: vi.fn().mockImplementation(() => {
        throw new Error('skip shell');
      }),
      execFile: vi.fn(),
    }));

    const { getNpxCacheDir } = await import('@process/utils/shellEnv');

    const result = getNpxCacheDir();
    expect(result).toBe(path.join('/tmp', 'custom-npm-cache', '_npx'));
  });

  it('returns ~/.npm-cache/_npx on POSIX when the newer cache dir exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const tempHome = mkdtempSync(path.join(os.tmpdir(), 'aionui-home-'));
    mkdirSync(path.join(tempHome, '.npm-cache'), { recursive: true });

    try {
      // Set HOME so os.homedir() returns tempHome — no module mocking needed
      process.env.HOME = tempHome;
      delete process.env.npm_config_cache;
      delete process.env.NPM_CONFIG_CACHE;

      vi.doMock('child_process', () => ({
        execFileSync: vi.fn().mockImplementation(() => {
          throw new Error('skip shell');
        }),
        execFile: vi.fn(),
      }));

      const { getNpxCacheDir } = await import('@process/utils/shellEnv');

      const result = getNpxCacheDir();
      expect(result).toBe(path.join(tempHome, '.npm-cache', '_npx'));
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('falls back to ~/.npm/_npx on POSIX when only the legacy .npm cache exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const tempHome = mkdtempSync(path.join(os.tmpdir(), 'aionui-home-'));
    mkdirSync(path.join(tempHome, '.npm'), { recursive: true });

    try {
      // Set HOME so os.homedir() returns tempHome — no module mocking needed
      process.env.HOME = tempHome;
      delete process.env.npm_config_cache;
      delete process.env.NPM_CONFIG_CACHE;

      vi.doMock('child_process', () => ({
        execFileSync: vi.fn().mockImplementation(() => {
          throw new Error('skip shell');
        }),
        execFile: vi.fn(),
      }));

      const { getNpxCacheDir } = await import('@process/utils/shellEnv');

      const result = getNpxCacheDir();
      expect(result).toBe(path.join(tempHome, '.npm', '_npx'));
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('uses LOCALAPPDATA on Windows when set', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    delete process.env.npm_config_cache;
    delete process.env.NPM_CONFIG_CACHE;

    vi.doMock('child_process', () => ({
      execFileSync: vi.fn().mockImplementation(() => {
        throw new Error('skip shell');
      }),
      execFile: vi.fn(),
    }));

    const { getNpxCacheDir } = await import('@process/utils/shellEnv');

    const result = getNpxCacheDir();
    expect(result).toBe(path.join('C:\\Users\\test\\AppData\\Local', 'npm-cache', '_npx'));
  });

  it('falls back to homedir AppData\\Local on Windows when LOCALAPPDATA is unset', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    delete process.env.LOCALAPPDATA;
    delete process.env.npm_config_cache;
    delete process.env.NPM_CONFIG_CACHE;
    // Set HOME so os.homedir() is predictable on this POSIX host
    const tempHome = mkdtempSync(path.join(os.tmpdir(), 'aionui-home-'));

    try {
      process.env.HOME = tempHome;

      vi.doMock('child_process', () => ({
        execFileSync: vi.fn().mockImplementation(() => {
          throw new Error('skip shell');
        }),
        execFile: vi.fn(),
      }));

      const { getNpxCacheDir } = await import('@process/utils/shellEnv');

      const result = getNpxCacheDir();
      expect(result).toBe(path.join(tempHome, 'AppData', 'Local', 'npm-cache', '_npx'));
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
