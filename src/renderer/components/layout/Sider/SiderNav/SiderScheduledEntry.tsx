/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { AlarmClock } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import SiderRow from '../SiderRow';

interface SiderScheduledEntryProps {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
}

const SiderScheduledEntry: React.FC<SiderScheduledEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();

  return (
    <Tooltip {...siderTooltipProps} content={t('cron.scheduledTasks')} position='right'>
      <SiderRow
        level={1}
        icon={
          <AlarmClock
            theme='outline'
            size='18'
            fill='currentColor'
            className='block leading-none shrink-0'
            style={{ lineHeight: 0 }}
          />
        }
        label={t('cron.scheduledTasks')}
        isActive={isActive}
        activeStyle='primary'
        collapsed={collapsed}
        onClick={onClick}
        className={classNames(isMobile && 'sider-action-btn-mobile')}
      />
    </Tooltip>
  );
};

export default SiderScheduledEntry;
