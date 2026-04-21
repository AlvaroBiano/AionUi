/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for guid/hooks/agentSelectionUtils.ts
 * Tests pure functions: getAgentKey, savePreferredMode, savePreferredModelId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock ConfigStorage before importing the module under test ---
const configStorageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: configStorageMock,
}));

import { getAgentKey, savePreferredMode, savePreferredModelId } from '@/renderer/pages/guid/hooks/agentSelectionUtils';
import type { AcpBackend } from '@/common/types/acpTypes';

// ---------------------------------------------------------------------------
// getAgentKey
// ---------------------------------------------------------------------------

describe('getAgentKey', () => {
  it('returns "custom:<uuid>" for custom backend with customAgentId', () => {
    expect(getAgentKey({ backend: 'custom' as AcpBackend, customAgentId: 'abc-123' })).toBe('custom:abc-123');
  });

  it('returns "remote:<uuid>" for remote backend with customAgentId', () => {
    expect(getAgentKey({ backend: 'remote' as AcpBackend, customAgentId: 'remote-99' })).toBe('remote:remote-99');
  });

  it('returns plain backend for custom backend without customAgentId', () => {
    expect(getAgentKey({ backend: 'custom' as AcpBackend })).toBe('custom');
  });

  it('returns plain backend for remote backend without customAgentId', () => {
    expect(getAgentKey({ backend: 'remote' as AcpBackend })).toBe('remote');
  });

  it('returns plain backend for gemini', () => {
    expect(getAgentKey({ backend: 'gemini' as AcpBackend })).toBe('gemini');
  });

  it('returns plain backend for claude', () => {
    expect(getAgentKey({ backend: 'claude' as AcpBackend })).toBe('claude');
  });

  it('returns plain backend for aionrs', () => {
    expect(getAgentKey({ backend: 'aionrs' as AcpBackend })).toBe('aionrs');
  });

  it('returns plain backend for codex', () => {
    expect(getAgentKey({ backend: 'codex' as AcpBackend })).toBe('codex');
  });
});

// ---------------------------------------------------------------------------
// savePreferredMode
// ---------------------------------------------------------------------------

describe('savePreferredMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configStorageMock.get.mockResolvedValue({});
    configStorageMock.set.mockResolvedValue(undefined);
  });

  it('saves preferred mode for gemini agent', async () => {
    configStorageMock.get.mockResolvedValue({ yoloMode: true });
    await savePreferredMode('gemini', 'yolo');

    expect(configStorageMock.get).toHaveBeenCalledWith('gemini.config');
    expect(configStorageMock.set).toHaveBeenCalledWith('gemini.config', {
      yoloMode: true,
      preferredMode: 'yolo',
    });
  });

  it('saves preferred mode for aionrs agent', async () => {
    configStorageMock.get.mockResolvedValue({ someKey: 'val' });
    await savePreferredMode('aionrs', 'default');

    expect(configStorageMock.get).toHaveBeenCalledWith('aionrs.config');
    expect(configStorageMock.set).toHaveBeenCalledWith('aionrs.config', {
      someKey: 'val',
      preferredMode: 'default',
    });
  });

  it('saves preferred mode for a non-gemini non-aionrs backend (e.g. claude)', async () => {
    configStorageMock.get.mockResolvedValue({ claude: { existingKey: 1 } });
    await savePreferredMode('claude', 'bypassPermissions');

    expect(configStorageMock.get).toHaveBeenCalledWith('acp.config');
    expect(configStorageMock.set).toHaveBeenCalledWith('acp.config', {
      claude: { existingKey: 1, preferredMode: 'bypassPermissions' },
    });
  });

  it('does nothing (silent) for "custom" agentKey', async () => {
    await savePreferredMode('custom', 'someMode');
    expect(configStorageMock.set).not.toHaveBeenCalled();
  });

  it('swallows errors silently', async () => {
    configStorageMock.get.mockRejectedValue(new Error('storage error'));
    // Should not throw
    await expect(savePreferredMode('gemini', 'yolo')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// savePreferredModelId
// ---------------------------------------------------------------------------

describe('savePreferredModelId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configStorageMock.get.mockResolvedValue({});
    configStorageMock.set.mockResolvedValue(undefined);
  });

  it('saves preferred model id under acp.config for a backend', async () => {
    configStorageMock.get.mockResolvedValue({ claude: { preferredMode: 'default' } });
    await savePreferredModelId('claude', 'claude-opus-4-6');

    expect(configStorageMock.get).toHaveBeenCalledWith('acp.config');
    expect(configStorageMock.set).toHaveBeenCalledWith('acp.config', {
      claude: { preferredMode: 'default', preferredModelId: 'claude-opus-4-6' },
    });
  });

  it('creates new entry when backend config does not exist', async () => {
    configStorageMock.get.mockResolvedValue({});
    await savePreferredModelId('codex', 'gpt-5.0');

    expect(configStorageMock.set).toHaveBeenCalledWith('acp.config', {
      codex: { preferredModelId: 'gpt-5.0' },
    });
  });

  it('swallows errors silently', async () => {
    configStorageMock.get.mockRejectedValue(new Error('disk error'));
    await expect(savePreferredModelId('claude', 'model-x')).resolves.toBeUndefined();
  });
});
