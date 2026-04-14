/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import React from 'react';

import { getBackendKeyFromConversation } from './utils/exportHelpers';

type DragOverlayContentProps = {
  conversation?: TChatConversation;
};

const DragOverlayContent: React.FC<DragOverlayContentProps> = ({ conversation }) => {
  if (!conversation) return null;

  const backendKey = getBackendKeyFromConversation(conversation);
  const logo = getAgentLogo(backendKey);

  return (
    <div
      className='flex items-center gap-10px px-12px py-8px rd-8px min-w-200px max-w-300px'
      style={{
        backgroundColor: 'var(--color-bg-1)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        border: '1px solid var(--color-border-2)',
        transform: 'scale(1.02)',
      }}
    >
      <AgentAvatar size={18} avatarSrc={logo ?? null} avatarEmoji={null} />
      <div className='text-14px lh-24px text-t-primary truncate flex-1'>{conversation.name}</div>
    </div>
  );
};

export default DragOverlayContent;
