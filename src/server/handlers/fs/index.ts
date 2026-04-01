/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Filesystem Handler Registry
 *
 * Replaces initFsBridge() from src/process/bridge/fsBridge.ts.
 * Delegates to sub-modules for file operations, skill CRUD, and assistant operations.
 */

import type { WsRouter } from '../../router/WsRouter';
import { registerFileOpsHandlers } from './fileOps';
import { registerSkillOpsHandlers } from './skillOps';
import { registerAssistantOpsHandlers } from './assistantOps';

/**
 * Register all filesystem-related endpoint handlers on the WsRouter.
 */
export function registerFsHandlers(router: WsRouter): void {
  registerFileOpsHandlers(router);
  registerSkillOpsHandlers(router);
  registerAssistantOpsHandlers(router);
}
