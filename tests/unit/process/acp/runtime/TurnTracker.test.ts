// tests/unit/process/acp/runtime/TurnTracker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnTracker } from '@process/acp/runtime/TurnTracker';

describe('TurnTracker', () => {
  let tracker: TurnTracker;
  let onFallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onFallback = vi.fn();
    tracker = new TurnTracker({ onFallback, fallbackDelayMs: 15_000 });
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  // ── beginTurn ──

  it('assigns incrementing turn IDs', () => {
    const t1 = tracker.beginTurn();
    tracker.markFinished(t1);
    const t2 = tracker.beginTurn();
    expect(t2).toBe(t1 + 1);
  });

  it('sets activeTurnId', () => {
    expect(tracker.activeTurnId).toBeNull();
    const turnId = tracker.beginTurn();
    expect(tracker.activeTurnId).toBe(turnId);
  });

  // ── markFinished ──

  it('clears activeTurnId on finish', () => {
    const turnId = tracker.beginTurn();
    tracker.markFinished(turnId);
    expect(tracker.activeTurnId).toBeNull();
  });

  it('ignores finish for non-active turn', () => {
    const t1 = tracker.beginTurn();
    tracker.markFinished(t1);
    const t2 = tracker.beginTurn();
    tracker.markFinished(t1); // stale finish
    expect(tracker.activeTurnId).toBe(t2); // t2 still active
  });

  // ── consumeFinished ──

  it('returns true when turn was finished, then false on second call', () => {
    const turnId = tracker.beginTurn();
    tracker.markFinished(turnId);
    expect(tracker.consumeFinished(turnId)).toBe(true);
    expect(tracker.consumeFinished(turnId)).toBe(false); // consumed
  });

  it('returns false when turn was not finished', () => {
    const turnId = tracker.beginTurn();
    expect(tracker.consumeFinished(turnId)).toBe(false);
  });

  // ── onActivity + fallback ──

  it('does not fire fallback before timeout', () => {
    tracker.beginTurn();
    tracker.onActivity();
    vi.advanceTimersByTime(14_999);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('fires fallback after 15s of inactivity', () => {
    const turnId = tracker.beginTurn();
    tracker.onActivity();
    vi.advanceTimersByTime(15_000);
    expect(onFallback).toHaveBeenCalledWith(turnId);
  });

  it('resets fallback timer on each activity', () => {
    tracker.beginTurn();
    tracker.onActivity();
    vi.advanceTimersByTime(10_000);
    tracker.onActivity(); // reset
    vi.advanceTimersByTime(10_000);
    expect(onFallback).not.toHaveBeenCalled(); // only 10s since last activity
    vi.advanceTimersByTime(5_000);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it('does not fire fallback if turn finished before timeout', () => {
    const turnId = tracker.beginTurn();
    tracker.onActivity();
    vi.advanceTimersByTime(5_000);
    tracker.markFinished(turnId);
    vi.advanceTimersByTime(15_000);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('does not fire fallback if no activity was recorded', () => {
    tracker.beginTurn();
    // No onActivity call → no fallback scheduled
    vi.advanceTimersByTime(30_000);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('marks turn as finished when fallback fires', () => {
    const turnId = tracker.beginTurn();
    tracker.onActivity();
    vi.advanceTimersByTime(15_000);
    expect(tracker.activeTurnId).toBeNull();
    // Fallback called markFinished, so consumeFinished returns true (one-shot)
    expect(tracker.consumeFinished(turnId)).toBe(true);
    expect(tracker.consumeFinished(turnId)).toBe(false); // consumed
  });

  // ── shouldFireFallback guard ──

  it('suppresses fallback when guard returns false, reschedules', () => {
    let guardResult = false;
    const guarded = new TurnTracker({
      onFallback,
      shouldFireFallback: () => guardResult,
      fallbackDelayMs: 15_000,
    });

    guarded.beginTurn();
    guarded.onActivity();
    vi.advanceTimersByTime(15_000);
    expect(onFallback).not.toHaveBeenCalled(); // suppressed

    // Guard now allows
    guardResult = true;
    vi.advanceTimersByTime(15_000);
    expect(onFallback).toHaveBeenCalledOnce(); // rescheduled and fired

    guarded.destroy();
  });

  // ── hasRuntimeActivity ──

  it('reports runtime activity correctly', () => {
    const turnId = tracker.beginTurn();
    expect(tracker.hasRuntimeActivity(turnId)).toBe(false);
    tracker.onActivity();
    expect(tracker.hasRuntimeActivity(turnId)).toBe(true);
  });

  it('returns false for non-active turn', () => {
    const t1 = tracker.beginTurn();
    tracker.onActivity();
    tracker.markFinished(t1);
    expect(tracker.hasRuntimeActivity(t1)).toBe(false);
  });

  // ── clearTurn ──

  it('force-clears turn without marking completed', () => {
    const turnId = tracker.beginTurn();
    tracker.onActivity();
    tracker.clearTurn(turnId);
    expect(tracker.activeTurnId).toBeNull();
    expect(tracker.consumeFinished(turnId)).toBe(false);
    vi.advanceTimersByTime(15_000);
    expect(onFallback).not.toHaveBeenCalled(); // timer cleared
  });

  // ── destroy ──

  it('clears all state on destroy', () => {
    const turnId = tracker.beginTurn();
    tracker.onActivity();
    tracker.destroy();
    expect(tracker.activeTurnId).toBeNull();
    vi.advanceTimersByTime(15_000);
    expect(onFallback).not.toHaveBeenCalled();
    expect(tracker.consumeFinished(turnId)).toBe(false);
  });

  // ── new turn clears previous fallback ──

  it('beginTurn clears fallback from previous turn', () => {
    tracker.beginTurn();
    tracker.onActivity();
    vi.advanceTimersByTime(10_000);
    const t2 = tracker.beginTurn(); // clears old fallback
    vi.advanceTimersByTime(15_000);
    // Old fallback should not fire — it was cleared by beginTurn
    expect(onFallback).not.toHaveBeenCalled();

    // New turn's fallback fires when it has activity
    tracker.onActivity();
    vi.advanceTimersByTime(15_000);
    expect(onFallback).toHaveBeenCalledWith(t2);
  });
});
