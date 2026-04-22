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
import { LegacyConnectorFactory } from '@process/acp/compat/LegacyConnectorFactory';
import { toAgentConfig } from '@process/acp/compat/typeBridge';
import { getAgentEventDispatcher } from '@process/events/compositionRoot';
import { ipcBridge } from '@/common/adapter/ipcBridge';
import { getDatabase } from '@process/services/database/export';

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

  // Build AgentConfig from conversation.extra (same mapping as old AcpAgentManager)
  const agentConfig = toAgentConfig({
    id: conversationId,
    backend,
    cliPath: extra.cliPath,
    workingDir: extra.workspace ?? process.cwd(),
    customArgs: extra.customArgs,
    customEnv: extra.customEnv,
    extra: {
      ...extra,
      yoloMode: opts?.yoloMode ?? extra.yoloMode,
      currentModelId: extra.currentModelId ?? (backend === 'gemini' ? c.model?.useModel : undefined),
    },
    onStreamEvent: () => {},
  });

  const dispatcher = getAgentEventDispatcher();

  const runtime = new AcpRuntime({
    conversation_id: conversationId,
    workspace: extra.workspace ?? process.cwd(),
    agentConfig,
    clientFactory: new LegacyConnectorFactory(),
    backend,
    yoloMode: opts?.yoloMode ?? extra.yoloMode,
    presetContext: extra.presetContext,
    enabledSkills: extra.enabledSkills,
    excludeBuiltinSkills: extra.excludeBuiltinSkills,
    isInTeam: !!extra.teamMcpStdioConfig,

    dispatcher,

    persisterDeps: {
      addMessage: (cid, msg) => {
        void getDatabase()
          .then((db) => db.addMessage(cid, msg))
          .catch(() => {});
      },
      updateConversation: async (_cid) => {
        // Touch conversation for sidebar sorting — deferred to PersistenceSubscriber
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
