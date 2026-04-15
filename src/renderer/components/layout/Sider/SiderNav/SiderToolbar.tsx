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
import SiderRow from '../SiderRow';
import styles from '../Sider.module.css';

interface SiderToolbarProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onNewChat: () => void;
}

const SiderToolbar: React.FC<SiderToolbarProps> = ({ isMobile, collapsed, siderTooltipProps, onNewChat }) => {
  const { t } = useTranslation();

  return (
    <Tooltip {...siderTooltipProps} content={t('conversation.welcome.newConversation')} position='right'>
      <SiderRow
        level={1}
        icon={
          <Plus
            theme='outline'
            size='18'
            fill='currentColor'
            className={classNames('block leading-none', styles.newChatIcon)}
            style={{ lineHeight: 0 }}
          />
        }
        label={t('conversation.welcome.newConversation')}
        activeStyle='primary'
        collapsed={collapsed}
        onClick={onNewChat}
        className={classNames(styles.newChatTrigger, isMobile && 'sider-action-btn-mobile')}
      />
    </Tooltip>
  );
};

export default SiderToolbar;
