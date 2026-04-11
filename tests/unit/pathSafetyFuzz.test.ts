import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isPathWithinDirectory } from '../../src/process/extensions/sandbox/pathSafety';

/**
 * Fuzz / boundary tests for isPathWithinDirectory().
 * This is the core path safety guard used by lifecycle hooks and other
 * extension system components.
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathsafety-test-'));
  // Create subdirectories for testing
  fs.mkdirSync(path.join(tmpDir, 'ext'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'ext/scripts'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'ext/scripts/install.js'), '// hook');
  fs.writeFileSync(path.join(tmpDir, 'secret.txt'), 'secret');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isPathWithinDirectory — valid paths', () => {
  it('accepts file directly inside base directory', () => {
    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'ext/scripts/install.js');
    expect(isPathWithinDirectory(target, base)).toBe(true);
  });

  it('accepts base directory itself', () => {
    const base = path.join(tmpDir, 'ext');
    expect(isPathWithinDirectory(base, base)).toBe(true);
  });

  it('accepts nested subdirectory', () => {
    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'ext/scripts');
    expect(isPathWithinDirectory(target, base)).toBe(true);
  });
});

describe('isPathWithinDirectory — path traversal attacks', () => {
  it('rejects "../" traversal to parent', () => {
    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'ext/../secret.txt');
    expect(isPathWithinDirectory(target, base)).toBe(false);
  });

  it('rejects deep "../../../" traversal', () => {
    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'ext/scripts/../../../etc/passwd');
    expect(isPathWithinDirectory(target, base)).toBe(false);
  });

  it('rejects traversal via absolute path outside base', () => {
    const base = path.join(tmpDir, 'ext');
    expect(isPathWithinDirectory('/etc/passwd', base)).toBe(false);
  });

  it('rejects traversal via /tmp path outside base', () => {
    const base = path.join(tmpDir, 'ext');
    expect(isPathWithinDirectory('/tmp/evil', base)).toBe(false);
  });
});

describe('isPathWithinDirectory — prefix attack prevention', () => {
  it('rejects path that shares prefix but is a different directory', () => {
    // base = /tmp/xxx/ext, target = /tmp/xxx/ext-evil/payload
    fs.mkdirSync(path.join(tmpDir, 'ext-evil'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'ext-evil/payload'), 'evil');

    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'ext-evil/payload');
    expect(isPathWithinDirectory(target, base)).toBe(false);
  });

  it('rejects path that shares prefix with longer name', () => {
    fs.mkdirSync(path.join(tmpDir, 'extension'), { recursive: true });
    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'extension/file');
    expect(isPathWithinDirectory(target, base)).toBe(false);
  });
});

describe('isPathWithinDirectory — edge cases', () => {
  it('handles trailing slash in base directory', () => {
    const base = path.join(tmpDir, 'ext') + '/';
    const target = path.join(tmpDir, 'ext/scripts/install.js');
    expect(isPathWithinDirectory(target, base)).toBe(true);
  });

  it('handles non-existent target path', () => {
    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'ext/nonexistent/file.js');
    expect(isPathWithinDirectory(target, base)).toBe(true);
  });

  it('handles path with double slashes', () => {
    const base = path.join(tmpDir, 'ext');
    const target = path.join(tmpDir, 'ext//scripts//install.js');
    expect(isPathWithinDirectory(target, base)).toBe(true);
  });
});

describe('isPathWithinDirectory — Unicode and special characters', () => {
  it('handles Unicode directory names', () => {
    const unicodeDir = path.join(tmpDir, 'ext/中文目录');
    fs.mkdirSync(unicodeDir, { recursive: true });
    fs.writeFileSync(path.join(unicodeDir, 'file.txt'), 'content');

    const base = path.join(tmpDir, 'ext');
    expect(isPathWithinDirectory(path.join(unicodeDir, 'file.txt'), base)).toBe(true);
  });

  it('handles directory names with spaces', () => {
    const spaceDir = path.join(tmpDir, 'ext/my scripts');
    fs.mkdirSync(spaceDir, { recursive: true });

    const base = path.join(tmpDir, 'ext');
    expect(isPathWithinDirectory(path.join(spaceDir, 'run.js'), base)).toBe(true);
  });
});
