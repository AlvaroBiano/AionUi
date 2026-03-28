/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Down, People, Up } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskOverviewProps } from '../types';
import styles from './TaskOverview.module.css';

/** Format timestamp to relative time or locale time string */
const formatActivityTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(timestamp).toLocaleDateString();
};

/** Get status indicator class and symbol */
const getStatusInfo = (status: string): { className: string; symbol: string } => {
  switch (status) {
    case 'running':
      return { className: styles.statusRunning, symbol: '' };
    case 'pending':
      return { className: styles.statusPending, symbol: '' };
    case 'completed':
    case 'idle':
      return { className: styles.statusCompleted, symbol: '' };
    case 'failed':
      return { className: styles.statusFailed, symbol: '' };
    case 'cancelled':
      return { className: styles.statusCancelled, symbol: '' };
    default:
      return { className: styles.statusPending, symbol: '' };
  }
};

const TaskOverview: React.FC<TaskOverviewProps> = ({
  dispatcherName,
  dispatcherAvatar,
  children,
  selectedChildTaskId,
  onSelectChild,
  collapsed,
  onToggleCollapse,
}) => {
  const { t } = useTranslation();

  const summary = useMemo(() => {
    const total = children.length;
    const running = children.filter((c) => c.status === 'running').length;
    const completed = children.filter((c) => c.status === 'completed' || c.status === 'idle').length;
    const failed = children.filter((c) => c.status === 'failed').length;
    const pending = children.filter((c) => c.status === 'pending').length;
    return { total, running, completed, failed, pending };
  }, [children]);

  return (
    <div className={classNames(styles.container, 'mx-16px mt-8px')}>
      {/* Header - always visible */}
      <div
        className='flex items-center justify-between px-12px py-8px cursor-pointer'
        onClick={onToggleCollapse}
        role='button'
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('dispatch.overview.expand') : t('dispatch.overview.collapse')}
      >
        <div className='flex items-center gap-8px min-w-0'>
          {dispatcherAvatar ? (
            <span className='text-16px leading-none flex-shrink-0'>{dispatcherAvatar}</span>
          ) : (
            <People theme='outline' size='16' className='flex-shrink-0' />
          )}
          <span className='font-medium text-13px truncate'>{dispatcherName}</span>
          <span className='text-12px text-t-secondary ml-4px'>
            {t('dispatch.overview.total', { count: summary.total })}
          </span>
        </div>
        <Button
          type='text'
          size='mini'
          icon={collapsed ? <Down theme='outline' size='14' /> : <Up theme='outline' size='14' />}
          aria-label={collapsed ? t('dispatch.overview.expand') : t('dispatch.overview.collapse')}
        />
      </div>

      {/* Content area with collapse animation */}
      <div className={classNames(styles.contentArea, { [styles.contentAreaCollapsed]: collapsed })}>
        {/* Child task list */}
        <div className='overflow-y-auto' style={{ maxHeight: '160px' }}>
          {children.map((child) => {
            const statusInfo = getStatusInfo(child.status);
            const isSelected = child.sessionId === selectedChildTaskId;
            return (
              <div
                key={child.sessionId}
                className={classNames(styles.childRow, { [styles.childRowSelected]: isSelected })}
                onClick={() => onSelectChild(child.sessionId)}
                role='button'
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectChild(child.sessionId);
                  }
                }}
              >
                {child.teammateAvatar ? (
                  <span className='text-14px leading-none flex-shrink-0'>{child.teammateAvatar}</span>
                ) : (
                  <People theme='outline' size='14' className='flex-shrink-0 text-t-secondary' />
                )}
                <span className='text-13px truncate flex-1 min-w-0'>{child.teammateName || child.title}</span>
                <span className={classNames(styles.statusDot, statusInfo.className)} />
                <span className='text-11px text-t-secondary flex-shrink-0'>
                  {formatActivityTime(child.lastActivityAt)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Summary bar */}
        <div className={styles.summaryBar}>
          <span>{t('dispatch.overview.total', { count: summary.total })}</span>
          {summary.running > 0 && (
            <>
              <span className='mx-4px'>|</span>
              <span>{t('dispatch.overview.running', { count: summary.running })}</span>
            </>
          )}
          {summary.completed > 0 && (
            <>
              <span className='mx-4px'>|</span>
              <span>{t('dispatch.overview.completed', { count: summary.completed })}</span>
            </>
          )}
          {summary.failed > 0 && (
            <>
              <span className='mx-4px'>|</span>
              <span>{t('dispatch.overview.failed', { count: summary.failed })}</span>
            </>
          )}
          {summary.pending > 0 && (
            <>
              <span className='mx-4px'>|</span>
              <span>{t('dispatch.overview.pending', { count: summary.pending })}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskOverview;
