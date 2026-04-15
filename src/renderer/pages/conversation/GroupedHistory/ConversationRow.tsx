/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AgentAvatar from '@/renderer/components/AgentAvatar';
import siderStyles from '@/renderer/components/layout/Sider/Sider.module.css';
import { CronJobIndicator } from '@/renderer/pages/cron';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { Checkbox, Dropdown, Menu, Spin, Tooltip } from '@arco-design/web-react';
import { DeleteOne, EditOne, Export, Pushpin } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ConversationRowProps } from './types';
import { isConversationPinned } from './utils/groupingHelpers';

function formatConversationTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const dayMs = 86400000;
  if (diff < dayMs) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * dayMs) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(ts).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

const ConversationRow: React.FC<ConversationRowProps> = (props) => {
  const {
    conversation,
    isGenerating,
    hasCompletionUnread,
    collapsed,
    tooltipEnabled,
    batchMode,
    checked,
    selected,
    menuVisible,
    avatarSrc,
    avatarEmoji,
    avatarBgColor,
  } = props;
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const {
    onToggleChecked,
    onConversationClick,
    onOpenMenu,
    onMenuVisibleChange,
    onEditStart,
    onDelete,
    onExport,
    onTogglePin,
    getJobStatus,
  } = props;
  const { t } = useTranslation();
  const isPinned = isConversationPinned(conversation);
  const cronStatus = getJobStatus(conversation.id);
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const handleRowClick = () => {
    cleanupSiderTooltips();
    if (batchMode) {
      onToggleChecked(conversation);
      return;
    }
    onConversationClick(conversation);
  };

  const handleRowContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    cleanupSiderTooltips();
    if (batchMode) {
      return;
    }
    onOpenMenu(conversation);
  };

  const renderCompletionUnreadDot = () => {
    if (batchMode || !hasCompletionUnread || isGenerating) {
      return null;
    }
    return (
      <span className='absolute right-10px top-4px flex items-center justify-center group-hover:hidden pointer-events-none'>
        <span className='h-8px w-8px rounded-full bg-#2C7FFF shadow-[0_0_0_2px_rgba(44,127,255,0.18)]' />
      </span>
    );
  };

  // Collapsed layout: centered icon with tooltip
  if (collapsed) {
    return (
      <Tooltip
        key={conversation.id}
        {...siderTooltipProps}
        content={conversation.name || t('conversation.welcome.newConversation')}
        position='right'
      >
        <div
          id={'c-' + conversation.id}
          className={classNames(
            'chat-history__item h-30px rd-8px flex items-center justify-center group cursor-pointer relative overflow-hidden shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-1px min-w-0 transition-colors',
            {
              'hover:bg-fill-3': !batchMode,
              '!bg-active': selected,
              'bg-[rgba(var(--primary-6),0.08)]': batchMode && checked,
            }
          )}
          onClick={handleRowClick}
          onContextMenu={handleRowContextMenu}
        >
          <span className='w-24px h-24px flex items-center justify-center shrink-0'>
            {isGenerating && !batchMode ? (
              <Spin size={16} />
            ) : cronStatus !== 'none' ? (
              <CronJobIndicator status={cronStatus} size={20} className='flex-shrink-0' />
            ) : (
              <AgentAvatar size={20} avatarSrc={avatarSrc} avatarEmoji={avatarEmoji} avatarBgColor={avatarBgColor} />
            )}
          </span>
        </div>
      </Tooltip>
    );
  }

  // Expanded layout: IM-style row
  const timestamp = conversation.modifyTime ?? conversation.createTime ?? 0;

  return (
    <div
      id={'c-' + conversation.id}
      className={classNames(
        'chat-history__item rd-8px flex items-center gap-10px px-8px group cursor-pointer relative overflow-hidden shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-1px min-w-0 transition-colors',
        {
          'hover:bg-fill-3': !batchMode,
          '!bg-active': selected,
          'bg-[rgba(var(--primary-6),0.08)]': batchMode && checked,
        }
      )}
      style={{ paddingTop: 8, paddingBottom: 8, minHeight: 52 }}
      onClick={handleRowClick}
      onContextMenu={handleRowContextMenu}
    >
      {/* Batch checkbox */}
      {batchMode && (
        <span
          className='flex-center shrink-0'
          onClick={(event) => {
            event.stopPropagation();
            onToggleChecked(conversation);
          }}
        >
          <Checkbox checked={checked} />
        </span>
      )}

      {/* Avatar slot */}
      <span className='flex items-center justify-center shrink-0' style={{ width: 36, height: 36 }}>
        {isGenerating && !batchMode ? (
          <Spin size={20} />
        ) : cronStatus !== 'none' ? (
          <CronJobIndicator status={cronStatus} size={24} className='flex-shrink-0' />
        ) : (
          <AgentAvatar size={36} avatarSrc={avatarSrc} avatarEmoji={avatarEmoji} avatarBgColor={avatarBgColor} />
        )}
      </span>

      {/* Text column */}
      <div className='flex flex-col gap-2px flex-1 min-w-0 overflow-hidden'>
        {/* Name + timestamp row */}
        <div className='flex items-center gap-4px min-w-0'>
          <span
            className={classNames('text-13px truncate flex-1 min-w-0', selected && !batchMode ? 'text-1' : 'text-1')}
          >
            {conversation.name || t('conversation.welcome.newConversation')}
          </span>
          {timestamp > 0 && (
            <span className='text-11px text-t-secondary shrink-0 whitespace-nowrap'>
              {formatConversationTime(timestamp)}
            </span>
          )}
        </div>
        {/* Preview / desc row */}
        {conversation.desc && <span className='text-12px text-t-secondary truncate block'>{conversation.desc}</span>}
      </div>

      {/* Unread dot (absolute, top-right) */}
      {renderCompletionUnreadDot()}

      {/* Pin indicator (absolute, top-right, not shown when menu open or on mobile) */}
      {!batchMode && isPinned && !menuVisible && !isMobile && (
        <span
          className={classNames(
            'absolute right-8px top-4px flex-center text-t-secondary pointer-events-none !collapsed-hidden group-hover:hidden',
            isPinned ? siderStyles.pinnedTextSlot : ''
          )}
          style={{ width: 12, height: 12 }}
        >
          <Pushpin theme='outline' size='12' />
        </span>
      )}

      {/* Three-dot hover menu */}
      {!batchMode && (
        <div
          className={classNames('absolute right-0px top-0px h-full items-center justify-end !collapsed-hidden pr-8px', {
            flex: isMobile || menuVisible,
            'hidden group-hover:flex': !isMobile && !menuVisible,
          })}
          style={{
            backgroundImage: selected
              ? 'linear-gradient(to right, transparent, var(--aou-2) 20%)'
              : 'linear-gradient(to right, transparent, var(--aou-1) 20%)',
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Dropdown
            droplist={
              <Menu
                onClickMenuItem={(key) => {
                  if (key === 'pin') {
                    onTogglePin(conversation);
                    return;
                  }
                  if (key === 'rename') {
                    onEditStart(conversation);
                    return;
                  }
                  if (key === 'export') {
                    onExport?.(conversation);
                    return;
                  }
                  if (key === 'delete') {
                    onDelete(conversation.id);
                  }
                }}
              >
                <Menu.Item key='pin'>
                  <div className='flex items-center gap-8px'>
                    <Pushpin theme='outline' size='14' />
                    <span>{isPinned ? t('conversation.history.unpin') : t('conversation.history.pin')}</span>
                  </div>
                </Menu.Item>
                <Menu.Item key='rename'>
                  <div className='flex items-center gap-8px'>
                    <EditOne theme='outline' size='14' />
                    <span>{t('conversation.history.rename')}</span>
                  </div>
                </Menu.Item>
                {onExport && (
                  <Menu.Item key='export'>
                    <div className='flex items-center gap-8px'>
                      <Export theme='outline' size='14' />
                      <span>{t('conversation.history.export')}</span>
                    </div>
                  </Menu.Item>
                )}
                <Menu.Item key='delete'>
                  <div className='flex items-center gap-8px text-[rgb(var(--warning-6))]'>
                    <DeleteOne theme='outline' size='14' />
                    <span>{t('conversation.history.deleteTitle')}</span>
                  </div>
                </Menu.Item>
              </Menu>
            }
            trigger='click'
            position='br'
            popupVisible={menuVisible}
            onVisibleChange={(visible) => onMenuVisibleChange(conversation.id, visible)}
            getPopupContainer={() => document.body}
            unmountOnExit={false}
          >
            <span
              className={classNames(
                'flex-center cursor-pointer hover:bg-fill-2 rd-4px p-4px transition-colors relative text-t-primary',
                {
                  flex: isMobile || menuVisible,
                  'hidden group-hover:flex': !isMobile && !menuVisible,
                }
              )}
              onClick={(event) => {
                event.stopPropagation();
                onOpenMenu(conversation);
              }}
            >
              <div
                className='flex flex-col gap-2px items-center justify-center'
                style={{ width: '16px', height: '16px' }}
              >
                <div className='w-2px h-2px rounded-full bg-current'></div>
                <div className='w-2px h-2px rounded-full bg-current'></div>
                <div className='w-2px h-2px rounded-full bg-current'></div>
              </div>
            </span>
          </Dropdown>
        </div>
      )}
    </div>
  );
};

export default ConversationRow;
