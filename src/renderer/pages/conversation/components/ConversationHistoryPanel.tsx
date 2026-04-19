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
import { isConversationPinned, resolveAgentKey } from '../GroupedHistory/utils/groupingHelpers';
import { emitter } from '../../../utils/emitter';
import { Button, Dropdown, Message, Popconfirm } from '@arco-design/web-react';
import { DeleteOne, History, Plus, Pushpin } from '@icon-park/react';
import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
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
  const [open, setOpen] = useState(false);

  // Close dropdown on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const agentKey = resolveAgentKey(conversation);

  const sameAgentConversations = useMemo(() => {
    return conversations
      .filter((c) => resolveAgentKey(c) === agentKey)
      .toSorted((a, b) => {
        const aPinned = isConversationPinned(a);
        const bPinned = isConversationPinned(b);
        if (aPinned !== bPinned) return bPinned ? 1 : -1;
        return (b.modifyTime ?? 0) - (a.modifyTime ?? 0);
      })
      .slice(0, 20);
  }, [conversations, agentKey]);

  const handleCreateNew = async () => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setOpen(false);
    try {
      const id = uuid();
      const latest = await ipcBridge.conversation.get.invoke({ id: conversation.id }).catch((): null => null);
      const source = latest || conversation;
      await ipcBridge.conversation.createWithConversation.invoke({
        conversation: {
          ...source,
          id,
          name: t('conversation.welcome.newConversation'),
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

  const handleTogglePin = useCallback(
    async (conv: TChatConversation) => {
      const pinned = isConversationPinned(conv);
      try {
        const success = await ipcBridge.conversation.update.invoke({
          id: conv.id,
          updates: {
            extra: {
              pinned: !pinned,
              pinnedAt: pinned ? undefined : Date.now(),
            } as Partial<TChatConversation['extra']>,
          } as Partial<TChatConversation>,
          mergeExtra: true,
        });
        if (success) {
          emitter.emit('chat.history.refresh');
        } else {
          Message.error(t('conversation.history.pinFailed'));
        }
      } catch (error) {
        console.error('Failed to toggle pin:', error);
        Message.error(t('conversation.history.pinFailed'));
      }
    },
    [t]
  );

  const handleRemove = useCallback(
    async (convId: string) => {
      try {
        const success = await ipcBridge.conversation.remove.invoke({ id: convId });
        if (success) {
          emitter.emit('chat.history.refresh');
          if (convId === conversation.id) {
            setOpen(false);
            void navigate('/guid');
          }
        }
      } catch (error) {
        console.error('Failed to remove conversation:', error);
      }
    },
    [conversation.id, navigate]
  );

  const droplist = (
    <div
      className='w-200px py-4px rd-8px'
      data-history-dropdown='true'
      style={{
        backgroundColor: 'var(--color-bg-2)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        border: '1px solid var(--color-border-2)',
      }}
    >
      {/* 新会话 — 顶部固定按钮 */}
      <div
        className='flex items-center gap-8px px-12px py-7px cursor-pointer hover:bg-[var(--color-fill-2)] text-t-primary'
        onClick={() => void handleCreateNew()}
      >
        <Plus theme='outline' size='13' />
        <span className='text-13px'>{t('conversation.welcome.newConversation')}</span>
      </div>

      {/* 分隔线 */}
      {sameAgentConversations.length > 0 && <div className='mx-8px my-4px border-t border-[var(--color-border-2)]' />}

      {/* 历史会话列表 — scrollable with max height */}
      <div className='max-h-400px overflow-y-auto'>
        {sameAgentConversations.map((conv) => {
          const isActive = conv.id === conversation.id;
          const isPinned = isConversationPinned(conv);
          const ts = conv.modifyTime ?? conv.createTime ?? 0;
          return (
            <div
              key={conv.id}
              className={`group relative flex items-center gap-8px px-12px py-6px cursor-pointer hover:bg-[var(--color-fill-2)] ${isActive ? 'bg-[var(--color-fill-2)]' : ''}`}
              onClick={() => {
                setOpen(false);
                void navigate(`/conversation/${conv.id}`);
              }}
            >
              <span
                className={`flex-1 min-w-0 truncate text-13px ${isActive ? 'font-medium text-t-primary' : 'text-t-primary'}`}
              >
                {conv.name || t('conversation.welcome.newConversation')}
              </span>
              {ts > 0 && (
                <span
                  className={`text-11px text-t-tertiary shrink-0 whitespace-nowrap ${isPinned ? 'hidden' : 'group-hover:hidden'}`}
                >
                  {formatTime(ts)}
                </span>
              )}
              {/* Pin icon — always visible when pinned, hover-only otherwise */}
              {isPinned && (
                <span
                  className='flex-center cursor-pointer text-t-secondary hover:text-t-primary shrink-0 group-hover:hidden'
                  title={t('conversation.history.unpin')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleTogglePin(conv);
                  }}
                >
                  <Pushpin theme='filled' size='14' fill={iconColors.primary} />
                </span>
              )}
              {/* Inline action buttons — visible on hover */}
              <div
                className='hidden group-hover:flex items-center gap-4px shrink-0'
                onClick={(e) => e.stopPropagation()}
              >
                <Popconfirm
                  title={t('conversation.history.deleteTitle')}
                  content={t('conversation.history.deleteConfirm')}
                  okText={t('conversation.history.confirmDelete')}
                  cancelText={t('conversation.history.cancelDelete')}
                  onOk={() => void handleRemove(conv.id)}
                  getPopupContainer={() => document.body}
                >
                  <span
                    className='flex-center cursor-pointer text-t-secondary hover:text-[rgb(var(--danger-6))]'
                    title={t('conversation.history.deleteTitle')}
                  >
                    <DeleteOne theme='outline' size='14' />
                  </span>
                </Popconfirm>
                <span
                  className='flex-center cursor-pointer text-t-secondary hover:text-t-primary'
                  title={isPinned ? t('conversation.history.unpin') : t('conversation.history.pin')}
                  onClick={() => void handleTogglePin(conv)}
                >
                  <Pushpin
                    theme={isPinned ? 'filled' : 'outline'}
                    size='14'
                    fill={isPinned ? iconColors.primary : undefined}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Dropdown
      droplist={droplist}
      trigger='click'
      position='br'
      getPopupContainer={() => document.body}
      popupVisible={open}
      onVisibleChange={setOpen}
    >
      <Button
        size='mini'
        title={t('conversation.history.historyPanel')}
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
  );
};

export default ConversationHistoryPanel;
