/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Channel Handler
 *
 * Replaces initChannelBridge() from src/process/bridge/channelBridge.ts.
 * Handles plugin management, pairing, user management, sessions, and settings sync.
 */

import type { WsRouter } from '../router/WsRouter';
import type { IChannelPluginStatus } from '@process/channels/types';
import { hasPluginCredentials } from '@process/channels/types';
import type { IChannelRepository } from '@process/services/database/IChannelRepository';
import { getChannelManager } from '@process/channels/core/ChannelManager';
import { getPairingService } from '@process/channels/pairing/PairingService';
import { ExtensionRegistry } from '@process/extensions';
import { toAssetUrl } from '@process/extensions/protocol/assetProtocol';
import * as path from 'path';

const BUILTIN_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'slack', 'discord', 'weixin']);

const BUILTIN_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  lark: 'Lark',
  dingtalk: 'DingTalk',
  slack: 'Slack',
  discord: 'Discord',
  weixin: 'WeChat',
};

/**
 * Resolve extension metadata for a channel plugin type.
 */
function resolveExtensionMeta(
  registry: ReturnType<typeof ExtensionRegistry.getInstance>,
  extensions: ReturnType<ReturnType<typeof ExtensionRegistry.getInstance>['getLoadedExtensions']>,
  pluginType: string,
): IChannelPluginStatus['extensionMeta'] | undefined {
  try {
    const meta = registry.getChannelPluginMeta(pluginType);
    if (!meta || typeof meta !== 'object') return undefined;
    const m = meta as Record<string, unknown>;
    const extensionMeta: NonNullable<IChannelPluginStatus['extensionMeta']> = {
      credentialFields: Array.isArray(m.credentialFields) ? m.credentialFields : undefined,
      configFields: Array.isArray(m.configFields) ? m.configFields : undefined,
      description: typeof m.description === 'string' ? m.description : undefined,
    };

    const ext = extensions.find((e) =>
      e.manifest.contributes.channelPlugins?.some((cp) => cp.type === pluginType),
    );
    if (ext) {
      extensionMeta.extensionName = ext.manifest.displayName || ext.manifest.name;
      const iconField = typeof m.icon === 'string' ? m.icon : undefined;
      if (iconField) {
        if (
          iconField.startsWith('http://') ||
          iconField.startsWith('https://') ||
          iconField.startsWith('data:') ||
          iconField.startsWith('file://') ||
          iconField.startsWith('aion-asset://')
        ) {
          extensionMeta.icon = iconField;
        } else {
          const absPath = path.isAbsolute(iconField) ? iconField : path.resolve(ext.directory, iconField);
          extensionMeta.icon = toAssetUrl(absPath);
        }
      }
    }

    return extensionMeta;
  } catch {
    return undefined;
  }
}

/**
 * Register all channel-related endpoint handlers on the WsRouter.
 */
export function registerChannelHandlers(router: WsRouter, channelRepo: IChannelRepository): void {
  // ==================== Plugin Management ====================

  router.handle('channel.get-plugin-status', async () => {
    try {
      let dbPlugins: import('@process/channels/types').IChannelPluginConfig[] = [];
      try {
        dbPlugins = await channelRepo.getChannelPlugins();
      } catch (dbError) {
        console.warn('[ChannelHandler] getChannelPlugins failed, proceeding with builtin-only list:', dbError);
      }

      const registry = ExtensionRegistry.getInstance();
      const extensions = registry.getLoadedExtensions();

      // Build a set of channel types whose parent extension is currently enabled
      const enabledExtChannelTypes = new Set<string>();
      for (const [pluginType] of registry.getChannelPlugins()) {
        enabledExtChannelTypes.add(pluginType);
      }

      const statusMap = new Map<string, IChannelPluginStatus>();

      for (const plugin of dbPlugins) {
        const isExtension = !BUILTIN_TYPES.has(plugin.type);

        // Skip extension channels whose parent extension is not loaded/enabled
        if (isExtension && !enabledExtChannelTypes.has(plugin.type)) {
          continue;
        }

        statusMap.set(plugin.type, {
          id: plugin.id,
          type: plugin.type,
          name: plugin.name,
          enabled: plugin.enabled,
          connected: plugin.status === 'running',
          status: plugin.status,
          lastConnected: plugin.lastConnected,
          activeUsers: 0,
          hasToken: hasPluginCredentials(plugin.type, plugin.credentials),
          isExtension,
          extensionMeta: isExtension ? resolveExtensionMeta(registry, extensions, plugin.type) : undefined,
        });
      }

      // Ensure extension-contributed channel plugins are always visible
      for (const [pluginType, entry] of registry.getChannelPlugins()) {
        if (statusMap.has(pluginType)) continue;
        const extensionMeta = resolveExtensionMeta(registry, extensions, pluginType);
        const meta = entry.meta as { name?: string } | undefined;
        statusMap.set(pluginType, {
          id: pluginType,
          type: pluginType,
          name: meta?.name || pluginType,
          enabled: false,
          connected: false,
          status: 'stopped',
          activeUsers: 0,
          hasToken: false,
          isExtension: true,
          extensionMeta,
        });
      }

      // Ensure builtin channel types are always visible
      for (const builtinType of BUILTIN_TYPES) {
        if (statusMap.has(builtinType)) continue;
        statusMap.set(builtinType, {
          id: builtinType,
          type: builtinType,
          name: BUILTIN_NAMES[builtinType] || builtinType,
          enabled: false,
          connected: false,
          status: 'stopped',
          activeUsers: 0,
          hasToken: false,
          isExtension: false,
        });
      }

      return { success: true, data: Array.from(statusMap.values()) };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] getPluginStatus error:', error);
      return { success: false, msg };
    }
  });

  router.handle('channel.enable-plugin', async ({ pluginId, config }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.enablePlugin(pluginId, config);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] enablePlugin error:', error);
      return { success: false, msg };
    }
  });

  router.handle('channel.disable-plugin', async ({ pluginId }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.disablePlugin(pluginId);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] disablePlugin error:', error);
      return { success: false, msg };
    }
  });

  router.handle('channel.test-plugin', async ({ pluginId, token, extraConfig }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.testPlugin(pluginId, token, extraConfig);
      return { success: true, data: result };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] testPlugin error:', error);
      return { success: false, data: { success: false, error: errorMsg } };
    }
  });

  // ==================== Pairing Management ====================

  router.handle('channel.get-pending-pairings', async () => {
    try {
      const data = await channelRepo.getPendingPairingRequests();
      return { success: true, data };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] getPendingPairings error:', error);
      return { success: false, msg };
    }
  });

  router.handle('channel.approve-pairing', async ({ code }) => {
    try {
      const pairingService = getPairingService();
      const result = await pairingService.approvePairing(code);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] approvePairing error:', error);
      return { success: false, msg };
    }
  });

  router.handle('channel.reject-pairing', async ({ code }) => {
    try {
      const pairingService = getPairingService();
      const result = await pairingService.rejectPairing(code);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] rejectPairing error:', error);
      return { success: false, msg };
    }
  });

  // ==================== User Management ====================

  router.handle('channel.get-authorized-users', async () => {
    try {
      const data = await channelRepo.getChannelUsers();
      return { success: true, data };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] getAuthorizedUsers error:', error);
      return { success: false, msg };
    }
  });

  router.handle('channel.revoke-user', async ({ userId }) => {
    try {
      await channelRepo.deleteChannelUser(userId);
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] revokeUser error:', error);
      return { success: false, msg };
    }
  });

  // ==================== Session Management ====================

  router.handle('channel.get-active-sessions', async () => {
    try {
      const data = await channelRepo.getChannelSessions();
      return { success: true, data };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] getActiveSessions error:', error);
      return { success: false, msg };
    }
  });

  // ==================== Settings Sync ====================

  router.handle('channel.sync-channel-settings', async ({ platform, agent, model }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.syncChannelSettings(platform, agent, model);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChannelHandler] syncChannelSettings error:', error);
      return { success: false, msg };
    }
  });
}
