// src/process/acp/runtime/BackendPolicy.ts

import { getFullAutoMode } from '@/common/types/agentModes';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import type { PromptContent } from '@process/acp/types';
import { getCodexSandboxModeForSessionMode, writeCodexSandboxMode } from '@process/task/codexConfig';

// ─── Interface ──────────────────────────────────────────────────

export type SetModeResult = { intercepted: false } | { intercepted: true; localModeId: string };

export type LoginCommand = { command: string; args: string[] };

export interface BackendPolicy {
  /** Backend identifier (e.g. 'claude', 'codex', 'qwen'). */
  readonly backend: string;

  // ── Model ──

  /** Called after a successful model switch. May queue a prompt injection. */
  onModelChanged(newModelId: string, oldModelId: string | null): void;

  /**
   * Transform prompt content before sending to agent.
   * Used to inject model switch notice, re-assert model override, etc.
   */
  beforePrompt(content: PromptContent): PromptContent;

  /** Track user-initiated model override for pre-prompt re-assertion. */
  setModelOverride(modelId: string): void;

  /** Get the active model override, or null if none. */
  getModelOverride(): string | null;

  // ── Mode ──

  /**
   * Intercept setMode for backends that don't support ACP session/set_mode.
   * Returns { intercepted: true, localModeId } if the RPC should be skipped.
   */
  interceptSetMode(modeId: string): SetModeResult;

  /** Get the YOLO/full-auto mode ID for this backend. */
  getYoloModeId(): string;

  // ── Auth ──

  /** Get CLI login command + args, or null if this backend has no CLI login. */
  getLoginCommand(): LoginCommand | null;

  /** Called when auth retry is attempted. Returns false if already retried (loop guard). */
  tryAuthRetry(): boolean;

  // ── Error ──

  /** Enhance error messages with backend-specific guidance. */
  enhanceErrorMessage(message: string): string;
}

// ─── Default (no-op for most backends) ──────────────────────────

class DefaultPolicy implements BackendPolicy {
  readonly backend: string;
  private _modelOverride: string | null = null;
  private _authRetried = false;

  constructor(backend: string) {
    this.backend = backend;
  }

  onModelChanged(_newModelId: string, _oldModelId: string | null): void {
    // No action by default
  }

  beforePrompt(content: PromptContent): PromptContent {
    return content;
  }

  setModelOverride(modelId: string): void {
    this._modelOverride = modelId;
  }

  getModelOverride(): string | null {
    return this._modelOverride;
  }

  interceptSetMode(_modeId: string): SetModeResult {
    return { intercepted: false };
  }

  getYoloModeId(): string {
    return getFullAutoMode(this.backend);
  }

  getLoginCommand(): LoginCommand | null {
    return null;
  }

  tryAuthRetry(): boolean {
    if (this._authRetried) return false;
    this._authRetried = true;
    return true;
  }

  enhanceErrorMessage(message: string): string {
    return message;
  }
}

// ─── Claude ─────────────────────────────────────────────────────

class ClaudePolicy extends DefaultPolicy {
  private pendingModelSwitchNotice: string | null = null;

  constructor() {
    super('claude');
  }

  override onModelChanged(newModelId: string, _oldModelId: string | null): void {
    // Queue a <system-reminder> for next prompt so the AI knows its identity changed.
    // ACP set_model is silent — without this, the AI thinks it's still the old model.
    this.pendingModelSwitchNotice =
      `<system-reminder>Your model has been switched to ${newModelId}. ` +
      `You are now ${newModelId}. Do not mention or reference your previous model identity.</system-reminder>`;
  }

  override beforePrompt(content: PromptContent): PromptContent {
    if (!this.pendingModelSwitchNotice) return content;

    const notice = this.pendingModelSwitchNotice;
    this.pendingModelSwitchNotice = null;

    // Prepend the notice to the first text block
    const noticeBlock: ContentBlock = { type: 'text', text: notice };
    return [noticeBlock, ...content];
  }

  override getLoginCommand(): LoginCommand | null {
    return { command: 'claude', args: ['/login'] };
  }
}

// ─── Codex ──────────────────────────────────────────────────────

class CodexPolicy extends DefaultPolicy {
  constructor() {
    super('codex');
  }

  override interceptSetMode(modeId: string): SetModeResult {
    // Codex does not support ACP session/set_mode (returns "Invalid params").
    // Write sandbox config and return local-only mode.
    const sandboxMode = getCodexSandboxModeForSessionMode(modeId);
    void writeCodexSandboxMode(sandboxMode);
    return { intercepted: true, localModeId: modeId };
  }
}

// ─── Snow ───────────────────────────────────────────────────────

class SnowPolicy extends DefaultPolicy {
  constructor() {
    super('snow');
  }

  override interceptSetMode(modeId: string): SetModeResult {
    // Snow does not support ACP session/set_mode (returns "Method not found").
    return { intercepted: true, localModeId: modeId };
  }
}

// ─── Qwen ───────────────────────────────────────────────────────

class QwenPolicy extends DefaultPolicy {
  constructor() {
    super('qwen');
  }

  override getLoginCommand(): LoginCommand | null {
    return { command: 'qwen', args: ['login'] };
  }

  override enhanceErrorMessage(message: string): string {
    if (message.includes('Internal error')) {
      return (
        `${message}\n\n` +
        'Qwen troubleshooting:\n' +
        '1. Restart the conversation\n' +
        '2. Check if bundled bun is available (Settings → Agent)\n' +
        '3. Verify DASHSCOPE_API_KEY is set correctly'
      );
    }
    return message;
  }
}

// ─── Factory ────────────────────────────────────────────────────

const POLICY_MAP: Record<string, () => BackendPolicy> = {
  claude: () => new ClaudePolicy(),
  codex: () => new CodexPolicy(),
  snow: () => new SnowPolicy(),
  qwen: () => new QwenPolicy(),
};

/**
 * Create a BackendPolicy for the given backend.
 * Returns a specialized policy for known backends, or a default no-op policy.
 */
export function createBackendPolicy(backend: string): BackendPolicy {
  const factory = POLICY_MAP[backend];
  return factory ? factory() : new DefaultPolicy(backend);
}
