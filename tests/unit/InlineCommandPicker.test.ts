/**
 * Tests for InlineCommandPicker — command registry, filtering, and inject logic.
 * TTY-dependent rendering is not tested here (requires real terminal).
 */
import { describe, it, expect } from 'vitest';

// We test the exported class in non-TTY mode (process.stdout.isTTY = false in CI)
// so all rendering methods are no-ops and we only test pure logic via public API.
import { InlineCommandPicker } from '../../src/cli/ui/InlineCommandPicker';

describe('InlineCommandPicker — command registry', () => {
  it('includes base commands', () => {
    const picker = new InlineCommandPicker([]);
    // Access private commands via type cast for white-box testing
    const cmds = (picker as unknown as { commands: { name: string }[] }).commands;
    const names = cmds.map((c) => c.name);
    expect(names).toContain('/model');
    expect(names).toContain('/agents');
    expect(names).toContain('/team [goal]');
    expect(names).toContain('/clear');
    expect(names).toContain('/help');
    expect(names).toContain('/exit');
  });

  it('adds per-agent shortcuts when agentKeys provided', () => {
    const picker = new InlineCommandPicker(['claude', 'codex']);
    const cmds = (picker as unknown as { commands: { name: string }[] }).commands;
    const names = cmds.map((c) => c.name);
    expect(names).toContain('/model claude');
    expect(names).toContain('/model codex');
  });

  it('/team [goal] has inject: "/team "', () => {
    const picker = new InlineCommandPicker([]);
    const cmds = (picker as unknown as { commands: { name: string; inject?: string }[] }).commands;
    const teamCmd = cmds.find((c) => c.name === '/team [goal]');
    expect(teamCmd).toBeDefined();
    expect(teamCmd!.inject).toBe('/team ');
  });

  it('all base commands have non-empty descriptions', () => {
    const picker = new InlineCommandPicker([]);
    const cmds = (picker as unknown as { commands: { name: string; description: string }[] }).commands;
    const baseCmds = cmds.filter((c) => !c.name.startsWith('/model ') || c.name === '/model');
    for (const cmd of baseCmds) {
      expect(cmd.description.length, `${cmd.name} missing description`).toBeGreaterThan(0);
    }
  });

  it('per-agent commands have descriptions mentioning agent key', () => {
    const picker = new InlineCommandPicker(['gemini']);
    const cmds = (picker as unknown as { commands: { name: string; description: string }[] }).commands;
    const geminiCmd = cmds.find((c) => c.name === '/model gemini');
    expect(geminiCmd).toBeDefined();
    expect(geminiCmd!.description).toContain('gemini');
  });
});

describe('InlineCommandPicker — getMatchesFor filtering', () => {
  function getMatches(picker: InlineCommandPicker, filter: string) {
    return (picker as unknown as { getMatchesFor: (f: string) => { name: string }[] }).getMatchesFor(filter);
  }

  it('returns all commands when filter is empty', () => {
    const picker = new InlineCommandPicker(['claude']);
    const all = getMatches(picker, '');
    const names = all.map((c) => c.name);
    expect(names).toContain('/model');
    expect(names).toContain('/exit');
  });

  it('filters by prefix — /m matches /model and /model claude', () => {
    const picker = new InlineCommandPicker(['claude', 'codex']);
    const matches = getMatches(picker, '/m');
    expect(matches.every((c) => c.name.startsWith('/m'))).toBe(true);
    expect(matches.map((c) => c.name)).toContain('/model');
    expect(matches.map((c) => c.name)).toContain('/model claude');
  });

  it('/e only matches /exit', () => {
    const picker = new InlineCommandPicker([]);
    const matches = getMatches(picker, '/e');
    expect(matches.map((c) => c.name)).toContain('/exit');
    expect(matches.map((c) => c.name)).not.toContain('/model');
  });

  it('/model cod matches /model codex only', () => {
    const picker = new InlineCommandPicker(['claude', 'codex']);
    const matches = getMatches(picker, '/model cod');
    expect(matches.map((c) => c.name)).toEqual(['/model codex']);
  });

  it('case-insensitive: /MODEL matches /model', () => {
    const picker = new InlineCommandPicker([]);
    const matches = getMatches(picker, '/MODEL');
    expect(matches.map((c) => c.name)).toContain('/model');
  });

  it('returns empty array for unknown prefix', () => {
    const picker = new InlineCommandPicker([]);
    const matches = getMatches(picker, '/zzz');
    expect(matches).toHaveLength(0);
  });
});
