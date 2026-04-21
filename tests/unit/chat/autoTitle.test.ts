import { describe, expect, it } from 'vitest';
import { buildAutoTitleFromContent, deriveAutoTitleFromMessages } from '@/renderer/utils/chat/autoTitle';
import type { TMessage } from '@/common/chat/chatLib';

const createUserMessage = (content: string): TMessage => ({
  id: content,
  conversation_id: 'conv-1',
  type: 'text',
  position: 'right',
  content: { content },
  createdAt: Date.now(),
});

const createAssistantMessage = (content: string): TMessage => ({
  id: content,
  conversation_id: 'conv-1',
  type: 'text',
  position: 'left',
  content: { content },
  createdAt: Date.now(),
});

describe('autoTitle', () => {
  it('picks the first user message from history', () => {
    const title = deriveAutoTitleFromMessages([
      createUserMessage('继续'),
      createUserMessage('请帮我排查登录态过期后跳回登录页的问题'),
    ]);

    expect(title).toBe('继续');
  });

  it('falls back to the current input when history has no user message yet', () => {
    const title = deriveAutoTitleFromMessages([], '帮我写一个发版回滚预案');

    expect(title).toBe('帮我写一个发版回滚预案');
  });

  it('returns null for empty content', () => {
    expect(buildAutoTitleFromContent('   \n  ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildAutoTitleFromContent — boundary & branch coverage (P2)
// ---------------------------------------------------------------------------
describe('buildAutoTitleFromContent – 50-character truncation', () => {
  it('truncates content longer than 50 characters to exactly 50 chars', () => {
    const longContent = 'A'.repeat(80);
    const result = buildAutoTitleFromContent(longContent);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(50);
  });

  it('does not truncate content of exactly 50 characters', () => {
    const exactly50 = 'B'.repeat(50);
    const result = buildAutoTitleFromContent(exactly50);
    expect(result).toBe(exactly50);
  });

  it('does not truncate content shorter than 50 characters', () => {
    const short = 'Hello world';
    const result = buildAutoTitleFromContent(short);
    expect(result).toBe('Hello world');
  });
});

describe('buildAutoTitleFromContent – multiline: only first non-empty line used', () => {
  it('uses the first non-empty line when content has multiple lines', () => {
    const multiline = 'First line\nSecond line\nThird line';
    const result = buildAutoTitleFromContent(multiline);
    expect(result).toBe('First line');
  });

  it('skips blank first line and uses first non-empty line', () => {
    const content = '\n\nActual content here\nmore lines';
    const result = buildAutoTitleFromContent(content);
    expect(result).toBe('Actual content here');
  });

  it('returns null when all lines are empty', () => {
    const result = buildAutoTitleFromContent('\n\n\n');
    expect(result).toBeNull();
  });
});

describe('buildAutoTitleFromContent – markdown prefix stripping', () => {
  it('strips leading # heading markers', () => {
    const result = buildAutoTitleFromContent('# My Heading');
    expect(result).toBe('My Heading');
  });

  it('strips leading ## heading markers', () => {
    const result = buildAutoTitleFromContent('## Section Title');
    expect(result).toBe('Section Title');
  });

  it('strips leading > blockquote marker', () => {
    const result = buildAutoTitleFromContent('> Quoted text');
    expect(result).toBe('Quoted text');
  });

  it('strips leading * bullet marker', () => {
    const result = buildAutoTitleFromContent('* List item');
    expect(result).toBe('List item');
  });

  it('strips leading - bullet marker', () => {
    const result = buildAutoTitleFromContent('- Another item');
    expect(result).toBe('Another item');
  });

  it('returns null when content is only markdown prefix with no text', () => {
    // "```" lines are filtered out, and lone "#" becomes empty after strip
    const result = buildAutoTitleFromContent('# ');
    expect(result).toBeNull();
  });
});

describe('buildAutoTitleFromContent – think tag stripping', () => {
  it('strips <think> tags and uses remaining content as title', () => {
    const content = '<think>Some reasoning here</think>The actual answer starts here';
    const result = buildAutoTitleFromContent(content);
    expect(result).not.toBeNull();
    // After stripping think tags, "The actual answer starts here" remains
    expect(result).toBe('The actual answer starts here');
  });

  it('returns null when content is only think tags with no visible text', () => {
    const content = '<think>internal reasoning only</think>';
    const result = buildAutoTitleFromContent(content);
    expect(result).toBeNull();
  });
});

describe('deriveAutoTitleFromMessages – position filtering', () => {
  it('skips assistant (left) messages and picks first user (right) message', () => {
    const result = deriveAutoTitleFromMessages([
      createAssistantMessage('Hello there'),
      createUserMessage('What is TypeScript?'),
    ]);
    expect(result).toBe('What is TypeScript?');
  });

  it('returns null when messages array is empty and no fallback', () => {
    const result = deriveAutoTitleFromMessages([]);
    expect(result).toBeNull();
  });

  it('returns null when only assistant messages exist and no fallback', () => {
    const result = deriveAutoTitleFromMessages([
      createAssistantMessage('Hi'),
      createAssistantMessage('How can I help?'),
    ]);
    expect(result).toBeNull();
  });
});
