import { describe, it, expect, vi } from 'vitest';

// Mock SVG/PNG imports as strings
vi.mock('@/renderer/assets/logos/ai-major/claude.svg', () => ({ default: 'claude.svg' }));
vi.mock('@/renderer/assets/logos/ai-major/gemini.svg', () => ({ default: 'gemini.svg' }));
vi.mock('@/renderer/assets/logos/ai-china/qwen.svg', () => ({ default: 'qwen.svg' }));
vi.mock('@/renderer/assets/logos/tools/iflow.svg', () => ({ default: 'iflow.svg' }));
vi.mock('@/renderer/assets/logos/tools/coding/codex.svg', () => ({ default: 'codex.svg' }));
vi.mock('@/renderer/assets/logos/tools/coding/codebuddy.svg', () => ({ default: 'codebuddy.svg' }));
vi.mock('@/renderer/assets/logos/brand/droid.svg', () => ({ default: 'droid.svg' }));
vi.mock('@/renderer/assets/logos/tools/goose.svg', () => ({ default: 'goose.svg' }));
vi.mock('@/renderer/assets/logos/brand/auggie.svg', () => ({ default: 'auggie.svg' }));
vi.mock('@/renderer/assets/logos/ai-china/kimi.svg', () => ({ default: 'kimi.svg' }));
vi.mock('@/renderer/assets/logos/tools/coding/opencode-light.svg', () => ({ default: 'opencode-light.svg' }));
vi.mock('@/renderer/assets/logos/tools/coding/opencode-dark.svg', () => ({ default: 'opencode-dark.svg' }));
vi.mock('@/renderer/assets/logos/tools/github.svg', () => ({ default: 'github.svg' }));
vi.mock('@/renderer/assets/logos/tools/openclaw.svg', () => ({ default: 'openclaw.svg' }));
vi.mock('@/renderer/assets/logos/ai-major/mistral.svg', () => ({ default: 'mistral.svg' }));
vi.mock('@/renderer/assets/logos/tools/nanobot.svg', () => ({ default: 'nanobot.svg' }));
vi.mock('@/renderer/assets/logos/tools/coding/qoder.png', () => ({ default: 'qoder.png' }));
vi.mock('@/renderer/assets/logos/tools/coding/cursor.png', () => ({ default: 'cursor.png' }));

import { getAgentLogo, resolveAgentLogo } from '../../src/renderer/utils/model/agentLogo';

describe('agentLogo', () => {
  describe('getAgentLogo', () => {
    it('should return logo for known backends (case-insensitive)', () => {
      expect(getAgentLogo('claude')).toBe('claude.svg');
      expect(getAgentLogo('Claude')).toBe('claude.svg');
      expect(getAgentLogo('CLAUDE')).toBe('claude.svg');
    });

    it('should return null for unknown backends', () => {
      expect(getAgentLogo('unknown')).toBeNull();
      expect(getAgentLogo('custom')).toBeNull();
    });

    it('should return null for null/undefined', () => {
      expect(getAgentLogo(null)).toBeNull();
      expect(getAgentLogo(undefined)).toBeNull();
    });

    it('should return logo for common agents', () => {
      expect(getAgentLogo('gemini')).toBe('gemini.svg');
      expect(getAgentLogo('qwen')).toBe('qwen.svg');
      expect(getAgentLogo('auggie')).toBe('auggie.svg');
      expect(getAgentLogo('goose')).toBe('goose.svg');
      expect(getAgentLogo('copilot')).toBe('github.svg');
    });
  });

  describe('resolveAgentLogo', () => {
    it('should return icon when provided (highest priority)', () => {
      expect(resolveAgentLogo({ icon: '/my/icon.png', backend: 'claude' })).toBe('/my/icon.png');
    });

    it('should return null for extension agents without explicit icon (avatar is extension author responsibility)', () => {
      const logo = resolveAgentLogo({
        backend: 'custom',
        customAgentId: 'ext:aionext-claude:claude',
        isExtension: true,
      });
      expect(logo).toBeNull();
    });

    it('should fall back to backend logo when not an extension', () => {
      expect(resolveAgentLogo({ backend: 'gemini' })).toBe('gemini.svg');
    });

    it('should return null for custom backend without extension info', () => {
      expect(resolveAgentLogo({ backend: 'custom' })).toBeNull();
    });

    it('should return null when nothing matches', () => {
      expect(resolveAgentLogo({})).toBeNull();
      expect(resolveAgentLogo({ backend: 'unknown-thing' })).toBeNull();
    });

    it('should return null for extension agents even with recognizable adapter ID', () => {
      // Extension agent: avatar is the extension author's responsibility, not built-in logo map
      const logo = resolveAgentLogo({
        backend: 'custom',
        customAgentId: 'ext:aionext-auggie:auggie',
        isExtension: true,
      });
      expect(logo).toBeNull();
    });

    it('should return explicit icon for extension agents when provided', () => {
      const logo = resolveAgentLogo({
        icon: 'aion-asset://asset/extensions/aionext-auggie/resources/avatar.svg',
        backend: 'custom',
        customAgentId: 'ext:aionext-auggie:auggie',
        isExtension: true,
      });
      expect(logo).toBe('aion-asset://asset/extensions/aionext-auggie/resources/avatar.svg');
    });
  });
});
