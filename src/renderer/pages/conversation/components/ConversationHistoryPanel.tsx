/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { iconColors } from '@/renderer/styles/colors';
import { resolveAgentKey } from '../GroupedHistory/utils/groupingHelpers';
import { emitter } from '../../../utils/emitter';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { History, Plus } from '@icon-park/react';
import React, { useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const dayMs = 86400000;
  if (diff < dayMs) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * dayMs) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(ts).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

type ConversationHistoryPanelProps = {
  conversation: TChatConversation;
};

const ConversationHistoryPanel: React.FC<ConversationHistoryPanelProps> = ({ conversation }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isCreatingRef = useRef(false);
  const { conversations } = useConversationHistoryContext();

  const agentKey = resolveAgentKey(conversation);

  const sameAgentConversations = useMemo(() => {
    return conversations
      .filter((c) => resolveAgentKey(c) === agentKey)
      .toSorted((a, b) => (b.modifyTime ?? 0) - (a.modifyTime ?? 0))
      .slice(0, 20);
  }, [conversations, agentKey]);

  const handleCreateNew = async () => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    try {
      const id = uuid();
      const latest = await ipcBridge.conversation.get.invoke({ id: conversation.id }).catch((): null => null);
      const source = latest || conversation;
      await ipcBridge.conversation.createWithConversation.invoke({
        conversation: {
          ...source,
          id,
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra:
            source.type === 'acp'
              ? { ...source.extra, acpSessionId: undefined, acpSessionUpdatedAt: undefined }
              : source.extra,
        } as TChatConversation,
      });
      void navigate(`/conversation/${id}`);
      emitter.emit('chat.history.refresh');
    } catch (error) {
      console.error('Failed to create conversation:', error);
    } finally {
      isCreatingRef.current = false;
    }
  };

  const droplist = (
    <Menu
      onClickMenuItem={(key) => {
        if (key === 'new') {
          void handleCreateNew();
          return;
        }
        void navigate(`/conversation/${key}`);
      }}
    >
      <Menu.ItemGroup title={t('conversation.history.historyPanel')}>
        <Menu.Item key='new'>
          <div className='flex items-center gap-8px'>
            <Plus theme='outline' size='14' />
            <span>{t('conversation.welcome.newConversation')}</span>
          </div>
        </Menu.Item>
      </Menu.ItemGroup>
      {sameAgentConversations.length > 0 && (
        <Menu.ItemGroup title={t('conversation.history.messagesSection')}>
          {sameAgentConversations.map((conv) => {
            const isActive = conv.id === conversation.id;
            const ts = conv.modifyTime ?? conv.createTime ?? 0;
            return (
              <Menu.Item key={conv.id}>
                <div className='flex items-center gap-8px min-w-0'>
                  <span
                    className={`flex-1 min-w-0 truncate text-13px ${isActive ? 'font-medium text-t-primary' : 'text-t-primary'}`}
                  >
                    {conv.name || t('conversation.welcome.newConversation')}
                  </span>
                  {ts > 0 && (
                    <span className='text-11px text-t-secondary shrink-0 whitespace-nowrap'>{formatTime(ts)}</span>
                  )}
                </div>
              </Menu.Item>
            );
          })}
        </Menu.ItemGroup>
      )}
    </Menu>
  );

  return (
    <Tooltip content={t('conversation.history.historyPanel')}>
      <Dropdown droplist={droplist} trigger='click' position='br' getPopupContainer={() => document.body}>
        <Button
          size='mini'
          icon={
            <History
              theme='filled'
              size='14'
              fill={iconColors.primary}
              strokeWidth={2}
              strokeLinejoin='miter'
              strokeLinecap='square'
            />
          }
        />
      </Dropdown>
    </Tooltip>
  );
};

export default ConversationHistoryPanel;
