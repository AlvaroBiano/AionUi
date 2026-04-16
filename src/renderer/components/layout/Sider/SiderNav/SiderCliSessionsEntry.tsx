/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IExternalCliSession } from '@/common/adapter/ipcBridge';
import { useConversationTabs } from '@/renderer/pages/conversation/hooks/ConversationTabsContext';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import { blockMobileInputFocus, blurActiveElement } from '@/renderer/utils/ui/focus';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { Button, Empty, Message, Modal, Spin, Tooltip } from '@arco-design/web-react';
import { FolderOpen, History } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface SiderCliSessionsEntryProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onSessionClick?: () => void;
}

const formatTimestamp = (timestamp: number): string => {
  if (!timestamp) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
};

const getWorkspaceName = (workspace: string): string => {
  if (!workspace) {
    return '';
  }

  const parts = workspace.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || workspace;
};

const SiderCliSessionsEntry: React.FC<SiderCliSessionsEntryProps> = ({
  isMobile,
  collapsed,
  siderTooltipProps,
  onSessionClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openTab, closeAllTabs, activeTab } = useConversationTabs();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<IExternalCliSession[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const title = t('conversation.cliSessions.title');
  const entryLabel = t('conversation.cliSessions.entry');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await ipcBridge.conversation.listExternalCliSessions.invoke();
      setSessions(result);
    } catch (error) {
      console.error('[SiderCliSessionsEntry] Failed to load CLI sessions:', error);
      setSessions([]);
      setLoadFailed(true);
      Message.error(t('conversation.cliSessions.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleOpen = useCallback(() => {
    setVisible(true);
    void loadSessions();
  }, [loadSessions]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setImportingId(null);
  }, []);

  const handleOpenConversation = useCallback(
    (conversation: Awaited<ReturnType<typeof ipcBridge.conversation.importExternalCliSession.invoke>>) => {
      blockMobileInputFocus();
      blurActiveElement();

      const customWorkspace = conversation.extra?.customWorkspace;
      const workspace = conversation.extra?.workspace;
      if (!customWorkspace) {
        closeAllTabs();
      } else {
        const currentWorkspace = activeTab?.workspace;
        if (!currentWorkspace || currentWorkspace !== workspace) {
          closeAllTabs();
        }
        openTab(conversation);
      }

      setVisible(false);
      void navigate(`/conversation/${conversation.id}`);
      onSessionClick?.();
    },
    [activeTab?.workspace, closeAllTabs, navigate, onSessionClick, openTab]
  );

  const handleImport = useCallback(
    async (session: IExternalCliSession) => {
      setImportingId(session.id);
      try {
        const conversation = await ipcBridge.conversation.importExternalCliSession.invoke({
          provider: session.provider,
          sessionId: session.sessionId,
        });
        handleOpenConversation(conversation);
      } catch (error) {
        console.error('[SiderCliSessionsEntry] Failed to import CLI session:', error);
        Message.error(t('conversation.cliSessions.importFailed'));
      } finally {
        setImportingId(null);
      }
    },
    [handleOpenConversation, t]
  );

  const entryNode = useMemo(() => {
    if (collapsed) {
      return (
        <div
          className='w-full h-40px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary hover:bg-fill-3 active:bg-fill-4'
          onClick={handleOpen}
        >
          <History theme='outline' size='20' fill='currentColor' className='block leading-none shrink-0' />
        </div>
      );
    }

    return (
      <div
        className={classNames(
          'box-border h-40px w-full flex items-center justify-start gap-8px px-10px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary hover:bg-fill-3 active:bg-fill-4',
          isMobile && 'sider-action-btn-mobile'
        )}
        onClick={handleOpen}
      >
        <span className='w-28px h-28px flex items-center justify-center shrink-0'>
          <History theme='outline' size='20' fill='currentColor' className='block leading-none' />
        </span>
        <span className='collapsed-hidden text-t-primary text-14px font-medium leading-24px'>{entryLabel}</span>
      </div>
    );
  }, [collapsed, entryLabel, handleOpen, isMobile]);

  return (
    <>
      <Tooltip {...siderTooltipProps} content={entryLabel} position='right'>
        {entryNode}
      </Tooltip>

      <Modal
        visible={visible}
        title={title}
        footer={null}
        onCancel={handleClose}
        style={{ borderRadius: '12px', width: 680 }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <div className='min-h-220px max-h-70vh overflow-y-auto pr-4px'>
          {loading ? (
            <div className='py-40px flex items-center justify-center'>
              <Spin />
            </div>
          ) : loadFailed ? (
            <div className='py-40px flex items-center justify-center'>
              <Empty description={t('conversation.cliSessions.loadFailed')} />
            </div>
          ) : sessions.length === 0 ? (
            <div className='py-40px flex items-center justify-center'>
              <Empty description={t('conversation.cliSessions.empty')} />
            </div>
          ) : (
            <div className='flex flex-col gap-10px'>
              {sessions.map((session) => {
                const logo = getAgentLogo(session.provider);
                const workspaceName = getWorkspaceName(session.workspace);
                const isImporting = importingId === session.id;
                return (
                  <div
                    key={session.id}
                    className='flex items-start gap-12px p-12px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-0'
                  >
                    <span className='mt-2px w-24px h-24px flex items-center justify-center shrink-0'>
                      {logo ? (
                        <img src={logo} alt='' width={20} height={20} style={{ objectFit: 'contain' }} />
                      ) : (
                        <History theme='outline' size='20' fill='currentColor' />
                      )}
                    </span>
                    <div className='min-w-0 flex-1 flex flex-col gap-4px'>
                      <div className='flex items-center gap-8px min-w-0'>
                        <span className='text-14px font-semibold text-t-primary truncate'>{session.title}</span>
                        <span className='shrink-0 text-11px px-6px py-2px rd-999px bg-fill-2 text-t-secondary uppercase'>
                          {session.provider}
                        </span>
                        {session.importedConversationId ? (
                          <span className='shrink-0 text-11px px-6px py-2px rd-999px bg-[rgba(var(--primary-6),0.12)] text-primary'>
                            {t('conversation.cliSessions.importedBadge')}
                          </span>
                        ) : null}
                      </div>
                      {workspaceName ? (
                        <div className='flex items-center gap-6px text-12px text-t-secondary min-w-0'>
                          <FolderOpen theme='outline' size='14' fill='currentColor' className='shrink-0' />
                          <span className='truncate'>{workspaceName}</span>
                          <span className='truncate text-t-tertiary'>{session.workspace}</span>
                        </div>
                      ) : null}
                      <div className='text-12px text-t-tertiary'>{formatTimestamp(session.updatedAt)}</div>
                    </div>
                    <Button
                      type='secondary'
                      size='small'
                      loading={isImporting}
                      onClick={() => {
                        void handleImport(session);
                      }}
                    >
                      {session.importedConversationId
                        ? t('conversation.cliSessions.openExisting')
                        : t('conversation.cliSessions.continue')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default SiderCliSessionsEntry;
