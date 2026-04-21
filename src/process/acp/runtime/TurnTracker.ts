// src/process/acp/runtime/TurnTracker.ts

/**
 * Tracks the lifecycle of agent turns (prompt → response → finish).
 *
 * Core responsibility: detect when an agent fails to emit a `finish` signal
 * and synthesize a fallback after a configurable inactivity timeout.
 *
 * Not responsible for: event dispatch, DB persistence, IPC emission.
 * The `onFallback` callback lets the caller (AcpRuntime) handle those.
 */

const DEFAULT_FALLBACK_DELAY_MS = 15_000;

export type TurnTrackerConfig = {
  /** Called when the inactivity fallback fires. Caller should synthesize a finish. */
  onFallback: (turnId: number) => void;

  /** Guard: if this returns false, fallback is suppressed (e.g. permission dialog open). */
  shouldFireFallback?: () => boolean;

  /** Inactivity timeout in ms (default 15000). */
  fallbackDelayMs?: number;
};

export class TurnTracker {
  private nextTurnId = 0;
  private _activeTurnId: number | null = null;
  private hasActivity = false;
  private readonly completedTurnIds = new Set<number>();

  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTurnId: number | null = null;
  private readonly fallbackDelayMs: number;

  private readonly onFallback: (turnId: number) => void;
  private readonly shouldFireFallback: () => boolean;

  constructor(config: TurnTrackerConfig) {
    this.onFallback = config.onFallback;
    this.shouldFireFallback = config.shouldFireFallback ?? (() => true);
    this.fallbackDelayMs = config.fallbackDelayMs ?? DEFAULT_FALLBACK_DELAY_MS;
  }

  /** The currently active turn ID, or null if no turn is in progress. */
  get activeTurnId(): number | null {
    return this._activeTurnId;
  }

  /**
   * Begin tracking a new turn. Clears any previous fallback timer.
   * Returns a turn ID for the caller to track.
   */
  beginTurn(): number {
    this.clearFallback();
    const turnId = ++this.nextTurnId;
    this._activeTurnId = turnId;
    this.hasActivity = false;
    return turnId;
  }

  /**
   * Mark a turn as finished (normal finish signal received).
   * Clears fallback timer and records completion.
   */
  markFinished(turnId: number): void {
    if (this._activeTurnId === turnId) {
      this._activeTurnId = null;
      this.hasActivity = false;
      this.clearFallback();
    }
    this.completedTurnIds.add(turnId);
  }

  /**
   * Called on every streaming event / signal during a turn.
   * Resets the inactivity fallback countdown.
   */
  onActivity(): void {
    if (this._activeTurnId === null) return;
    this.hasActivity = true;
    this.scheduleFallback();
  }

  /**
   * One-shot check: did `turnId` receive a finish signal?
   * Consumes the record — subsequent calls for the same turnId return false.
   *
   * Used after `sendMessage()` resolves to detect if finish arrived during execution.
   */
  consumeFinished(turnId: number): boolean {
    const finished = this.completedTurnIds.has(turnId);
    if (finished) {
      if (this._activeTurnId === turnId) {
        this._activeTurnId = null;
      }
      this.completedTurnIds.delete(turnId);
    }
    return finished;
  }

  /**
   * Check whether the active turn has received any streaming activity.
   */
  hasRuntimeActivity(turnId: number): boolean {
    return this._activeTurnId === turnId && this.hasActivity;
  }

  /**
   * Force-clear a turn without marking it completed (e.g. on error/throw).
   */
  clearTurn(turnId: number): void {
    if (this._activeTurnId === turnId) {
      this._activeTurnId = null;
      this.hasActivity = false;
      this.clearFallback();
    }
    this.completedTurnIds.delete(turnId);
  }

  /** Clear all state and timers. */
  destroy(): void {
    this.clearFallback();
    this._activeTurnId = null;
    this.hasActivity = false;
    this.completedTurnIds.clear();
  }

  // ── Private ───────────────────────────────────────────────────

  private scheduleFallback(): void {
    if (this._activeTurnId === null) return;

    this.clearFallback();
    this.fallbackTurnId = this._activeTurnId;
    this.fallbackTimer = setTimeout(() => {
      this.handleFallback(this.fallbackTurnId!);
    }, this.fallbackDelayMs);
  }

  private handleFallback(turnId: number): void {
    // Stale timer check
    if (this.fallbackTurnId !== turnId) return;
    this.clearFallback();

    // Already finished or no longer active
    if (this._activeTurnId !== turnId || this.completedTurnIds.has(turnId)) return;

    // Guard: caller can suppress (e.g. permission dialog open)
    if (!this.shouldFireFallback()) {
      // Reschedule instead of suppressing permanently
      this.scheduleFallback();
      return;
    }

    // Synthesize finish
    this.markFinished(turnId);
    this.onFallback(turnId);
  }

  private clearFallback(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.fallbackTurnId = null;
  }
}
