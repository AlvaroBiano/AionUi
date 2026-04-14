/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { ConfigStorage } from '@/common/config/storage';
import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import DirectorySelectionModal from '@/renderer/components/settings/DirectorySelectionModal';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@/renderer/pages/guid/constants';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Empty, Input, Modal, Tooltip } from '@arco-design/web-react';
import { Down, FolderOpen, Right, Robot } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import ConversationRow from './ConversationRow';
import DragOverlayContent from './DragOverlayContent';
import SortableConversationRow from './SortableConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useExport } from './hooks/useExport';
import { buildAgentGroupedHistory } from './utils/groupingHelpers';
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({
  onSessionClick,
  collapsed = false,
  tooltipEnabled = false,
  batchMode = false,
  onBatchModeChange,
}) => {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Sync active conversation ref when route changes (for URL navigation)
  // This doesn't trigger state update, avoiding double render
  useEffect(() => {
    if (id) {
      setActiveConversation(id);
    }
  }, [id, setActiveConversation]);

  const {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    pinnedConversations,
    collapsedAgentGroups,
    handleToggleAgentGroup,
  } = useConversations();

  // Fetch custom agents to populate display map with correct avatars
  const { data: customAgents } = useSWR('acp.customAgents', () => ConfigStorage.get('acp.customAgents'));

  // Build agent-grouped history from conversations using static backend metadata + custom agents
  const agentDisplayMap = useMemo(() => {
    const map = new Map<string, { displayName: string; avatarSrc: string | null; avatarEmoji?: string }>();
    // Populate from ACP_BACKENDS_ALL for known backends
    for (const [key, config] of Object.entries(ACP_BACKENDS_ALL)) {
      map.set(key, {
        displayName: config.name,
        avatarSrc: resolveAgentLogo({ backend: key }) ?? null,
      });
    }
    // Gemini backend key
    map.set('gemini', {
      displayName: 'Gemini',
      avatarSrc: resolveAgentLogo({ backend: 'gemini' }) ?? null,
    });
    // Custom agents (agentKey = `custom:${id}`)
    if (Array.isArray(customAgents)) {
      for (const agent of customAgents as Array<{
        id?: string;
        name?: string;
        avatar?: string;
        presetAgentType?: string;
      }>) {
        if (!agent?.id) continue;
        const key = `custom:${agent.id}`;
        const displayName = agent.name || agent.id;
        const avatarValue = (agent.avatar || '').trim();

        // 1. Check mapped avatars (e.g. cowork.svg)
        const mapped = CUSTOM_AVATAR_IMAGE_MAP[avatarValue];
        if (mapped) {
          map.set(key, { displayName, avatarSrc: mapped });
          continue;
        }

        // 2. Try to resolve as image URL
        const resolved = avatarValue ? resolveExtensionAssetUrl(avatarValue) || avatarValue : '';
        const isImage =
          resolved &&
          (/\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) ||
            /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved));
        if (isImage) {
          map.set(key, { displayName, avatarSrc: resolved });
          continue;
        }

        // 3. Treat as emoji if non-empty and not a broken SVG identifier
        if (avatarValue && !avatarValue.endsWith('.svg')) {
          map.set(key, { displayName, avatarSrc: null, avatarEmoji: avatarValue });
          continue;
        }

        // 4. Fall back to the backing backend's logo (e.g. Claude logo for Claude-backed preset)
        const backendSrc = agent.presetAgentType
          ? (resolveAgentLogo({ backend: agent.presetAgentType }) ?? null)
          : null;
        map.set(key, { displayName, avatarSrc: backendSrc });
      }
    }
    return map;
  }, [customAgents]);

  const { agentGroups } = useMemo(
    () => buildAgentGroupedHistory(conversations, agentDisplayMap),
    [conversations, agentDisplayMap]
  );

  const {
    selectedConversationIds,
    setSelectedConversationIds,
    selectedCount,
    allSelected,
    toggleSelectedConversation,
    handleToggleSelectAll,
  } = useBatchSelection(batchMode, conversations);

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
  } = useConversationActions({
    batchMode,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
  });

  const {
    exportTask,
    exportModalVisible,
    exportTargetPath,
    exportModalLoading,
    showExportDirectorySelector,
    setShowExportDirectorySelector,
    closeExportModal,
    handleSelectExportDirectoryFromModal,
    handleSelectExportFolder,
    handleExportConversation,
    handleBatchExport,
    handleConfirmExport,
  } = useExport({
    conversations,
    selectedConversationIds,
    setSelectedConversationIds,
    onBatchModeChange,
  });

  const { sensors, activeId, activeConversation, handleDragStart, handleDragEnd, handleDragCancel, isDragEnabled } =
    useDragAndDrop({
      pinnedConversations,
      batchMode,
      collapsed,
    });

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation): ConversationRowProps => ({
      conversation,
      isGenerating: isConversationGenerating(conversation.id),
      hasCompletionUnread: hasCompletionUnread(conversation.id),
      collapsed,
      tooltipEnabled,
      batchMode,
      checked: selectedConversationIds.has(conversation.id),
      selected: id === conversation.id,
      menuVisible: dropdownVisibleId === conversation.id,
      onToggleChecked: toggleSelectedConversation,
      onConversationClick: handleConversationClick,
      onOpenMenu: handleOpenMenu,
      onMenuVisibleChange: handleMenuVisibleChange,
      onEditStart: handleEditStart,
      onDelete: handleDeleteClick,
      onExport: handleExportConversation,
      onTogglePin: handleTogglePin,
      getJobStatus,
    }),
    [
      collapsed,
      tooltipEnabled,
      batchMode,
      isConversationGenerating,
      hasCompletionUnread,
      selectedConversationIds,
      id,
      dropdownVisibleId,
      toggleSelectedConversation,
      handleConversationClick,
      handleOpenMenu,
      handleMenuVisibleChange,
      handleEditStart,
      handleDeleteClick,
      handleExportConversation,
      handleTogglePin,
      getJobStatus,
    ]
  );

  const renderConversation = (conversation: TChatConversation) => {
    const rowProps = getConversationRowProps(conversation);
    return <ConversationRow key={conversation.id} {...rowProps} />;
  };

  // Collect all sortable IDs for the pinned section
  const pinnedIds = useMemo(() => pinnedConversations.map((c) => c.id), [pinnedConversations]);

  if (agentGroups.length === 0 && pinnedConversations.length === 0) {
    return (
      <div className='py-48px flex-center'>
        <Empty description={t('conversation.history.noHistory')} />
      </div>
    );
  }

  return (
    <>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameModalName}
          onChange={setRenameModalName}
          onPressEnter={handleRenameConfirm}
          placeholder={t('conversation.history.renamePlaceholder')}
          allowClear
        />
      </Modal>

      <Modal
        visible={exportModalVisible}
        title={t('conversation.history.exportDialogTitle')}
        onCancel={closeExportModal}
        footer={null}
        style={{ borderRadius: '12px' }}
        className='conversation-export-modal'
        alignCenter
        getPopupContainer={() => document.body}
      >
        <div className='py-8px'>
          <div className='text-14px mb-16px text-t-secondary'>
            {exportTask?.mode === 'batch'
              ? t('conversation.history.exportDialogBatchDescription', { count: exportTask.conversationIds.length })
              : t('conversation.history.exportDialogSingleDescription')}
          </div>

          <div className='mb-16px p-16px rounded-12px bg-fill-1'>
            <div className='text-14px mb-8px text-t-primary'>{t('conversation.history.exportTargetFolder')}</div>
            <div
              className='flex items-center justify-between px-12px py-10px rounded-8px transition-colors'
              style={{
                backgroundColor: 'var(--color-bg-1)',
                border: '1px solid var(--color-border-2)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
                opacity: exportModalLoading ? 0.55 : 1,
              }}
              onClick={() => {
                void handleSelectExportFolder();
              }}
            >
              <span
                className='text-14px overflow-hidden text-ellipsis whitespace-nowrap'
                style={{ color: exportTargetPath ? 'var(--color-text-1)' : 'var(--color-text-3)' }}
              >
                {exportTargetPath || t('conversation.history.exportSelectFolder')}
              </span>
              <FolderOpen theme='outline' size='18' fill='var(--color-text-3)' />
            </div>
          </div>

          <div className='flex items-center gap-8px mb-20px text-14px text-t-secondary'>
            <span>💡</span>
            <span>{t('conversation.history.exportDialogHint')}</span>
          </div>

          <div className='flex gap-12px justify-end'>
            <button
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid var(--color-border-2)',
                backgroundColor: 'var(--color-fill-2)',
                color: 'var(--color-text-1)',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
              }}
              onClick={closeExportModal}
            >
              {t('common.cancel')}
            </button>
            <button
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: 'none',
                backgroundColor: exportModalLoading ? 'var(--color-fill-3)' : 'var(--color-text-1)',
                color: 'var(--color-bg-1)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '0.85';
                }
              }}
              onMouseLeave={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '1';
                }
              }}
              onClick={() => {
                void handleConfirmExport();
              }}
              disabled={exportModalLoading}
            >
              {exportModalLoading ? t('conversation.history.exporting') : t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>

      <DirectorySelectionModal
        visible={showExportDirectorySelector}
        onConfirm={handleSelectExportDirectoryFromModal}
        onCancel={() => setShowExportDirectorySelector(false)}
      />

      {batchMode && !collapsed && (
        <div className='px-12px pb-8px'>
          <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
            <div className='text-12px leading-18px text-t-secondary'>
              {t('conversation.history.selectedCount', { count: selectedCount })}
            </div>
            <div className='grid grid-cols-2 gap-6px'>
              <Button
                className='!col-span-2 !w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleToggleSelectAll}
              >
                {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleBatchExport}
              >
                {t('conversation.history.batchExport')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                status='warning'
                onClick={handleBatchDelete}
              >
                {t('conversation.history.batchDelete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {pinnedConversations.length > 0 && (
            <div className='mb-8px min-w-0'>
              {!collapsed && (
                <div
                  className='group flex items-center px-12px py-6px cursor-pointer select-none sticky top-0 z-10 bg-fill-2'
                  onClick={() => toggleSection('pinned')}
                >
                  <span className='text-12px text-t-secondary font-medium'>
                    {t('conversation.history.pinnedSection')}
                  </span>
                  <span className='ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-t-secondary flex items-center'>
                    {collapsedSections.has('pinned') ? (
                      <Right theme='outline' size={12} />
                    ) : (
                      <Down theme='outline' size={12} />
                    )}
                  </span>
                </div>
              )}
              {!collapsedSections.has('pinned') && (
                <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                  <div className='min-w-0'>
                    {pinnedConversations.map((conversation) => {
                      const props = getConversationRowProps(conversation);
                      return isDragEnabled ? (
                        <SortableConversationRow key={conversation.id} {...props} />
                      ) : (
                        <ConversationRow key={conversation.id} {...props} />
                      );
                    })}
                  </div>
                </SortableContext>
              )}
            </div>
          )}

          <DragOverlay dropAnimation={null}>
            {activeId && activeConversation ? <DragOverlayContent conversation={activeConversation} /> : null}
          </DragOverlay>
        </DndContext>

        {agentGroups.map((agentGroup) => {
          const logoSrc =
            agentGroup.avatarSrc ??
            resolveAgentLogo({ backend: agentGroup.agentKey.startsWith('custom:') ? undefined : agentGroup.agentKey });
          const isCollapsed = collapsedAgentGroups.has(agentGroup.agentKey);

          const headerContent = (
            <div
              className='group flex items-center gap-8px px-12px py-6px cursor-pointer select-none sticky top-0 z-10 bg-fill-2 min-w-0'
              onClick={() => handleToggleAgentGroup(agentGroup.agentKey)}
            >
              {/* Agent avatar */}
              <span
                className='shrink-0 flex items-center justify-center cursor-pointer'
                onClick={(e) => {
                  e.stopPropagation();
                  void navigate(`/guid?agent=${encodeURIComponent(agentGroup.agentKey)}`);
                }}
              >
                {agentGroup.avatarEmoji ? (
                  <span className='text-16px leading-none'>{agentGroup.avatarEmoji}</span>
                ) : logoSrc ? (
                  <img src={logoSrc} alt={agentGroup.displayName} width={16} height={16} className='object-contain' />
                ) : (
                  <Robot theme='outline' size={16} fill='currentColor' />
                )}
              </span>
              {/* Agent name — navigates to /guid on click */}
              <span
                className='text-12px text-t-secondary font-medium truncate flex-1 min-w-0 hover:text-t-primary transition-colors'
                onClick={(e) => {
                  e.stopPropagation();
                  void navigate(`/guid?agent=${encodeURIComponent(agentGroup.agentKey)}`);
                }}
              >
                {agentGroup.displayName}
              </span>
              {/* Collapse arrow */}
              <span className='ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-t-secondary flex items-center shrink-0'>
                {isCollapsed ? <Right theme='outline' size={12} /> : <Down theme='outline' size={12} />}
              </span>
            </div>
          );

          return (
            <div key={agentGroup.agentKey} className='mb-8px min-w-0'>
              {collapsed ? (
                <Tooltip content={agentGroup.displayName} position='right'>
                  <div
                    className='w-full h-32px flex items-center justify-center cursor-pointer'
                    onClick={() => handleToggleAgentGroup(agentGroup.agentKey)}
                  >
                    {agentGroup.avatarEmoji ? (
                      <span className='text-16px leading-none'>{agentGroup.avatarEmoji}</span>
                    ) : logoSrc ? (
                      <img
                        src={logoSrc}
                        alt={agentGroup.displayName}
                        width={16}
                        height={16}
                        className='object-contain'
                      />
                    ) : (
                      <Robot theme='outline' size={16} fill='currentColor' />
                    )}
                  </div>
                </Tooltip>
              ) : (
                headerContent
              )}
              {!isCollapsed && (
                <div className='min-w-0'>
                  {agentGroup.conversations.map((conversation) => renderConversation(conversation))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default WorkspaceGroupedHistory;
