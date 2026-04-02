/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import type { IConversationRepository } from '@server/services/database/IConversationRepository';
import type { IChannelRepository } from '@server/services/database/IChannelRepository';
import type { IConversationService } from '@server/services/IConversationService';
import type { IWorkerTaskManager } from '@server/task/IWorkerTaskManager';
import { registerCronHandlers } from './cron';
import { registerDatabaseHandlers } from './database';
import { registerAuthHandlers } from './auth';
import { registerNotificationHandlers } from './notification';
import { registerTaskHandlers } from './task';
import { registerStarOfficeHandlers } from './starOffice';
import { registerSpeechHandlers } from './speech';
import { registerPreviewHistoryHandlers } from './previewHistory';
import { registerPptPreviewHandlers } from './pptPreview';
import { registerConversationHandlers } from './conversation';
import { registerAcpConversationHandlers } from './acpConversation';
import { registerFsHandlers } from './fs';
import { registerModelHandlers } from './model';
import { registerChannelHandlers } from './channel';
import { registerExtensionsHandlers } from './extensions';
import { registerWebuiHandlers } from './webui';
import { registerShellHandlers } from './shell';
import { registerWindowControlsHandlers } from './windowControls';
import { registerDialogHandlers } from './dialog';
import { registerWeixinLoginHandlers } from './weixinLogin';
import { registerApplicationHandlers } from './application';
import { registerSystemSettingsHandlers } from './systemSettings';
import { registerWorkspaceSnapshotHandlers } from './workspaceSnapshot';
import { registerDocumentHandlers } from './document';
import { registerRemoteAgentHandlers } from './remoteAgent';
import { registerMcpHandlers } from './mcp';
import { registerGeminiHandlers } from './gemini';
import { registerBedrockHandlers } from './bedrock';
import { registerUpdateHandlers } from './update';
import { registerOfficeWatchHandlers } from './officeWatch';
import { registerFileWatchHandlers } from './fileWatch';

/**
 * Dependencies required by handler registration.
 * Mirrors the subset of BridgeDependencies used by the migrated bridges.
 */
export type HandlerDependencies = {
  conversationRepo: IConversationRepository;
  channelRepo: IChannelRepository;
  conversationService: IConversationService;
  workerTaskManager: IWorkerTaskManager;
};

/**
 * Register all migrated handlers on the WsRouter.
 *
 * This is the single entry point for wiring handlers — equivalent to
 * initAllBridges() in src/process/bridge/index.ts for the migrated subset.
 */
export function registerAllHandlers(router: WsRouter, deps: HandlerDependencies): void {
  registerCronHandlers(router);
  registerDatabaseHandlers(router, deps.conversationRepo);
  registerAuthHandlers(router);
  registerNotificationHandlers(router);
  registerTaskHandlers(router, deps.workerTaskManager);
  registerStarOfficeHandlers(router);
  registerSpeechHandlers(router);
  registerPreviewHistoryHandlers(router);
  registerPptPreviewHandlers(router);
  registerConversationHandlers(router, deps.conversationService, deps.workerTaskManager);
  registerAcpConversationHandlers(router, deps.workerTaskManager);
  registerFsHandlers(router);
  registerModelHandlers(router);
  registerChannelHandlers(router, deps.channelRepo);
  registerExtensionsHandlers(router, deps.conversationRepo, deps.workerTaskManager);
  registerWebuiHandlers(router);
  registerShellHandlers(router);
  registerWindowControlsHandlers(router);
  registerDialogHandlers(router);
  registerWeixinLoginHandlers(router);
  registerApplicationHandlers(router);
  registerSystemSettingsHandlers(router);
  registerWorkspaceSnapshotHandlers(router);
  registerDocumentHandlers(router);
  registerRemoteAgentHandlers(router);
  registerMcpHandlers(router);
  registerGeminiHandlers(router, deps.workerTaskManager);
  registerBedrockHandlers(router);
  registerUpdateHandlers(router);
  registerOfficeWatchHandlers(router);
  registerFileWatchHandlers(router);
}
