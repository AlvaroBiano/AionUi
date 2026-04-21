// tests/unit/process/acp/runtime/UserMessagePersister.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserMessagePersister } from '@process/acp/runtime/UserMessagePersister';
import type { PersisterDeps, UserMessageData } from '@process/acp/runtime/UserMessagePersister';

describe('UserMessagePersister', () => {
  let deps: PersisterDeps;
  let persister: UserMessagePersister;

  beforeEach(() => {
    deps = {
      addMessage: vi.fn(),
      updateConversation: vi.fn().mockResolvedValue(undefined),
      emitToRenderer: vi.fn(),
    };
    persister = new UserMessagePersister(deps);
  });

  const baseData: UserMessageData = {
    msgId: 'msg-1',
    content: 'hello',
    conversationId: 'conv-1',
  };

  it('persists message to DB, touches conversation, and emits to renderer', () => {
    persister.persist(baseData);

    expect(deps.addMessage).toHaveBeenCalledOnce();
    expect(deps.updateConversation).toHaveBeenCalledWith('conv-1');
    expect(deps.emitToRenderer).toHaveBeenCalledOnce();
  });

  it('creates correct TMessage with position=right', () => {
    persister.persist(baseData);

    const msg = vi.mocked(deps.addMessage).mock.calls[0][1];
    expect(msg).toMatchObject({
      id: 'msg-1',
      type: 'text',
      position: 'right',
      conversation_id: 'conv-1',
      content: { content: 'hello' },
    });
    expect(msg.createdAt).toBeTypeOf('number');
  });

  it('emits IResponseMessage with type user_content', () => {
    persister.persist(baseData);

    const emitted = vi.mocked(deps.emitToRenderer).mock.calls[0][0];
    expect(emitted).toMatchObject({
      type: 'user_content',
      conversation_id: 'conv-1',
      msg_id: 'msg-1',
      data: 'hello',
    });
  });

  it('includes cronMeta when provided', () => {
    const cronMeta = { source: 'cron' as const, cronJobId: 'j1', cronJobName: 'test', triggeredAt: 1000 };
    persister.persist({ ...baseData, cronMeta });

    const msg = vi.mocked(deps.addMessage).mock.calls[0][1];
    expect((msg as { content: { cronMeta: unknown } }).content.cronMeta).toEqual(cronMeta);

    const emitted = vi.mocked(deps.emitToRenderer).mock.calls[0][0];
    expect(emitted.data).toMatchObject({ content: 'hello', cronMeta });
  });

  it('sets hidden flag when provided', () => {
    persister.persist({ ...baseData, hidden: true });

    const msg = vi.mocked(deps.addMessage).mock.calls[0][1];
    expect((msg as { hidden: boolean }).hidden).toBe(true);

    const emitted = vi.mocked(deps.emitToRenderer).mock.calls[0][0];
    expect(emitted.hidden).toBe(true);
  });

  it('skips everything when silent is true', () => {
    persister.persist({ ...baseData, silent: true });

    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(deps.updateConversation).not.toHaveBeenCalled();
    expect(deps.emitToRenderer).not.toHaveBeenCalled();
  });

  it('skips when msgId is empty', () => {
    persister.persist({ ...baseData, msgId: '' });

    expect(deps.addMessage).not.toHaveBeenCalled();
  });

  it('skips when content is empty', () => {
    persister.persist({ ...baseData, content: '' });

    expect(deps.addMessage).not.toHaveBeenCalled();
  });

  it('tolerates updateConversation failure', () => {
    vi.mocked(deps.updateConversation).mockRejectedValue(new Error('not found'));

    // Should not throw
    expect(() => persister.persist(baseData)).not.toThrow();
    expect(deps.addMessage).toHaveBeenCalledOnce();
    expect(deps.emitToRenderer).toHaveBeenCalledOnce();
  });
});
