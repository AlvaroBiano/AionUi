/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import type { GeminiAgentManager } from '@server/task/GeminiAgentManager';
import type { IWorkerTaskManager } from '@server/task/IWorkerTaskManager';
import { getGeminiSubscriptionStatus } from '@server/services/geminiSubscription';

/**
 * Register Gemini endpoint handlers on the WsRouter.
 * Replaces initGeminiBridge() and initGeminiConversationBridge()
 * from src/process/bridge/geminiBridge.ts and geminiConversationBridge.ts.
 */
export function registerGeminiHandlers(router: WsRouter, workerTaskManager: IWorkerTaskManager): void {
  // Subscription status query — renderer uses this to decide whether to show premium models
  router.handle('gemini.subscription-status', async ({ proxy }) => {
    try {
      const status = await getGeminiSubscriptionStatus(proxy);
      return { success: true, data: status };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Gemini conversation MCP tool confirmation (including "always allow" options)
  router.handle('input.confirm.message', async ({ conversation_id, msg_id, confirmKey, callId }) => {
    const task = workerTaskManager.getTask(conversation_id);
    if (!task) {
      return { success: false, msg: 'conversation not found' };
    }
    if (task.type !== 'gemini') {
      return { success: false, msg: 'only supported for gemini' };
    }

    // Send confirmation to worker
    void (task as GeminiAgentManager).confirm(msg_id, callId, confirmKey);
    return { success: true };
  });
}
