/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Avatar, Button, Typography } from '@arco-design/web-react';
import { EditTwo, MessageSearch, Robot } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { AssistantCardItem } from '../types';

type AssistantCardProps = {
  item: AssistantCardItem;
};

const AssistantCard: React.FC<AssistantCardProps> = ({ item }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleChat = () => {
    void navigate(`/guid?agent=${encodeURIComponent(item.agentKey)}`);
  };

  const handleEdit = () => {
    if (item.editPath) {
      void navigate(item.editPath);
    }
  };

  const avatarSize = 48;
  const iconSize = Math.floor(avatarSize * 0.5);
  const imgSize = Math.floor(avatarSize * 0.6);

  return (
    <div className='flex flex-col rounded-12px border border-solid border-border-1 bg-bg-2 p-16px gap-12px hover:border-brand-6 transition-colors duration-200'>
      {/* Avatar + Name */}
      <div className='flex flex-col items-center gap-8px'>
        <Avatar
          shape='square'
          size={avatarSize}
          className='border-none !rounded-10px'
          style={{ backgroundColor: 'var(--color-fill-2)', border: 'none', flexShrink: 0 }}
        >
          {item.avatarSrc ? (
            <img src={item.avatarSrc} alt='' width={imgSize} height={imgSize} style={{ objectFit: 'contain' }} />
          ) : item.avatarEmoji ? (
            <span style={{ fontSize: imgSize }}>{item.avatarEmoji}</span>
          ) : (
            <Robot theme='outline' size={iconSize} />
          )}
        </Avatar>
        <Typography.Text bold className='text-center text-14px leading-tight line-clamp-1'>
          {item.name}
        </Typography.Text>
      </div>

      {/* Description — only shown when present */}
      {item.description && (
        <Typography.Text className='text-12px text-text-3 line-clamp-2 text-center' style={{ minHeight: 0 }}>
          {item.description}
        </Typography.Text>
      )}

      {/* Action buttons */}
      <div className='flex gap-8px mt-auto'>
        <Button
          type='primary'
          size='small'
          data-testid='agent-chat-btn'
          icon={<MessageSearch theme='outline' size='14' />}
          className='flex-1 !rounded-8px'
          onClick={handleChat}
        >
          {t('assistants.card.chat')}
        </Button>
        {item.canEdit && (
          <Button
            type='secondary'
            size='small'
            data-testid='agent-edit-btn'
            icon={<EditTwo theme='outline' size='14' />}
            className='!rounded-8px'
            onClick={handleEdit}
          />
        )}
      </div>
    </div>
  );
};

export default AssistantCard;
