// src/process/acp/runtime/PermissionGate.ts

import type { IConfirmation } from '@/common/chat/chatLib';

// ─── Types ──────────────────────────────────────────────────────

export type PermissionOption = {
  optionId: string;
  name: string;
};

export type PermissionRequest = {
  msgId: string;
  toolCallId: string;
  toolTitle: string;
  description: string;
  options: PermissionOption[];
};

export type PermissionDecision =
  | { action: 'auto_approved'; callId: string; optionId: string }
  | { action: 'needs_ui'; confirmation: IConfirmation<PermissionOption> };

export type PermissionGateCallbacks = {
  /** Notify renderer: new confirmation added. */
  onConfirmationAdded: (conversationId: string, confirmation: IConfirmation<PermissionOption>) => void;
  /** Notify renderer: confirmation updated. */
  onConfirmationUpdated: (conversationId: string, confirmation: IConfirmation<PermissionOption>) => void;
  /** Notify renderer: confirmation removed. */
  onConfirmationRemoved: (conversationId: string, confirmationId: string) => void;
};

// ─── PermissionGate ───────────────────────────────────────────

/**
 * Manager-level permission policy on top of AcpSession's PermissionResolver.
 *
 * PermissionResolver (Session layer) handles:
 *   L1: static YOLO (agentConfig.yoloMode, set at session creation)
 *   L2: LRU approval cache ("always allow" decisions)
 *   L3: UI delegation (Promise-based, calls onPermissionRequest callback)
 *
 * PermissionGate (Runtime layer) handles requests that PASSED through L1-L3:
 *   - Dynamic YOLO (user switched mode mid-conversation)
 *   - Team MCP tool auto-approve (title contains 'aionui-team')
 *   - Confirmation storage for UI display + TurnTracker guard
 *
 * NOT responsible for:
 *   - Sending confirmation to ACP agent (AcpRuntime calls session.confirmPermission)
 *   - Channel notification (EventDispatcher subscriber in Phase 3)
 */
export class PermissionGate {
  private confirmations: Array<IConfirmation<PermissionOption>> = [];
  private _isYoloMode = false;

  constructor(
    private readonly conversationId: string,
    private readonly callbacks: PermissionGateCallbacks
  ) {}

  /** Update dynamic YOLO state (called when mode changes via setMode). */
  setYoloMode(yolo: boolean): void {
    this._isYoloMode = yolo;
  }

  get isYoloMode(): boolean {
    return this._isYoloMode;
  }

  /**
   * Evaluate a permission request.
   * Returns 'auto_approved' (with callId + optionId) or 'needs_ui' (with IConfirmation).
   *
   * Auto-approve rules (in order):
   * 1. Dynamic YOLO mode (user switched mode mid-conversation)
   * 2. Team MCP tools (title contains 'aionui-team')
   */
  evaluate(request: PermissionRequest): PermissionDecision {
    const { options, toolTitle, toolCallId, msgId } = request;
    const callId = toolCallId || msgId;

    // 1. Dynamic YOLO — user activated YOLO mode after session creation
    //    (static YOLO is handled by PermissionResolver L1 at session level)
    if (this._isYoloMode && options.length > 0) {
      const allowOption = options.find((o) => o.optionId.startsWith('allow_'));
      return {
        action: 'auto_approved',
        callId,
        optionId: (allowOption ?? options[0]).optionId,
      };
    }

    // 2. Auto-approve team MCP tools
    if (toolTitle.includes('aionui-team') && options.length > 0) {
      return {
        action: 'auto_approved',
        callId,
        optionId: options[0].optionId,
      };
    }

    // Falls through to UI prompt
    const confirmation: IConfirmation<PermissionOption> = {
      title: toolTitle || 'messages.permissionRequest',
      action: 'messages.command',
      id: msgId,
      description: request.description || 'messages.agentRequestingPermission',
      callId: toolCallId || msgId,
      options: options.map((opt) => ({
        label: opt.name,
        value: opt,
      })),
    };

    this.addConfirmation(confirmation);
    return { action: 'needs_ui', confirmation };
  }

  /**
   * User confirmed a pending permission. Removes from list and notifies renderer.
   * Returns the selected option, or null if confirmation was not found.
   */
  confirm(callId: string): PermissionOption | null {
    const found = this.confirmations.find((c) => c.callId === callId);
    if (!found) return null;

    this.confirmations = this.confirmations.filter((c) => c.callId !== callId);
    this.callbacks.onConfirmationRemoved(this.conversationId, found.id);
    return found.options.find((o) => o.value)?.value ?? null;
  }

  /**
   * Resolve a specific confirmation with a chosen option.
   * Used when the caller knows both callId and the option to select.
   */
  confirmWithOption(callId: string, option: PermissionOption): void {
    const found = this.confirmations.find((c) => c.callId === callId);
    if (!found) return;
    this.confirmations = this.confirmations.filter((c) => c.callId !== callId);
    this.callbacks.onConfirmationRemoved(this.conversationId, found.id);
  }

  /** Get all pending confirmations (for bridge layer queries). */
  getConfirmations(): Array<IConfirmation<PermissionOption>> {
    return this.confirmations;
  }

  /** Whether any confirmations are pending (for TurnTracker guard). */
  hasPending(): boolean {
    return this.confirmations.length > 0;
  }

  /** Clear all pending confirmations (call on kill/destroy). */
  clear(): void {
    this.confirmations = [];
  }

  // ── Private ───────────────────────────────────────────────────

  private addConfirmation(confirmation: IConfirmation<PermissionOption>): void {
    const existingIndex = this.confirmations.findIndex((c) => c.id === confirmation.id);

    if (existingIndex !== -1) {
      // Update existing
      this.confirmations = this.confirmations.map((item, i) =>
        i === existingIndex ? { ...item, ...confirmation } : item
      );
      this.callbacks.onConfirmationUpdated(this.conversationId, confirmation);
    } else {
      // Add new
      this.confirmations = [...this.confirmations, confirmation];
      this.callbacks.onConfirmationAdded(this.conversationId, confirmation);
    }
  }
}
