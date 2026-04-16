/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AgentAvatar from '@/renderer/components/AgentAvatar';
import SiderRow from '@/renderer/components/layout/Sider/SiderRow';
import { cleanupSiderTooltips } from '@/renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { Dropdown, Menu, Modal, Tooltip } from '@arco-design/web-react';
import { DeleteOne, Pushpin } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { TChatConversation } from '@/common/config/storage';

type AgentContactRowProps = {
  agentKey: string;
  displayName: string;
  avatarSrc: string | null;
  avatarEmoji?: string;
  avatarBgColor?: string;
  lastConversation?: TChatConversation;
  conversationIds: string[];
  isActive: boolean;
  isPinned: boolean;
  collapsed: boolean;
  tooltipEnabled: boolean;
  onNavigate: (conversationId: string) => void;
  onNewConversation: (agentKey: string) => void;
  onTogglePin: (agentKey: string) => void;
  onRemove: (conversationIds: string[]) => void;
};

const AgentContactRow: React.FC<AgentContactRowProps> = ({
  agentKey,
  displayName,
  avatarSrc,
  avatarEmoji,
  avatarBgColor,
  lastConversation,
  conversationIds,
  isActive,
  isPinned,
  collapsed,
  tooltipEnabled,
  onNavigate,
  onNewConversation,
  onTogglePin,
  onRemove,
}) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { t } = useTranslation();

  const handleRowClick = () => {
    cleanupSiderTooltips();
    if (lastConversation) {
      onNavigate(lastConversation.id);
    } else {
      onNewConversation(agentKey);
    }
  };

  const icon = <AgentAvatar size={20} avatarSrc={avatarSrc} avatarEmoji={avatarEmoji} avatarBgColor={avatarBgColor} />;

  const droplist = (
    <Menu
      onClickMenuItem={(key) => {
        if (key === 'pin') {
          onTogglePin(agentKey);
        } else if (key === 'remove') {
          Modal.confirm({
            title: t('conversation.history.removeContact'),
            content: t('conversation.history.removeContactConfirm', { count: conversationIds.length }),
            okText: t('conversation.history.confirmDelete'),
            cancelText: t('conversation.history.cancelDelete'),
            okButtonProps: { status: 'warning' },
            onOk: () => {
              onRemove(conversationIds);
            },
            style: { borderRadius: '12px' },
            alignCenter: true,
            getPopupContainer: () => document.body,
          });
        }
      }}
    >
      <Menu.Item key='pin'>
        <div className='flex items-center gap-8px'>
          <Pushpin theme='outline' size='14' />
          <span>{isPinned ? t('conversation.history.unpin') : t('conversation.history.pin')}</span>
        </div>
      </Menu.Item>
      <Menu.Item key='remove'>
        <div className='flex items-center gap-8px text-[rgb(var(--warning-6))]'>
          <DeleteOne theme='outline' size='14' />
          <span>{t('conversation.history.removeContact')}</span>
        </div>
      </Menu.Item>
    </Menu>
  );

  // Collapsed sidebar: centered avatar only
  if (collapsed) {
    return (
      <Tooltip content={displayName} position='right' disabled={!tooltipEnabled}>
        <SiderRow level={2} collapsed icon={icon} isActive={isActive} onClick={handleRowClick} />
      </Tooltip>
    );
  }

  // Expanded: icon + name, three-dot button on hover
  // Single uncontrolled Dropdown on the three-dot button — avoids position issues from
  // programmatic popupVisible control on a contextMenu-triggered dropdown.
  return (
    <SiderRow level={2} icon={icon} label={displayName} isActive={isActive} onClick={handleRowClick}>
      {!isMobile && (
        <div
          className='absolute right-0px top-0px h-full items-center justify-end pr-8px hidden group-hover:flex'
          style={{
            backgroundImage: isActive
              ? 'linear-gradient(to right, transparent, var(--aou-2) 20%)'
              : 'linear-gradient(to right, transparent, var(--aou-1) 20%)',
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Dropdown
            droplist={droplist}
            trigger='click'
            position='br'
            getPopupContainer={() => document.body}
            unmountOnExit={false}
          >
            <span
              className='flex-center cursor-pointer hover:bg-fill-2 rd-4px p-4px transition-colors text-t-primary'
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div
                className='flex flex-col gap-2px items-center justify-center'
                style={{ width: '16px', height: '16px' }}
              >
                <div className='w-2px h-2px rounded-full bg-current' />
                <div className='w-2px h-2px rounded-full bg-current' />
                <div className='w-2px h-2px rounded-full bg-current' />
              </div>
            </span>
          </Dropdown>
        </div>
      )}
    </SiderRow>
  );
};

export default AgentContactRow;
