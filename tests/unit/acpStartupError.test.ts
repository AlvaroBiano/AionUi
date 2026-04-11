/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildStartupErrorMessage,
  classifyStartupError,
  type AcpStartupErrorPhase,
} from '../../src/process/agent/acp/AcpErrors';

describe('classifyStartupError', () => {
  it('should classify auth errors', () => {
    const result = classifyStartupError('claude', 1, null, 'authentication required', undefined, null);
    expect(result.phase).toBe('auth');
    expect(result.message).toContain('requires authentication');
  });

  it('should classify install failures', () => {
    const result = classifyStartupError('auggie', 1, null, 'onInstall hook failed: ENOSPC', undefined, null);
    expect(result.phase).toBe('install');
    expect(result.message).toContain('installation failed');
  });

  it('should classify command not found as runtime', () => {
    const result = classifyStartupError('codex', 127, null, 'codex: command not found', undefined, 'codex');
    expect(result.phase).toBe('runtime');
    expect(result.message).toContain("'codex' CLI not found");
    expect(result.message).toContain('Agent Hub');
  });

  it('should classify ENOENT in spawnError as runtime', () => {
    const result = classifyStartupError('gemini', 1, null, '', 'spawn gemini ENOENT', 'gemini');
    expect(result.phase).toBe('runtime');
    expect(result.message).toContain("'gemini' CLI not found");
  });

  it('should classify config loading error as runtime', () => {
    const stderr = 'Error: error loading config: /Users/test/.codex/config.toml:10:1: invalid type';
    const result = classifyStartupError('codex', 1, null, stderr, undefined, null);
    expect(result.phase).toBe('runtime');
    expect(result.message).toContain('config file error');
    expect(result.message).toContain('/Users/test/.codex/config.toml');
  });

  it('should classify exit code 0 without stderr as ACP mode not supported', () => {
    const result = classifyStartupError('codex', 0, null, '', undefined, null);
    expect(result.phase).toBe('runtime');
    expect(result.message).toContain('does not support ACP');
  });

  it('should classify exit code 0 with stderr as runtime', () => {
    const stderr = 'Error: error loading config: /Users/test/.codex/config.toml:10:1';
    const result = classifyStartupError('codex', 0, null, stderr, undefined, null);
    expect(result.phase).toBe('runtime');
    // code=0 with stderr is generic runtime failure, not config error
    expect(result.message).toContain('failed to start');
  });

  it('should classify generic failure with stderr as runtime', () => {
    const result = classifyStartupError('codex', 1, null, 'some error output', undefined, null);
    expect(result.phase).toBe('runtime');
    expect(result.stderr).toBe('some error output');
  });

  it('should classify generic failure without stderr as unknown', () => {
    const result = classifyStartupError('codex', 1, 'SIGTERM' as NodeJS.Signals, '', undefined, null);
    expect(result.phase).toBe('unknown');
    expect(result.message).toContain('SIGTERM');
  });

  it('should handle config error without extractable path', () => {
    const stderr = 'Error: error loading config';
    const result = classifyStartupError('codex', 1, null, stderr, undefined, null);
    expect(result.phase).toBe('runtime');
    expect(result.message).toContain('the CLI config file');
  });

  it('should prioritize auth over command-not-found when both match', () => {
    const stderr = 'authentication required: command not found';
    const result = classifyStartupError('codex', 1, null, stderr, undefined, null);
    // Auth is checked first
    expect(result.phase).toBe('auth');
  });
});

describe('buildStartupErrorMessage', () => {
  it('should include stderr in message when present', () => {
    const msg = buildStartupErrorMessage('codex', 1, null, 'some error output', undefined, null);
    expect(msg).toContain('some error output');
    expect(msg).toContain('codex');
  });

  it('should return message without stderr for clean failures', () => {
    const msg = buildStartupErrorMessage('codex', 1, 'SIGTERM' as NodeJS.Signals, '', undefined, null);
    expect(msg).toContain('codex');
    expect(msg).toContain('SIGTERM');
  });

  it('should detect "command not found" and provide CLI hint', () => {
    const msg = buildStartupErrorMessage('codex', 127, null, 'codex: command not found', undefined, 'codex');
    expect(msg).toContain("'codex' CLI not found");
    expect(msg).toContain('Agent Hub');
  });

  it('should detect ENOENT in spawnError and provide CLI hint', () => {
    const msg = buildStartupErrorMessage('gemini', 1, null, '', 'spawn gemini ENOENT', 'gemini');
    expect(msg).toContain("'gemini' CLI not found");
  });

  it('should detect config loading error and extract config path', () => {
    const stderr = 'Error: error loading config: /Users/test/.codex/config.toml:10:1: invalid type: integer `2`';
    const msg = buildStartupErrorMessage('codex', 1, null, stderr, undefined, null);
    expect(msg).toContain('config file error');
    expect(msg).toContain('/Users/test/.codex/config.toml');
    expect(msg).toContain(stderr);
  });
});
