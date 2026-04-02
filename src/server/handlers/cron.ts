/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import { cronService } from '@server/services/cron/cronServiceSingleton';

/**
 * Register cron endpoint handlers on the WsRouter.
 * Replaces initCronBridge() from src/process/bridge/cronBridge.ts.
 */
export function registerCronHandlers(router: WsRouter): void {
  // Query handlers
  router.handle('cron.list-jobs', async () => {
    return cronService.listJobs();
  });

  router.handle('cron.list-jobs-by-conversation', async ({ conversationId }) => {
    return cronService.listJobsByConversation(conversationId);
  });

  router.handle('cron.get-job', async ({ jobId }) => {
    return cronService.getJob(jobId);
  });

  // CRUD handlers
  router.handle('cron.add-job', async (params) => {
    return cronService.addJob(params);
  });

  router.handle('cron.update-job', async ({ jobId, updates }) => {
    return cronService.updateJob(jobId, updates);
  });

  router.handle('cron.remove-job', async ({ jobId }) => {
    await cronService.removeJob(jobId);
  });
}
