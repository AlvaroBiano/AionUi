/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import ConversationSearchPopover from '@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';
import styles from '../Sider.module.css';

interface SiderToolbarProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onNewChat: () => void;
  onConversationSelect: () => void;
  onSessionClick?: () => void;
}

const SiderToolbar: React.FC<SiderToolbarProps> = ({
  isMobile,
  collapsed,
  siderTooltipProps,
  onNewChat,
  onConversationSelect,
  onSessionClick,
}) => {
  const { t } = useTranslation();

  if (collapsed) {
    return (
      <div className='shrink-0 flex flex-col items-center gap-3px w-full'>
        <Tooltip {...siderTooltipProps} content={t('conversation.welcome.newConversation')} position='right'>
          <div
            className={classNames(
              'w-full h-30px flex items-center justify-center cursor-pointer transition-colors text-t-primary rd-8px hover:bg-fill-3 active:bg-fill-4',
              styles.newChatTrigger
            )}
            onClick={onNewChat}
          >
            <Plus
              theme='outline'
              size='20'
              fill='currentColor'
              className={classNames('block leading-none', styles.newChatIcon)}
              style={{ lineHeight: 0 }}
            />
          </div>
        </Tooltip>
        <Tooltip {...siderTooltipProps} content={t('conversation.historySearch.tooltip')} position='right'>
          <div className='w-full'>
            <ConversationSearchPopover
              onConversationSelect={onConversationSelect}
              onSessionClick={onSessionClick}
              buttonClassName='!w-full !h-30px !py-0 !px-0 !justify-center !rd-8px !hover:bg-fill-3 !active:bg-fill-4'
            />
          </div>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className='shrink-0 flex items-center gap-8px'>
      <Tooltip {...siderTooltipProps} content={t('conversation.welcome.newConversation')} position='right'>
        <div
          className={classNames(
            styles.newChatTrigger,
            'h-30px flex-1 flex items-center justify-start gap-8px px-10px rd-0.5rem cursor-pointer group transition-all bg-transparent text-t-primary hover:bg-fill-3 active:bg-fill-4',
            isMobile && 'sider-action-btn-mobile'
          )}
          onClick={onNewChat}
        >
          <div className='size-20px flex items-center justify-center shrink-0'>
            <Plus
              theme='outline'
              size='20'
              fill='currentColor'
              className={classNames('block leading-none', styles.newChatIcon)}
              style={{ lineHeight: 0 }}
            />
          </div>
          <span className='collapsed-hidden text-t-primary text-13px font-medium leading-24px'>
            {t('conversation.welcome.newConversation')}
          </span>
        </div>
      </Tooltip>
      <ConversationSearchPopover onConversationSelect={onConversationSelect} onSessionClick={onSessionClick} />
    </div>
  );
};

export default SiderToolbar;
