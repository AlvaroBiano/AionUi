/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateApiToken } from '../middleware/apiAuthMiddleware';
import { apiRateLimiter } from '../middleware/security';
import { ConversationService } from '@process/services/conversationService';
import WorkerManage from '@process/WorkerManage';
import { getDatabase } from '@process/database';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { formatStatusLastMessage, getConversationStatusSnapshot } from '@process/services/ConversationTurnCompletionService';
import { ipcBridge } from '@/common';
import type { TProviderWithModel } from '@/common/storage';
import { uuid } from '@/common/utils';
import { buildConversationTitleFromMessage } from '@/common/utils/conversationTitle';

const router = Router();
const VALID_CONVERSATION_TYPES = ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot'] as const;
type ConversationType = (typeof VALID_CONVERSATION_TYPES)[number];
type ConversationStatusValue = 'pending' | 'running' | 'finished';
type ConversationRuntimeState = 'ai_generating' | 'ai_waiting_input' | 'ai_waiting_confirmation' | 'initializing' | 'stopped' | 'error' | 'unknown';
const VALID_ACP_BACKENDS = ['claude', 'gemini', 'qwen', 'iflow', 'codex', 'codebuddy', 'droid', 'goose', 'auggie', 'kimi', 'opencode', 'copilot', 'qoder', 'vibe', 'custom'] as const;
const ACP_BACKEND_SET = new Set<string>(VALID_ACP_BACKENDS);
type SimulationAction = 'create' | 'message' | 'status' | 'stop' | 'messages';
const SIMULATION_ACTIONS: SimulationAction[] = ['create', 'message', 'status', 'stop', 'messages'];
const STOP_DISPATCH_TIMEOUT_MS = 15000;
const STOP_VERIFY_TIMEOUT_MS = 20000;
const STOP_VERIFY_INTERVAL_MS = 250;

// Apply middleware to all routes
router.use(validateApiToken);
router.use(apiRateLimiter);

const escapeSingleQuoteString = (value: string): string => value.replace(/'/g, "''");

const parseOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parseOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
};

const getFallbackConversationModel = (): TProviderWithModel =>
  ({
    id: 'default-provider',
    platform: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '***',
    useModel: 'gpt-4o-mini',
  }) as TProviderWithModel;

const parseSessionIdQuery = (req: Request): string | undefined => parseOptionalString(req.query?.sessionId);

type IConversationStatusInput = {
  status?: ConversationStatusValue | undefined;
};

type IMessageLike = {
  type?: string;
  status?: string;
  position?: string;
  content?: unknown;
};

const isErrorMessage = (message: IMessageLike | null): boolean => {
  if (!message) return false;
  if (message.status === 'error') return true;

  if (message.type === 'tips' && message.content && typeof message.content === 'object') {
    const tipsContent = message.content as { type?: string };
    return tipsContent.type === 'error';
  }

  return false;
};

const _deriveConversationRuntimeStatus = (sessionId: string, conversation: IConversationStatusInput, lastMessage: IMessageLike | null) => {
  const task = WorkerManage.getTaskById(sessionId) as
    | {
        status?: ConversationStatusValue;
        getConfirmations?: () => unknown[];
      }
    | undefined;

  const hasTask = !!task;
  const taskStatus = task?.status;
  const isProcessing = cronBusyGuard.isProcessing(sessionId);
  const pendingConfirmations = typeof task?.getConfirmations === 'function' ? task.getConfirmations().length : 0;
  const dbStatus = conversation.status;

  if (isErrorMessage(lastMessage)) {
    return {
      status: 'finished' as ConversationStatusValue,
      state: 'error' as ConversationRuntimeState,
      detail: 'Last response ended with an error',
      canSendMessage: true,
      runtime: { hasTask, taskStatus, isProcessing, pendingConfirmations, dbStatus },
    };
  }

  if (pendingConfirmations > 0) {
    return {
      status: 'running' as ConversationStatusValue,
      state: 'ai_waiting_confirmation' as ConversationRuntimeState,
      detail: 'Waiting for tool confirmation',
      canSendMessage: false,
      runtime: { hasTask, taskStatus, isProcessing, pendingConfirmations, dbStatus },
    };
  }

  if (isProcessing || taskStatus === 'running') {
    return {
      status: 'running' as ConversationStatusValue,
      state: 'ai_generating' as ConversationRuntimeState,
      detail: 'AI is generating response',
      canSendMessage: false,
      runtime: { hasTask, taskStatus, isProcessing, pendingConfirmations, dbStatus },
    };
  }

  if (taskStatus === 'pending') {
    // A pending task with a latest user message usually means request is queued/initializing.
    if (lastMessage?.position === 'right') {
      return {
        status: 'running' as ConversationStatusValue,
        state: 'ai_generating' as ConversationRuntimeState,
        detail: 'AI request accepted and initializing',
        canSendMessage: false,
        runtime: { hasTask, taskStatus, isProcessing, pendingConfirmations, dbStatus },
      };
    }

    return {
      status: 'pending' as ConversationStatusValue,
      state: 'initializing' as ConversationRuntimeState,
      detail: 'Conversation task is initializing',
      canSendMessage: true,
      runtime: { hasTask, taskStatus, isProcessing, pendingConfirmations, dbStatus },
    };
  }

  if (dbStatus === 'finished' && !hasTask) {
    return {
      status: 'finished' as ConversationStatusValue,
      state: 'stopped' as ConversationRuntimeState,
      detail: 'Conversation is stopped',
      canSendMessage: true,
      runtime: { hasTask, taskStatus, isProcessing, pendingConfirmations, dbStatus },
    };
  }

  return {
    status: 'finished' as ConversationStatusValue,
    state: 'ai_waiting_input' as ConversationRuntimeState,
    detail: 'AI is waiting for input',
    canSendMessage: true,
    runtime: { hasTask, taskStatus, isProcessing, pendingConfirmations, dbStatus },
  };
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const invokeStopWithTimeout = async (sessionId: string, timeoutMs: number): Promise<{ success: boolean; msg?: string }> => {
  const stopPromise = ipcBridge.conversation.stop.invoke({ conversation_id: sessionId }) as Promise<{ success: boolean; msg?: string }>;
  const timeoutPromise = new Promise<{ success: false; msg: string }>((resolve) => {
    setTimeout(() => {
      resolve({ success: false, msg: `Stop dispatch timeout after ${timeoutMs}ms` });
    }, timeoutMs);
  });
  return Promise.race([stopPromise, timeoutPromise]);
};

const isStopConfirmed = (resolvedStatus: { runtime: { taskStatus?: ConversationStatusValue; isProcessing?: boolean; pendingConfirmations?: number } }): boolean => {
  const runtime = resolvedStatus.runtime as {
    taskStatus?: ConversationStatusValue;
    isProcessing?: boolean;
    pendingConfirmations?: number;
  };
  return !runtime.isProcessing && (runtime.pendingConfirmations ?? 0) === 0 && runtime.taskStatus !== 'running';
};

const waitForStopConfirmed = async (sessionId: string, timeoutMs: number): Promise<void> => {
  const db = getDatabase();
  const startedAt = Date.now();
  let lastState: ConversationRuntimeState | undefined;

  while (Date.now() - startedAt <= timeoutMs) {
    const convResult = db.getConversation(sessionId);
    if (!convResult.success || !convResult.data) {
      throw new Error('Conversation not found while waiting for stop confirmation');
    }

    const snapshot = getConversationStatusSnapshot(sessionId);
    if (!snapshot) {
      throw new Error(`Conversation snapshot not found: ${sessionId}`);
    }

    const resolvedStatus = snapshot;
    lastState = resolvedStatus.state;

    if (isStopConfirmed(resolvedStatus)) {
      return;
    }

    await sleep(STOP_VERIFY_INTERVAL_MS);
  }

  throw new Error(`Stop confirmation timeout after ${timeoutMs}ms (last state: ${lastState || 'unknown'})`);
};

const resolveConversationType = (rawType: unknown, rawCli: unknown): IResolveTypeResult => {
  const type = parseOptionalString(rawType);
  const cli = parseOptionalString(rawCli);

  if (type) {
    if (!VALID_CONVERSATION_TYPES.includes(type as ConversationType)) {
      return {
        success: false,
        error: `Invalid type. Must be one of: ${VALID_CONVERSATION_TYPES.join(', ')}`,
      };
    }
    return { success: true, type: type as ConversationType };
  }

  if (!cli) {
    return {
      success: false,
      error: 'Missing required field: type or cli',
    };
  }

  if (VALID_CONVERSATION_TYPES.includes(cli as ConversationType)) {
    return { success: true, type: cli as ConversationType };
  }

  if (ACP_BACKEND_SET.has(cli)) {
    return { success: true, type: 'acp', backendFromCli: cli };
  }

  return {
    success: false,
    error: `Invalid cli. Must be a conversation type (${VALID_CONVERSATION_TYPES.join(', ')}) or ACP backend (${VALID_ACP_BACKENDS.join(', ')})`,
  };
};

type IResolveTypeResult =
  | {
      success: true;
      type: ConversationType;
      backendFromCli?: string;
    }
  | {
      success: false;
      error: string;
    };

const buildSimulationPayload = (action: SimulationAction, sessionId: string, payload: Record<string, unknown>) => {
  const defaultCreatePayload = {
    type: 'gemini',
    cli: 'gemini',
    model: {
      id: 'default-provider',
      platform: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '***',
      useModel: 'gpt-4o-mini',
    },
    workspace: 'E:/code/project',
    mode: 'default',
    message: 'Hello from API simulation',
  };
  const encodedSessionId = encodeURIComponent(sessionId);

  const requestMap: Record<SimulationAction, { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> }> = {
    create: {
      method: 'POST',
      path: '/api/v1/conversation/create',
      body: { ...defaultCreatePayload, ...payload },
    },
    message: {
      method: 'POST',
      path: `/api/v1/conversation/message?sessionId=${encodedSessionId}`,
      body: { message: 'Continue response', ...payload },
    },
    status: {
      method: 'GET',
      path: `/api/v1/conversation/status?sessionId=${encodedSessionId}`,
    },
    stop: {
      method: 'POST',
      path: `/api/v1/conversation/stop?sessionId=${encodedSessionId}`,
    },
    messages: {
      method: 'GET',
      path: `/api/v1/conversation/messages?sessionId=${encodedSessionId}&page=0&pageSize=50`,
    },
  };

  const selected = requestMap[action];
  const bodyJson = selected.body ? JSON.stringify(selected.body) : '';
  const escapedBodyJson = escapeSingleQuoteString(bodyJson);

  const curlCommand = selected.method === 'GET' ? `curl -X GET "http://localhost:3000${selected.path}" -H "Authorization: Bearer <api_token>"` : `curl -X POST "http://localhost:3000${selected.path}" -H "Authorization: Bearer <api_token>" -H "Content-Type: application/json" -d '${bodyJson}'`;

  const powershellCommand = selected.method === 'GET' ? `Invoke-RestMethod -Method Get -Uri 'http://localhost:3000${selected.path}' -Headers @{ Authorization = 'Bearer <api_token>' }` : `$headers=@{ Authorization='Bearer <api_token>' }; $body='${escapedBodyJson}'; Invoke-RestMethod -Method Post -Uri 'http://localhost:3000${selected.path}' -Headers $headers -ContentType 'application/json' -Body $body`;

  return {
    action,
    method: selected.method,
    path: selected.path,
    headers: {
      Authorization: 'Bearer <api_token>',
      'Content-Type': selected.method === 'POST' ? 'application/json' : undefined,
    },
    requestBody: selected.body,
    sampleSuccessResponse: action === 'create' ? { success: true, sessionId: 'conv_example_001', status: 'running' } : action === 'messages' ? { success: true, messages: [] as unknown[], total: 0, page: 0, pageSize: 50, hasMore: false } : { success: true, sessionId, status: action === 'stop' ? 'finished' : 'running' },
    commands: {
      curl: curlCommand,
      powershell: powershellCommand,
    },
    note: 'Simulation only. No real conversation will be created or executed.',
  };
};

/**
 * POST /api/v1/conversation/create
 * Create a new conversation and send initial message
 * 创建新会话并发送初始消息
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { model } = req.body;
    const message = parseOptionalString(req.body?.message);
    const workspace = parseOptionalString(req.body?.workspace);
    const backend = parseOptionalString(req.body?.backend);
    const cliPath = parseOptionalString(req.body?.cliPath);
    const mode = parseOptionalString(req.body?.mode) || parseOptionalString(req.body?.sessionMode);
    const currentModelId = parseOptionalString(req.body?.currentModelId);
    const codexModel = parseOptionalString(req.body?.codexModel);
    const agentName = parseOptionalString(req.body?.agentName);
    const customAgentId = parseOptionalString(req.body?.customAgentId);
    const waitForDispatch = parseOptionalBoolean(req.body?.waitForDispatch) ?? false;

    const resolvedType = resolveConversationType(req.body?.type, req.body?.cli);
    if (!resolvedType.success) {
      return res.status(400).json({
        success: false,
        error: 'error' in resolvedType ? resolvedType.error : 'Invalid conversation type',
      });
    }

    const hasValidModelObject = !!model && typeof model === 'object' && !Array.isArray(model);

    // Validate required fields
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: message (and one of type/cli)',
      });
    }
    if (resolvedType.type === 'gemini' && !hasValidModelObject) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: model (required for gemini conversations)',
      });
    }
    if (model !== undefined && !hasValidModelObject) {
      return res.status(400).json({
        success: false,
        error: 'Invalid model. Expected an object',
      });
    }

    const type = resolvedType.type;
    const resolvedBackend = backend || resolvedType.backendFromCli;
    const effectiveModel = (hasValidModelObject ? model : getFallbackConversationModel()) as TProviderWithModel;
    const conversationTitle = buildConversationTitleFromMessage(message);
    if (type === 'acp' && !resolvedBackend) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: backend (required when type/acp cli is acp)',
      });
    }

    // Create conversation
    const result = await ConversationService.createConversation({
      type,
      model: effectiveModel,
      extra: {
        workspace,
        backend: resolvedBackend as (typeof VALID_ACP_BACKENDS)[number] | undefined,
        customWorkspace: !!workspace,
        cliPath,
        sessionMode: mode,
        currentModelId,
        codexModel,
        agentName,
        customAgentId,
      },
      name: conversationTitle || undefined,
      source: 'api',
    });

    if (!result.success || !result.conversation) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to create conversation',
      });
    }

    const conversation = result.conversation;

    // Send initial message
    const msg_id = uuid();
    if (waitForDispatch) {
      const sendResult = await WorkerManage.sendMessage(conversation.id, message, msg_id);
      if (!sendResult.success) {
        const errorMessage = 'msg' in sendResult ? sendResult.msg : 'Failed to send initial message';
        console.error('[API] Initial message send failed:', errorMessage);
        return res.status(500).json({
          success: false,
          error: errorMessage,
        });
      }
    } else {
      void WorkerManage.sendMessage(conversation.id, message, msg_id)
        .then((sendResult) => {
          if (!sendResult.success) {
            console.error('[API] Async initial message send failed:', 'msg' in sendResult ? sendResult.msg : 'Failed to send initial message', {
              sessionId: conversation.id,
              msg_id,
            });
          }
        })
        .catch((dispatchError) => {
          console.error('[API] Async initial message send exception:', dispatchError, {
            sessionId: conversation.id,
            msg_id,
          });
        });
    }

    res.json({
      success: true,
      sessionId: conversation.id,
      status: 'running',
    });
  } catch (error) {
    console.error('[API] Create conversation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * POST /api/v1/conversation/simulate
 * Simulate request examples for integration testing
 */
router.post('/simulate', async (req: Request, res: Response) => {
  try {
    const rawAction = typeof req.body?.action === 'string' ? req.body.action : 'create';
    const action = rawAction as SimulationAction;

    if (!SIMULATION_ACTIONS.includes(action)) {
      return res.status(400).json({
        success: false,
        error: `Invalid action. Must be one of: ${SIMULATION_ACTIONS.join(', ')}`,
      });
    }

    const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.trim() ? req.body.sessionId.trim() : 'conv_example_001';
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? (req.body.payload as Record<string, unknown>) : {};

    const simulation = buildSimulationPayload(action, sessionId, payload);

    res.json({
      success: true,
      simulation,
    });
  } catch (error) {
    console.error('[API] Simulate request error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * GET /api/v1/conversation/status?sessionId={sessionId}
 * Query conversation status
 * 查询会话状态
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const sessionId = parseSessionIdQuery(req);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId query parameter',
      });
    }

    const db = getDatabase();

    // Get conversation
    const convResult = db.getConversation(sessionId);
    if (!convResult.success || !convResult.data) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    const snapshot = getConversationStatusSnapshot(sessionId);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    res.json({
      success: true,
      sessionId,
      status: snapshot.status,
      state: snapshot.state,
      detail: snapshot.detail,
      canSendMessage: snapshot.canSendMessage,
      runtime: snapshot.runtime,
      lastMessage: formatStatusLastMessage(snapshot.lastMessage),
    });
  } catch (error) {
    console.error('[API] Get status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * POST /api/v1/conversation/stop?sessionId={sessionId}
 * Stop AI generation
 * 终止 AI 生成
 */
router.post('/stop', async (req: Request, res: Response) => {
  try {
    const sessionId = parseSessionIdQuery(req);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId query parameter',
      });
    }

    const db = getDatabase();

    // Verify conversation exists
    const convResult = db.getConversation(sessionId);
    if (!convResult.success || !convResult.data) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    // Strong consistency: do not return success until stop is actually confirmed.
    const stopResult = await invokeStopWithTimeout(sessionId, STOP_DISPATCH_TIMEOUT_MS);
    if (!stopResult.success) {
      console.error('[API] Stop dispatch failed, forcing kill:', stopResult.msg, { sessionId });
      WorkerManage.kill(sessionId);
      cronBusyGuard.setProcessing(sessionId, false);
    }

    try {
      await waitForStopConfirmed(sessionId, STOP_VERIFY_TIMEOUT_MS);
    } catch (verifyError) {
      // Final fallback: force kill once and verify quickly again.
      WorkerManage.kill(sessionId);
      cronBusyGuard.setProcessing(sessionId, false);
      try {
        await waitForStopConfirmed(sessionId, 5000);
      } catch {
        return res.status(504).json({
          success: false,
          error: verifyError instanceof Error ? verifyError.message : 'Stop confirmation failed',
        });
      }
    }

    // Update conversation status
    db.updateConversation(sessionId, { status: 'finished' });

    res.json({
      success: true,
      sessionId,
      status: 'finished',
    });
  } catch (error) {
    console.error('[API] Stop conversation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * POST /api/v1/conversation/message?sessionId={sessionId}
 * Continue conversation (send new message)
 * 持续对话（发送新消息）
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    const sessionId = parseSessionIdQuery(req);
    const message = parseOptionalString(req.body?.message);
    const waitForDispatch = parseOptionalBoolean(req.body?.waitForDispatch) ?? false;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId query parameter',
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Missing message in request body',
      });
    }

    const db = getDatabase();

    // Verify conversation exists
    const convResult = db.getConversation(sessionId);
    if (!convResult.success || !convResult.data) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    const snapshot = getConversationStatusSnapshot(sessionId);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    const resolvedStatus = snapshot;

    // Check if AI is busy or awaiting confirmation
    if (!resolvedStatus.canSendMessage) {
      return res.status(409).json({
        success: false,
        error: `Conversation is not ready for new input: ${resolvedStatus.state}`,
        status: 'ai-busy',
        state: resolvedStatus.state,
        detail: resolvedStatus.detail,
      });
    }

    // Send message
    const msg_id = uuid();
    if (waitForDispatch) {
      const sendResult = await WorkerManage.sendMessage(sessionId, message, msg_id);
      if (!sendResult.success) {
        const errorMessage = 'msg' in sendResult ? sendResult.msg : 'Failed to send message';
        console.error('[API] Continue message send failed:', errorMessage);
        return res.status(500).json({
          success: false,
          error: errorMessage,
        });
      }
    } else {
      void WorkerManage.sendMessage(sessionId, message, msg_id)
        .then((sendResult) => {
          if (!sendResult.success) {
            console.error('[API] Async continue message send failed:', 'msg' in sendResult ? sendResult.msg : 'Failed to send message', {
              sessionId,
              msg_id,
            });
          }
        })
        .catch((dispatchError) => {
          console.error('[API] Async continue message send exception:', dispatchError, {
            sessionId,
            msg_id,
          });
        });
    }

    res.json({
      success: true,
      sessionId,
      status: 'running',
    });
  } catch (error) {
    console.error('[API] Send message error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * GET /api/v1/conversation/messages?sessionId={sessionId}
 * Get conversation message history
 * 获取对话历史记录
 */
router.get('/messages', async (req: Request, res: Response) => {
  try {
    const sessionId = parseSessionIdQuery(req);
    const page = parseInt((req.query.page as string) || '0');
    const pageSize = Math.min(parseInt((req.query.pageSize as string) || '50'), 100);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId query parameter',
      });
    }

    const db = getDatabase();

    // Verify conversation exists
    const convResult = db.getConversation(sessionId);
    if (!convResult.success || !convResult.data) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    // Get messages
    const result = db.getConversationMessages(sessionId, page, pageSize);

    res.json({
      success: true,
      messages: result.data,
      total: result.total,
      page,
      pageSize,
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error('[API] Get messages error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

export default router;
