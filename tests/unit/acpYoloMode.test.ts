/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { resolveYoloMode, YOLO_MODE_FALLBACK } from '@process/agent/acp/constants';
import type { AcpSessionConfigOption } from '@/common/types/acpTypes';

describe('YOLO_MODE_FALLBACK', () => {
  it('contains correct fallback values', () => {
    expect(YOLO_MODE_FALLBACK.claude).toBe('bypassPermissions');
    expect(YOLO_MODE_FALLBACK.codebuddy).toBe('bypassPermissions');
    expect(YOLO_MODE_FALLBACK.qwen).toBe('yolo');
    expect(YOLO_MODE_FALLBACK.iflow).toBe('yolo');
  });
});

describe('resolveYoloMode', () => {
  const configWithYolo: AcpSessionConfigOption[] = [
    {
      id: 'mode',
      category: 'mode',
      type: 'select',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'plan', name: 'Plan' },
        { value: 'yolo', name: 'YOLO' },
      ],
    },
  ];

  const configWithBypassPermissions: AcpSessionConfigOption[] = [
    {
      id: 'mode',
      category: 'mode',
      type: 'select',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'acceptEdits', name: 'Accept Edits' },
        { value: 'bypassPermissions', name: 'YOLO' },
      ],
    },
  ];

  const configWithoutYolo: AcpSessionConfigOption[] = [
    {
      id: 'mode',
      category: 'mode',
      type: 'select',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'plan', name: 'Plan' },
      ],
    },
  ];

  const configNoMode: AcpSessionConfigOption[] = [
    {
      id: 'thought_level',
      category: 'other',
      type: 'select',
      options: [{ value: 'high' }],
    },
  ];

  it('detects yolo from configOptions for unknown backend', () => {
    expect(resolveYoloMode('newbackend', configWithYolo)).toBe('yolo');
  });

  it('detects bypassPermissions from configOptions', () => {
    expect(resolveYoloMode('claude', configWithBypassPermissions)).toBe('bypassPermissions');
  });

  it('falls back to YOLO_MODE_FALLBACK when configOptions has no YOLO option', () => {
    expect(resolveYoloMode('claude', configWithoutYolo)).toBe('bypassPermissions');
  });

  it('falls back to YOLO_MODE_FALLBACK when configOptions has no mode category', () => {
    expect(resolveYoloMode('qwen', configNoMode)).toBe('yolo');
  });

  it('falls back to YOLO_MODE_FALLBACK when configOptions is null', () => {
    expect(resolveYoloMode('iflow', null)).toBe('yolo');
  });

  it('falls back to YOLO_MODE_FALLBACK when configOptions is undefined', () => {
    expect(resolveYoloMode('codebuddy', undefined)).toBe('bypassPermissions');
  });

  it('falls back to YOLO_MODE_FALLBACK when configOptions is empty', () => {
    expect(resolveYoloMode('claude', [])).toBe('bypassPermissions');
  });

  it('returns undefined for backend without YOLO support and no configOptions', () => {
    expect(resolveYoloMode('opencode', undefined)).toBeUndefined();
  });

  it('returns undefined for backend without YOLO support and configOptions with no YOLO option', () => {
    expect(resolveYoloMode('opencode', configWithoutYolo)).toBeUndefined();
  });

  it('prefers configOptions over fallback when both available', () => {
    // configWithYolo has 'yolo', but claude fallback is 'bypassPermissions'
    // Since configOptions is checked first and 'yolo' is in YOLO_MODE_VALUES, it should return 'yolo'
    expect(resolveYoloMode('claude', configWithYolo)).toBe('yolo');
  });
});
