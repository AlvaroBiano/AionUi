/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CODEX_MODE_FULL_AUTO_NO_SANDBOX, isCodexAutoApproveMode, isCodexNoSandboxMode } from '../../src/common/codex/codexModes';
import { getCodexSandboxModeForSessionMode } from '../../src/process/utils/codexConfig';
import { getAgentModes } from '../../src/renderer/constants/agentModes';
import { describe, expect, it } from 'vitest';

describe('codex mode helpers', () => {
  it('exposes an explicit no-sandbox full auto mode for Codex', () => {
    expect(getAgentModes('codex').map((mode) => mode.value)).toContain(CODEX_MODE_FULL_AUTO_NO_SANDBOX);
  });

  it('treats no-sandbox full auto as auto-approve', () => {
    expect(isCodexAutoApproveMode(CODEX_MODE_FULL_AUTO_NO_SANDBOX)).toBe(true);
    expect(isCodexNoSandboxMode(CODEX_MODE_FULL_AUTO_NO_SANDBOX)).toBe(true);
  });

  it('derives sandbox mode from session mode', () => {
    expect(getCodexSandboxModeForSessionMode('default', 'danger-full-access')).toBe('workspace-write');
    expect(getCodexSandboxModeForSessionMode(CODEX_MODE_FULL_AUTO_NO_SANDBOX, 'workspace-write')).toBe('danger-full-access');
    expect(getCodexSandboxModeForSessionMode(undefined, 'danger-full-access')).toBe('danger-full-access');
  });
});
