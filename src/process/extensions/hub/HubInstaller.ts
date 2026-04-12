import { getPlatformServices } from '@/common/platform';
import { cleanOldVersions } from '@/process/extensions/hub/ManagedInstallResolver';
import { agentRegistry } from '@process/agent/AgentRegistry';
import {
  EXTENSION_MANIFEST_FILE,
  getHubResourcesDir,
  getInstallTargetDir,
  HUB_REMOTE_URLS,
} from '@process/extensions/constants';
import { ExtensionRegistry } from '@process/extensions/ExtensionRegistry';
import { hubIndexManager } from '@process/extensions/hub/HubIndexManager';
import { hubStateManager } from '@process/extensions/hub/HubStateManager';
import { computeContentHash } from '@process/extensions/lifecycle/contentHash';
import { uninstallExtension } from '@process/extensions/lifecycle/lifecycle';
import {
  loadPersistedStates,
  markExtensionForReinstall,
  savePersistedStates,
} from '@process/extensions/lifecycle/statePersistence';
import { getAgentInstallBasePath, getDataPath } from '@process/utils';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Post-install verification
// ---------------------------------------------------------------------------

type VerifyResult = { ok: boolean; reason?: string };

/**
 * Verify that an extension's ACP adapter binaries exist in the managed install directory.
 *
 * Convention: install.ts must place the executable at bin/{cliCommand}.
 * Checks each adapter's `bin/{cliCommand}` under the managed directory
 * ({basePath}/{extName}/{version}_{hashPrefix}/).
 */
function verifyInstallation(extName: string, extDir: string): VerifyResult {
  const loadedExtension = ExtensionRegistry.getInstance()
    .getLoadedExtensions()
    .find((ext) => ext.manifest.name === extName);
  if (!loadedExtension) {
    return { ok: true }; // Extension not loaded yet — skip verification
  }

  const adapters = loadedExtension.manifest.contributes?.acpAdapters;
  if (!adapters || adapters.length === 0) return { ok: true };

  // Compute the managed install directory for this extension
  const contentHash = computeContentHash(extDir);
  const hashPrefix = contentHash.substring(0, 8);
  const installDir = path.join(getAgentInstallBasePath(), extName, `${loadedExtension.manifest.version}_${hashPrefix}`);

  const missing: string[] = [];
  for (const adapter of adapters) {
    if (!adapter.cliCommand) continue;
    const binaryPath = path.join(installDir, 'bin', adapter.cliCommand);
    if (!fs.existsSync(binaryPath)) {
      missing.push(`${adapter.id} (bin/${adapter.cliCommand})`);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Agent binaries not found in managed directory after install: [${missing.join(', ')}]. The onInstall hook may have failed.`,
    };
  }
  return { ok: true };
}

export class HubInstallerImpl {
  private getCacheDir(): string {
    return path.join(getDataPath(), 'cache', 'hub');
  }

  private getTempDir(): string {
    return path.join(getInstallTargetDir(), '.tmp');
  }

  public async install(name: string): Promise<void> {
    try {
      hubStateManager.setTransientState(name, 'installing');

      const extInfo = hubIndexManager.getExtension(name);
      if (!extInfo) {
        throw new Error(`Extension ${name} not found in Hub Index`);
      }

      const tempDir = path.join(this.getTempDir(), name);
      const targetDir = path.join(getInstallTargetDir(), name);

      // Clean up previous temp dir if exists
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Ensure directories exist
      fs.mkdirSync(this.getCacheDir(), { recursive: true });
      fs.mkdirSync(this.getTempDir(), { recursive: true });

      // Step 1: Resolve zip path — try remote download first, fallback to bundled resources
      const zipPath = await this.resolveZipPath(name, extInfo.dist.tarball, extInfo.bundled);

      // Step 2: Extract (.zip)
      fs.mkdirSync(tempDir, { recursive: true });
      if (process.platform === 'win32') {
        await execAsync(`tar -xf "${zipPath}" -C "${tempDir}"`);
      } else {
        await execAsync(`unzip -o "${zipPath}" -d "${tempDir}"`);
      }

      // If the archive wraps contents in a "package" directory, move contents up
      const packageDir = path.join(tempDir, 'package');
      let finalExtractDir = tempDir;
      if (fs.existsSync(packageDir)) {
        finalExtractDir = packageDir;
      }

      // Verify aion-extension.json exists
      const manifestPath = path.join(finalExtractDir, EXTENSION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid extension package: aion-extension.json missing');
      }

      // Step 3: Verify Integrity (content hash on extracted dir, cross-platform safe)
      this.verifyIntegrity(finalExtractDir, extInfo.dist.integrity);

      // Step 4: Move to target directory
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      if (finalExtractDir === packageDir) {
        fs.renameSync(packageDir, targetDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
      } else {
        fs.renameSync(tempDir, targetDir);
      }

      // Step 4.5: Stamp dist.integrity into local manifest for update detection
      this.stampIntegrity(targetDir, extInfo.dist.integrity);

      // Step 5: Reload extension registry
      // Clear persisted state so hotReload treats this as a fresh install
      // and re-runs onInstall (handles reinstall after CLI was uninstalled).
      await markExtensionForReinstall(name);

      // hotReload re-scans all extension directories, discovers this new extension,
      // and runs the full lifecycle (onInstall for first-time + onActivate) via
      // the extension system's lifecycle runner (forked process, timeout, sandboxing).
      await ExtensionRegistry.hotReload();

      // Re-detect all agents (builtin + extension + custom) since onInstall
      // may have installed new CLIs that weren't on PATH at startup.
      await agentRegistry.refreshAll();

      // Step 6: Verify installed binaries exist in managed directory
      const verification = verifyInstallation(name, targetDir);
      if (!verification.ok) {
        throw new Error(verification.reason);
      }

      // Step 7: Clean old managed versions (non-blocking, keep 3 most recent)
      cleanOldVersions(name, 3).catch((err) =>
        console.warn(`[HubInstaller] Failed to clean old versions for ${name}:`, err)
      );

      hubStateManager.setTransientState(name, 'installed');
    } catch (error) {
      console.error(`[HubInstaller] Failed to install ${name}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      hubStateManager.setTransientState(name, 'install_failed', errorMessage);
      throw error;
    }
  }

  public async uninstall(name: string): Promise<void> {
    try {
      hubStateManager.setTransientState(name, 'uninstalling');

      // Step 1: Run onUninstall lifecycle hook (if extension is loaded)
      const loadedExtension = ExtensionRegistry.getInstance()
        .getLoadedExtensions()
        .find((ext) => ext.manifest.name === name);

      if (loadedExtension) {
        try {
          await uninstallExtension(loadedExtension);
        } catch (err) {
          // Log but don't abort — still clean up files even if hook fails
          console.warn(`[HubInstaller] onUninstall hook failed for ${name}:`, err);
        }
      }

      // Step 2: Delete managed install directory (~/.aionui-agents/{name}/)
      try {
        const managedDir = path.join(getAgentInstallBasePath(), name);
        if (fs.existsSync(managedDir)) {
          fs.rmSync(managedDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.warn(`[HubInstaller] Failed to clean managed directory for ${name}:`, err);
      }

      // Step 3: Delete extension directory (where aion-extension.json lives)
      const targetDir = path.join(getInstallTargetDir(), name);
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      // Step 4: Clear persisted state
      const states = await loadPersistedStates();
      states.delete(name);
      savePersistedStates(states);

      // Step 5: Reload registry + refresh detector
      await ExtensionRegistry.hotReload();
      await acpDetector.refreshExtensionAgents();

      hubStateManager.setTransientState(name, 'not_installed');
    } catch (error) {
      console.error(`[HubInstaller] Failed to uninstall ${name}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      hubStateManager.setTransientState(name, 'install_failed', errorMessage);
      throw error;
    }
  }

  public async retryInstall(name: string): Promise<void> {
    hubStateManager.setTransientState(name, 'installing');

    try {
      const targetDir = path.join(getInstallTargetDir(), name);

      // If target directory doesn't exist, we must run the full install process again
      if (!fs.existsSync(targetDir)) {
        await this.install(name);
        return;
      }

      // Target directory exists — verify manifest then let registry handle lifecycle
      const manifestPath = path.join(targetDir, EXTENSION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Extension manifest missing, please reinstall from scratch.');
      }

      // Reload registry — clear persisted state to force onInstall re-run
      await markExtensionForReinstall(name);
      await ExtensionRegistry.hotReload();
      await agentRegistry.refreshAll();

      // Verify installed binaries exist in managed directory
      const verification = verifyInstallation(name, targetDir);
      if (!verification.ok) {
        throw new Error(verification.reason);
      }

      // Clean old managed versions (non-blocking, keep 3 most recent)
      cleanOldVersions(name, 3).catch((err) =>
        console.warn(`[HubInstaller] Failed to clean old versions for ${name}:`, err)
      );

      hubStateManager.setTransientState(name, 'installed');
    } catch (error) {
      console.error(`[HubInstaller] Failed to retry install ${name}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      hubStateManager.setTransientState(name, 'install_failed', errorMessage);
      throw error;
    }
  }

  /**
   * Resolve the zip file path for an extension.
   * Always tries remote download first to ensure the latest version is used.
   * Bundled extensions fall back to local Resources if all remote mirrors fail.
   * Non-bundled extensions fail if all remote mirrors are unavailable.
   */
  private async resolveZipPath(name: string, distTarball: string, bundled?: boolean): Promise<string> {
    console.debug(`[HubInstaller] Resolving zip path for ${name}, bundled=${bundled}, distTarball=${distTarball}`);

    // Reject absolute URLs to prevent bypassing trusted base URLs
    if (/^https?:\/\//i.test(distTarball)) {
      throw new Error(`Untrusted absolute tarball URL in hub index: ${distTarball}`);
    }

    // Try remote download first (all mirrors in order)
    const cachePath = path.join(this.getCacheDir(), `${name}.zip`);
    for (const baseUrl of HUB_REMOTE_URLS) {
      const url = new URL(distTarball, baseUrl).toString();
      try {
        console.log(`[HubInstaller] Attempting to download ${name} from ${url}`);
        await this.downloadFile(url, cachePath);
        return cachePath;
      } catch (error) {
        console.warn(`[HubInstaller] Download failed from ${url} (${error})`);
      }
    }

    // Remote failed — fall back to bundled local zip if available
    if (bundled) {
      const localPath = path.join(getHubResourcesDir(), path.basename(distTarball));
      if (fs.existsSync(localPath)) {
        console.warn(`[HubInstaller] All remote mirrors failed for ${name}, using bundled zip from ${localPath}`);
        return localPath;
      }
    }

    throw new Error(`Failed to download ${name} from all remote sources`);
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const response = await getPlatformServices().network.fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }

    // Convert array buffer to buffer and write to disk
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(arrayBuffer));
  }

  /**
   * Write dist.integrity from the hub index into the local aion-extension.json.
   * This allows HubStateManager to cheaply detect updates by comparing the
   * stamped integrity against the remote index, without recomputing the hash.
   */
  private stampIntegrity(extDir: string, integrity: string): void {
    const manifestPath = path.join(extDir, EXTENSION_MANIFEST_FILE);
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest.dist = { ...manifest.dist, integrity };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (err) {
      throw new Error(`[HubInstaller] Failed to stamp integrity into ${manifestPath}: ${err}`);
    }
  }

  /**
   * Verify integrity of an extracted extension directory using content hash.
   * The expected SRI is `sha256-{hex}` computed over sorted file paths + contents,
   * matching AionHub's build script `computeContentHash()`.
   */
  private verifyIntegrity(extractedDir: string, expectedSri: string): void {
    if (!expectedSri.startsWith('sha256-')) {
      // Legacy sha512 format or unknown — skip gracefully during migration
      if (expectedSri.startsWith('sha512-')) {
        console.warn(`[HubInstaller] Legacy sha512 integrity format, skipping content hash check.`);
        return;
      }
      console.warn(`[HubInstaller] Unsupported integrity algorithm in ${expectedSri}, skipping check.`);
      return;
    }

    const expectedHash = expectedSri.substring('sha256-'.length);
    const actualHash = computeContentHash(extractedDir);

    if (actualHash !== expectedHash) {
      throw new Error(
        `Integrity verification failed! Expected content hash ${expectedHash.substring(0, 16)}..., got ${actualHash.substring(0, 16)}...`
      );
    }
  }
}

export const hubInstaller = new HubInstallerImpl();
