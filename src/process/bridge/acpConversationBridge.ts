/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { agentRegistry } from '@process/agent/AgentRegistry';
import { isAgentKind } from '@/common/types/detectedAgent';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
import { AcpBridgeAdapter } from '@process/acp/runtime/AcpBridgeAdapter';
import type { AcpRuntime } from '@process/acp/runtime/AcpRuntime';
import { GeminiAgentManager } from '@process/task/GeminiAgentManager';
import { AionrsManager } from '@process/task/AionrsManager';
import { mcpService } from '@/process/services/mcpServices/McpService';
import { ipcBridge } from '@/common';
import { LegacyConnectorFactory } from '@process/acp/compat/LegacyConnectorFactory';
import { noopProtocolHandlers } from '@process/acp/types';
import * as os from 'os';

export function initAcpConversationBridge(workerTaskManager: IWorkerTaskManager): void {
  // Debug provider to check environment variables
  ipcBridge.acpConversation.checkEnv.provider(() => {
    return Promise.resolve({
      env: {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ? '[SET]' : '[NOT SET]',
        GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ? '[SET]' : '[NOT SET]',
        NODE_ENV: process.env.NODE_ENV || '[NOT SET]',
      },
    });
  });

  ipcBridge.acpConversation.detectCliPath.provider(({ backend }) => {
    const agents = agentRegistry.getDetectedAgents();
    const agent = agents.find((a) => isAgentKind(a, 'acp') && a.backend === backend);

    if (agent && isAgentKind(agent, 'acp') && agent.cliPath) {
      return Promise.resolve({ success: true, data: { path: agent.cliPath } });
    }

    return Promise.resolve({
      success: false,
      msg: `${backend} CLI not found. Please install it and ensure it's accessible.`,
    });
  });

  // Get all detected execution engines, enriched with MCP transport support info.
  ipcBridge.acpConversation.getAvailableAgents.provider(() => {
    try {
      const agents = agentRegistry.getDetectedAgents();
      const enriched = agents.map((agent) => ({
        ...agent,
        supportedTransports: mcpService.getSupportedTransportsForAgent(agent),
      }));

      // Map to the IPC bridge response shape explicitly
      const data = enriched.map((agent) => ({
        backend: agent.backend,
        name: agent.name,
        kind: agent.kind,
        cliPath: 'cliPath' in agent ? (agent.cliPath as string | undefined) : undefined,
        supportedTransports: agent.supportedTransports,
        isExtension: 'isExtension' in agent ? (agent.isExtension as boolean | undefined) : undefined,
        extensionName: 'extensionName' in agent ? (agent.extensionName as string | undefined) : undefined,
        isPreset: 'isPreset' in agent ? (agent.isPreset as boolean | undefined) : undefined,
        customAgentId: 'customAgentId' in agent ? (agent.customAgentId as string | undefined) : undefined,
      }));
      return Promise.resolve({ success: true as const, data });
    } catch (error) {
      return Promise.resolve({
        success: false as const,
        msg: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Refresh custom ACP agents after the user adds/edits/deletes one in Settings.
  ipcBridge.acpConversation.refreshCustomAgents.provider(async () => {
    await agentRegistry.refreshCustomAgents();
    return { success: true };
  });

  // Test custom agent connection - validates CLI exists and ACP handshake works
  ipcBridge.acpConversation.testCustomAgent.provider(async (params) => {
    const { testCustomAgentConnection } = await import('./testCustomAgentConnection');
    return testCustomAgentConnection(params);
  });

  // Check agent health by sending a real test message
  ipcBridge.acpConversation.checkAgentHealth.provider(async ({ backend }) => {
    const startTime = Date.now();

    // Step 1: Check if CLI is installed
    const agents = agentRegistry.getDetectedAgents();
    const agent = agents.find((a) => isAgentKind(a, 'acp') && a.backend === backend);
    const acpAgent = agent && isAgentKind(agent, 'acp') ? agent : undefined;

    // Skip CLI check for claude/codebuddy (uses npx) and codex (has its own detection)
    if (!acpAgent?.cliPath && backend !== 'claude' && backend !== 'codebuddy' && backend !== 'codex') {
      return {
        success: false,
        msg: `${backend} CLI not found`,
        data: { available: false, error: 'CLI not installed' },
      };
    }

    const tempDir = os.tmpdir();
    const cliPath = acpAgent?.cliPath;
    const acpArgs = acpAgent?.acpArgs;

    // Step 2: For ACP-based agents (claude, codex, gemini, qwen, etc.)
    const factory = new LegacyConnectorFactory();
    const client = factory.create(
      {
        agentBackend: backend,
        agentSource: 'builtin',
        agentId: `health-check-${backend}`,
        cwd: tempDir,
        command: cliPath,
        args: acpArgs,
      },
      noopProtocolHandlers
    );

    try {
      await client.start();
      const session = await client.createSession({ cwd: tempDir });
      await client.prompt(session.sessionId, [{ type: 'text', text: 'hi' }]);

      const latency = Date.now() - startTime;
      await client.close();

      return {
        success: true,
        data: { available: true, latency },
      };
    } catch (error) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      const lowerError = errorMsg.toLowerCase();

      if (
        lowerError.includes('auth') ||
        lowerError.includes('login') ||
        lowerError.includes('credential') ||
        lowerError.includes('api key') ||
        lowerError.includes('unauthorized') ||
        lowerError.includes('forbidden')
      ) {
        return {
          success: false,
          msg: `${backend} not authenticated`,
          data: { available: false, error: 'Not authenticated' },
        };
      }

      return {
        success: false,
        msg: `${backend} health check failed: ${errorMsg}`,
        data: { available: false, error: errorMsg },
      };
    }
  });

  ipcBridge.acpConversation.getMode.provider(({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (!task) {
      return Promise.resolve({
        success: true,
        data: { mode: 'default', initialized: false },
      });
    }
    if (task.type === 'acp') {
      const adapter = new AcpBridgeAdapter(task as AcpRuntime);
      return Promise.resolve({ success: true, data: adapter.getMode() });
    }
    if (task instanceof GeminiAgentManager || task instanceof AionrsManager) {
      return Promise.resolve({ success: true, data: task.getMode() });
    }
    return Promise.resolve({
      success: true,
      data: { mode: 'default', initialized: false },
    });
  });

  ipcBridge.acpConversation.getModelInfo.provider(({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (!task || task.type !== 'acp') {
      return Promise.resolve({ success: true, data: { modelInfo: null } });
    }
    const adapter = new AcpBridgeAdapter(task as AcpRuntime);
    return Promise.resolve({
      success: true,
      data: { modelInfo: adapter.getModelInfo() },
    });
  });

  // Set model for ACP agents
  // 设置 ACP 代理的模型
  ipcBridge.acpConversation.setModel.provider(async ({ conversationId, modelId }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || task.type !== 'acp') {
        return {
          success: false,
          msg: 'Conversation not found or not an ACP agent',
        };
      }
      const adapter = new AcpBridgeAdapter(task as AcpRuntime);
      return {
        success: true,
        data: { modelInfo: await adapter.setModel(modelId) },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  ipcBridge.acpConversation.setMode.provider(async ({ conversationId, mode }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task) {
        return { success: false, msg: 'Conversation not found' };
      }
      if (task.type === 'acp') {
        const adapter = new AcpBridgeAdapter(task as AcpRuntime);
        return await adapter.setMode(mode);
      }
      if (task instanceof GeminiAgentManager || task instanceof AionrsManager) {
        return await task.setMode(mode);
      }
      return {
        success: false,
        msg: 'Mode switching not supported for this agent type',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  ipcBridge.acpConversation.getConfigOptions.provider(({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (!task || task.type !== 'acp') {
      return Promise.resolve({ success: true, data: { configOptions: [] } });
    }
    const adapter = new AcpBridgeAdapter(task as AcpRuntime);
    return Promise.resolve({
      success: true,
      data: { configOptions: adapter.getConfigOptions() },
    });
  });

  ipcBridge.acpConversation.setConfigOption.provider(async ({ conversationId, configId, value }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || task.type !== 'acp') {
        return {
          success: false,
          msg: 'Conversation not found or not an ACP agent',
        };
      }
      const adapter = new AcpBridgeAdapter(task as AcpRuntime);
      const configOptions = await adapter.setConfigOption(configId, value);
      return { success: true, data: { configOptions } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });
}
