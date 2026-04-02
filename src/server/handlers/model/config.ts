/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model config storage operations handler.
 * Extracted from modelBridge.ts — saveModelConfig + getModelConfig endpoints.
 */

import type { WsRouter } from '../../router/WsRouter';
import type { IProvider } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { ProcessConfig } from '@process/utils/initStorage';
import { ExtensionRegistry } from '@server/extensions';

export function registerModelConfigHandlers(router: WsRouter): void {
  router.handle('mode.save-model-config', (models) => {
    return ProcessConfig.set('model.config', models)
      .then(() => {
        return { success: true };
      })
      .catch((e) => {
        return { success: false, msg: e.message || e.toString() };
      });
  });

  router.handle('mode.get-model-config', () => {
    return ProcessConfig.get('model.config')
      .then((data) => {
        const sourceList = Array.isArray(data) ? data : [];

        // Handle migration from old IModel format to new IProvider format
        const normalizedProviders = sourceList.map((v: any) => {
          if ('selectedModel' in v && !('useModel' in v)) {
            return {
              ...v,
              useModel: v.selectedModel,
              id: v.id || uuid(),
              capabilities: v.capabilities || [],
              contextLimit: v.contextLimit,
            } as IProvider;
          }

          return {
            ...v,
            id: v.id || uuid(),
            useModel: v.useModel || v.selectedModel || '',
          } as IProvider;
        });

        // Merge extension-contributed model providers
        try {
          const registry = ExtensionRegistry.getInstance();
          const extensionProviders = registry.getModelProviders();
          if (!extensionProviders || extensionProviders.length === 0) {
            return normalizedProviders;
          }

          const extensionIds = new Set(extensionProviders.map((provider) => provider.id));
          const userProviders = normalizedProviders.filter((provider) => !extensionIds.has(provider.id));

          const mergedExtensionProviders: IProvider[] = extensionProviders.map((provider) => {
            const existing = normalizedProviders.find((item) => item.id === provider.id);
            return {
              ...existing,
              id: provider.id,
              platform: provider.platform,
              name: provider.name,
              baseUrl: existing?.baseUrl || provider.baseUrl || '',
              apiKey: existing?.apiKey || '',
              model: Array.isArray(existing?.model) && existing.model.length > 0 ? existing.model : provider.models,
              enabled: existing?.enabled ?? true,
            } as IProvider;
          });

          return [...userProviders, ...mergedExtensionProviders];
        } catch (error) {
          console.warn('[ModelHandler] Failed to merge extension model providers:', error);
          return normalizedProviders;
        }
      })
      .catch(() => {
        return [] as IProvider[];
      });
  });
}
