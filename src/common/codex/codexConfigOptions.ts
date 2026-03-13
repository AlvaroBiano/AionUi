/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackend, AcpSessionConfigOption } from '@/types/acpTypes';

/**
 * Default Codex config options shown on the Guid page when a live ACP probe
 * hasn't populated cached configOptions yet.
 */
export const DEFAULT_CODEX_CONFIG_OPTIONS: AcpSessionConfigOption[] = [
  {
    id: 'model_reasoning_effort',
    name: 'Reasoning effort',
    category: 'reasoning',
    type: 'select',
    currentValue: 'medium',
    options: [
      { value: 'medium', name: 'Medium' },
      { value: 'high', name: 'High' },
      { value: 'xhigh', name: 'Maximum' },
    ],
  },
];

export function getDefaultAcpConfigOptions(backend: AcpBackend | 'custom' | undefined): AcpSessionConfigOption[] {
  if (backend === 'codex') {
    return DEFAULT_CODEX_CONFIG_OPTIONS;
  }

  return [];
}
