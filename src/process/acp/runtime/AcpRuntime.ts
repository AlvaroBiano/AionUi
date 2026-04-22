// src/process/acp/runtime/AcpRuntime.ts

import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { CronMessageMeta, IConfirmation } from '@/common/chat/chatLib';
import type { AcpPermissionOption } from '@/common/types/acpTypes';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { ClientFactory } from '@process/acp/infra/IAcpClient';
import { AcpSession, type SessionOptions } from '@process/acp/session/AcpSession';
import type {
  AgentConfig,
  AgentStatus,
  PermissionUIData,
  SessionCallbacks,
  SessionSignal,
  SessionStatus,
} from '@process/acp/types';
import type { AgentEventPayloadMap } from '@process/events/AgentEvents';
import type { EventDispatcher } from '@process/events/EventDispatcher';
import type { AgentKillReason, IAgentManager } from '@process/task/IAgentManager';
import { createBackendPolicy, type BackendPolicy } from '@process/acp/runtime/BackendPolicy';
import { InputPipeline, type InjectionContext } from '@process/acp/runtime/InputPipeline';
import { OutputPipeline } from '@process/acp/runtime/OutputPipeline';
import { PermissionGate, type PermissionGateCallbacks } from '@process/acp/runtime/PermissionGate';
import { TurnTracker } from '@process/acp/runtime/TurnTracker';
import { UserMessagePersister, type PersisterDeps } from '@process/acp/runtime/UserMessagePersister';

// ─── TMessage → IResponseMessage bridge ─────────────────────────

// Temporary: convert new TMessage to old IResponseMessage for event payloads.
// Will be removed when renderer migrates to TMessage directly.
import type { TMessage } from '@/common/chat/chatLib';

function toResponseMessage(msg: TMessage, conversationId: string): IResponseMessage {
  return {
    type: msg.type,
    conversation_id: conversationId,
    msg_id: msg.msg_id ?? msg.id,
    data: msg.content,
    hidden: (msg as { hidden?: boolean }).hidden,
  };
}

// ─── Config ─────────────────────────────────────────────────────

export type AcpRuntimeConfig = {
  conversation_id: string;
  workspace: string;
  agentConfig: AgentConfig;
  clientFactory: ClientFactory;
  sessionOptions?: SessionOptions;

  // Business context
  backend: string;
  yoloMode?: boolean;
  presetContext?: string;
  enabledSkills?: string[];
  excludeBuiltinSkills?: string[];
  isInTeam?: boolean;

  // Injection context resolver (async, called on first message)
  resolveInjectionContext?: () => Promise<InjectionContext>;

  // Dependencies (injected for testability)
  persisterDeps: PersisterDeps;
  permissionCallbacks: PermissionGateCallbacks;

  // EventDispatcher — all fan-out goes through here
  dispatcher: EventDispatcher<AgentEventPayloadMap>;
};

// ─── AcpRuntime ─────────────────────────────────────────────────

/**
 * AcpRuntime: the business layer for a single ACP conversation.
 *
 * Implements IAgentManager so it can be registered in WorkerTaskManager.
 * All fan-out goes through EventDispatcher — AcpRuntime does not know
 * who consumes its events (Bridge, Team, Channel, Cron, Persistence, etc.).
 */
export class AcpRuntime implements IAgentManager {
  readonly type = 'acp' as const;
  readonly workspace: string;
  readonly conversation_id: string;

  private _status: AgentStatus = 'idle';
  private _lastActivityAt: number = Date.now();
  private _bootstrapping = true;
  private _isFirstMessage = true;

  // Components
  private readonly session: AcpSession;
  private readonly inputPipeline: InputPipeline;
  private readonly outputPipeline: OutputPipeline;
  private readonly turnTracker: TurnTracker;
  private readonly backendPolicy: BackendPolicy;
  private readonly permissionGate: PermissionGate;
  private readonly persister: UserMessagePersister;
  private readonly dispatcher: EventDispatcher<AgentEventPayloadMap>;

  private readonly config: AcpRuntimeConfig;

  constructor(config: AcpRuntimeConfig) {
    this.config = config;
    this.conversation_id = config.conversation_id;
    this.workspace = config.workspace;
    this.dispatcher = config.dispatcher;

    // Components
    this.backendPolicy = createBackendPolicy(config.backend);
    this.inputPipeline = new InputPipeline(config.workspace);
    this.outputPipeline = new OutputPipeline(config.conversation_id);
    this.persister = new UserMessagePersister(config.persisterDeps);
    this.permissionGate = new PermissionGate(config.conversation_id, config.permissionCallbacks);

    if (config.yoloMode) {
      this.permissionGate.setYoloMode(true);
    }

    this.turnTracker = new TurnTracker({
      onFallback: (turnId) => this.handleMissingFinish(turnId),
      shouldFireFallback: () => !this.permissionGate.hasPending(),
    });

    // Create session
    const callbacks = this.buildSessionCallbacks();
    this.session = new AcpSession(config.agentConfig, config.clientFactory, callbacks, config.sessionOptions);
  }

  // ─── IAgentManager ────────────────────────────────────────────

  get status(): AgentStatus {
    return this._status;
  }

  get lastActivityAt(): number {
    return this._lastActivityAt;
  }

  async sendMessage(data: {
    content: string;
    files?: string[];
    msg_id?: string;
    cronMeta?: CronMessageMeta;
    hidden?: boolean;
    silent?: boolean;
  }): Promise<void> {
    this._lastActivityAt = Date.now();
    this._bootstrapping = false;
    this._status = 'running';

    // Auto-start session if not yet started (warmup may have been skipped)
    if (this.session.status === 'idle' || this.session.status === 'error') {
      this.session.start();
      // Wait for session to reach active state before sending
      await this.waitForSessionReady();
    }

    // 1. Persist user message immediately (UI sees it before agent init)
    this.persister.persist({
      msgId: data.msg_id ?? '',
      content: data.content,
      conversationId: this.conversation_id,
      cronMeta: data.cronMeta,
      hidden: data.hidden,
      silent: data.silent,
    });

    // 2. Emit turn:started
    this.dispatcher.emit('turn:started', {
      conversationId: this.conversation_id,
      agentType: 'acp',
    });

    // 3. Resolve injection context on first message
    let injection: InjectionContext | undefined;
    if (this._isFirstMessage && this.config.resolveInjectionContext) {
      try {
        injection = await this.config.resolveInjectionContext();
      } catch {
        // Best effort — send without injection
      }
    }

    // 4. Input pipeline: strip marker → first message inject → @file resolve
    const content = this.inputPipeline.process(data.content, data.files, injection);
    if (this._isFirstMessage) {
      this._isFirstMessage = false;
    }

    // 5. Backend policy: inject model switch notice, re-assert model override
    const processed = this.backendPolicy.beforePrompt(content);

    // 6. Turn tracking
    const turnId = this.turnTracker.beginTurn();

    try {
      await this.session.sendMessage(processed);

      // Check if finish arrived during sendMessage
      if (this.turnTracker.consumeFinished(turnId)) {
        return;
      }

      // If streaming activity observed but no finish yet, fallback timer handles it
      if (this.turnTracker.hasRuntimeActivity(turnId)) {
        return;
      }

      // No finish AND no activity — synthesize finish immediately
      this.turnTracker.clearTurn(turnId);
      this.handleMissingFinish(turnId);
    } catch {
      this.turnTracker.clearTurn(turnId);
      this._status = 'ready';
    }
  }

  async stop(): Promise<void> {
    this.session.cancelPrompt();
  }

  confirm(_msgId: string, callId: string, data: unknown): void {
    const option = data as AcpPermissionOption;
    this.permissionGate.confirmWithOption(callId, {
      optionId: option.optionId,
      name: option.name,
    });
    this.session.confirmPermission(callId, option.optionId);
  }

  getConfirmations(): IConfirmation[] {
    return this.permissionGate.getConfirmations();
  }

  kill(_reason?: AgentKillReason): void {
    this.turnTracker.destroy();
    this.outputPipeline.reset();
    this.permissionGate.clear();
    void this.session.stop();
    this._status = 'idle';
  }

  // ─── Additional public API (for bridge layer) ─────────────────

  start(): void {
    this.session.start();
  }

  setModel(modelId: string): void {
    this.backendPolicy.setModelOverride(modelId);
    this.session.setModel(modelId);
    // Emit immediately (user intent). Session callback onModelUpdate may emit
    // again when agent confirms, but we don't wait — persistence should capture
    // the user's choice even if session is temporarily unavailable.
    this.dispatcher.emit('model:changed', {
      conversationId: this.conversation_id,
      agentType: 'acp',
      modelId,
    });
  }

  setMode(modeId: string): void {
    const result = this.backendPolicy.interceptSetMode(modeId);
    const isYolo = modeId === this.backendPolicy.getYoloModeId();
    this.permissionGate.setYoloMode(isYolo);
    this.session.setAutoApproveAll(isYolo);

    if (!result.intercepted) {
      this.session.setMode(modeId);
    }

    // Emit immediately regardless of interception or session state.
    this.dispatcher.emit('mode:changed', {
      conversationId: this.conversation_id,
      agentType: 'acp',
      modeId,
      isYolo,
    });
  }

  setConfigOption(id: string, value: string | boolean): void {
    this.session.setConfigOption(id, value);
  }

  retryAuth(credentials?: Record<string, string>): void {
    this.session.retryAuth(credentials);
  }

  getSessionStatus(): SessionStatus {
    return this.session.status;
  }

  // ─── Snapshot access (for BridgeCompat) ───────────────────────

  /** Read-only access to current model/mode/config snapshots. */
  getModelSnapshot() {
    return this.session.configTracker.modelSnapshot();
  }

  getModeSnapshot() {
    return this.session.configTracker.modeSnapshot();
  }

  getConfigSnapshot() {
    return this.session.configTracker.configSnapshot();
  }

  getAvailableCommands() {
    return this.session.configTracker.configSnapshot().availableCommands;
  }

  // ─── Session callbacks ────────────────────────────────────────

  private buildSessionCallbacks(): SessionCallbacks {
    return {
      onNotification: (notification: SessionNotification) => {
        this.handleNotification(notification);
      },

      onTurnEnd: () => {
        this.outputPipeline.onTurnEnd();
      },

      onSessionId: (sessionId: string) => {
        this.dispatcher.emit('session:id', {
          conversationId: this.conversation_id,
          agentType: 'acp',
          sessionId,
        });
      },

      onStatusChange: (status: AgentStatus) => {
        this._status = status;
      },

      onConfigUpdate: (config) => {
        this.dispatcher.emit('config:changed', {
          conversationId: this.conversation_id,
          agentType: 'acp',
          config,
        });
      },

      onModelUpdate: (model) => {
        const modelId = model.currentModelId ?? '';
        this.backendPolicy.onModelChanged(modelId, null);
        this.dispatcher.emit('model:changed', {
          conversationId: this.conversation_id,
          agentType: 'acp',
          modelId,
        });
      },

      onModeUpdate: (mode) => {
        const modeId = mode.currentModeId ?? '';
        const isYolo = modeId === this.backendPolicy.getYoloModeId();
        this.dispatcher.emit('mode:changed', {
          conversationId: this.conversation_id,
          agentType: 'acp',
          modeId,
          isYolo,
        });
      },

      onContextUsage: (usage) => {
        this.dispatcher.emit('context:usage', {
          conversationId: this.conversation_id,
          agentType: 'acp',
          ...usage,
        });
      },

      onPermissionRequest: (data: PermissionUIData) => {
        this.handlePermissionRequest(data);
      },

      onSignal: (signal: SessionSignal) => {
        this.handleSignal(signal);
      },
    };
  }

  // ─── Internal handlers ────────────────────────────────────────

  private handleNotification(notification: SessionNotification): void {
    if (this._bootstrapping) return;

    this.turnTracker.onActivity();

    const messages = this.outputPipeline.process(notification);
    for (const msg of messages) {
      this.dispatcher.emit('agent:stream', {
        conversationId: this.conversation_id,
        agentType: 'acp',
        message: toResponseMessage(msg, this.conversation_id),
      });
    }
  }

  private handleSignal(signal: SessionSignal): void {
    this.turnTracker.onActivity();
    const ctx = { conversationId: this.conversation_id, agentType: 'acp' as const };

    switch (signal.type) {
      case 'turn_finished': {
        this.turnTracker.markFinished(this.turnTracker.activeTurnId ?? 0);
        this._status = 'ready';
        this.dispatcher.emit('agent:finish', {
          ...ctx,
          message: {
            type: 'finish',
            conversation_id: this.conversation_id,
            msg_id: `finish_${Date.now()}`,
            data: null,
          },
        });
        this.dispatcher.emit('turn:completed', {
          ...ctx,
          backend: this.config.backend,
          workspace: this.workspace,
          pendingConfirmations: this.permissionGate.getConfirmations().length,
        });
        break;
      }

      case 'process_crash': {
        this.turnTracker.markFinished(this.turnTracker.activeTurnId ?? 0);
        this._status = 'ready';
        const errorMsg = this.backendPolicy.enhanceErrorMessage(
          `process exited unexpectedly (code: ${signal.exitCode ?? 'unknown'}, signal: ${signal.signal ?? 'none'})`
        );
        this.dispatcher.emit('agent:error', {
          ...ctx,
          message: {
            type: 'error',
            conversation_id: this.conversation_id,
            msg_id: `error_${Date.now()}`,
            data: errorMsg,
          },
        });
        this.dispatcher.emit('agent:finish', {
          ...ctx,
          message: {
            type: 'finish',
            conversation_id: this.conversation_id,
            msg_id: `finish_crash_${Date.now()}`,
            data: { agentCrash: true },
          },
        });
        this.dispatcher.emit('turn:completed', { ...ctx, backend: this.config.backend });
        break;
      }

      case 'error':
        this.dispatcher.emit('agent:error', {
          ...ctx,
          message: {
            type: 'error',
            conversation_id: this.conversation_id,
            msg_id: `error_${Date.now()}`,
            data: this.backendPolicy.enhanceErrorMessage(signal.message),
          },
        });
        break;

      case 'auth_required':
        this.dispatcher.emit('agent:error', {
          ...ctx,
          message: {
            type: 'error',
            conversation_id: this.conversation_id,
            msg_id: `auth_${Date.now()}`,
            data: 'Authentication required',
          },
        });
        break;

      case 'session_expired':
        this.dispatcher.emit('agent:error', {
          ...ctx,
          message: {
            type: 'error',
            conversation_id: this.conversation_id,
            msg_id: `expired_${Date.now()}`,
            data: 'Session expired',
          },
        });
        break;
    }
  }

  private handlePermissionRequest(data: PermissionUIData): void {
    const decision = this.permissionGate.evaluate({
      msgId: data.callId,
      toolCallId: data.callId,
      toolTitle: data.title,
      description: data.description,
      options: data.options.map((o) => ({ optionId: o.optionId, name: o.label })),
    });

    if (decision.action === 'auto_approved') {
      setTimeout(() => {
        this.session.confirmPermission(decision.callId, decision.optionId);
      }, 50);
    }
  }

  private handleMissingFinish(_turnId: number): void {
    this._status = 'ready';
    const ctx = { conversationId: this.conversation_id, agentType: 'acp' as const };
    this.dispatcher.emit('agent:finish', {
      ...ctx,
      message: {
        type: 'finish',
        conversation_id: this.conversation_id,
        msg_id: `finish_fallback_${Date.now()}`,
        data: null,
      },
    });
    this.dispatcher.emit('turn:completed', { ...ctx, backend: this.config.backend });
  }

  /**
   * Wait for session to reach 'active' state (or fail).
   * Used when sendMessage auto-starts a session that wasn't warmed up.
   */
  private waitForSessionReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Session failed to start within timeout'));
      }, 60_000);

      const check = () => {
        const s = this.session.status;
        switch (s) {
          case 'active':
          case 'prompting':
            clearTimeout(timeout);
            resolve();
            break;
          case 'error':
            clearTimeout(timeout);
            reject(new Error('Session entered error state during startup'));
            break;
          default:
            setTimeout(check, 100);
        }
      };
      check();
    });
  }
}
