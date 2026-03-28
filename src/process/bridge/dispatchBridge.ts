/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/bridge/dispatchBridge.ts

import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
import type { IConversationService } from '@process/services/IConversationService';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig, ProcessEnv } from '@process/utils/initStorage';

/**
 * Initialize dispatch-related IPC bridge handlers.
 * Registers group chat creation, info retrieval, and child transcript channels.
 *
 * IMPORTANT: Use ProcessConfig / ProcessEnv (direct file I/O) instead of
 * ConfigStorage / EnvStorage (bridge-based) inside provider handlers.
 * Bridge-based storage invokes go through the IPC adapter and are routed to
 * the renderer, causing a deadlock when called from the main process.
 */
export function initDispatchBridge(
  _workerTaskManager: IWorkerTaskManager,
  conversationService: IConversationService,
  conversationRepo?: IConversationRepository
): void {
  mainLog('[DispatchBridge]', 'Dispatch bridge initialized');

  // --- dispatch.create-group-chat ---
  ipcBridge.dispatch.createGroupChat.provider(async (params) => {
    mainLog('[DispatchBridge:createGroupChat]', 'received', params);
    try {
      const id = uuid();

      // Read config directly via ProcessConfig (file I/O) — never via ConfigStorage
      // (bridge invoke) which deadlocks inside a main-process provider handler.
      //
      // Look up full provider config (apiKey, baseUrl, platform, etc.)
      const providers = ((await ProcessConfig.get('model.config')) || []) as Array<{
        id: string;
        platform: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        model: string[];
      }>;

      // Phase 2b: Model override support
      let defaultModel: TProviderWithModel;
      if (params.modelOverride) {
        const overrideProvider = providers.find((p) => p.id === params.modelOverride!.providerId);
        defaultModel = overrideProvider
          ? { ...overrideProvider, useModel: params.modelOverride.useModel }
          : ({ id: params.modelOverride.providerId, useModel: params.modelOverride.useModel } as TProviderWithModel);
      } else {
        // gemini.defaultModel only stores { id, useModel } — a reference to the provider.
        // We must look up the full provider (with apiKey, baseUrl, platform) from model.config
        // to avoid "OpenAI API key is required" errors in the Gemini CLI worker.
        const geminiDefaultModel = await ProcessConfig.get('gemini.defaultModel');
        const modelRef =
          typeof geminiDefaultModel === 'object' && geminiDefaultModel !== null
            ? (geminiDefaultModel as { id: string; useModel: string })
            : { id: 'gemini', useModel: String(geminiDefaultModel || 'gemini-2.0-flash') };
        const provider = providers.find((p) => p.id === modelRef.id);
        defaultModel = provider
          ? { ...provider, useModel: modelRef.useModel }
          : ({ id: modelRef.id, useModel: modelRef.useModel } as TProviderWithModel);
      }

      // Determine workspace from params or use system default via ProcessEnv
      const envDirs = await ProcessEnv.get('aionui.dir');
      const workspace = params.workspace || envDirs?.workDir || '';

      // Phase 2b: Leader agent snapshot
      let leaderAgentId: string | undefined;
      let leaderPresetRules: string | undefined;
      let leaderName: string | undefined;
      let leaderAvatar: string | undefined;
      if (params.leaderAgentId) {
        // AcpBackendConfig uses 'context' field; stored as 'leaderPresetRules' in dispatch extra
        const customAgents =
          ((await ProcessConfig.get('acp.customAgents')) as Array<
            Record<string, unknown> & { id: string; name: string; avatar?: string; context?: string; enabled?: boolean }
          >) || [];
        const leaderAgent = customAgents.find((a) => a.id === params.leaderAgentId);
        if (leaderAgent) {
          leaderAgentId = leaderAgent.id;
          leaderPresetRules = leaderAgent.context; // AcpBackendConfig.context → leaderPresetRules
          leaderName = leaderAgent.name;
          leaderAvatar = leaderAgent.avatar;
        } else {
          mainWarn('[DispatchBridge:createGroupChat]', 'Leader agent not found: ' + params.leaderAgentId);
        }
      }

      // Phase 2b: Seed messages
      const seedMessages = params.seedMessages?.trim() || undefined;

      // Use leader name as dispatcher name if available
      const displayName = leaderName || params.name || 'Group Chat';

      await conversationService.createConversation({
        id,
        type: 'dispatch',
        name: displayName,
        model: defaultModel,
        extra: {
          workspace,
          dispatchSessionType: 'dispatcher',
          groupChatName: params.name || undefined,
          leaderAgentId,
          leaderPresetRules,
          leaderName,
          leaderAvatar,
          seedMessages,
        },
      });

      // Eager Orchestrator startup: pre-warm the agent so the first message
      // does not pay the cold-start penalty (worker fork + MCP server spawn).
      try {
        await _workerTaskManager.getOrBuildTask(id);
        mainLog('[DispatchBridge:createGroupChat]', 'Orchestrator agent started for ' + id);
      } catch (err) {
        // Non-fatal: agent will be lazily started on first sendMessage
        mainWarn('[DispatchBridge:createGroupChat]', 'Orchestrator warm-start failed', err);
      }

      ipcBridge.conversation.listChanged.emit({
        conversationId: id,
        action: 'created',
        source: 'dispatch',
      });

      mainLog('[DispatchBridge:createGroupChat]', 'success, conversationId=' + id);
      return { success: true, data: { conversationId: id } };
    } catch (error) {
      mainWarn('[DispatchBridge:createGroupChat]', 'ERROR: ' + String(error));
      return { success: false, msg: String(error) };
    }
  });

  // --- dispatch.get-group-chat-info ---
  ipcBridge.dispatch.getGroupChatInfo.provider(async (params) => {
    mainLog('[DispatchBridge:getGroupChatInfo]', 'received', params);
    try {
      const conversation = await conversationService.getConversation(params.conversationId);
      if (!conversation || conversation.type !== 'dispatch') {
        return { success: false, msg: 'Conversation not found or not a dispatch conversation' };
      }

      const extra = conversation.extra as {
        groupChatName?: string;
        pendingNotifications?: string[];
      };

      // Get child conversations from the database
      const allConversations = await conversationService.listAllConversations();
      // Filter by extra.dispatchSessionType, not conv.type — child conversations use type='gemini' (CR-004/BUG-001)
      const children = allConversations
        .filter((conv: TChatConversation) => {
          const childExtra = conv.extra as { dispatchSessionType?: string; parentSessionId?: string } | undefined;
          return (
            childExtra?.dispatchSessionType === 'dispatch_child' && childExtra.parentSessionId === params.conversationId
          );
        })
        .map((conv: TChatConversation) => {
          const childExtra = conv.extra as {
            dispatchTitle?: string;
            teammateConfig?: { name: string; avatar?: string };
          };
          return {
            sessionId: conv.id,
            title: childExtra.dispatchTitle || conv.name,
            status: conv.status || 'unknown',
            teammateName: childExtra.teammateConfig?.name,
            teammateAvatar: childExtra.teammateConfig?.avatar,
            createdAt: conv.createTime,
            lastActivityAt: conv.modifyTime,
          };
        });

      return {
        success: true,
        data: {
          dispatcherId: conversation.id,
          dispatcherName: extra.groupChatName || conversation.name,
          children,
          pendingNotificationCount: extra.pendingNotifications?.length ?? 0,
        },
      };
    } catch (error) {
      mainWarn('[DispatchBridge:getGroupChatInfo]', 'ERROR: ' + String(error));
      return { success: false, msg: String(error) };
    }
  });

  // --- dispatch.cancel-child-task (F-2.5) ---
  ipcBridge.dispatch.cancelChildTask.provider(async (params) => {
    mainLog('[DispatchBridge:cancelChildTask]', 'received', params);
    try {
      const task = _workerTaskManager.getTask(params.conversationId);
      if (!task || task.type !== 'dispatch') {
        mainWarn('[DispatchBridge:cancelChildTask]', 'Dispatch session not found: ' + params.conversationId);
        return { success: false, msg: 'Dispatch session not found' };
      }

      // Access DispatchAgentManager.cancelChild via type assertion.
      // The task is typed as IAgentManager; cancelChild is dispatch-specific.
      // Runtime guard: verify the method exists before calling.
      const dispatchAgent = task as unknown as {
        cancelChild?(childSessionId: string): Promise<void>;
      };
      if (typeof dispatchAgent.cancelChild !== 'function') {
        return { success: false, msg: 'Task does not support cancelChild' };
      }
      await dispatchAgent.cancelChild(params.childSessionId);

      mainLog('[DispatchBridge:cancelChildTask]', 'success', params.childSessionId);
      return { success: true, data: { cancelled: true } };
    } catch (error) {
      mainWarn('[DispatchBridge:cancelChildTask]', 'ERROR: ' + String(error));
      return { success: false, msg: String(error) };
    }
  });

  // --- dispatch.get-teammate-config (F-3.1) ---
  ipcBridge.dispatch.getTeammateConfig.provider(async (params) => {
    mainLog('[DispatchBridge:getTeammateConfig]', 'received', params);
    try {
      const conversation = await conversationService.getConversation(params.childSessionId);
      if (!conversation) {
        return { success: false, msg: 'Child session not found' };
      }
      const extra = conversation.extra as {
        teammateConfig?: { name: string; avatar?: string };
        presetRules?: string;
      };
      return {
        success: true,
        data: {
          name: extra.teammateConfig?.name || conversation.name,
          avatar: extra.teammateConfig?.avatar,
          presetRules: extra.presetRules,
        },
      };
    } catch (error) {
      mainWarn('[DispatchBridge:getTeammateConfig]', 'ERROR: ' + String(error));
      return { success: false, msg: String(error) };
    }
  });

  // --- dispatch.save-teammate (F-3.1) ---
  ipcBridge.dispatch.saveTeammate.provider(async (params) => {
    mainLog('[DispatchBridge:saveTeammate]', 'received', { name: params.name });
    try {
      const customAgents =
        ((await ProcessConfig.get('acp.customAgents')) as Array<
          Record<string, unknown> & { id: string; name: string; avatar?: string; context?: string; enabled?: boolean }
        >) || [];

      // Duplicate name check
      if (customAgents.some((a) => a.name === params.name)) {
        return { success: false, msg: 'Assistant with this name already exists' };
      }

      const newId = uuid();
      const newAgent = {
        id: newId,
        name: params.name,
        avatar: params.avatar,
        context: params.presetRules,
        enabled: true,
        isPreset: true,
        presetAgentType: 'gemini',
        source: 'dispatch_teammate',
      };

      customAgents.push(newAgent as (typeof customAgents)[number]);
      await ProcessConfig.set('acp.customAgents', customAgents);

      mainLog('[DispatchBridge:saveTeammate]', 'success, assistantId=' + newId);
      return { success: true, data: { assistantId: newId } };
    } catch (error) {
      mainWarn('[DispatchBridge:saveTeammate]', 'ERROR: ' + String(error));
      return { success: false, msg: String(error) };
    }
  });

  // --- dispatch.get-child-transcript ---
  ipcBridge.dispatch.getChildTranscript.provider(async (params) => {
    mainLog('[DispatchBridge:getChildTranscript]', 'received', params);
    try {
      // Query messages directly via repository to avoid IPC round-trip in the process layer
      const pageSize = params.limit || 50;
      const offset = params.offset || 0;
      const result = conversationRepo
        ? await conversationRepo.getMessages(params.childSessionId, offset, pageSize)
        : { data: [] as Array<{ position?: string; content: unknown; createdAt?: number }> };
      const dbMessages = result.data;
      const conversation = await conversationService.getConversation(params.childSessionId);

      const messages = (dbMessages || []).map((msg) => ({
        role: msg.position === 'right' ? 'user' : 'assistant',
        content: typeof msg.content === 'string' ? msg.content : (msg.content as { content?: string })?.content || '',
        timestamp: msg.createdAt || Date.now(),
      }));

      return {
        success: true,
        data: {
          messages,
          status: conversation?.status || 'unknown',
        },
      };
    } catch (error) {
      mainWarn('[DispatchBridge:getChildTranscript]', 'ERROR: ' + String(error));
      return { success: false, msg: String(error) };
    }
  });
}
