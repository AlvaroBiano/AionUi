// tests/unit/process/acp/session/InputPreprocessor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputPreprocessor } from '@process/acp/session/InputPreprocessor';
import * as fs from 'fs';

// Mock fs for workspace search tests
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    statSync: vi.fn(actual.statSync),
    readdirSync: vi.fn(actual.readdirSync),
  };
});

describe('InputPreprocessor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- Basic functionality (no cwd) ---

  it('returns text-only content when no files', () => {
    const pp = new InputPreprocessor(vi.fn());
    const result = pp.process('hello world');
    expect(result).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('appends file items for provided files', () => {
    const readFile = vi.fn((p: string) => `content of ${p}`);
    const pp = new InputPreprocessor(readFile);
    const result = pp.process('check this', ['/foo/bar.ts']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'text', text: 'check this' });
    expect(result[1]).toEqual({ type: 'text', text: '[File: /foo/bar.ts]\ncontent of /foo/bar.ts' });
  });

  it('resolves @file references in text', () => {
    const readFile = vi.fn((p: string) => `content of ${p}`);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
    const pp = new InputPreprocessor(readFile);
    const result = pp.process('review @/src/index.ts');
    expect(result.length).toBeGreaterThan(1);
    expect(result.some((item) => item.type === 'text' && 'text' in item && item.text.startsWith('[File:'))).toBe(true);
  });

  it('handles file read errors gracefully', () => {
    const readFile = vi.fn(() => {
      throw new Error('ENOENT');
    });
    const pp = new InputPreprocessor(readFile);
    const result = pp.process('check this', ['/nonexistent.ts']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });

  it('deduplicates uploaded files from @references', () => {
    const readFile = vi.fn((p: string) => `content of ${p}`);
    const pp = new InputPreprocessor(readFile);
    const result = pp.process('review @/src/index.ts', ['/src/index.ts']);
    // Should only read the file once (from uploaded files), not twice
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2); // text + 1 file
  });

  it('deduplicates by basename when uploaded file path differs', () => {
    const readFile = vi.fn((p: string) => `content of ${p}`);
    const pp = new InputPreprocessor(readFile);
    const result = pp.process('review @index.ts', ['/workspace/src/index.ts']);
    // @index.ts basename matches uploaded /workspace/src/index.ts — skip
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });

  it('resolves quoted @"path with spaces"', () => {
    const readFile = vi.fn((p: string) => `content of ${p}`);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
    const pp = new InputPreprocessor(readFile, '/workspace');
    const result = pp.process('check @"my folder/file name.ts"');
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ type: 'text' });
  });

  it('deduplicates duplicate uploaded files', () => {
    const readFile = vi.fn((p: string) => `content of ${p}`);
    const pp = new InputPreprocessor(readFile);
    const result = pp.process('check', ['/a.ts', '/a.ts', '/b.ts']);
    expect(readFile).toHaveBeenCalledTimes(2); // /a.ts once + /b.ts once
    expect(result).toHaveLength(3); // text + 2 files
  });

  // --- Workspace resolution ---

  it('resolves @file relative to cwd', () => {
    const readFile = vi.fn(() => 'file content');
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);

    const pp = new InputPreprocessor(readFile, '/workspace');
    const result = pp.process('review @src/utils.ts');

    expect(result).toHaveLength(2);
    // Should resolve to /workspace/src/utils.ts
    expect(readFile).toHaveBeenCalledWith('/workspace/src/utils.ts');
  });

  it('falls back to workspace search when direct path fails', () => {
    const readFile = vi.fn(() => 'found it');

    // Direct path fails
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    // Workspace search finds it
    vi.mocked(fs.readdirSync).mockImplementation((dir: fs.PathLike) => {
      const d = String(dir);
      if (d === '/workspace') {
        return [
          { name: 'src', isFile: () => false, isDirectory: () => true },
          { name: 'node_modules', isFile: () => false, isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      if (d === '/workspace/src') {
        return [{ name: 'utils.ts', isFile: () => true, isDirectory: () => false }] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });

    const pp = new InputPreprocessor(readFile, '/workspace');
    const result = pp.process('review @utils.ts');

    expect(result).toHaveLength(2);
    expect(readFile).toHaveBeenCalledWith('/workspace/src/utils.ts');
  });

  it('skips hidden directories and node_modules during search', () => {
    const readFile = vi.fn(() => 'found it');
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const readdirCalls: string[] = [];
    vi.mocked(fs.readdirSync).mockImplementation((dir: fs.PathLike) => {
      const d = String(dir);
      readdirCalls.push(d);
      if (d === '/workspace') {
        return [
          { name: '.git', isFile: () => false, isDirectory: () => true },
          { name: 'node_modules', isFile: () => false, isDirectory: () => true },
          { name: 'src', isFile: () => false, isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      if (d === '/workspace/src') {
        return [{ name: 'target.ts', isFile: () => true, isDirectory: () => false }] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });

    const pp = new InputPreprocessor(readFile, '/workspace');
    pp.process('review @target.ts');

    // Should NOT recurse into .git or node_modules
    expect(readdirCalls).not.toContain('/workspace/.git');
    expect(readdirCalls).not.toContain('/workspace/node_modules');
    expect(readdirCalls).toContain('/workspace/src');
  });

  it('respects max search depth of 3', () => {
    const readFile = vi.fn(() => 'found it');
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const readdirCalls: string[] = [];
    vi.mocked(fs.readdirSync).mockImplementation((dir: fs.PathLike) => {
      const d = String(dir);
      readdirCalls.push(d);
      // Create a deep chain: workspace/a/b/c/d/target.ts
      // Only workspace/a/b/c should be searched (depth 3), not workspace/a/b/c/d (depth 4)
      return [
        { name: d.endsWith('/c') ? 'd' : 'a', isFile: () => false, isDirectory: () => true },
      ] as unknown as fs.Dirent[];
    });

    const pp = new InputPreprocessor(readFile, '/workspace');
    pp.process('review @nope.ts');

    // depth 0=/workspace, 1=/workspace/a, 2=/workspace/a/a, 3=/workspace/a/a/a — stops here
    expect(readdirCalls.length).toBeLessThanOrEqual(5); // root + 3 levels + 1 attempt
  });

  it('logs warning for unreadable files', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readFile = vi.fn(() => {
      throw new Error('binary');
    });
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);

    const pp = new InputPreprocessor(readFile, '/workspace');
    pp.process('review @binary.png');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping unreadable file'));
    warnSpy.mockRestore();
  });
});
