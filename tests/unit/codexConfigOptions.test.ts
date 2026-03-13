/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDefaultAcpConfigOptions } from '../../src/common/codex/codexConfigOptions';
import { describe, expect, it } from 'vitest';

describe('codex config options defaults', () => {
  it('provides Guid fallback reasoning options for codex', () => {
    expect(getDefaultAcpConfigOptions('codex')).toEqual([
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
    ]);
  });

  it('does not expose fallback config options for other backends', () => {
    expect(getDefaultAcpConfigOptions('claude')).toEqual([]);
  });
});
