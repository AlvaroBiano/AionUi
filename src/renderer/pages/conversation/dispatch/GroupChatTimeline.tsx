/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin } from '@arco-design/web-react';
import { People } from '@icon-park/react';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ChildTaskCard from './ChildTaskCard';
import type { GroupChatTimelineMessage, GroupChatTimelineProps } from './types';

const isTaskMessage = (messageType: string): boolean => {
  return (
    messageType === 'task_started' ||
    messageType === 'task_progress' ||
    messageType === 'task_completed' ||
    messageType === 'task_failed' ||
    messageType === 'task_cancelled'
  );
};

const GroupChatTimeline: React.FC<GroupChatTimelineProps> = ({
  messages,
  isLoading,
  dispatcherName,
  dispatcherAvatar,
  onCancelChild,
  conversationId,
  onViewDetail,
  selectedChildTaskId,
  onSaveTeammate,
  savedTeammateNames,
}) => {
  const { t } = useTranslation();
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [messages.length]);

  const sortedMessages = useMemo(() => [...messages].toSorted((a, b) => a.timestamp - b.timestamp), [messages]);

  if (isLoading) {
    return (
      <div className='flex-center flex-1'>
        <Spin />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className='flex-center flex-1 flex-col gap-12px'>
        {dispatcherAvatar ? (
          <span className='text-48px leading-none'>{dispatcherAvatar}</span>
        ) : (
          <People theme='outline' size='48' className='text-t-secondary' />
        )}
        <span className='text-16px font-medium text-t-primary'>{dispatcherName}</span>
        <span className='text-14px text-t-secondary'>
          {t('dispatch.timeline.emptyState', { name: dispatcherName })}
        </span>
      </div>
    );
  }

  const renderMessage = (message: GroupChatTimelineMessage) => {
    // System messages: center-aligned
    if (message.messageType === 'system') {
      return (
        <div key={message.id} className='flex justify-center py-4px'>
          <span className='text-12px text-t-secondary'>{message.content}</span>
        </div>
      );
    }

    // Task status cards
    if (isTaskMessage(message.messageType)) {
      return (
        <div key={message.id} className='py-4px px-16px'>
          <ChildTaskCard
            message={message}
            onCancel={onCancelChild}
            conversationId={conversationId}
            onViewDetail={onViewDetail}
            isSelected={selectedChildTaskId === message.childTaskId}
            onSave={onSaveTeammate}
            isSaved={message.displayName ? savedTeammateNames?.has(message.displayName) : false}
          />
        </div>
      );
    }

    // User messages: right-aligned
    if (message.sourceRole === 'user') {
      return (
        <div key={message.id} className='flex justify-end py-4px px-16px'>
          <div
            className='rd-12px px-16px py-10px max-w-70% text-14px whitespace-pre-wrap'
            style={{
              backgroundColor: 'rgb(var(--primary-6))',
              color: 'var(--color-bg-1)',
            }}
          >
            {message.content}
          </div>
        </div>
      );
    }

    // Dispatcher messages: left-aligned with avatar
    return (
      <div key={message.id} className='flex items-start gap-8px py-4px px-16px'>
        <div className='flex-shrink-0 mt-4px'>
          {message.avatar ? (
            <span className='text-24px leading-none'>{message.avatar}</span>
          ) : dispatcherAvatar ? (
            <span className='text-24px leading-none'>{dispatcherAvatar}</span>
          ) : (
            <People theme='outline' size='24' className='text-t-secondary' />
          )}
        </div>
        <div className='flex flex-col gap-2px min-w-0 max-w-70%'>
          <span className='text-12px text-t-secondary'>{message.displayName}</span>
          <div
            className='rd-12px px-16px py-10px text-14px whitespace-pre-wrap'
            style={{ backgroundColor: 'var(--color-fill-2)' }}
          >
            {message.content}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div ref={timelineRef} className='flex-1 overflow-y-auto py-16px'>
      {sortedMessages.map(renderMessage)}
    </div>
  );
};

export default GroupChatTimeline;
