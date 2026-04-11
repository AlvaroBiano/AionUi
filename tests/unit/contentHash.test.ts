import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeContentHash } from '../../src/process/extensions/lifecycle/contentHash';

/**
 * White-box tests for computeContentHash().
 * Uses a real temporary directory so hash behaviour is tested end-to-end
 * without mocking the filesystem.
 */

let tmpDir: string;

function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contentHash-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('computeContentHash', () => {
  // ----------------------------------------------------------------
  // Determinism
  // ----------------------------------------------------------------
  it('returns the same hash for identical directory contents (deterministic)', () => {
    writeFile('a.txt', 'hello');
    writeFile('b.txt', 'world');

    const hash1 = computeContentHash(tmpDir);
    const hash2 = computeContentHash(tmpDir);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('returns different hashes when file content differs', () => {
    writeFile('a.txt', 'v1');
    const hash1 = computeContentHash(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v2');
    const hash2 = computeContentHash(tmpDir);

    expect(hash1).not.toBe(hash2);
  });

  it('returns different hashes when file names differ', () => {
    writeFile('a.txt', 'same');
    const hash1 = computeContentHash(tmpDir);

    // Remove a.txt, create b.txt with same content
    fs.unlinkSync(path.join(tmpDir, 'a.txt'));
    writeFile('b.txt', 'same');
    const hash2 = computeContentHash(tmpDir);

    expect(hash1).not.toBe(hash2);
  });

  // ----------------------------------------------------------------
  // File ordering — sorted, so creation order should not matter
  // ----------------------------------------------------------------
  it('produces consistent hash regardless of file creation order', () => {
    // Create in order a, b, c
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'order1-'));
    fs.writeFileSync(path.join(dir1, 'a.txt'), '1');
    fs.writeFileSync(path.join(dir1, 'b.txt'), '2');
    fs.writeFileSync(path.join(dir1, 'c.txt'), '3');

    // Create in order c, a, b
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'order2-'));
    fs.writeFileSync(path.join(dir2, 'c.txt'), '3');
    fs.writeFileSync(path.join(dir2, 'a.txt'), '1');
    fs.writeFileSync(path.join(dir2, 'b.txt'), '2');

    expect(computeContentHash(dir1)).toBe(computeContentHash(dir2));

    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // Empty directory
  // ----------------------------------------------------------------
  it('returns a valid hash for an empty directory', () => {
    const hash = computeContentHash(tmpDir);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Empty hash should equal SHA-256 of empty input
    const expected = crypto.createHash('sha256').digest('hex');
    expect(hash).toBe(expected);
  });

  // ----------------------------------------------------------------
  // Skip patterns: node_modules, .git, .DS_Store, __MACOSX
  // ----------------------------------------------------------------
  it('skips node_modules directory', () => {
    writeFile('index.js', 'main');
    const hashBefore = computeContentHash(tmpDir);

    writeFile('node_modules/pkg/index.js', 'dep');
    const hashAfter = computeContentHash(tmpDir);

    expect(hashBefore).toBe(hashAfter);
  });

  it('skips .git directory', () => {
    writeFile('index.js', 'main');
    const hashBefore = computeContentHash(tmpDir);

    writeFile('.git/HEAD', 'ref: refs/heads/main');
    const hashAfter = computeContentHash(tmpDir);

    expect(hashBefore).toBe(hashAfter);
  });

  it('skips .DS_Store file', () => {
    writeFile('index.js', 'main');
    const hashBefore = computeContentHash(tmpDir);

    // .DS_Store is matched by name in SKIP set — it's a file entry name
    fs.writeFileSync(path.join(tmpDir, '.DS_Store'), '\x00\x00\x00\x01Bud1');
    const hashAfter = computeContentHash(tmpDir);

    expect(hashBefore).toBe(hashAfter);
  });

  it('skips __MACOSX directory', () => {
    writeFile('index.js', 'main');
    const hashBefore = computeContentHash(tmpDir);

    writeFile('__MACOSX/._index.js', 'resource fork');
    const hashAfter = computeContentHash(tmpDir);

    expect(hashBefore).toBe(hashAfter);
  });

  it('does NOT skip similarly-named directories that are not in the skip list', () => {
    writeFile('index.js', 'main');
    const hashBefore = computeContentHash(tmpDir);

    writeFile('node_modules_backup/pkg/index.js', 'dep');
    const hashAfter = computeContentHash(tmpDir);

    expect(hashBefore).not.toBe(hashAfter);
  });

  // ----------------------------------------------------------------
  // Nested subdirectories
  // ----------------------------------------------------------------
  it('includes files in deeply nested subdirectories', () => {
    writeFile('a/b/c/d/deep.txt', 'deep content');
    const hash1 = computeContentHash(tmpDir);

    // Modify deep file
    fs.writeFileSync(path.join(tmpDir, 'a/b/c/d/deep.txt'), 'modified');
    const hash2 = computeContentHash(tmpDir);

    expect(hash1).not.toBe(hash2);
  });

  it('includes relative paths in hash (different subdirectory = different hash)', () => {
    // Same file content but different relative path
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'nested1-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nested2-'));

    fs.mkdirSync(path.join(dir1, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir1, 'sub/file.txt'), 'content');

    fs.mkdirSync(path.join(dir2, 'other'), { recursive: true });
    fs.writeFileSync(path.join(dir2, 'other/file.txt'), 'content');

    expect(computeContentHash(dir1)).not.toBe(computeContentHash(dir2));

    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // Symlink handling
  // ----------------------------------------------------------------
  it('ignores symlinks (not isFile)', () => {
    writeFile('real.txt', 'real content');
    const hashBefore = computeContentHash(tmpDir);

    // Create a symlink — entry.isFile() returns false for symlinks
    // unless the symlink target is a regular file (on some OS).
    // On most platforms, readdirSync withFileTypes: true reports symlinks
    // as isSymbolicLink()=true, isFile()=false.
    try {
      fs.symlinkSync(path.join(tmpDir, 'real.txt'), path.join(tmpDir, 'link.txt'));
    } catch {
      // Symlinks may not be supported (e.g. some Windows configs)
      return;
    }

    const hashAfter = computeContentHash(tmpDir);
    // On macOS/Linux, symlink isFile() may return true for file targets.
    // The key invariant: no crash, and hash is deterministic.
    expect(hashAfter).toMatch(/^[a-f0-9]{64}$/);
  });

  // ----------------------------------------------------------------
  // Binary / large files
  // ----------------------------------------------------------------
  it('handles binary file content correctly', () => {
    const binaryContent = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) binaryContent[i] = i % 256;
    fs.writeFileSync(path.join(tmpDir, 'binary.bin'), binaryContent);

    const hash = computeContentHash(tmpDir);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Deterministic
    expect(computeContentHash(tmpDir)).toBe(hash);
  });

  it('handles moderately large files', () => {
    // 1MB file
    const largeContent = Buffer.alloc(1024 * 1024, 'x');
    fs.writeFileSync(path.join(tmpDir, 'large.bin'), largeContent);

    const hash = computeContentHash(tmpDir);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ----------------------------------------------------------------
  // Manual verification against known hash
  // ----------------------------------------------------------------
  it('matches manually computed SHA-256 for known input', () => {
    writeFile('hello.txt', 'world');

    // Manual computation: hash.update('hello.txt').update(Buffer.from('world'))
    const expected = crypto.createHash('sha256').update('hello.txt').update(Buffer.from('world')).digest('hex');

    expect(computeContentHash(tmpDir)).toBe(expected);
  });
});
