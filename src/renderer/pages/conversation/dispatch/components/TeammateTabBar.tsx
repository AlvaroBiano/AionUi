/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import { Close, SettingTwo } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { TeammateTabBarProps } from '../types';

const tabStatusColor: Record<string, string> = {
  working: 'bg-blue-6',
  idle: 'bg-gray-6',
  error: 'bg-red-6',
  released: 'bg-gray-4',
};

const TeammateTabBar: React.FC<TeammateTabBarProps> = ({ tabs, activeTabKey, onTabChange, onTabClose, onSettingsClick }) => {
  const { t } = useTranslation();

  return (
    <div className='flex items-center px-12px border-b border-bd-primary flex-shrink-0'>
      <div className='flex items-center gap-0 flex-1 overflow-x-auto'>
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={classNames(
              'flex items-center gap-4px px-12px py-8px cursor-pointer text-13px',
              'border-b-2 transition-colors relative',
              tab.key === activeTabKey
                ? 'border-primary-6 text-primary-6 font-medium'
                : 'border-transparent text-t-secondary hover:text-t-primary'
            )}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.avatar && <span className='text-14px leading-none'>{tab.avatar}</span>}
            <span className='truncate max-w-120px'>{tab.label}</span>
            {/* Status dot */}
            <span className={classNames('w-6px h-6px rd-full flex-shrink-0', tabStatusColor[tab.status])} />
            {/* Unread red dot */}
            {tab.hasUnread && tab.key !== activeTabKey && (
              <span className='absolute top-4px right-4px w-6px h-6px rd-full bg-red-6' />
            )}
            {/* Close button for closable tabs */}
            {tab.closable && (
              <Close
                size='12'
                className='ml-2px hover:text-t-primary'
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.key);
                }}
              />
            )}
          </div>
        ))}
      </div>
      {/* Settings button */}
      {onSettingsClick && (
        <Tooltip content={t('dispatch.settings.title')}>
          <div
            className='flex-shrink-0 p-6px cursor-pointer text-t-secondary hover:text-t-primary transition-colors'
            onClick={onSettingsClick}
          >
            <SettingTwo theme='outline' size='16' />
          </div>
        </Tooltip>
      )}
    </div>
  );
};

export default TeammateTabBar;
