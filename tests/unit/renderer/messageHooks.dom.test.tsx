import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MessageListProvider,
  useAddOrUpdateMessage,
  useMessageList,
  useMessageLstCache,
  useRemoveMessageByMsgId,
} from '@/renderer/pages/conversation/Messages/hooks';

const mockGetConversationMessagesInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessages: {
        invoke: (...args: unknown[]) => mockGetConversationMessagesInvoke(...args),
      },
    },
  },
}));

type TestMessage = {
  id: string;
  msg_id?: string;
  conversation_id: string;
  type: string;
  position?: string;
  content: {
    content: string;
  };
  createdAt?: number;
};

const CacheProbe = ({ conversationId }: { conversationId: string }) => {
  useMessageLstCache(conversationId);
  const messages = useMessageList();
  return <pre data-testid='messages'>{JSON.stringify(messages)}</pre>;
};

const MutationProbe = () => {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const removeMessageByMsgId = useRemoveMessageByMsgId();
  const messages = useMessageList();

  return (
    <div>
      <button
        type='button'
        onClick={() =>
          addOrUpdateMessage(
            {
              id: 'msg-1',
              msg_id: 'msg-1',
              conversation_id: 'conv-1',
              type: 'text',
              position: 'right',
              content: { content: 'queued message' },
            },
            true
          )
        }
      >
        add-message
      </button>
      <button type='button' onClick={() => removeMessageByMsgId('msg-1')}>
        remove-message
      </button>
      <pre data-testid='mutated-messages'>{JSON.stringify(messages)}</pre>
    </div>
  );
};

const StreamingMergeProbe = () => {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const messages = useMessageList();

  return (
    <div>
      <button
        type='button'
        onClick={() =>
          addOrUpdateMessage(
            {
              id: 'turn-1',
              msg_id: 'turn-1',
              conversation_id: 'conv-1',
              type: 'text',
              position: 'right',
              content: { content: 'optimistic draft' },
            },
            true
          )
        }
      >
        add-optimistic
      </button>
      <button
        type='button'
        onClick={() =>
          addOrUpdateMessage({
            id: 'assistant-1',
            msg_id: 'turn-1',
            conversation_id: 'conv-1',
            type: 'text',
            position: 'left',
            content: { content: 'assistant says' },
          })
        }
      >
        add-first-chunk
      </button>
      <button
        type='button'
        onClick={() =>
          addOrUpdateMessage({
            id: 'turn-1',
            msg_id: 'turn-1',
            conversation_id: 'conv-1',
            type: 'text',
            position: 'right',
            content: { content: 'canonical prompt' },
          })
        }
      >
        sync-user-bubble
      </button>
      <button
        type='button'
        onClick={() =>
          addOrUpdateMessage({
            id: 'assistant-2',
            msg_id: 'turn-1',
            conversation_id: 'conv-1',
            type: 'text',
            position: 'left',
            content: { content: ' hello' },
          })
        }
      >
        add-second-chunk
      </button>
      <pre data-testid='streaming-messages'>{JSON.stringify(messages)}</pre>
    </div>
  );
};

describe('message hooks cache merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps same-conversation streaming messages while filtering out messages from the previous conversation', async () => {
    const dbMessages: TestMessage[] = [
      {
        id: 'db-1',
        msg_id: 'db-1',
        conversation_id: 'conv-1',
        type: 'text',
        content: { content: 'from db' },
      },
    ];

    mockGetConversationMessagesInvoke.mockResolvedValue(dbMessages);

    const initialMessages: TestMessage[] = [
      {
        id: 'stream-1',
        msg_id: 'stream-1',
        conversation_id: 'conv-1',
        type: 'text',
        content: { content: 'streaming current conversation' },
      },
      {
        id: 'stream-2',
        msg_id: 'stream-2',
        conversation_id: 'conv-2',
        type: 'text',
        content: { content: 'streaming stale conversation' },
      },
    ];

    render(
      <MessageListProvider value={initialMessages}>
        <CacheProbe conversationId='conv-1' />
      </MessageListProvider>
    );

    await waitFor(() => {
      const content = screen.getByTestId('messages').textContent;
      expect(content).toContain('db-1');
      expect(content).toContain('stream-1');
    });

    const merged = JSON.parse(screen.getByTestId('messages').textContent ?? '[]') as TestMessage[];

    expect(merged.map((message) => message.id)).toEqual(['db-1', 'stream-1']);
  });

  it('adds optimistic messages and removes them by msg id', async () => {
    mockGetConversationMessagesInvoke.mockResolvedValue([]);

    render(
      <MessageListProvider value={[]}>
        <MutationProbe />
      </MessageListProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'add-message' }));

    await waitFor(() => {
      expect(screen.getByTestId('mutated-messages').textContent).toContain('msg-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'remove-message' }));

    await waitFor(() => {
      expect(screen.getByTestId('mutated-messages').textContent).not.toContain('msg-1');
    });
  });

  it('keeps the user bubble on the right while streaming assistant text into a new left bubble', async () => {
    render(
      <MessageListProvider value={[]}>
        <StreamingMergeProbe />
      </MessageListProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'add-optimistic' }));
    fireEvent.click(screen.getByRole('button', { name: 'add-first-chunk' }));
    fireEvent.click(screen.getByRole('button', { name: 'sync-user-bubble' }));
    fireEvent.click(screen.getByRole('button', { name: 'add-second-chunk' }));

    await waitFor(() => {
      const messages = JSON.parse(screen.getByTestId('streaming-messages').textContent ?? '[]') as TestMessage[];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        id: 'turn-1',
        position: 'right',
        content: { content: 'canonical prompt' },
      });
      expect(messages[1]).toMatchObject({
        id: 'assistant-1',
        position: 'left',
        content: { content: 'assistant says hello' },
      });
    });
  });
});
