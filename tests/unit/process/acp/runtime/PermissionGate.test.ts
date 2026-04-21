// tests/unit/process/acp/runtime/PermissionGate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionGate } from '@process/acp/runtime/PermissionGate';
import type { PermissionGateCallbacks, PermissionRequest } from '@process/acp/runtime/PermissionGate';

describe('PermissionGate', () => {
  let policy: PermissionGate;
  let callbacks: PermissionGateCallbacks;

  beforeEach(() => {
    callbacks = {
      onConfirmationAdded: vi.fn(),
      onConfirmationUpdated: vi.fn(),
      onConfirmationRemoved: vi.fn(),
    };
    policy = new PermissionGate('conv-1', callbacks);
  });

  function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
    return {
      msgId: 'msg-1',
      toolCallId: 'tc-1',
      toolTitle: 'bash',
      description: 'Run a command',
      options: [
        { optionId: 'allow_once', name: 'Allow once' },
        { optionId: 'deny', name: 'Deny' },
      ],
      ...overrides,
    };
  }

  // ── Auto-approve: dynamic YOLO ──

  it('auto-approves all tools when dynamic YOLO is active', () => {
    policy.setYoloMode(true);
    const result = policy.evaluate(makeRequest({ toolTitle: 'bash: rm -rf' }));

    expect(result.action).toBe('auto_approved');
    if (result.action === 'auto_approved') {
      expect(result.optionId).toBe('allow_once'); // prefers allow_* option
    }
    expect(callbacks.onConfirmationAdded).not.toHaveBeenCalled();
  });

  it('prefers allow_ option in YOLO mode', () => {
    policy.setYoloMode(true);
    const result = policy.evaluate(
      makeRequest({
        options: [
          { optionId: 'deny', name: 'Deny' },
          { optionId: 'allow_always', name: 'Always allow' },
        ],
      })
    );

    if (result.action === 'auto_approved') {
      expect(result.optionId).toBe('allow_always');
    }
  });

  it('does not auto-approve when YOLO is off', () => {
    policy.setYoloMode(false);
    const result = policy.evaluate(makeRequest({ toolTitle: 'bash: rm -rf' }));
    expect(result.action).toBe('needs_ui');
  });

  // ── Auto-approve: team MCP tools ──

  it('auto-approves team MCP tools', () => {
    const result = policy.evaluate(makeRequest({ toolTitle: 'aionui-team-guide: list_tasks' }));

    expect(result.action).toBe('auto_approved');
    if (result.action === 'auto_approved') {
      expect(result.optionId).toBe('allow_once');
      expect(result.callId).toBe('tc-1');
    }
    // No confirmation added
    expect(callbacks.onConfirmationAdded).not.toHaveBeenCalled();
    expect(policy.getConfirmations()).toHaveLength(0);
  });

  it('auto-approves with first option when multiple available', () => {
    const result = policy.evaluate(
      makeRequest({
        toolTitle: 'aionui-team: send_message',
        options: [
          { optionId: 'allow_always', name: 'Always allow' },
          { optionId: 'allow_once', name: 'Allow once' },
          { optionId: 'deny', name: 'Deny' },
        ],
      })
    );

    expect(result.action).toBe('auto_approved');
    if (result.action === 'auto_approved') {
      expect(result.optionId).toBe('allow_always');
    }
  });

  // ── UI prompt: non-team tools ──

  it('falls through to UI for non-team tools', () => {
    const result = policy.evaluate(makeRequest({ toolTitle: 'bash: rm -rf' }));

    expect(result.action).toBe('needs_ui');
    if (result.action === 'needs_ui') {
      expect(result.confirmation.callId).toBe('tc-1');
      expect(result.confirmation.options).toHaveLength(2);
    }
    expect(callbacks.onConfirmationAdded).toHaveBeenCalledOnce();
    expect(policy.getConfirmations()).toHaveLength(1);
  });

  it('uses msgId as fallback callId when toolCallId is empty', () => {
    const result = policy.evaluate(makeRequest({ toolCallId: '', msgId: 'msg-fallback' }));

    if (result.action === 'needs_ui') {
      expect(result.confirmation.callId).toBe('msg-fallback');
    }
  });

  // ── Confirmation lifecycle ──

  it('stores multiple confirmations', () => {
    policy.evaluate(makeRequest({ msgId: 'msg-1', toolCallId: 'tc-1' }));
    policy.evaluate(makeRequest({ msgId: 'msg-2', toolCallId: 'tc-2' }));

    expect(policy.getConfirmations()).toHaveLength(2);
    expect(policy.hasPending()).toBe(true);
  });

  it('updates existing confirmation with same id', () => {
    policy.evaluate(makeRequest({ msgId: 'msg-1', description: 'first' }));
    policy.evaluate(makeRequest({ msgId: 'msg-1', description: 'updated' }));

    expect(policy.getConfirmations()).toHaveLength(1);
    expect(policy.getConfirmations()[0].description).toBe('updated');
    expect(callbacks.onConfirmationUpdated).toHaveBeenCalledOnce();
  });

  it('confirm removes and notifies', () => {
    policy.evaluate(makeRequest({ toolCallId: 'tc-1' }));
    expect(policy.getConfirmations()).toHaveLength(1);

    policy.confirmWithOption('tc-1', { optionId: 'allow_once', name: 'Allow once' });

    expect(policy.getConfirmations()).toHaveLength(0);
    expect(callbacks.onConfirmationRemoved).toHaveBeenCalledWith('conv-1', 'msg-1');
  });

  it('confirm returns null for unknown callId', () => {
    const result = policy.confirm('nonexistent');
    expect(result).toBeNull();
    expect(callbacks.onConfirmationRemoved).not.toHaveBeenCalled();
  });

  // ── hasPending (for TurnTracker guard) ──

  it('hasPending returns false when no confirmations', () => {
    expect(policy.hasPending()).toBe(false);
  });

  it('hasPending returns true when confirmations exist', () => {
    policy.evaluate(makeRequest());
    expect(policy.hasPending()).toBe(true);
  });

  it('hasPending returns false after all confirmed', () => {
    policy.evaluate(makeRequest({ toolCallId: 'tc-1' }));
    policy.confirmWithOption('tc-1', { optionId: 'allow_once', name: 'Allow once' });
    expect(policy.hasPending()).toBe(false);
  });

  // ── clear ──

  it('clear removes all confirmations', () => {
    policy.evaluate(makeRequest({ msgId: 'msg-1', toolCallId: 'tc-1' }));
    policy.evaluate(makeRequest({ msgId: 'msg-2', toolCallId: 'tc-2' }));
    policy.clear();

    expect(policy.getConfirmations()).toHaveLength(0);
    expect(policy.hasPending()).toBe(false);
  });
});
