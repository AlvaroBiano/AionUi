// ============================================================
// SyncDaemon — Dual-way sync Hermes ↔ AionUI
// ============================================================

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getBianinhoPaths } from "./types";

const CHECK_INTERVAL_MS = 30_000;  // 30 segundos
const GIT_DEBOUNCE_MS = 5_000;     // 5 segundos

export interface SyncConfig {
  enabled: boolean;
  hermesPath: string;
  aionuiPath: string;
  autoSync: boolean;
  lastSync: number;
}

export interface SyncResult {
  ok: boolean;
  direction: "push" | "pull" | "none";
  changes: number;
  errors: string[];
  timestamp: number;
}

interface FileHash {
  [file: string]: string;
}

export class SyncDaemon {
  private config: SyncConfig;
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;
  private lastPushHashes: FileHash = {};
  private lastPullHashes: FileHash = {};
  private pendingErrors: string[] = [];

  constructor() {
    const paths = getBianinhoPaths();
    this.config = {
      enabled: true,
      hermesPath: paths.hermesPath,
      aionuiPath: paths.base,
      autoSync: true,
      lastSync: 0,
    };
    this.loadState();
  }

  // ── State persistence ────────────────────────────────────

  private statePath(): string {
    const paths = getBianinhoPaths();
    return path.join(paths.configPath || "", "sync_state.json");
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.statePath())) {
        const data = JSON.parse(fs.readFileSync(this.statePath(), "utf-8"));
        this.lastPushHashes = data.pushHashes || {};
        this.lastPullHashes = data.pullHashes || {};
        this.config.lastSync = data.lastSync || 0;
      }
    } catch { /* ignore */ }
  }

  private saveState(): void {
    const paths = getBianinhoPaths();
    const dir = paths.configPath || "";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      this.statePath(),
      JSON.stringify({ pushHashes: this.lastPushHashes, pullHashes: this.lastPullHashes, lastSync: this.config.lastSync }, null, 2)
    );
  }

  // ── File hashing ────────────────────────────────────────

  private hashFile(filePath: string): string {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return "DIR";
      const content = fs.readFileSync(filePath);
      return crypto.createHash("md5").update(content).digest("hex") + `_${stat.mtimeMs}`;
    } catch {
      return "MISSING";
    }
  }

  private hashDir(dirPath: string, extensions: string[] = []): FileHash {
    const hashes: FileHash = {};
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const full = path.join(dirPath, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (!file.startsWith(".")) {
            hashes[file] = "DIR";
          }
        } else if (extensions.length === 0 || extensions.some((e) => file.endsWith(e))) {
          hashes[file] = this.hashFile(full);
        }
      }
    } catch { /* ignore */ }
    return hashes;
  }

  // ── Sync logic ─────────────────────────────────────────

  private diffHashes(oldHashes: FileHash, newHashes: FileHash): string[] {
    const changed: string[] = [];
    const allKeys = new Set([...Object.keys(oldHashes), ...Object.keys(newHashes)]);
    for (const key of allKeys) {
      if (oldHashes[key] !== newHashes[key]) {
        changed.push(key);
      }
    }
    return changed;
  }

  async sync(): Promise<SyncResult> {
    const errors: string[] = [];
    const result: SyncResult = { ok: false, direction: "none", changes: 0, errors, timestamp: Date.now() };

    if (!this.config.enabled) return result;

    try {
      // Check AionUI side
      const aionuiHashes = this.hashDir(this.config.aionuiPath, [".ts", ".tsx", ".json", ".md", ".py", ".sh"]);
      const changedAionui = this.diffHashes(this.lastPushHashes, aionuiHashes);

      // Check Hermes side
      const hermesHashes = this.hashDir(path.join(this.config.hermesPath, "skills"), [".md"]);
      const changedHermes = this.diffHashes(this.lastPullHashes, hermesHashes);

      if (changedAionui.length > 0) {
        // Changes in AionUI — commit + push
        await this.gitPush(changedAionui);
        this.lastPushHashes = aionuiHashes;
        result.direction = "push";
        result.changes += changedAionui.length;
      }

      if (changedHermes.length > 0) {
        // Changes in Hermes — pull
        await this.gitPull(changedHermes);
        this.lastPullHashes = hermesHashes;
        result.direction = result.direction === "none" ? "pull" : "both";
        result.changes += changedHermes.length;
      }

      this.config.lastSync = Date.now();
      this.saveState();
      result.ok = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      this.pendingErrors.push(msg);
    }

    return result;
  }

  private async gitPush(files: string[]): Promise<void> {
    try {
      execSync("git add .", { cwd: this.config.aionuiPath, stdio: "pipe" });
      execSync(`git commit -m "Sync: ${files.length} files updated"`, { cwd: this.config.aionuiPath, stdio: "pipe" });
      execSync("git push alvaro main:alvaro/main", { cwd: this.config.aionuiPath, stdio: "pipe" });
      console.log(`[SyncDaemon] Pushed ${files.length} files`);
    } catch (err) {
      console.error("[SyncDaemon] Push failed:", err);
    }
  }

  private async gitPull(files: string[]): Promise<void> {
    try {
      execSync("git pull alvaro main", { cwd: this.config.aionuiPath, stdio: "pipe" });
      console.log(`[SyncDaemon] Pulled ${files.length} files`);
    } catch (err) {
      console.error("[SyncDaemon] Pull failed:", err);
    }
  }

  // ── Lifecycle ───────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(() => {
      if (this.config.autoSync) {
        this.sync();
      }
    }, CHECK_INTERVAL_MS);
    console.log("[SyncDaemon] Started");
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.saveState();
    console.log("[SyncDaemon] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  getStatus(): SyncConfig & { errors: string[] } {
    return { ...this.config, errors: this.pendingErrors.slice(-5) };
  }
}
