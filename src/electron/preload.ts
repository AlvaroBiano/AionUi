/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal Electron preload script.
 *
 * Exposes only two things to the renderer:
 *   - serverUrl: WebSocket URL for the backend server
 *   - getPathForFile: Electron-only drag-and-drop file path resolution
 *
 * All business logic communication goes through WebSocket (ApiClient),
 * not IPC. This preload replaces the legacy src/preload.ts that exposed
 * a full IPC bridge (emit/on/invoke).
 */

import { contextBridge, webUtils } from 'electron';

// Server URL is passed from the main process via additionalData on the webPreferences.
// In development, fall back to a default local WebSocket URL.
const serverUrl =
  process.argv.find((a: string) => a.startsWith('--server-url='))?.split('=')[1] || 'ws://localhost:3000';

contextBridge.exposeInMainWorld('electronConfig', {
  serverUrl,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
