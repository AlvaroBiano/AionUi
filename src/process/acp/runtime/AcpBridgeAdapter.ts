// src/process/acp/runtime/AcpBridgeAdapter.ts

/**
 * AcpBridgeAdapter: temporary compatibility shim between AcpRuntime and the Bridge layer.
 *
 * The Bridge layer expects methods that return data synchronously (getModelInfo,
 * getMode, getConfigOptions) and setters that return Promise results (setModel →
 * Promise<AcpModelInfo>). AcpRuntime is event-driven and fire-and-forget.
 *
 * This shim wraps AcpRuntime and provides the old interface. It will be removed
 * when the renderer migrates to event-driven state management (push-on-subscribe).
 *
 * NOT part of AcpRuntime's clean architecture — this is a transitional adapter.
 */

import type { AcpModelInfo, AcpSessionConfigOption } from '@/common/types/acpTypes';
import { toAcpModelInfo, toAcpConfigOptions } from '@process/acp/compat/typeBridge';
import type { AcpRuntime } from './AcpRuntime';

// ─── AcpBridgeAdapter ───────────────────────────────────────────────

export class AcpBridgeAdapter {
  constructor(private readonly runtime: AcpRuntime) {}

  // ── Getters (mount-time state sync for renderer) ──────────────

  /** Returns current model info in old AcpModelInfo format. */
  getModelInfo(): AcpModelInfo | null {
    const snapshot = this.runtime.getModelSnapshot();
    if (!snapshot.currentModelId && snapshot.availableModels.length === 0) return null;
    return toAcpModelInfo(snapshot);
  }

  /** Returns current mode + initialization state. */
  getMode(): { mode: string; initialized: boolean } {
    const snapshot = this.runtime.getModeSnapshot();
    return {
      mode: snapshot.currentModeId ?? 'default',
      initialized: this.runtime.getSessionStatus() !== 'idle',
    };
  }

  /** Returns config options in old AcpSessionConfigOption format. */
  getConfigOptions(): AcpSessionConfigOption[] {
    const snapshot = this.runtime.getConfigSnapshot();
    return toAcpConfigOptions(snapshot.configOptions);
  }

  // ── Setters with Promise return (request-response for renderer) ──

  /**
   * Set model and return updated model info.
   * Fires setModel (fire-and-forget), then reads back snapshot.
   * The snapshot may not reflect the change yet (async confirmation),
   * but we return the best-effort current state.
   */
  async setModel(modelId: string): Promise<AcpModelInfo | null> {
    this.runtime.setModel(modelId);
    // Give the session a moment to process the model change
    await new Promise((r) => setTimeout(r, 100));
    return this.getModelInfo();
  }

  /**
   * Set mode and return result.
   * Fires setMode (fire-and-forget), then reads back snapshot.
   */
  async setMode(modeId: string): Promise<{ success: boolean; msg?: string; data?: { mode: string } }> {
    this.runtime.setMode(modeId);
    await new Promise((r) => setTimeout(r, 100));
    const snapshot = this.runtime.getModeSnapshot();
    return {
      success: true,
      data: { mode: snapshot.currentModeId ?? modeId },
    };
  }

  /**
   * Set config option and return updated options list.
   * Fires setConfigOption (fire-and-forget), then reads back snapshot.
   */
  async setConfigOption(id: string, value: string | boolean): Promise<AcpSessionConfigOption[]> {
    this.runtime.setConfigOption(id, value);
    await new Promise((r) => setTimeout(r, 100));
    return this.getConfigOptions();
  }

  // ── Other compat methods ──────────────────────────────────────

  /** Warmup / pre-initialize (alias for start). */
  initAgent(): void {
    this.runtime.start();
  }

  /**
   * Load slash commands from the running agent.
   * Returns available commands from ConfigTracker.
   */
  loadAcpSlashCommands(): Array<{ name: string; description?: string; hint?: string }> {
    return this.runtime.getAvailableCommands();
  }
}
