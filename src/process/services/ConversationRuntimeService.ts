/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import WorkerManage from '@process/WorkerManage';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { workerTaskManager } from '@process/task/workerTaskManagerSingleton';

type ConversationRuntimeTaskStatus = 'pending' | 'running' | 'finished';

export type ConversationRuntimeTask = {
  status?: ConversationRuntimeTaskStatus;
  getConfirmations?: () => unknown[];
  stop?: () => Promise<void>;
};

type ConversationRuntimeSource = 'workerTaskManager' | 'workerManage';

export type ConversationRuntimeTaskResolution = {
  task?: ConversationRuntimeTask;
  source?: ConversationRuntimeSource;
  workerTask?: ConversationRuntimeTask;
  legacyTask?: ConversationRuntimeTask;
};

type GetConversationRuntimeTaskOptions = {
  touchLegacyTask?: boolean;
};

const getTaskConfirmationCount = (task?: ConversationRuntimeTask): number => {
  if (!task || typeof task.getConfirmations !== 'function') {
    return 0;
  }

  return task.getConfirmations().length;
};

const getTaskPriority = (task?: ConversationRuntimeTask): number => {
  if (!task) {
    return -1;
  }

  let priority = 0;
  const confirmationCount = getTaskConfirmationCount(task);
  if (confirmationCount > 0) {
    priority += 1000 + confirmationCount;
  }

  if (task.status === 'running') {
    priority += 750;
  } else if (task.status === 'pending') {
    priority += 500;
  } else if (task.status === 'finished') {
    priority += 250;
  }

  return priority;
};

export const getConversationRuntimeTask = (
  sessionId: string,
  options: GetConversationRuntimeTaskOptions = {}
): ConversationRuntimeTaskResolution => {
  const touchLegacyTask = options.touchLegacyTask ?? true;
  const workerTask = workerTaskManager.getTask(sessionId) as ConversationRuntimeTask | undefined;
  const legacyTask = (touchLegacyTask ? WorkerManage.getTaskById(sessionId) : WorkerManage.peekTaskById(sessionId)) as
    | ConversationRuntimeTask
    | undefined;

  const workerPriority = getTaskPriority(workerTask);
  const legacyPriority = getTaskPriority(legacyTask);

  if (workerPriority >= legacyPriority && workerTask) {
    return {
      task: workerTask,
      source: 'workerTaskManager',
      workerTask,
      legacyTask,
    };
  }

  if (legacyTask) {
    return {
      task: legacyTask,
      source: 'workerManage',
      workerTask,
      legacyTask,
    };
  }

  return {
    workerTask,
    legacyTask,
  };
};

export const listConversationRuntimeTaskIds = (): string[] => {
  const sessionIds = new Set<string>();

  workerTaskManager.listTasks().forEach(({ id }) => {
    sessionIds.add(id);
  });

  WorkerManage.listTasks().forEach(({ id }) => {
    sessionIds.add(id);
  });

  return Array.from(sessionIds);
};

export const stopConversationRuntime = async (
  sessionId: string
): Promise<{ success: boolean; msg?: string; attemptedSources: ConversationRuntimeSource[] }> => {
  const { workerTask, legacyTask } = getConversationRuntimeTask(sessionId, { touchLegacyTask: false });
  const attemptedSources: ConversationRuntimeSource[] = [];
  const seenTasks = new Set<ConversationRuntimeTask>();

  const stopOne = async (task: ConversationRuntimeTask | undefined, source: ConversationRuntimeSource) => {
    if (!task || typeof task.stop !== 'function' || seenTasks.has(task)) {
      return;
    }

    seenTasks.add(task);
    attemptedSources.push(source);
    await task.stop();
  };

  try {
    await stopOne(workerTask, 'workerTaskManager');
    await stopOne(legacyTask, 'workerManage');

    return {
      success: true,
      attemptedSources,
      msg: attemptedSources.length > 0 ? undefined : 'conversation not found',
    };
  } catch (error) {
    return {
      success: false,
      attemptedSources,
      msg: error instanceof Error ? error.message : String(error),
    };
  }
};

const forgetConversationTurnCompletionSession = async (sessionId: string): Promise<void> => {
  try {
    const { ConversationTurnCompletionService } = await import('@process/services/ConversationTurnCompletionService');
    ConversationTurnCompletionService.getInstance().forgetSession(sessionId);
  } catch (error) {
    console.warn('[ConversationRuntimeService] Failed to forget turn completion state:', error, { sessionId });
  }
};

const cleanupWorkerOnlyRuntimeArtifacts = async (sessionId: string): Promise<void> => {
  cronBusyGuard.remove(sessionId);
  await forgetConversationTurnCompletionSession(sessionId);

  try {
    const { releaseConversationMessageCache } = await import('@process/message');
    await releaseConversationMessageCache(sessionId, {
      persistPending: true,
    });
  } catch (error) {
    console.warn('[ConversationRuntimeService] Failed to release conversation message cache:', error, { sessionId });
  }
};

export const drainConversationRuntime = async (sessionId: string): Promise<void> => {
  const workerTask = workerTaskManager.getTask(sessionId) as ConversationRuntimeTask | undefined;
  const legacyTask = WorkerManage.peekTaskById(sessionId) as ConversationRuntimeTask | undefined;
  const sharesSameTask = !!workerTask && workerTask === legacyTask;

  if (legacyTask) {
    await WorkerManage.killAndDrain(sessionId);
  }

  if (workerTask) {
    if (sharesSameTask && typeof workerTaskManager.removeTask === 'function') {
      workerTaskManager.removeTask(sessionId);
    } else if (!sharesSameTask) {
      workerTaskManager.kill(sessionId);
    }
  }

  if (!legacyTask) {
    await cleanupWorkerOnlyRuntimeArtifacts(sessionId);
  }
};
