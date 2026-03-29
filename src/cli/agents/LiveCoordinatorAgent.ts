/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LiveCoordinatorAgent — extends CoordinatorSession with dynamic adjustment
 * and forced verification capabilities. Used by PersistentCoordinatorLoop.
 */

import { CoordinatorSession } from './coordinator';
import type { AgentManagerFactory } from '@process/task/orchestrator/SubTaskSession';

export type LiveCoordinatorOptions = {
  /** Force verification pass after each round. Default true. */
  enableVerification?: boolean;
  /** Enable mid-flight plan adjustments. Default false (experimental). */
  enableMidFlightAdjustments?: boolean;
  /** Max mid-flight adjustments per run. Default 2. */
  maxMidFlightAdjustments?: number;
};

export class LiveCoordinatorAgent extends CoordinatorSession {
  constructor(
    factory: AgentManagerFactory,
    readonly liveOptions: LiveCoordinatorOptions = {},
  ) {
    super(factory);
  }
}
