/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { SqliteConversationRepository } from '@server/services/database/SqliteConversationRepository';
import { workerTaskManager } from '@server/task/workerTaskManagerSingleton';
import { cronBusyGuard } from './CronBusyGuard';
import { CronService } from './CronService';
import { IpcCronEventEmitter } from './IpcCronEventEmitter';
import { SqliteCronRepository } from './SqliteCronRepository';
import { WorkerTaskManagerJobExecutor } from './WorkerTaskManagerJobExecutor';

export const cronService = new CronService(
  new SqliteCronRepository(),
  new IpcCronEventEmitter(),
  new WorkerTaskManagerJobExecutor(workerTaskManager, cronBusyGuard),
  new SqliteConversationRepository()
);
