/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import { Button, Input, Message, Modal, Spin, Tag } from '@arco-design/web-react';
import { CheckOne, Close, CloseOne, People, Refresh, SendOne } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SaveTeammateModal from './components/SaveTeammateModal';
import { useIsSavedTeammate } from './hooks/useIsSavedTeammate';
import { useTaskPanelTranscript } from './hooks/useTaskPanelTranscript';
import type { TaskPanelProps } from './types';
import styles from './TaskPanel.module.css';

/** Map child status to tag color */
const getTagColor = (status: string): string => {
  switch (status) {
    case 'running':
    case 'pending':
      return 'arcoblue';
    case 'completed':
    case 'idle':
      return 'green';
    case 'failed':
      return 'red';
    case 'cancelled':
      return 'gray';
    default:
      return 'arcoblue';
  }
};

const TaskPanel: React.FC<TaskPanelProps> = ({
  childTaskId,
  childInfo,
  conversationId,
  onClose,
  onCancel,
  onTeammateSaved,
}) => {
  const { t } = useTranslation();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [sendValue, setSendValue] = useState('');
  const [sendingToChild, setSendingToChild] = useState(false);

  const isRunning = childInfo.status === 'running' || childInfo.status === 'pending';
  const canSend = childInfo.status === 'running' || childInfo.status === 'idle';
  const { transcript, isLoading, error, refresh } = useTaskPanelTranscript(childTaskId, isRunning);
  const { isSaved, recheck: recheckSaved } = useIsSavedTeammate(childInfo.teammateName);
  const hasTeammateConfig = Boolean(childInfo.teammateName);

  // Auto-scroll to bottom when transcript changes
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript.length]);

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // F-4.1: Send direct message to child agent
  const handleSendToChild = useCallback(async () => {
    if (!sendValue.trim()) return;
    setSendingToChild(true);
    try {
      await ipcBridge.conversation.sendMessage.invoke({
        input: sendValue,
        msg_id: uuid(),
        conversation_id: childTaskId,
      });
      // Notify parent dispatcher
      await ipcBridge.dispatch.notifyParent.invoke({
        parentConversationId: conversationId,
        childSessionId: childTaskId,
        childName: childInfo.teammateName || t('dispatch.taskPanel.childAgent'),
        userMessage: sendValue,
      });
      setSendValue('');
      refresh();
    } catch (err) {
      if (err instanceof Error) {
        Message.error(err.message);
      } else {
        Message.error(t('dispatch.taskPanel.sendFailed'));
      }
    } finally {
      setSendingToChild(false);
    }
  }, [sendValue, childTaskId, conversationId, childInfo.teammateName, childInfo.title, refresh, t]);

  const handleCancel = useCallback(() => {
    const title = childInfo.title || 'task';
    Modal.confirm({
      title: t('dispatch.childTask.cancelConfirmTitle'),
      content: t('dispatch.childTask.cancelConfirmContent', { title }),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        await onCancel(childTaskId);
      },
    });
  }, [childTaskId, childInfo.title, onCancel, t]);

  const createdAtStr = new Date(childInfo.createdAt).toLocaleTimeString();

  return (
    <div className={`${styles.panel} ${styles.panelEnter} flex flex-col h-full`}>
      {/* Header */}
      <div
        className='flex items-center justify-between px-16px py-12px border-b border-b-solid'
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className='flex items-center gap-8px min-w-0 flex-1'>
          {childInfo.teammateAvatar ? (
            <span className='text-20px leading-none flex-shrink-0'>{childInfo.teammateAvatar}</span>
          ) : (
            <People theme='outline' size='20' className='flex-shrink-0' />
          )}
          <div className='flex flex-col min-w-0'>
            <span className='font-medium text-14px truncate'>{childInfo.teammateName || childInfo.title}</span>
            <span className='text-12px text-t-secondary'>{createdAtStr}</span>
          </div>
          <Tag color={getTagColor(childInfo.status)} className='flex-shrink-0 ml-4px'>
            {t(`dispatch.taskPanel.status.${childInfo.status}`)}
          </Tag>
          {!isSaved && hasTeammateConfig && (
            <Button
              type='text'
              size='mini'
              onClick={() => setShowSaveModal(true)}
              aria-label={t('dispatch.teammate.saveAsAssistant')}
            >
              {t('dispatch.teammate.saveAsAssistant')}
            </Button>
          )}
          {isSaved && (
            <span className='flex items-center gap-4px text-t-secondary text-12px ml-4px'>
              <CheckOne theme='outline' size='14' />
              {t('dispatch.teammate.saved')}
            </span>
          )}
        </div>
        <Button type='text' size='mini' icon={<Close theme='outline' size='16' />} onClick={onClose} />
      </div>

      {/* Task title */}
      {childInfo.title && (
        <div
          className='px-16px py-8px text-13px text-t-secondary border-b border-b-solid'
          style={{ borderColor: 'var(--color-border)' }}
        >
          {childInfo.title}
        </div>
      )}

      {/* Transcript area */}
      <div className={`flex-1 overflow-y-auto px-16px py-12px ${styles.transcriptContainer}`}>
        {isLoading && (
          <div className='flex-center py-32px'>
            <Spin />
          </div>
        )}
        {error && <div className='text-13px text-danger text-center py-16px'>{error}</div>}
        {!isLoading && !error && transcript.length === 0 && (
          <div className='text-13px text-t-secondary text-center py-16px'>{t('dispatch.taskPanel.noTranscript')}</div>
        )}
        {!isLoading && transcript.length > 0 && (
          <div className='flex flex-col gap-8px'>
            {transcript.map((msg, index) => (
              <div key={index} className='text-13px'>
                <span className='font-medium text-t-secondary'>[{msg.role}]</span>{' '}
                <span className='text-t-primary whitespace-pre-wrap'>{msg.content}</span>
              </div>
            ))}
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* F-4.1: SendBox for direct user-to-child messaging */}
      {canSend && (
        <div className='px-16px py-8px border-t border-t-solid' style={{ borderColor: 'var(--color-border)' }}>
          <Input.TextArea
            placeholder={t('dispatch.taskPanel.sendPlaceholder', { name: childInfo.teammateName || childInfo.title })}
            value={sendValue}
            onChange={setSendValue}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void handleSendToChild();
              }
            }}
            disabled={sendingToChild}
            autoSize={{ minRows: 1, maxRows: 4 }}
            aria-label={t('dispatch.taskPanel.sendPlaceholder', { name: childInfo.teammateName || childInfo.title })}
          />
          <div className='flex justify-end mt-4px'>
            <Button
              type='primary'
              size='small'
              onClick={() => void handleSendToChild()}
              loading={sendingToChild}
              disabled={!sendValue.trim()}
              icon={<SendOne theme='outline' size='14' />}
            >
              {t('dispatch.taskPanel.sendToChild')}
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div
        className='flex items-center justify-end gap-8px px-16px py-12px border-t border-t-solid'
        style={{ borderColor: 'var(--color-border)' }}
      >
        <Button type='secondary' size='small' icon={<Refresh theme='outline' size='14' />} onClick={refresh}>
          {t('dispatch.taskPanel.refresh')}
        </Button>
        {isRunning && (
          <Button
            type='secondary'
            size='small'
            status='danger'
            icon={<CloseOne theme='outline' size='14' />}
            onClick={handleCancel}
          >
            {t('dispatch.childTask.cancel')}
          </Button>
        )}
      </div>

      {/* F-3.1: Save Teammate Modal */}
      <SaveTeammateModal
        visible={showSaveModal}
        childSessionId={childTaskId}
        initialName={childInfo.teammateName}
        initialAvatar={childInfo.teammateAvatar}
        onClose={() => setShowSaveModal(false)}
        onSaved={() => {
          recheckSaved();
          if (childInfo.teammateName && onTeammateSaved) {
            onTeammateSaved(childInfo.teammateName);
          }
        }}
      />
    </div>
  );
};

export default TaskPanel;
