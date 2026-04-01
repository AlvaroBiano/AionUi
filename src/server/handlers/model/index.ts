/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model Handler Registry
 *
 * Replaces initModelBridge() from src/process/bridge/modelBridge.ts.
 * Delegates to sub-modules for provider listing, config storage, and protocol detection.
 */

import type { WsRouter } from '../../router/WsRouter';
import { registerModelProviderHandlers } from './providers';
import { registerModelConfigHandlers } from './config';
import { registerModelDetectionHandlers } from './detection';

/**
 * Register all model-related endpoint handlers on the WsRouter.
 */
export function registerModelHandlers(router: WsRouter): void {
  registerModelProviderHandlers(router);
  registerModelConfigHandlers(router);
  registerModelDetectionHandlers(router);
}
