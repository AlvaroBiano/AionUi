// ============================================================
// BianinhoBridge — TypeScript bridge (Electron → Python)
// ============================================================

import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as path from "path";
import { app } from "electron";
import {
  BianinhoConfig,
  BianinhoResponse,
  BridgeStats,
  getPlatform,
  getBianinhoPaths,
} from "./types";

const BRIDGE_PORT = 18743;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

export class BianinhoBridge {
  private process: ChildProcess | null = null;
  private connected = false;
  private stats: BridgeStats = { uptime: 0, messagesProcessed: 0, errors: 0 };
  private startedAt = 0;
  private port = BRIDGE_PORT;
  private scriptPath: string;
  private venvPath: string;

  constructor() {
    const paths = getBianinhoPaths();
    this.scriptPath = path.join(paths.scriptsPath || "", "bianinho_bridge.py");
    this.venvPath = paths.venvPath || "";
  }

  // ── Lifecycle ────────────────────────────────────────────

  async start(): Promise<boolean> {
    const platform = getPlatform();
    console.log(`[BianinhoBridge] Starting on ${platform}...`);

    const pythonBin = platform === "darwin" || platform === "linux"
      ? path.join(this.venvPath, "bin", "python3")
      : path.join(this.venvPath, "Scripts", "python.exe");

    return new Promise((resolve) => {
      try {
        this.process = spawn(pythonBin, [this.scriptPath, String(this.port)], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
          detached: false,
        });

        this.process.stdout?.on("data", (d) =>
          console.log(`[Bridge stdout] ${d.toString().trim()}`)
        );
        this.process.stderr?.on("data", (d) =>
          console.error(`[Bridge stderr] ${d.toString().trim()}`)
        );
        this.process.on("exit", (code) => {
          console.warn(`[BianinhoBridge] Process exited with code ${code}`);
          this.connected = false;
        });

        this.startedAt = Date.now();
        this.connected = true;
        this.stats = { uptime: 0, messagesProcessed: 0, errors: 0 };
        console.log(`[BianinhoBridge] Started (PID: ${this.process.pid})`);
        resolve(true);
      } catch (err) {
        console.error(`[BianinhoBridge] Start failed:`, err);
        this.stats.errors++;
        resolve(false);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.connected = false;
    console.log("[BianinhoBridge] Stopped");
  }

  // ── TCP send/receive ────────────────────────────────────

  private async tcpSend(cmd: string, args: Record<string, unknown> = {}): Promise<BianinhoResponse> {
    if (!this.connected) {
      return { success: false, error: "Bridge not connected" };
    }

    const payload = JSON.stringify({ cmd, args });
    const encoded = Buffer.from(payload, "utf-8");

    return new Promise((resolve) => {
      const sock = new net.Socket();
      let retries = 0;

      const tryConnect = () => {
        sock.connect(this.port, "127.0.0.1", () => {
          sock.write(encoded);
          sock.write("\n");
        });
      };

      sock.on("connect", () => {
        let responseData = Buffer.alloc(0);
        sock.on("data", (chunk: Buffer) => {
          responseData = Buffer.concat([responseData, chunk]);
        });
        sock.on("close", () => {
          try {
            const text = responseData.toString("utf-8").trim();
            if (text) {
              const result = JSON.parse(text);
              this.stats.messagesProcessed++;
              resolve(result);
            } else {
              resolve({ success: false, error: "Empty response" });
            }
          } catch {
            resolve({ success: false, error: "Invalid JSON response" });
          }
        });
      });

      sock.on("error", (err) => {
        if (retries < MAX_RETRIES) {
          retries++;
          setTimeout(tryConnect, RETRY_DELAY_MS);
        } else {
          this.stats.errors++;
          this.stats.lastError = err.message;
          resolve({ success: false, error: err.message });
        }
      });

      tryConnect();
    });
  }

  // ── Public API (matching Python commands) ───────────────

  async ping(echo = "pong"): Promise<BianinhoResponse> {
    return this.tcpSend("ping", { echo });
  }

  async status(): Promise<BridgeStats & { ok?: boolean }> {
    return this.tcpSend("status") as Promise<BridgeStats & { ok?: boolean }>;
  }

  async hermesPath(): Promise<{ path?: string; exists?: boolean }> {
    return this.tcpSend("hermes_path") as Promise<{ path?: string; exists?: boolean }>;
  }

  async listSkills(): Promise<{ count?: number; skills?: Array<{ name: string; size?: number }> }> {
    return this.tcpSend("list_skills") as Promise<{ count?: number; skills?: Array<{ name: string; size?: number }> }>;
  }

  async checkHermes(): Promise<{ ok?: boolean; checks?: Record<string, boolean> }> {
    return this.tcpSend("check_hermes") as Promise<{ ok?: boolean; checks?: Record<string, boolean> }>;
  }

  async platformInfo(): Promise<Record<string, string>> {
    return this.tcpSend("platform_info") as Promise<Record<string, string>>;
  }

  // ── Stats ───────────────────────────────────────────────

  getStats(): BridgeStats {
    return {
      ...this.stats,
      uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Singleton
export const bianinhoBridge = new BianinhoBridge();
