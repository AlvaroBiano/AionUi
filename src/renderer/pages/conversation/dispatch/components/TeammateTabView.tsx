/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * G3.4: Read-only teammate conversation view.
 * MVP approach: Uses useTaskPanelTranscript hook (text transcript with 5s polling).
 * Renders transcript as styled messages (admin prompts vs teammate responses).
 * NO input box (read-only).
 */

import { Spin } from '@arco-design/web-react';
import { People } from '@icon-park/react';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskPanelTranscript } from '../hooks/useTaskPanelTranscript';

type TeammateTabViewProps = {
  /** Child session ID -- this IS a full conversation ID in the DB */
  childSessionId: string;
  /** Parent group chat conversation ID (for context) */
  conversationId: string;
};

const TeammateTabView: React.FC<TeammateTabViewProps> = ({ childSessionId }) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Always pass isRunning=true to enable polling; the hook's responseStream
  // listener handles final refresh on task completion events regardless.
  const { transcript, isLoading, error } = useTaskPanelTranscript(childSessionId, true);

  // Auto-scroll to bottom when new messages arrive
  const prevLenRef = useRef(0);
  useEffect(() => {
    if (transcript.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLenRef.current = transcript.length;
  }, [transcript.length]);

  // Map transcript messages with display metadata
  const messages = useMemo(() => {
    return transcript.map((msg, index) => ({
      ...msg,
      index,
      isUser: msg.role === 'user',
    }));
  }, [transcript]);

  if (isLoading) {
    return (
      <div className='flex-center flex-1'>
        <Spin />
      </div>
    );
  }

  if (error) {
    return <div className='flex-center flex-1 text-13px text-danger'>{error}</div>;
  }

  if (messages.length === 0) {
    return (
      <div className='flex-center flex-1 text-13px text-t-secondary'>{t('dispatch.teammateView.noTranscript')}</div>
    );
  }

  return (
    <div ref={scrollRef} className='flex-1 overflow-y-auto px-16px py-12px'>
      <div className='max-w-800px mx-auto flex flex-col gap-12px'>
        {messages.map((msg) => (
          <div key={msg.index} className='flex gap-8px'>
            {/* Avatar */}
            <div className='w-28px h-28px rd-full flex-center bg-fill-2 text-12px flex-shrink-0 mt-2px'>
              {msg.isUser ? <People size='14' /> : <span className='text-primary-6 font-medium'>A</span>}
            </div>

            {/* Message content */}
            <div className='flex-1 min-w-0'>
              <div className='text-12px text-t-secondary mb-2px'>
                {msg.isUser ? t('dispatch.teammateView.adminPrompt') : t('dispatch.teammateView.teammateResponse')}
              </div>
              <div className='text-13px text-t-primary whitespace-pre-wrap break-words leading-relaxed'>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TeammateTabView;
