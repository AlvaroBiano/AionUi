/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchAgentManager.ts

import fs from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TMessage, IMessageText } from '@/common/chat/chatLib';
import { transformMessage } from '@/common/chat/chatLib';
import type { TProviderWithModel, TChatConversation } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { addMessage, addOrUpdateMessage } from '@process/utils/message';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import type { IProvider } from '@/common/config/storage';
import { ProcessConfig } from '@process/utils/initStorage';
import BaseAgentManager from '../BaseAgentManager';
import { IpcAgentEventEmitter } from '../IpcAgentEventEmitter';
import type { IWorkerTaskManager } from '../IWorkerTaskManager';
import type { IAgentManager } from '../IAgentManager';
import { DispatchMcpServer } from './DispatchMcpServer';
import type { DispatchToolHandler } from './DispatchMcpServer';
import { DispatchSessionTracker } from './DispatchSessionTracker';
import { DispatchNotifier } from './DispatchNotifier';
import { DispatchResourceGuard } from './DispatchResourceGuard';
import { buildDispatchSystemPrompt } from './dispatchPrompt';
import type {
  ChildTaskInfo,
  StartChildTaskParams,
  ReadTranscriptOptions,
  TranscriptResult,
  TemporaryTeammateConfig,
  GroupChatMessage,
  SendMessageToChildParams,
  ListSessionsParams,
} from './dispatchTypes';
import { DEFAULT_CONCURRENT_CHILDREN } from './dispatchTypes';

type DispatchAgentData = {
  workspace: string;
  conversation_id: string;
  model: TProviderWithModel;
  presetRules?: string;
  yoloMode?: boolean;
  dispatchSessionType?: string;
  dispatcherName?: string;
};

/**
 * Dispatch agent manager that orchestrates multi-agent collaboration.
 *
 * Public type is 'dispatch', but internally reuses 'gemini' worker (workerType).
 * Injects dispatch system prompt and MCP tools (start_task, read_transcript,
 * list_sessions, send_message).
 */
export class DispatchAgentManager extends BaseAgentManager<
  {
    workspace: string;
    model: TProviderWithModel;
    presetRules?: string;
    yoloMode?: boolean;
    mcpServers?: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  },
  string
> {
  workspace: string;
  conversation_id: string;

  private readonly model: TProviderWithModel;
  private readonly dispatcherName: string;
  private readonly tracker: DispatchSessionTracker;
  private notifier!: DispatchNotifier;
  private resourceGuard!: DispatchResourceGuard;
  private readonly mcpServer: DispatchMcpServer;
  private readonly temporaryTeammates = new Map<string, TemporaryTeammateConfig>();

  /** Tool call phase state machine for message filtering */
  private isToolCallPhase = false;

  /** F-5.2: Track children whose transcripts have been read (for lazy cleanup) */
  private readonly transcriptReadChildren = new Set<string>();

  /** F-5.2: Guard against concurrent resume of the same child */
  private readonly resumingChildren = new Map<string, Promise<void>>();

  /** Track children with active polling to prevent duplicate pollers */
  private readonly activePollers = new Set<string>();

  /** Reference to the shared WorkerTaskManager (set after construction) */
  private taskManager: IWorkerTaskManager | undefined;
  private conversationRepo: IConversationRepository | undefined;

  private bootstrap: Promise<void>;

  constructor(data: DispatchAgentData) {
    // type='dispatch' (public), workerType='gemini' (reuse gemini.js worker)
    super('dispatch', { ...data, model: data.model }, new IpcAgentEventEmitter(), true, 'gemini');
    this.workspace = data.workspace;
    this.conversation_id = data.conversation_id;
    this.model = data.model;
    this.dispatcherName = data.dispatcherName ?? 'Dispatcher';

    this.tracker = new DispatchSessionTracker();
    // notifier and resourceGuard need repo, will be set via setDependencies()

    // MCP server: handles tool calls from Gemini CLI
    const toolHandler: DispatchToolHandler = {
      parentSessionId: this.conversation_id,
      startChildSession: this.startChildSession.bind(this),
      readTranscript: this.readTranscript.bind(this),
      listChildren: this.listChildren.bind(this),
      sendMessageToChild: this.sendMessageToChild.bind(this),
      listSessions: this.listSessions.bind(this),
    };
    this.mcpServer = new DispatchMcpServer(toolHandler);

    // Bootstrap is deferred until dependencies are set
    this.bootstrap = Promise.resolve();
  }

  /**
   * Set external dependencies. Must be called before sendMessage.
   * Separated from constructor to avoid circular dependency with WorkerTaskManager.
   */
  setDependencies(taskManager: IWorkerTaskManager, conversationRepo: IConversationRepository): void {
    this.taskManager = taskManager;
    this.conversationRepo = conversationRepo;
    this.notifier = new DispatchNotifier(taskManager, this.tracker, conversationRepo);
    this.resourceGuard = new DispatchResourceGuard(taskManager, this.tracker);
    this.bootstrap = this.createBootstrap();
    this.bootstrap.catch((err) => {
      mainError('[DispatchAgentManager]', 'Bootstrap failed', err);
    });
  }

  /**
   * Initialize worker with dispatch config.
   */
  private async createBootstrap(): Promise<void> {
    // Phase 2b: Read leader profile and seed messages from conversation extra
    let leaderProfile: string | undefined;
    let customInstructions: string | undefined;
    let maxConcurrentChildren: number | undefined;
    if (this.conversationRepo) {
      try {
        const conv = await this.conversationRepo.getConversation(this.conversation_id);
        if (conv) {
          const extra = conv.extra as {
            leaderPresetRules?: string;
            seedMessages?: string;
            maxConcurrentChildren?: number;
          };
          leaderProfile = extra.leaderPresetRules;
          customInstructions = extra.seedMessages;
          maxConcurrentChildren = extra.maxConcurrentChildren;
        }
      } catch (err) {
        mainWarn('[DispatchAgentManager]', 'Failed to read extra for leader/seed', err);
      }
    }

    // F-6.2: Apply configurable concurrent limit from conversation extra
    if (typeof maxConcurrentChildren === 'number') {
      this.resourceGuard.setMaxConcurrent(maxConcurrentChildren);
    }

    // F-4.2: Build available model list for orchestrator prompt
    const availableModels = await this.getAvailableModels();

    const systemPrompt = buildDispatchSystemPrompt(this.dispatcherName, {
      leaderProfile,
      customInstructions,
      availableModels,
      workspace: this.workspace,
      maxConcurrentChildren: maxConcurrentChildren ?? DEFAULT_CONCURRENT_CHILDREN,
    });
    const combinedRules = systemPrompt;

    // Build MCP server config for Gemini CLI
    const mcpConfig = this.mcpServer.getMcpServerConfig();

    await this.start({
      workspace: this.workspace,
      model: this.model,
      presetRules: combinedRules,
      yoloMode: true, // Dispatch agents auto-approve tool calls
      mcpServers: {
        'aionui-dispatch': mcpConfig,
      },
    });

    // Restore parent-child mappings from DB (handles app restart)
    if (this.conversationRepo) {
      await this.tracker.restoreFromDb(this.conversationRepo, this.conversation_id);
    }

    // Restore any pending notifications from DB
    if (this.notifier) {
      await this.notifier.restoreFromDb(this.conversation_id);
    }

    // F-5.3: Inject resume context if children exist from a previous session
    const restoredChildren = this.tracker.getChildren(this.conversation_id);
    if (restoredChildren.length > 0 && this.notifier) {
      this.notifier.injectResumeContext(this.conversation_id, restoredChildren);
    }
  }

  /**
   * Override sendMessage to inject pending notifications before user message.
   */
  async sendMessage(data: { input: string; msg_id: string; files?: string[]; isSystemNotification?: boolean }) {
    // Save user message to DB
    if (!data.isSystemNotification) {
      const message: TMessage = {
        id: data.msg_id,
        type: 'text',
        position: 'right',
        conversation_id: this.conversation_id,
        content: { content: data.input },
      };
      addMessage(this.conversation_id, message);
    }

    this.status = 'pending';

    await this.bootstrap.catch((e) => {
      this.status = 'failed';
      throw e;
    });

    // Check for pending notifications (cold parent wakeup)
    if (!data.isSystemNotification && this.notifier) {
      const pending = this.notifier.flushPending(this.conversation_id);
      if (pending) {
        mainLog('[DispatchAgentManager]', `Injecting ${pending.split('\n').length} pending notification(s)`);
        // Inject as system notification first (separate turn)
        await super.sendMessage({
          input: `[System Notification]\n${pending}`,
          msg_id: uuid(),
        });
        // Only clear after successful delivery
        this.notifier.confirmFlush(this.conversation_id);
      }
    }

    // Then send the actual message
    return super.sendMessage(data);
  }

  /**
   * Initialize event listeners for worker messages.
   */
  protected init(): void {
    super.init();

    this.on('gemini.message', (data: Record<string, unknown>) => {
      // Status tracking
      if (data.type === 'start') {
        this.status = 'running';
      }
      if (data.type === 'finish') {
        this.status = 'finished';
        this.isToolCallPhase = false;
      }

      // Tool call phase state machine for message filtering
      if (data.type === 'tool_group') {
        this.isToolCallPhase = true;
      }
      if (data.type === 'content' && this.isToolCallPhase) {
        this.isToolCallPhase = false;
      }

      // Handle MCP tool call IPC messages from MCP server script
      if (data.type === 'tool_call') {
        void this.handleMcpToolCall(data);
        return;
      }

      // Build proper IResponseMessage
      const responseMsg: IResponseMessage = {
        type: String(data.type ?? ''),
        data: data.data ?? data,
        msg_id: String((data.data as Record<string, unknown>)?.msg_id ?? data.msg_id ?? uuid()),
        conversation_id: this.conversation_id,
      };

      // Persist non-transient messages
      const skipTransformTypes = ['thought', 'finished', 'start', 'finish', 'tool_call'];
      if (!skipTransformTypes.includes(responseMsg.type)) {
        const tMessage = transformMessage(responseMsg);
        if (tMessage) {
          addOrUpdateMessage(this.conversation_id, tMessage, 'gemini');
        }
      }

      // Emit to group chat stream
      ipcBridge.geminiConversation.responseStream.emit(responseMsg);
    });
  }

  /**
   * Handle MCP tool call forwarded from the MCP server script via IPC.
   */
  private async handleMcpToolCall(data: Record<string, unknown>): Promise<void> {
    const callId = data.id as string;
    const tool = data.tool as string;
    const args = (data.args ?? {}) as Record<string, unknown>;

    try {
      const result = await this.mcpServer.handleToolCall(tool, args);
      // Send result back to MCP server script
      this.postMessage('tool_result', { type: 'tool_result', id: callId, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage('tool_result', { type: 'tool_result', id: callId, error: msg });
    }
  }

  // ==================== Tool Handler Implementations ====================

  /**
   * start_task implementation: create child conversation and agent.
   */
  private async startChildSession(params: StartChildTaskParams): Promise<string> {
    if (!this.taskManager || !this.conversationRepo) {
      throw new Error('Dependencies not set. Call setDependencies() first.');
    }

    // Check concurrency limit (F-5.2: pass transcriptReadChildren for lazy cleanup)
    const limitError = this.resourceGuard.checkConcurrencyLimit(this.conversation_id, this.transcriptReadChildren);
    if (limitError) {
      throw new Error(limitError);
    }

    // Store teammate config if provided
    if (params.teammate) {
      this.temporaryTeammates.set(params.teammate.id, params.teammate);
    }

    // F-4.2: Resolve model override
    let childModel = this.model;
    let childModelName: string | undefined;
    if (params.model) {
      try {
        const providers = ((await ProcessConfig.get('model.config')) || []) as IProvider[];
        const provider = providers.find((p) => p.id === params.model!.providerId);
        if (
          provider &&
          provider.enabled !== false &&
          provider.model.includes(params.model.modelName) &&
          provider.modelEnabled?.[params.model.modelName] !== false
        ) {
          childModel = { ...provider, useModel: params.model.modelName };
          childModelName = params.model.modelName;
          mainLog('[DispatchAgentManager]', `Model override: ${params.model.providerId}::${params.model.modelName}`);
        } else {
          mainWarn(
            '[DispatchAgentManager]',
            `Model override not found: ${params.model.providerId}::${params.model.modelName}, fallback to default`
          );
        }
      } catch (err) {
        mainWarn('[DispatchAgentManager]', 'Failed to resolve model override, fallback to default', err);
      }
    }

    // F-6.1: Workspace resolution and validation
    let childWorkspace = this.workspace;
    if (params.workspace) {
      const resolved = path.resolve(params.workspace);
      const parentResolved = path.resolve(this.workspace);
      // Security: workspace must be within parent workspace to prevent path traversal
      if (!resolved.startsWith(parentResolved + path.sep) && resolved !== parentResolved) {
        throw new Error(`Workspace must be within parent workspace: ${this.workspace}`);
      }
      try {
        const stat = await fs.promises.stat(resolved);
        if (!stat.isDirectory()) {
          throw new Error(`Workspace is not a directory: ${params.workspace}`);
        }
        childWorkspace = resolved;
        mainLog('[DispatchAgentManager]', `Workspace override: ${resolved}`);
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Workspace directory does not exist: ${params.workspace}`, { cause: err });
        }
        throw err;
      }
    }

    // Create child conversation in DB.
    const childId = uuid(16);
    const childConversation: TChatConversation = {
      id: childId,
      name: params.title,
      type: 'gemini',
      createTime: Date.now(),
      modifyTime: Date.now(),
      model: childModel,
      extra: {
        workspace: childWorkspace,
        dispatchSessionType: 'dispatch_child' as const,
        parentSessionId: this.conversation_id,
        dispatchTitle: params.title,
        presetRules: params.teammate?.presetRules,
        teammateConfig: params.teammate ? { name: params.teammate.name, avatar: params.teammate.avatar } : undefined,
        yoloMode: true,
        childModelName,
      },
    };
    await this.conversationRepo.createConversation(childConversation);

    // Register in tracker
    const childInfo: ChildTaskInfo = {
      sessionId: childId,
      title: params.title,
      status: 'pending',
      teammateName: params.teammate?.name,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      workspace: childWorkspace,
    };
    this.tracker.registerChild(this.conversation_id, childInfo);

    // Build and start child agent via AgentFactory
    const childTask = await this.taskManager.getOrBuildTask(childId, {
      yoloMode: true,
      dispatchSessionType: 'dispatch_child',
      parentSessionId: this.conversation_id,
    });

    // Listen for child completion
    this.listenForChildCompletion(childId, childTask);

    // Send initial prompt to child
    mainLog('[DispatchAgentManager]', `Starting child task: ${childId} (${params.title})`);
    this.tracker.updateChildStatus(childId, 'running');

    void childTask
      .sendMessage({
        input: params.prompt,
        msg_id: uuid(),
      })
      .catch((err: unknown) => {
        mainError('[DispatchAgentManager]', `Child task failed to start: ${childId}`, err);
        this.tracker.updateChildStatus(childId, 'failed');
        void this.notifier.handleChildCompletion(childId, 'failed');
      });

    // Emit child_started event for UI
    this.emitGroupChatEvent({
      sourceSessionId: childId,
      sourceRole: 'child',
      displayName: params.teammate?.name ?? 'Agent',
      content: '',
      messageType: 'task_started',
      timestamp: Date.now(),
      childTaskId: childId,
      avatar: params.teammate?.avatar,
    });

    return childId;
  }

  /**
   * Listen for a child agent's completion event.
   * F-5.6: Adaptive polling — 500ms for first 30s, 2s for 30s-5min, 5s beyond 5min.
   * Uses setTimeout chain instead of setInterval for adaptive timing.
   * Maximum lifetime: 30 minutes.
   */
  private listenForChildCompletion(childId: string, _childTask: IAgentManager): void {
    // Prevent duplicate pollers for the same child
    if (this.activePollers.has(childId)) return;
    this.activePollers.add(childId);

    const startTime = Date.now();
    const maxLifetimeMs = 30 * 60 * 1000; // 30 minutes

    const getPollingInterval = (elapsedMs: number): number => {
      if (elapsedMs < 30_000) return 500;
      if (elapsedMs < 5 * 60_000) return 2000;
      return 5000;
    };

    const stopPolling = (): void => {
      this.activePollers.delete(childId);
    };

    const poll = (): void => {
      const elapsedMs = Date.now() - startTime;

      // Safety: stop after max lifetime, mark child as timed out
      if (elapsedMs >= maxLifetimeMs) {
        mainWarn('[DispatchAgentManager]', `Polling max lifetime reached for child: ${childId}, marking idle`);
        this.tracker.updateChildStatus(childId, 'idle');
        stopPolling();
        return;
      }

      // F-2.5: If child was cancelled, stop polling
      const childInfo = this.tracker.getChildInfo(childId);
      if (childInfo?.status === 'cancelled') {
        stopPolling();
        return;
      }

      const task = this.taskManager?.getTask(childId);
      if (!task) {
        stopPolling();
        return;
      }
      if (task.status === 'finished' || task.status === 'idle') {
        this.tracker.updateChildStatus(childId, 'idle');
        void this.notifier.handleChildCompletion(childId, 'completed');
        this.emitGroupChatEvent({
          sourceSessionId: childId,
          sourceRole: 'child',
          displayName: this.tracker.getChildInfo(childId)?.teammateName ?? 'Agent',
          content: '',
          messageType: 'task_completed',
          timestamp: Date.now(),
          childTaskId: childId,
        });
        stopPolling();
        return;
      } else if (task.status === 'failed') {
        this.tracker.updateChildStatus(childId, 'failed');
        void this.notifier.handleChildCompletion(childId, 'failed');
        this.emitGroupChatEvent({
          sourceSessionId: childId,
          sourceRole: 'child',
          displayName: this.tracker.getChildInfo(childId)?.teammateName ?? 'Agent',
          content: '',
          messageType: 'task_failed',
          timestamp: Date.now(),
          childTaskId: childId,
        });
        stopPolling();
        return;
      }

      // Schedule next poll with adaptive interval
      setTimeout(poll, getPollingInterval(elapsedMs));
    };

    // Start first poll
    setTimeout(poll, getPollingInterval(0));
  }

  /**
   * read_transcript implementation: read child conversation messages.
   */
  private async readTranscript(options: ReadTranscriptOptions): Promise<TranscriptResult> {
    if (!this.taskManager || !this.conversationRepo) {
      throw new Error('Dependencies not set');
    }

    const childInfo = this.tracker.getChildInfo(options.sessionId);
    if (!childInfo) {
      return {
        sessionId: options.sessionId,
        title: 'Unknown',
        status: 'failed',
        transcript: `Error: No child task found with session_id "${options.sessionId}"`,
        isRunning: false,
      };
    }

    // Wait for completion if still running
    const maxWait = (options.maxWaitSeconds ?? 30) * 1000;
    if (childInfo.status === 'running' || childInfo.status === 'pending') {
      if (maxWait > 0) {
        const completed = await this.waitForChildIdle(options.sessionId, maxWait);
        if (!completed) {
          // Still running after timeout, return progress summary
          if (options.format !== 'full') {
            const timeAgo = this.formatTimeAgo(childInfo.lastActivityAt);
            const turnCount = await this.getMessageCount(options.sessionId);
            return {
              sessionId: options.sessionId,
              title: childInfo.title,
              status: childInfo.status,
              transcript: `${childInfo.title}: ${childInfo.status}, ${turnCount} turns completed, last activity ${timeAgo}`,
              isRunning: true,
            };
          }
        }
      } else if (options.format !== 'full') {
        // Immediate return with progress summary
        const timeAgo = this.formatTimeAgo(childInfo.lastActivityAt);
        const turnCount = await this.getMessageCount(options.sessionId);
        return {
          sessionId: options.sessionId,
          title: childInfo.title,
          status: childInfo.status,
          transcript: `${childInfo.title}: ${childInfo.status}, ${turnCount} turns completed, last activity ${timeAgo}`,
          isRunning: true,
        };
      }
    }

    // Read messages from DB
    const limit = options.limit ?? 20;
    const messages = await this.conversationRepo.getMessages(options.sessionId, 0, limit);
    const transcript = this.formatTranscript(messages.data);

    const currentInfo = this.tracker.getChildInfo(options.sessionId);
    const isRunning = currentInfo?.status === 'running' || currentInfo?.status === 'pending';

    // F-5.2: Track that this child's transcript has been read (for lazy cleanup).
    // No longer auto-release the child worker — idle children remain resumable.
    if (!isRunning) {
      this.transcriptReadChildren.add(options.sessionId);
    }

    return {
      sessionId: options.sessionId,
      title: childInfo.title,
      status: currentInfo?.status ?? 'finished',
      transcript: transcript || '[No messages yet]',
      isRunning,
    };
  }

  /**
   * Wait for a child task to reach idle/finished/failed/cancelled state.
   */
  private waitForChildIdle(childId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        const info = this.tracker.getChildInfo(childId);
        if (
          !info ||
          info.status === 'idle' ||
          info.status === 'finished' ||
          info.status === 'failed' ||
          info.status === 'cancelled'
        ) {
          resolve(true);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 1000);
      };
      check();
    });
  }

  /**
   * List all children for this dispatcher.
   */
  private async listChildren(): Promise<ChildTaskInfo[]> {
    return this.tracker.getChildren(this.conversation_id);
  }

  /**
   * F-2.2: list_sessions implementation (replaces list_children for MCP tool).
   * Returns formatted session list sorted by recency.
   */
  private async listSessions(params: ListSessionsParams): Promise<string> {
    const children = this.tracker.getChildren(this.conversation_id);
    if (children.length === 0) {
      return 'No other sessions.';
    }

    const limit = params.limit ?? 20;
    const sorted = [...children].toSorted((a, b) => b.lastActivityAt - a.lastActivityAt);
    const shown = sorted.slice(0, limit);

    const statusLabel = (status: string): string => {
      if (status === 'running' || status === 'pending') return 'running';
      if (status === 'cancelled') return 'cancelled';
      if (status === 'failed') return 'failed';
      return 'idle';
    };

    const lines = shown.map((c) => {
      const workspaceLabel = c.workspace ? `, workspace: ${c.workspace}` : '';
      return `  - ${c.sessionId} "${c.title}" (${statusLabel(c.status)}, is_child: true${workspaceLabel})`;
    });

    const header =
      children.length > shown.length
        ? `Sessions (${shown.length} of ${children.length}, most recent first -- pass a higher limit to see more):`
        : `Sessions (${children.length}):`;

    return header + '\n' + lines.join('\n');
  }

  /**
   * F-2.1: send_message implementation.
   * Sends a follow-up message to a running child task.
   * Phase 2a: only supports running/pending children.
   */
  private async sendMessageToChild(params: SendMessageToChildParams): Promise<string> {
    if (!this.taskManager) throw new Error('Dependencies not set');

    const childInfo = this.tracker.getChildInfo(params.sessionId);
    if (!childInfo) {
      throw new Error(`Session "${params.sessionId}" not found. Use list_sessions to see available sessions.`);
    }

    // Terminal states cannot receive messages
    if (childInfo.status === 'cancelled' || childInfo.status === 'failed') {
      throw new Error(`Session "${childInfo.title}" has been ${childInfo.status}. Start a new task instead.`);
    }

    // F-5.2: Idle/finished children can be resumed by re-creating worker
    let task = this.taskManager.getTask(params.sessionId);

    if (!task || childInfo.status === 'idle' || childInfo.status === 'finished') {
      // Wait if this child is already being resumed by another concurrent call
      const inFlight = this.resumingChildren.get(params.sessionId);
      if (inFlight) {
        await inFlight;
        task = this.taskManager.getTask(params.sessionId);
      } else {
        // Re-create worker for the idle child
        const resumePromise = this.resumeChild(params.sessionId);
        this.resumingChildren.set(params.sessionId, resumePromise);
        try {
          await resumePromise;
        } finally {
          this.resumingChildren.delete(params.sessionId);
        }
        task = this.taskManager.getTask(params.sessionId);
      }
    }

    if (!task) {
      throw new Error(`Child task process not found for "${params.sessionId}"`);
    }

    mainLog('[DispatchAgentManager]', `Sending message to child: ${params.sessionId} (status: ${childInfo.status})`);
    this.tracker.updateChildStatus(params.sessionId, 'running');

    await task.sendMessage({
      input: params.message,
      msg_id: uuid(),
    });

    return `Message sent to "${childInfo.title}". Use read_transcript to see the response.`;
  }

  /**
   * F-5.2: Re-create a worker for an idle/finished child session.
   * Reads config from conversation DB and rebuilds the agent.
   */
  private async resumeChild(childId: string): Promise<void> {
    if (!this.taskManager) throw new Error('Dependencies not set');

    mainLog('[DispatchAgentManager]', `Resuming idle child: ${childId}`);

    const childTask = await this.taskManager.getOrBuildTask(childId, {
      yoloMode: true,
      dispatchSessionType: 'dispatch_child',
      parentSessionId: this.conversation_id,
    });

    // Re-attach completion listener
    this.listenForChildCompletion(childId, childTask);

    // Clear from transcript-read set since child is being resumed
    this.transcriptReadChildren.delete(childId);
  }

  /**
   * F-2.5: Cancel a running child task.
   * Called from dispatchBridge when user clicks cancel in UI.
   * Kills worker, updates tracker, notifies parent, emits UI event.
   */
  async cancelChild(childSessionId: string): Promise<void> {
    const childInfo = this.tracker.getChildInfo(childSessionId);
    if (!childInfo) {
      throw new Error(`Child session not found: ${childSessionId}`);
    }

    if (childInfo.status === 'cancelled' || childInfo.status === 'finished' || childInfo.status === 'idle') {
      // Already done, nothing to cancel
      return;
    }

    mainLog('[DispatchAgentManager]', `Cancelling child: ${childSessionId}, previousStatus=${childInfo.status}`);

    // Capture info before kill (kill removes task from taskList)
    const displayName = childInfo.teammateName ?? 'Agent';

    // 1. Kill the worker process FIRST (ensures polling loop exits cleanly)
    if (this.taskManager) {
      this.taskManager.kill(childSessionId);
    }

    // 2. Update tracker status AFTER kill
    this.tracker.updateChildStatus(childSessionId, 'cancelled');

    // 3. Notify parent dispatcher (uses extended signature with 'cancelled')
    if (this.notifier) {
      try {
        await this.notifier.handleChildCompletion(childSessionId, 'cancelled');
      } catch (err) {
        mainError('[DispatchAgentManager]', `Failed to notify parent about cancel: ${childSessionId}`, err);
      }
    }

    // 4. Emit UI event (emitGroupChatEvent now also persists to DB per CF-1 fix)
    this.emitGroupChatEvent({
      sourceSessionId: childSessionId,
      sourceRole: 'child',
      displayName,
      content: '',
      messageType: 'task_cancelled',
      timestamp: Date.now(),
      childTaskId: childSessionId,
    });

    mainLog('[DispatchAgentManager]', `cancelChild success: childId=${childSessionId}, workerKilled=true`);
  }

  // ==================== Helper Methods ====================

  private formatTranscript(messages: TMessage[]): string {
    return messages
      .filter((m): m is IMessageText => m.type === 'text')
      .map((m) => {
        const role = m.position === 'right' ? '[user]' : '[assistant]';
        return `${role} ${m.content?.content ?? ''}`;
      })
      .join('\n');
  }

  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  private async getMessageCount(sessionId: string): Promise<number> {
    if (!this.conversationRepo) return 0;
    try {
      const result = await this.conversationRepo.getMessages(sessionId, 0, 1);
      return result.total;
    } catch (err) {
      mainWarn('[DispatchAgentManager]', `Failed to get message count for ${sessionId}`, err);
      return 0;
    }
  }

  /**
   * F-4.2: Get available models for orchestrator prompt injection.
   */
  private async getAvailableModels(): Promise<Array<{ providerId: string; models: string[] }>> {
    try {
      const providers = ((await ProcessConfig.get('model.config')) || []) as IProvider[];
      return providers
        .filter((p) => p.enabled !== false)
        .map((p) => ({
          providerId: p.id,
          models: (Array.isArray(p.model) ? p.model : []).filter((m) => p.modelEnabled?.[m] !== false),
        }))
        .filter((p) => p.models.length > 0);
    } catch (err) {
      mainWarn('[DispatchAgentManager]', 'Failed to read model config for prompt', err);
      return [];
    }
  }

  private emitGroupChatEvent(message: GroupChatMessage): void {
    const msgId = uuid();

    // CF-1 Fix Part A: Persist dispatch event to DB before emitting to IPC.
    // For task_progress, use addOrUpdateMessage (upsert by childTaskId) to
    // avoid DB bloat -- same child's progress should overwrite, not accumulate.
    try {
      const dbMessage: TMessage = {
        id:
          message.messageType === 'task_progress' && message.childTaskId
            ? `dispatch-progress-${message.childTaskId}`
            : msgId,
        type: 'dispatch_event' as TMessage['type'],
        position: 'left',
        conversation_id: this.conversation_id,
        content: { ...message } as unknown as TMessage['content'],
        createdAt: message.timestamp,
      };
      if (message.messageType === 'task_progress' && message.childTaskId) {
        addOrUpdateMessage(this.conversation_id, dbMessage, 'dispatch');
      } else {
        addMessage(this.conversation_id, dbMessage);
      }
    } catch (err) {
      mainError('[DispatchAgentManager]', 'Failed to persist dispatch event to DB', err);
    }

    // Emit to the group chat stream (dispatch-specific channel)
    ipcBridge.geminiConversation.responseStream.emit({
      type: 'dispatch_event',
      conversation_id: this.conversation_id,
      msg_id: msgId,
      data: message,
    } as IResponseMessage);
  }

  /**
   * Clean up all resources when the dispatcher is disposed.
   */
  dispose(): void {
    this.mcpServer.dispose();
    if (this.resourceGuard) {
      this.resourceGuard.cascadeKill(this.conversation_id);
    } else {
      // No resourceGuard means dependencies weren't set, just kill self
      this.kill();
    }
  }

  /**
   * Get the tracker instance (for external access by bridge).
   */
  getTracker(): DispatchSessionTracker {
    return this.tracker;
  }

  /**
   * Get the notifier instance (for external access by bridge).
   */
  getNotifier(): DispatchNotifier {
    return this.notifier;
  }

  /**
   * F-6.2: Update the concurrent task limit at runtime.
   */
  setMaxConcurrent(limit: number): void {
    this.resourceGuard.setMaxConcurrent(limit);
  }
}
