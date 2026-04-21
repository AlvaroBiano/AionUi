// tests/unit/process/acp/runtime/InputPipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputPipeline } from '@process/acp/runtime/InputPipeline';
import type { InjectionContext } from '@process/acp/runtime/InputPipeline';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(() => 'file content'),
    statSync: vi.fn(() => ({ isFile: () => true })),
    readdirSync: vi.fn(() => []),
  };
});

describe('InputPipeline', () => {
  let pipeline: InputPipeline;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue('file content');
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    pipeline = new InputPipeline('/workspace');
  });

  // ── Basic ──

  it('returns text content for plain message', () => {
    const result = pipeline.process('hello');
    expect(result).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('strips AIONUI_FILES_MARKER from text', () => {
    const result = pipeline.process('hello[[AION_FILES]]extra stuff');
    const text = (result[0] as { text: string }).text;
    expect(text).toBe('hello');
  });

  // ── First message injection ──

  it('injects preset context on first message', () => {
    const injection: InjectionContext = { presetContext: 'You are a helpful assistant.' };
    const result = pipeline.process('hello', undefined, injection);

    const text = (result[0] as { text: string }).text;
    expect(text).toContain('[Assistant Rules');
    expect(text).toContain('You are a helpful assistant.');
    expect(text).toContain('[User Request]');
    expect(text).toContain('hello');
  });

  it('injects skills index and team guide', () => {
    const injection: InjectionContext = {
      presetContext: 'preset',
      skillsIndex: 'available skills: coding, testing',
      teamGuidePrompt: 'you are in a team',
    };
    const result = pipeline.process('hello', undefined, injection);
    const text = (result[0] as { text: string }).text;
    expect(text).toContain('preset');
    expect(text).toContain('available skills');
    expect(text).toContain('you are in a team');
  });

  it('only injects on first message, not subsequent', () => {
    const injection: InjectionContext = { presetContext: 'preset' };
    pipeline.process('first', undefined, injection);

    const result = pipeline.process('second', undefined, injection);
    const text = (result[0] as { text: string }).text;
    expect(text).toBe('second'); // No injection
  });

  it('skips injection when no context provided', () => {
    const result = pipeline.process('hello');
    const text = (result[0] as { text: string }).text;
    expect(text).toBe('hello');
    expect(pipeline.firstMessageConsumed).toBe(false);
  });

  it('marks firstMessageConsumed after injection', () => {
    expect(pipeline.firstMessageConsumed).toBe(false);
    pipeline.process('hello', undefined, { presetContext: 'preset' });
    expect(pipeline.firstMessageConsumed).toBe(true);
  });

  it('skips injection when context has no content', () => {
    const result = pipeline.process('hello', undefined, {});
    const text = (result[0] as { text: string }).text;
    // Consumed but no wrapping (empty context)
    expect(text).toBe('hello');
    expect(pipeline.firstMessageConsumed).toBe(true);
  });

  // ── @file resolution ──

  it('resolves @file references after injection', () => {
    const injection: InjectionContext = { presetContext: 'preset' };
    const result = pipeline.process('check @src/utils.ts', undefined, injection);

    // Should have text block (with injection) + file block
    expect(result.length).toBeGreaterThan(1);
    expect(result.some((b: ContentBlock) => b.type === 'text' && 'text' in b && b.text.includes('[File:'))).toBe(true);
  });

  it('includes uploaded files as content blocks', () => {
    const result = pipeline.process('check this', ['/workspace/src/a.ts']);
    expect(result).toHaveLength(2);
    expect((result[1] as { text: string }).text).toContain('[File:');
  });

  // ── Combined: marker strip + injection + @file ──

  it('processes all stages in correct order', () => {
    const injection: InjectionContext = { presetContext: 'You are helpful.' };
    const result = pipeline.process('review @test.ts[[AION_FILES]]attached', ['/workspace/b.ts'], injection);

    // Marker stripped, so text is 'review @test.ts' (not 'review @test.ts[[AION_FILES]]attached')
    const textBlock = result[0] as { text: string };
    expect(textBlock.text).toContain('[Assistant Rules');
    expect(textBlock.text).toContain('You are helpful.');
    expect(textBlock.text).toContain('[User Request]');
    expect(textBlock.text).toContain('review @test.ts');
    expect(textBlock.text).not.toContain('AION_FILES');

    // File blocks present
    expect(result.length).toBeGreaterThan(1);
  });
});
