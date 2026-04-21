// tests/unit/process/acp/runtime/BackendPolicy.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createBackendPolicy } from '@process/acp/runtime/BackendPolicy';
import type { BackendPolicy } from '@process/acp/runtime/BackendPolicy';
import type { ContentBlock } from '@agentclientprotocol/sdk';

vi.mock('@process/task/codexConfig', () => ({
  getCodexSandboxModeForSessionMode: vi.fn((mode: string) =>
    mode === 'danger-full-access' ? 'danger-full-access' : 'workspace-write'
  ),
  writeCodexSandboxMode: vi.fn().mockResolvedValue(undefined),
}));

describe('BackendPolicy', () => {
  describe('createBackendPolicy', () => {
    it('returns ClaudePolicy for claude backend', () => {
      const policy = createBackendPolicy('claude');
      expect(policy.backend).toBe('claude');
    });

    it('returns CodexPolicy for codex backend', () => {
      const policy = createBackendPolicy('codex');
      expect(policy.backend).toBe('codex');
    });

    it('returns SnowPolicy for snow backend', () => {
      const policy = createBackendPolicy('snow');
      expect(policy.backend).toBe('snow');
    });

    it('returns QwenPolicy for qwen backend', () => {
      const policy = createBackendPolicy('qwen');
      expect(policy.backend).toBe('qwen');
    });

    it('returns DefaultPolicy for unknown backends', () => {
      const policy = createBackendPolicy('gemini');
      expect(policy.backend).toBe('gemini');
    });
  });

  describe('DefaultPolicy', () => {
    let policy: BackendPolicy;
    beforeEach(() => {
      policy = createBackendPolicy('gemini');
    });

    it('beforePrompt returns content unchanged', () => {
      const content: ContentBlock[] = [{ type: 'text', text: 'hello' }];
      expect(policy.beforePrompt(content)).toBe(content);
    });

    it('interceptSetMode does not intercept', () => {
      expect(policy.interceptSetMode('some-mode')).toEqual({ intercepted: false });
    });

    it('tracks model override', () => {
      expect(policy.getModelOverride()).toBeNull();
      policy.setModelOverride('gpt-4');
      expect(policy.getModelOverride()).toBe('gpt-4');
    });

    it('getLoginCommand returns null', () => {
      expect(policy.getLoginCommand()).toBeNull();
    });

    it('tryAuthRetry returns true first time, false second time', () => {
      expect(policy.tryAuthRetry()).toBe(true);
      expect(policy.tryAuthRetry()).toBe(false);
    });

    it('enhanceErrorMessage returns message unchanged', () => {
      expect(policy.enhanceErrorMessage('some error')).toBe('some error');
    });

    it('getYoloModeId returns yolo for unknown backends', () => {
      expect(policy.getYoloModeId()).toBe('yolo');
    });
  });

  describe('ClaudePolicy', () => {
    let policy: BackendPolicy;
    beforeEach(() => {
      policy = createBackendPolicy('claude');
    });

    it('queues model switch notice on onModelChanged', () => {
      policy.onModelChanged('claude-4-opus', 'claude-4-sonnet');
      const content: ContentBlock[] = [{ type: 'text', text: 'hello' }];
      const result = policy.beforePrompt(content);

      // Notice prepended
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('text');
      expect((result[0] as { text: string }).text).toContain('<system-reminder>');
      expect((result[0] as { text: string }).text).toContain('claude-4-opus');
    });

    it('consumes model switch notice on first beforePrompt', () => {
      policy.onModelChanged('claude-4-opus', null);

      const content: ContentBlock[] = [{ type: 'text', text: 'hello' }];
      const first = policy.beforePrompt(content);
      expect(first).toHaveLength(2); // notice + original

      // Second call should not have the notice
      const second = policy.beforePrompt(content);
      expect(second).toBe(content); // unchanged
    });

    it('beforePrompt returns unchanged when no pending notice', () => {
      const content: ContentBlock[] = [{ type: 'text', text: 'hello' }];
      expect(policy.beforePrompt(content)).toBe(content);
    });

    it('getLoginCommand returns claude /login', () => {
      const cmd = policy.getLoginCommand();
      expect(cmd).toEqual({ command: 'claude', args: ['/login'] });
    });

    it('getYoloModeId returns bypassPermissions', () => {
      expect(policy.getYoloModeId()).toBe('bypassPermissions');
    });
  });

  describe('CodexPolicy', () => {
    let policy: BackendPolicy;
    beforeEach(() => {
      policy = createBackendPolicy('codex');
    });

    it('intercepts setMode and writes sandbox config', () => {
      const result = policy.interceptSetMode('some-mode');
      expect(result).toEqual({ intercepted: true, localModeId: 'some-mode' });
    });

    it('does not intercept other methods', () => {
      const content: ContentBlock[] = [{ type: 'text', text: 'hello' }];
      expect(policy.beforePrompt(content)).toBe(content);
    });
  });

  describe('SnowPolicy', () => {
    let policy: BackendPolicy;
    beforeEach(() => {
      policy = createBackendPolicy('snow');
    });

    it('intercepts setMode without sandbox config', () => {
      const result = policy.interceptSetMode('some-mode');
      expect(result).toEqual({ intercepted: true, localModeId: 'some-mode' });
    });
  });

  describe('QwenPolicy', () => {
    let policy: BackendPolicy;
    beforeEach(() => {
      policy = createBackendPolicy('qwen');
    });

    it('enhances Internal error with troubleshooting', () => {
      const enhanced = policy.enhanceErrorMessage('Internal error');
      expect(enhanced).toContain('Qwen troubleshooting');
      expect(enhanced).toContain('DASHSCOPE_API_KEY');
    });

    it('does not enhance other errors', () => {
      expect(policy.enhanceErrorMessage('timeout')).toBe('timeout');
    });

    it('getLoginCommand returns qwen login', () => {
      const cmd = policy.getLoginCommand();
      expect(cmd).toEqual({ command: 'qwen', args: ['login'] });
    });

    it('getYoloModeId returns yolo', () => {
      expect(policy.getYoloModeId()).toBe('yolo');
    });
  });
});
