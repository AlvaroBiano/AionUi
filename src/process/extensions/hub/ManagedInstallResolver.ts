/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ManagedInstallResolver — resolves installed agent binaries from the
 * managed install directory (~/.aionui-agents/{ext-name}/{version}_{hash}/).
 *
 * Used by AcpDetector to discover Hub-installed agents before falling back
 * to `which` or `bunx`.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { getAgentInstallBasePath } from '@process/utils/utils';

export interface ManagedInstallResult {
  /** Absolute path to the resolved binary */
  binaryPath: string;
  /** The version directory name (e.g. "1.0.0_a3f8b2c1") */
  versionDir: string;
}

/**
 * Resolve the installed binary for a given extension from the managed directory.
 *
 * Directory structure:
 *   {basePath}/{extensionName}/{version}_{hash}/
 *     └── {installedBinaryPath}   (e.g. "node_modules/.bin/auggie" or "goose")
 *
 * When multiple version directories exist, the latest one is selected
 * (lexicographic sort by directory name — semver + hash ensures correct ordering).
 *
 * @param extensionName - The extension name (e.g. "aionext-auggie")
 * @param installedBinaryPath - Relative path to the binary inside the version dir
 * @returns ManagedInstallResult if found, null otherwise
 */
export function resolveManagedBinary(
  extensionName: string,
  installedBinaryPath: string | undefined
): ManagedInstallResult | null {
  if (!installedBinaryPath) return null;

  let basePath: string;
  try {
    basePath = getAgentInstallBasePath();
  } catch {
    return null;
  }

  const extDir = path.join(basePath, extensionName);
  if (!existsSync(extDir)) return null;

  // List version directories and pick the latest (lexicographic sort)
  let entries: string[];
  try {
    entries = readdirSync(extDir);
  } catch {
    return null;
  }

  // Filter to actual directories that match the {version}_{hash} pattern
  const versionDirs = entries.filter((entry) => {
    try {
      const fullPath = path.join(extDir, entry);
      return statSync(fullPath).isDirectory() && /^\d+\.\d+\.\d+/.test(entry);
    } catch {
      return false;
    }
  });

  if (versionDirs.length === 0) return null;

  // Sort lexicographically — semver format ensures correct ordering
  versionDirs.sort();
  const latestVersionDir = versionDirs[versionDirs.length - 1];

  const binaryPath = path.join(extDir, latestVersionDir, installedBinaryPath);
  if (!existsSync(binaryPath)) return null;

  return { binaryPath, versionDir: latestVersionDir };
}

/**
 * List all version directories for a given extension in the managed install dir.
 * Returns directories sorted lexicographically (oldest first, latest last).
 */
export function listVersionDirs(extensionName: string): string[] {
  let basePath: string;
  try {
    basePath = getAgentInstallBasePath();
  } catch {
    return [];
  }

  const extDir = path.join(basePath, extensionName);
  if (!existsSync(extDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(extDir);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => {
      try {
        return statSync(path.join(extDir, entry)).isDirectory() && /^\d+\.\d+\.\d+/.test(entry);
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Clean up old version directories, keeping the most recent N versions.
 *
 * @param extensionName - The extension name
 * @param keepCount - Number of recent versions to keep (default: 3)
 * @returns List of removed directory paths
 */
export async function cleanOldVersions(extensionName: string, keepCount: number = 3): Promise<string[]> {
  const { promises: fs } = await import('fs');

  let basePath: string;
  try {
    basePath = getAgentInstallBasePath();
  } catch {
    return [];
  }

  const extDir = path.join(basePath, extensionName);
  const dirs = listVersionDirs(extensionName);
  if (dirs.length <= keepCount) return [];

  const toRemove = dirs.slice(0, dirs.length - keepCount);
  const removed: string[] = [];

  for (const dir of toRemove) {
    const fullPath = path.join(extDir, dir);
    try {
      await fs.rm(fullPath, { recursive: true, force: true });
      removed.push(fullPath);
    } catch (error) {
      console.warn(`[ManagedInstallResolver] Failed to clean ${fullPath}:`, error);
    }
  }

  if (removed.length > 0) {
    console.log(`[ManagedInstallResolver] Cleaned ${removed.length} old version(s) for ${extensionName}`);
  }

  return removed;
}
