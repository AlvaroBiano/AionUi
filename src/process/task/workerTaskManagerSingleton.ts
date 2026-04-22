/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Singleton WorkerTaskManager wired with all registered agent creators.
 * Extracted to a separate module to avoid circular dependencies with initBridge.ts.
 */

import { AgentFactory } from './AgentFactory';
import { WorkerTaskManager } from './WorkerTaskManager';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { GeminiAgentManager } from './GeminiAgentManager';
import OpenClawAgentManager from './OpenClawAgentManager';
import NanoBotAgentManager from './NanoBotAgentManager';
import RemoteAgentManager from './RemoteAgentManager';
import { AionrsManager } from './AionrsManager';
import { AcpRuntime } from '@process/acp/runtime/AcpRuntime';
import { AcpClientFactory } from '@process/acp/infra/AcpClientFactory';
import { getAgentEventDispatcher } from '@process/events/compositionRoot';
import { getDatabase } from '@process/services/database/export';
import { ipcBridge } from '@/common';
import type { AgentConfig, InitialDesiredConfig } from '@process/acp/types';
import type { McpServer } from '@agentclientprotocol/sdk';

const agentFactory = new AgentFactory();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
agentFactory.register('gemini', (conv, opts) => {
  const c = conv as any;
  return new GeminiAgentManager(
    { ...c.extra, conversation_id: c.id, yoloMode: opts?.yoloMode },
    c.model,
  ) as unknown as ReturnType<typeof agentFactory.create>;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
agentFactory.register('acp', (conv, opts) => {
  const c = conv as any;
  const extra = c.extra ?? {};
  const backend = extra.backend ?? 'claude';
  const conversationId = c.id;
  const workspace = extra.workspace ?? process.cwd();

  // Build AgentConfig directly from conversation.extra
  const initialDesired: InitialDesiredConfig = {};
  if (extra.currentModelId) initialDesired.model = extra.currentModelId;
  if (extra.sessionMode) initialDesired.mode = extra.sessionMode;
  if (extra.pendingConfigOptions && Object.keys(extra.pendingConfigOptions).length > 0) {
    initialDesired.configOptions = extra.pendingConfigOptions;
  }

  let teamMcpConfig: McpServer | undefined;
  if (extra.teamMcpStdioConfig) {
    teamMcpConfig = {
      name: extra.teamMcpStdioConfig.name,
      command: extra.teamMcpStdioConfig.command,
      args: extra.teamMcpStdioConfig.args,
      env: extra.teamMcpStdioConfig.env,
    };
  }

  const agentConfig: AgentConfig = {
    agentBackend: backend,
    agentSource: 'extension',
    agentId: conversationId,
    command: extra.cliPath,
    args: extra.customArgs,
    env: extra.customEnv,
    cwd: workspace,
    teamMcpConfig,
    resumeSessionId: extra.acpSessionId,
    initialDesired: Object.keys(initialDesired).length > 0 ? initialDesired : undefined,
    yoloMode: opts?.yoloMode ?? extra.yoloMode,
  };

  const runtime = new AcpRuntime({
    conversation_id: conversationId,
    workspace,
    agentConfig,
    clientFactory: new AcpClientFactory(),
    backend,
    yoloMode: opts?.yoloMode ?? extra.yoloMode,
    presetContext: extra.presetContext,
    enabledSkills: extra.enabledSkills,
    excludeBuiltinSkills: extra.excludeBuiltinSkills,
    isInTeam: !!teamMcpConfig,
    dispatcher: getAgentEventDispatcher(),
    persisterDeps: {
      addMessage: (cid, msg) => {
        void getDatabase()
          .then((db) => db.insertMessage({ ...msg, conversation_id: cid }))
          .catch(() => {});
      },
      updateConversation: async () => {
        // Sidebar sorting touch — deferred to PersistenceSubscriber
      },
      emitToRenderer: (msg) => {
        ipcBridge.conversation.responseStream.emit(msg);
      },
    },
    permissionCallbacks: {
      onConfirmationAdded: (cid, confirmation) => {
        ipcBridge.conversation.responseStream.emit({
          type: 'confirmation_add',
          conversation_id: cid,
          msg_id: confirmation.id,
          data: confirmation,
        });
      },
      onConfirmationUpdated: (cid, confirmation) => {
        ipcBridge.conversation.responseStream.emit({
          type: 'confirmation_update',
          conversation_id: cid,
          msg_id: confirmation.id,
          data: confirmation,
        });
      },
      onConfirmationRemoved: (cid, confirmationId) => {
        ipcBridge.conversation.responseStream.emit({
          type: 'confirmation_remove',
          conversation_id: cid,
          msg_id: confirmationId,
          data: null,
        });
      },
    },
  });

  return runtime as unknown as ReturnType<typeof agentFactory.create>;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
agentFactory.register('openclaw-gateway', (conv, opts) => {
  const c = conv as any;
  return new OpenClawAgentManager({
    ...c.extra,
    conversation_id: c.id,
    yoloMode: opts?.yoloMode,
  }) as unknown as ReturnType<typeof agentFactory.create>;
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
agentFactory.register('nanobot', (conv, opts) => {
  const c = conv as any;
  return new NanoBotAgentManager({
    ...c.extra,
    conversation_id: c.id,
    yoloMode: opts?.yoloMode,
  }) as unknown as ReturnType<typeof agentFactory.create>;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
agentFactory.register('remote', (conv, opts) => {
  const c = conv as any;
  return new RemoteAgentManager({
    ...c.extra,
    conversation_id: c.id,
    yoloMode: opts?.yoloMode,
  }) as unknown as ReturnType<typeof agentFactory.create>;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
agentFactory.register('aionrs', (conv, opts) => {
  const c = conv as any;
  return new AionrsManager(
    { ...c.extra, conversation_id: c.id, yoloMode: opts?.yoloMode },
    c.model,
  ) as unknown as ReturnType<typeof agentFactory.create>;
});

const conversationRepo = new SqliteConversationRepository();
export const workerTaskManager = new WorkerTaskManager(agentFactory, conversationRepo);
