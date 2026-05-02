// ============================================================
// BianinhoBridge HTTP — Electron → Remote BianinhoBridge Server
// Usa HTTP em vez de TCP para ligar ao servidor via Tailscale
// ============================================================

import {
  BianinhoResponse,
  BridgeStats,
} from "./types";

const BRIDGE_URL = "http://100.79.189.95:18743";
const TIMEOUT_MS = 15000;

export class BianinhoHttpBridge {
  private connected = false;
  private stats: BridgeStats = { uptime: 0, messagesProcessed: 0, errors: 0 };
  private startedAt = 0;

  constructor() {
    this.startedAt = Date.now();
    this.connected = true;
    this.stats = { uptime: 0, messagesProcessed: 0, errors: 0 };
    console.log(`[BianinhoHttpBridge] Connecting to ${BRIDGE_URL}`);
  }

  private async httpSend(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown> {
    const url = `${BRIDGE_URL}${path}`;
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        this.stats.errors++;
        return { ok: false, error: `HTTP ${response.status}` };
      }

      const text = await response.text();
      if (!text) {
        return { ok: false, error: "Empty response" };
      }

      this.stats.messagesProcessed++;
      return JSON.parse(text);
    } catch (err: unknown) {
      this.stats.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      this.stats.lastError = msg;
      return { ok: false, error: msg };
    }
  }

  // ── Public API ─────────────────────────────────────────────

  async ping(echo = "pong"): Promise<{ ok: boolean; pong?: string }> {
    const result = await this.httpSend("GET", "/ping");
    return result as { ok: boolean; pong?: string };
  }

  async status(): Promise<BridgeStats & { ok?: boolean }> {
    return (await this.httpSend("GET", "/status")) as BridgeStats & { ok?: boolean };
  }

  async hermesPath(): Promise<{ path?: string; exists?: boolean }> {
    return (await this.httpSend("GET", "/hermes_path")) as { path?: string; exists?: boolean };
  }

  async listSkills(): Promise<{ count?: number; skills?: Array<{ name: string; size?: number }> }> {
    return (await this.httpSend("GET", "/list_skills")) as { count?: number; skills?: Array<{ name: string; size?: number }> };
  }

  async checkHermes(): Promise<{ ok?: boolean; checks?: Record<string, boolean> }> {
    return (await this.httpSend("GET", "/check_hermes")) as { ok?: boolean; checks?: Record<string, boolean> };
  }

  async platformInfo(): Promise<Record<string, string>> {
    return (await this.httpSend("GET", "/platform_info")) as Record<string, string>;
  }

  // ── Stats ─────────────────────────────────────────────

  getStats(): BridgeStats {
    return {
      ...this.stats,
      uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  async start(): Promise<boolean> {
    this.connected = true;
    return true;
  }
}

// Singleton
export const bianinhoHttpBridge = new BianinhoHttpBridge();
