/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { People } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import SiderRow from '../SiderRow';

type SiderAssistantsEntryProps = {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
};

const SiderAssistantsEntry: React.FC<SiderAssistantsEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();

  return (
    <Tooltip {...siderTooltipProps} content={t('common.nav.assistants')} position='right'>
      <SiderRow
        level={1}
        icon={
          <People
            theme='outline'
            size='18'
            fill='currentColor'
            className='block leading-none'
            style={{ lineHeight: 0 }}
          />
        }
        label={t('common.nav.assistants')}
        isActive={isActive}
        activeStyle='primary'
        collapsed={collapsed}
        onClick={onClick}
        className={classNames(isMobile && 'sider-action-btn-mobile')}
      />
    </Tooltip>
  );
};

export default SiderAssistantsEntry;
