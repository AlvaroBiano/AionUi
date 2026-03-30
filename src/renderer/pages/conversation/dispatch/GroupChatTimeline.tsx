/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import MarkdownView from '@renderer/components/Markdown';
import { Spin } from '@arco-design/web-react';
import { People } from '@icon-park/react';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ChildTaskCard from './ChildTaskCard';
import ProgressCard, { parseProgressBlock } from './components/ProgressCard';
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
        <div key={message.id} className='flex justify-center m-t-10px max-w-full md:max-w-780px mx-auto px-8px'>
          <span className='text-12px text-t-secondary'>{message.content}</span>
        </div>
      );
    }

    // Task status cards
    if (isTaskMessage(message.messageType)) {
      return (
        <div key={message.id} className='m-t-10px max-w-full md:max-w-780px mx-auto px-8px'>
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

    // User messages: right-aligned, same style as normal chat
    if (message.sourceRole === 'user') {
      return (
        <div key={message.id} className='flex justify-end m-t-10px max-w-full md:max-w-780px mx-auto px-8px'>
          <div className='min-w-0 flex flex-col items-end'>
            <div
              className='min-w-0 bg-aou-2 p-8px [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px'
              style={{ borderRadius: '8px 0 8px 8px' }}
            >
              <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{message.content}</MarkdownView>
            </div>
          </div>
        </div>
      );
    }

    // Agent messages: left-aligned with avatar, same bubble style as normal chat
    const avatar = message.avatar || dispatcherAvatar;

    // G4.5: Detect progress blocks in agent messages and render ProgressCard
    const progressData = message.content ? parseProgressBlock(message.content) : null;

    return (
      <div key={message.id} className='flex items-start gap-8px m-t-10px max-w-full md:max-w-780px mx-auto px-8px'>
        <div className='flex-shrink-0 w-28px h-28px flex-center mt-2px'>
          {avatar ? (
            <span className='text-24px leading-none'>{avatar}</span>
          ) : (
            <People theme='outline' size='24' className='text-t-secondary' />
          )}
        </div>
        <div className='min-w-0 flex-1 flex flex-col items-start'>
          <span className='text-12px text-t-secondary mb-2px'>{message.displayName}</span>
          <div className='min-w-0 w-full [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px'>
            {progressData ? (
              <ProgressCard data={progressData} />
            ) : (
              <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{message.content}</MarkdownView>
            )}
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
