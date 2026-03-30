/**
 * Unit tests for dispatchPrompt Phase 5 features.
 * Test IDs: DP-P5-001 through DP-P5-007.
 *
 * Covers:
 * - F-5.5: Error handling section in prompt output
 * - Prompt structure verification
 * - Optional sections (leader profile, available models, custom instructions)
 */

import { describe, it, expect } from 'vitest';
import { buildDispatchSystemPrompt } from '../../../src/process/task/dispatch/dispatchPrompt';

describe('dispatchPrompt Phase 5', () => {
  // ==================== F-5.5: Error handling section ====================

  describe('DP-P5-001: error handling section is present', () => {
    it('includes Error Handling header in base prompt', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).toContain('## Error Handling');
    });
  });

  describe('DP-P5-002: error handling includes retry guidance', () => {
    it('mentions retrying failed tasks', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).toContain('retry');
    });

    it('mentions reading transcript on failure', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).toContain('read');
      expect(prompt).toContain('transcript');
    });

    it('limits retry count', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).toMatch(/retry.*2|2.*retry|not retry more than 2/i);
    });
  });

  describe('DP-P5-003: error handling distinguishes transient vs persistent errors', () => {
    it('mentions transient errors', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).toMatch(/transient/i);
    });

    it('mentions persistent errors', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).toMatch(/persistent/i);
    });
  });

  // ==================== Base prompt structure ====================

  describe('DP-P5-004: base prompt includes all 4 tools', () => {
    it('mentions start_task, read_transcript, list_sessions, send_message', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).toContain('start_task');
      expect(prompt).toContain('read_transcript');
      expect(prompt).toContain('list_sessions');
      expect(prompt).toContain('send_message');
    });
  });

  describe('DP-P5-005: prompt includes dispatcher name', () => {
    it('embeds the given dispatcher name', () => {
      const prompt = buildDispatchSystemPrompt('AlphaDispatcher');
      expect(prompt).toContain('AlphaDispatcher');
    });
  });

  // ==================== Optional sections ====================

  describe('DP-P5-006: optional leader profile section', () => {
    it('includes leader profile when provided', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        leaderProfile: 'You are a senior architect.',
      });
      expect(prompt).toContain('## Leader Agent Profile');
      expect(prompt).toContain('You are a senior architect.');
    });

    it('omits leader profile section when not provided', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).not.toContain('## Leader Agent Profile');
    });
  });

  describe('DP-P5-007: optional available models section', () => {
    it('includes model list when provided', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        availableModels: [
          { providerId: 'openai', models: ['gpt-4o', 'gpt-4o-mini'] },
          { providerId: 'google', models: ['gemini-2.5-pro'] },
        ],
      });
      expect(prompt).toContain('## Available Models');
      expect(prompt).toContain('gpt-4o');
      expect(prompt).toContain('gemini-2.5-pro');
    });

    it('omits model section when empty array', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        availableModels: [],
      });
      expect(prompt).not.toContain('## Available Models');
    });

    it('omits model section when not provided', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {});
      expect(prompt).not.toContain('## Available Models');
    });
  });
});

// ==================== Phase 6 Tests ====================

describe('dispatchPrompt Phase 6', () => {
  // ==================== F-6.1: Workspace section ====================

  describe('DP-P6-001: workspace section included when provided', () => {
    it('includes Workspace header and path', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        workspace: '/home/user/project',
      });
      expect(prompt).toContain('## Workspace');
      expect(prompt).toContain('/home/user/project');
    });

    it('mentions workspace override for child tasks', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        workspace: '/home/user/project',
      });
      expect(prompt).toContain('workspace');
      expect(prompt).toMatch(/child.*task|start_task/i);
    });
  });

  describe('DP-P6-002: workspace section omitted when not provided', () => {
    it('omits Workspace header when workspace is undefined', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      expect(prompt).not.toContain('## Workspace');
    });

    it('omits Workspace header when options object has no workspace', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {});
      expect(prompt).not.toContain('## Workspace');
    });

    it('omits Workspace header when workspace is empty string', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', { workspace: '' });
      expect(prompt).not.toContain('## Workspace');
    });
  });

  // ==================== F-6.2: Dynamic concurrent limit in prompt ====================

  describe('DP-P6-003: maxConcurrentChildren reflected in constraints', () => {
    it('uses provided maxConcurrentChildren value in constraint text', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        maxConcurrentChildren: 7,
      });
      expect(prompt).toContain('7 concurrent child tasks');
    });

    it('uses DEFAULT_CONCURRENT_CHILDREN when maxConcurrentChildren not provided', () => {
      const prompt = buildDispatchSystemPrompt('TestBot');
      // DEFAULT_CONCURRENT_CHILDREN is 3
      expect(prompt).toContain('3 concurrent child tasks');
    });

    it('uses DEFAULT_CONCURRENT_CHILDREN when maxConcurrentChildren is undefined in options', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        maxConcurrentChildren: undefined,
      });
      expect(prompt).toContain('3 concurrent child tasks');
    });
  });

  describe('DP-P6-004: workspace and concurrent limit together', () => {
    it('includes both workspace and custom concurrent limit', () => {
      const prompt = buildDispatchSystemPrompt('TestBot', {
        workspace: '/opt/myproject',
        maxConcurrentChildren: 5,
      });
      expect(prompt).toContain('## Workspace');
      expect(prompt).toContain('/opt/myproject');
      expect(prompt).toContain('5 concurrent child tasks');
    });
  });
});
