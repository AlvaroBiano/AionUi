/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import {
  findNodeByKey,
  getFirstLevelKeys,
  replacePathInList,
  updateChildrenPaths,
  updateTreeForRename,
  flattenSingleRoot,
  getTargetFolderPath,
  getPathSeparator,
} from '@/renderer/pages/conversation/Workspace/utils/treeHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function file(name: string, fullPath: string, relativePath?: string): IDirOrFile {
  return {
    name,
    fullPath,
    relativePath: relativePath ?? name,
    isDir: false,
    isFile: true,
  };
}

function dir(name: string, fullPath: string, children: IDirOrFile[] = [], relativePath?: string): IDirOrFile {
  return {
    name,
    fullPath,
    relativePath: relativePath ?? name,
    isDir: true,
    isFile: false,
    children,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getPathSeparator
// ─────────────────────────────────────────────────────────────────────────────
describe('getPathSeparator', () => {
  it('returns backslash for Windows-style paths', () => {
    expect(getPathSeparator('C:\\Users\\project')).toBe('\\');
  });

  it('returns forward slash for Unix-style paths', () => {
    expect(getPathSeparator('/home/user/project')).toBe('/');
  });

  it('returns forward slash for relative Unix paths', () => {
    expect(getPathSeparator('src/components')).toBe('/');
  });

  it('returns forward slash for empty string', () => {
    expect(getPathSeparator('')).toBe('/');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findNodeByKey
// ─────────────────────────────────────────────────────────────────────────────
describe('findNodeByKey', () => {
  const tree: IDirOrFile[] = [
    dir('src', '/src', [
      file('index.ts', '/src/index.ts', 'src/index.ts'),
      dir('utils', '/src/utils', [file('helper.ts', '/src/utils/helper.ts', 'src/utils/helper.ts')], 'src/utils'),
    ]),
    file('README.md', '/README.md', 'README.md'),
  ];

  it('finds a top-level file node', () => {
    const result = findNodeByKey(tree, 'README.md');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('README.md');
  });

  it('finds a nested file node by relativePath', () => {
    const result = findNodeByKey(tree, 'src/utils/helper.ts');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('helper.ts');
  });

  it('finds a directory node', () => {
    const result = findNodeByKey(tree, 'src/utils');
    expect(result).not.toBeNull();
    expect(result?.isDir).toBe(true);
  });

  it('returns null for a non-existent key', () => {
    const result = findNodeByKey(tree, 'non/existent.ts');
    expect(result).toBeNull();
  });

  it('returns null for an empty tree', () => {
    const result = findNodeByKey([], 'any.ts');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getFirstLevelKeys
// ─────────────────────────────────────────────────────────────────────────────
describe('getFirstLevelKeys', () => {
  it('returns [""] when first node has empty relativePath (root node)', () => {
    const nodes: IDirOrFile[] = [dir('root', '/root', [], '')];
    expect(getFirstLevelKeys(nodes)).toEqual(['']);
  });

  it('returns [] when first node has non-empty relativePath', () => {
    const nodes: IDirOrFile[] = [dir('src', '/src', [], 'src')];
    expect(getFirstLevelKeys(nodes)).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(getFirstLevelKeys([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replacePathInList
// ─────────────────────────────────────────────────────────────────────────────
describe('replacePathInList', () => {
  it('replaces an exact match', () => {
    const result = replacePathInList(['src/foo', 'src/bar'], 'src/foo', 'src/baz');
    expect(result).toEqual(['src/baz', 'src/bar']);
  });

  it('replaces path and updates children with the prefix', () => {
    const result = replacePathInList(['src/foo', 'src/foo/index.ts', 'src/bar'], 'src/foo', 'src/renamed');
    expect(result).toEqual(['src/renamed', 'src/renamed/index.ts', 'src/bar']);
  });

  it('does not replace partial prefix matches (path segment boundary)', () => {
    // 'src/foobar' should NOT be replaced when renaming 'src/foo'
    const result = replacePathInList(['src/foobar'], 'src/foo', 'src/renamed');
    expect(result).toEqual(['src/foobar']);
  });

  it('returns same array when oldPath is not in list', () => {
    const result = replacePathInList(['src/a', 'src/b'], 'src/c', 'src/d');
    expect(result).toEqual(['src/a', 'src/b']);
  });

  it('returns empty array when input is empty', () => {
    expect(replacePathInList([], 'old', 'new')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateChildrenPaths
// ─────────────────────────────────────────────────────────────────────────────
describe('updateChildrenPaths', () => {
  it('returns undefined when children is undefined', () => {
    expect(updateChildrenPaths(undefined, '/old/', '/new/', 'old/', 'new/')).toBeUndefined();
  });

  it('updates fullPath and relativePath for matching children', () => {
    const children: IDirOrFile[] = [file('a.ts', '/old/a.ts', 'old/a.ts')];
    const result = updateChildrenPaths(children, '/old/', '/new/', 'old/', 'new/');
    expect(result).toHaveLength(1);
    expect(result![0].fullPath).toBe('/new/a.ts');
    expect(result![0].relativePath).toBe('new/a.ts');
  });

  it('recursively updates nested children', () => {
    const children: IDirOrFile[] = [dir('sub', '/old/sub', [file('b.ts', '/old/sub/b.ts', 'old/sub/b.ts')], 'old/sub')];
    const result = updateChildrenPaths(children, '/old/', '/new/', 'old/', 'new/');
    expect(result![0].fullPath).toBe('/new/sub');
    expect(result![0].relativePath).toBe('new/sub');
    expect(result![0].children![0].fullPath).toBe('/new/sub/b.ts');
    expect(result![0].children![0].relativePath).toBe('new/sub/b.ts');
  });

  it('leaves non-matching paths unchanged', () => {
    const children: IDirOrFile[] = [file('c.ts', '/other/c.ts', 'other/c.ts')];
    const result = updateChildrenPaths(children, '/old/', '/new/', 'old/', 'new/');
    expect(result![0].fullPath).toBe('/other/c.ts');
    expect(result![0].relativePath).toBe('other/c.ts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateTreeForRename
// ─────────────────────────────────────────────────────────────────────────────
describe('updateTreeForRename', () => {
  it('renames a top-level file node', () => {
    const tree: IDirOrFile[] = [file('old.ts', '/src/old.ts', 'old.ts')];
    const result = updateTreeForRename(tree, 'old.ts', 'new.ts', '/src/new.ts');

    expect(result[0].name).toBe('new.ts');
    expect(result[0].fullPath).toBe('/src/new.ts');
    expect(result[0].relativePath).toBe('new.ts');
  });

  it('renames a nested directory node and updates all children paths', () => {
    const tree: IDirOrFile[] = [
      dir(
        'src',
        '/src',
        [dir('old', '/src/old', [file('index.ts', '/src/old/index.ts', 'src/old/index.ts')], 'src/old')],
        'src'
      ),
    ];

    const result = updateTreeForRename(tree, 'src/old', 'renamed', '/src/renamed');

    const srcDir = result[0];
    const renamedDir = srcDir.children![0];
    expect(renamedDir.name).toBe('renamed');
    expect(renamedDir.fullPath).toBe('/src/renamed');
    expect(renamedDir.relativePath).toBe('src/renamed');

    // Children should also be updated
    const indexFile = renamedDir.children![0];
    expect(indexFile.fullPath).toBe('/src/renamed/index.ts');
    expect(indexFile.relativePath).toBe('src/renamed/index.ts');
  });

  it('returns original tree when key does not exist', () => {
    const tree: IDirOrFile[] = [file('a.ts', '/a.ts', 'a.ts')];
    const result = updateTreeForRename(tree, 'b.ts', 'c.ts', '/c.ts');
    expect(result).toEqual(tree);
  });

  it('handles empty tree gracefully', () => {
    expect(updateTreeForRename([], 'key', 'new', '/new')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// flattenSingleRoot
// ─────────────────────────────────────────────────────────────────────────────
describe('flattenSingleRoot', () => {
  it('returns children when there is exactly one root directory with children', () => {
    const children = [file('a.ts', '/root/a.ts'), file('b.ts', '/root/b.ts')];
    const tree: IDirOrFile[] = [dir('root', '/root', children)];

    const result = flattenSingleRoot(tree);
    expect(result).toEqual(children);
  });

  it('returns original array when there are multiple root nodes', () => {
    const tree: IDirOrFile[] = [dir('a', '/a', [file('x.ts', '/a/x.ts')]), dir('b', '/b', [file('y.ts', '/b/y.ts')])];
    const result = flattenSingleRoot(tree);
    expect(result).toEqual(tree);
  });

  it('returns original array when the single root has no children', () => {
    const tree: IDirOrFile[] = [dir('empty', '/empty')];
    const result = flattenSingleRoot(tree);
    expect(result).toEqual(tree);
  });

  it('returns empty array for empty input', () => {
    expect(flattenSingleRoot([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTargetFolderPath
// ─────────────────────────────────────────────────────────────────────────────
describe('getTargetFolderPath', () => {
  const files: IDirOrFile[] = [
    dir('src', '/workspace/src', [dir('utils', '/workspace/src/utils', [], 'src/utils')], 'src'),
    file('README.md', '/workspace/README.md', 'README.md'),
  ];

  it('returns selectedNodeRef when it is provided', () => {
    const ref = { relativePath: 'src', fullPath: '/workspace/src' };
    const result = getTargetFolderPath(ref, [], files, '/workspace');

    expect(result.fullPath).toBe('/workspace/src');
    expect(result.relativePath).toBe('src');
  });

  it('falls back to deepest directory from selected keys when no ref', () => {
    const result = getTargetFolderPath(null, ['src', 'src/utils'], files, '/workspace');

    // 'src/utils' is deeper than 'src'
    expect(result.fullPath).toBe('/workspace/src/utils');
    expect(result.relativePath).toBe('src/utils');
  });

  it('skips file nodes when finding folder from selected keys', () => {
    const result = getTargetFolderPath(null, ['README.md'], files, '/workspace');

    // README.md is a file, so it should not be selected
    // falls back to workspace root
    expect(result.fullPath).toBe('/workspace');
    expect(result.relativePath).toBeNull();
  });

  it('returns workspace root when no ref and no valid selected keys', () => {
    const result = getTargetFolderPath(null, [], files, '/workspace');

    expect(result.fullPath).toBe('/workspace');
    expect(result.relativePath).toBeNull();
  });

  it('returns workspace root when selected is empty array', () => {
    const result = getTargetFolderPath(null, [], [], '/my/workspace');

    expect(result.fullPath).toBe('/my/workspace');
    expect(result.relativePath).toBeNull();
  });
});
