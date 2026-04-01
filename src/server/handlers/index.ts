/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import type { IConversationService } from '@process/services/IConversationService';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
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

/**
 * Dependencies required by handler registration.
 * Mirrors the subset of BridgeDependencies used by the migrated bridges.
 */
export type HandlerDependencies = {
  conversationRepo: IConversationRepository;
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
}
