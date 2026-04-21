// src/process/acp/runtime/AcpRuntime.ts

import type { IConfirmation } from '@/common/chat/chatLib';
import type { AcpPermissionOption } from '@/common/types/acpTypes';
import type { CronMessageMeta } from '@/common/chat/chatLib';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
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
import type { AgentKillReason, IAgentManager } from '@process/task/IAgentManager';
import { createBackendPolicy, type BackendPolicy } from './BackendPolicy';
import { InputPipeline, type InjectionContext } from './InputPipeline';
import { OutputPipeline } from './OutputPipeline';
import { PermissionGate, type PermissionGateCallbacks } from './PermissionGate';
import { TurnTracker } from './TurnTracker';
import { UserMessagePersister, type PersisterDeps } from './UserMessagePersister';

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

  // Stream output handler (AcpRuntime emits TMessages here)
  onStreamEvent: (message: TMessage) => void;
  // Signal output handler (status, error, auth, etc.)
  onSignalEvent: (event: IResponseMessage) => void;
};

// ─── AcpRuntime ─────────────────────────────────────────────────

/**
 * AcpRuntime: the business layer for a single ACP conversation.
 *
 * Implements IAgentManager so it can be registered in WorkerTaskManager.
 * Composes: AcpSession, InputPipeline, OutputPipeline, TurnTracker,
 * BackendPolicy, PermissionGate, UserMessagePersister.
 *
 * Owns all business logic that was previously in AcpAgentManager (1635 lines).
 * AcpSession is the pure protocol layer below; AcpRuntime adds:
 * - Input preprocessing (first message injection, @file resolution)
 * - Output post-processing (SDK→TMessage translation, think tags, tool call merge)
 * - Turn tracking with finish fallback
 * - Per-backend behavioral differences
 * - Permission management (dynamic YOLO, team auto-approve, confirmation lifecycle)
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

  private readonly config: AcpRuntimeConfig;

  constructor(config: AcpRuntimeConfig) {
    this.config = config;
    this.conversation_id = config.conversation_id;
    this.workspace = config.workspace;

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

    // 1. Persist user message immediately (UI sees it before agent init)
    this.persister.persist({
      msgId: data.msg_id ?? '',
      content: data.content,
      conversationId: this.conversation_id,
      cronMeta: data.cronMeta,
      hidden: data.hidden,
      silent: data.silent,
    });

    // 2. Resolve injection context on first message
    let injection: InjectionContext | undefined;
    if (this._isFirstMessage && this.config.resolveInjectionContext) {
      try {
        injection = await this.config.resolveInjectionContext();
      } catch {
        // Best effort — send without injection
      }
    }

    // 3. Input pipeline: strip marker → first message inject → @file resolve
    const content = this.inputPipeline.process(data.content, data.files, injection);
    if (this._isFirstMessage) {
      this._isFirstMessage = false;
    }

    // 4. Backend policy: inject model switch notice, re-assert model override
    const processed = this.backendPolicy.beforePrompt(content);

    // 5. Turn tracking
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
  }

  setMode(modeId: string): void {
    const result = this.backendPolicy.interceptSetMode(modeId);
    if (result.intercepted) {
      // Backend doesn't support set_mode — update local state only
      const isYolo = modeId === this.backendPolicy.getYoloModeId();
      this.permissionGate.setYoloMode(isYolo);
      this.session.setAutoApproveAll(isYolo);
      return;
    }

    this.session.setMode(modeId);
    const isYolo = modeId === this.backendPolicy.getYoloModeId();
    this.permissionGate.setYoloMode(isYolo);
    this.session.setAutoApproveAll(isYolo);
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

  // ─── Session callbacks ────────────────────────────────────────

  private buildSessionCallbacks(): SessionCallbacks {
    return {
      onNotification: (notification: SessionNotification) => {
        this.handleNotification(notification);
      },

      onTurnEnd: () => {
        this.outputPipeline.onTurnEnd();
      },

      onSessionId: (_sessionId: string) => {
        // TODO: PersistenceSubscriber (Phase 3)
      },

      onStatusChange: (status: AgentStatus) => {
        // AcpSession already maps 7-state → 4-state and deduplicates.
        this._status = status;
      },

      onConfigUpdate: (_config) => {
        // TODO: PersistenceSubscriber (Phase 3)
      },

      onModelUpdate: (model) => {
        this.backendPolicy.onModelChanged(model.currentModelId ?? '', null);
        // TODO: PersistenceSubscriber (Phase 3)
      },

      onModeUpdate: (_mode) => {
        // TODO: PersistenceSubscriber (Phase 3)
      },

      onContextUsage: (_usage) => {
        // TODO: PersistenceSubscriber (Phase 3)
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
    // Bootstrap suppression: don't emit stream events until first sendMessage
    if (this._bootstrapping) return;

    this.turnTracker.onActivity();

    // OutputPipeline: translate → think filter → tool call merge
    const messages = this.outputPipeline.process(notification);
    for (const msg of messages) {
      this.config.onStreamEvent(msg);
    }
  }

  private handleSignal(signal: SessionSignal): void {
    this.turnTracker.onActivity();

    switch (signal.type) {
      case 'turn_finished':
        this.turnTracker.markFinished(this.turnTracker.activeTurnId ?? 0);
        this._status = 'ready';
        this.config.onSignalEvent({
          type: 'finish',
          conversation_id: this.conversation_id,
          msg_id: `finish_${Date.now()}`,
          data: null,
        });
        break;

      case 'process_crash':
        this.turnTracker.markFinished(this.turnTracker.activeTurnId ?? 0);
        this._status = 'ready';
        this.config.onSignalEvent({
          type: 'error',
          conversation_id: this.conversation_id,
          msg_id: `error_${Date.now()}`,
          data: this.backendPolicy.enhanceErrorMessage(
            `process exited unexpectedly (code: ${signal.exitCode ?? 'unknown'}, signal: ${signal.signal ?? 'none'})`
          ),
        });
        this.config.onSignalEvent({
          type: 'finish',
          conversation_id: this.conversation_id,
          msg_id: `finish_crash_${Date.now()}`,
          data: { agentCrash: true },
        });
        break;

      case 'error':
        this.config.onSignalEvent({
          type: 'error',
          conversation_id: this.conversation_id,
          msg_id: `error_${Date.now()}`,
          data: this.backendPolicy.enhanceErrorMessage(signal.message),
        });
        break;

      case 'auth_required':
        this.config.onSignalEvent({
          type: 'error',
          conversation_id: this.conversation_id,
          msg_id: `auth_${Date.now()}`,
          data: 'Authentication required',
        });
        break;

      case 'session_expired':
        this.config.onSignalEvent({
          type: 'error',
          conversation_id: this.conversation_id,
          msg_id: `expired_${Date.now()}`,
          data: 'Session expired',
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
      // Auto-approve: resolve immediately in session
      setTimeout(() => {
        this.session.confirmPermission(decision.callId, decision.optionId);
      }, 50);
    }
    // 'needs_ui': PermissionGate already stored the IConfirmation + notified renderer
  }

  private handleMissingFinish(_turnId: number): void {
    this._status = 'ready';
    this.config.onSignalEvent({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: `finish_fallback_${Date.now()}`,
      data: null,
    });
  }
}
