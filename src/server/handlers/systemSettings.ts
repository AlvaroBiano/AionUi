/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System Settings Handler
 *
 * Handles system-level settings such as close-to-tray, notification preferences,
 * and language changes. Replaces initSystemSettingsBridge() from
 * src/process/bridge/systemSettingsBridge.ts.
 */

import { ProcessConfig } from '@process/utils/initStorage';
import { changeLanguage } from '@server/services/i18n';
import type { WsRouter } from '../router/WsRouter';

type CloseToTrayChangeListener = (enabled: boolean) => void;
let _changeListener: CloseToTrayChangeListener | null = null;

type LanguageChangeListener = () => void;
let _languageChangeListener: LanguageChangeListener | null = null;

/**
 * Register a listener for close-to-tray setting changes (used by server bootstrap).
 */
export function onCloseToTrayChanged(listener: CloseToTrayChangeListener): void {
  _changeListener = listener;
}

/**
 * Register a listener for language changes (used by server bootstrap).
 */
export function onLanguageChanged(listener: LanguageChangeListener): void {
  _languageChangeListener = listener;
}

/**
 * Register system settings endpoint handlers on the WsRouter.
 * Replaces initSystemSettingsBridge() from src/process/bridge/systemSettingsBridge.ts.
 */
export function registerSystemSettingsHandlers(router: WsRouter): void {
  // Get "close to tray" setting
  router.handle('system-settings:get-close-to-tray', async () => {
    const value = await ProcessConfig.get('system.closeToTray');
    return value ?? false;
  });

  // Set "close to tray", persist then notify
  router.handle('system-settings:set-close-to-tray', async ({ enabled }) => {
    await ProcessConfig.set('system.closeToTray', enabled);
    _changeListener?.(enabled);
  });

  // Get "task completion notification" setting
  router.handle('system-settings:get-notification-enabled', async () => {
    const value = await ProcessConfig.get('system.notificationEnabled');
    return value ?? true;
  });

  // Set "task completion notification"
  router.handle('system-settings:set-notification-enabled', async ({ enabled }) => {
    await ProcessConfig.set('system.notificationEnabled', enabled);
  });

  // Get "scheduled task notification" setting
  router.handle('system-settings:get-cron-notification-enabled', async () => {
    const value = await ProcessConfig.get('system.cronNotificationEnabled');
    return value ?? false;
  });

  // Set "scheduled task notification"
  router.handle('system-settings:set-cron-notification-enabled', async ({ enabled }) => {
    await ProcessConfig.set('system.cronNotificationEnabled', enabled);
  });

  // Language change: broadcast to renderers, notify listener, update main-process i18n
  router.handle('system-settings:change-language', async ({ language }) => {
    // Broadcast to all connected clients for real-time sync
    router.emit('system-settings:language-changed', { language });
    _languageChangeListener?.();

    // Update main process i18n (non-blocking)
    changeLanguage(language).catch((error) => {
      console.error('[SystemSettings] Main process changeLanguage failed:', error);
    });
  });
}
