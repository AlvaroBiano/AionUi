import { describe, it, expect } from 'vitest';
import { sanitizeSkillName } from '@process/bridge/skillUtils';

describe('sanitizeSkillName', () => {
  it('returns the name unchanged when it contains no special characters', () => {
    expect(sanitizeSkillName('my-skill')).toBe('my-skill');
  });

  it('replaces forward slashes with hyphens', () => {
    expect(sanitizeSkillName('Claude API / Assistant')).toBe('Claude API - Assistant');
  });

  it('replaces backslashes with hyphens', () => {
    expect(sanitizeSkillName('skill\\sub')).toBe('skill-sub');
  });

  it('replaces colons with hyphens', () => {
    expect(sanitizeSkillName('skill:v2')).toBe('skill-v2');
  });

  it('replaces Windows-invalid characters (*?"<>|) with hyphens', () => {
    expect(sanitizeSkillName('skill*name?v2')).toBe('skill-name-v2');
    expect(sanitizeSkillName('skill<name>v2')).toBe('skill-name-v2');
    expect(sanitizeSkillName('skill|name')).toBe('skill-name');
  });

  it('collapses consecutive invalid characters into a single hyphen', () => {
    expect(sanitizeSkillName('a/\\:b')).toBe('a-b');
  });

  it('strips leading and trailing hyphens from sanitization', () => {
    expect(sanitizeSkillName('/skill/')).toBe('skill');
    expect(sanitizeSkillName(':::skill:::')).toBe('skill');
  });

  it('returns empty string when name is entirely invalid characters', () => {
    expect(sanitizeSkillName('///')).toBe('');
    expect(sanitizeSkillName('***')).toBe('');
  });

  it('preserves spaces and other valid characters', () => {
    expect(sanitizeSkillName('My Cool Skill 2.0')).toBe('My Cool Skill 2.0');
  });

  it('preserves unicode characters', () => {
    expect(sanitizeSkillName('技能-测试')).toBe('技能-测试');
  });

  it('handles names that are already valid directory names', () => {
    expect(sanitizeSkillName('1password')).toBe('1password');
    expect(sanitizeSkillName('claude-api')).toBe('claude-api');
    expect(sanitizeSkillName('mcp-builder')).toBe('mcp-builder');
  });
});
