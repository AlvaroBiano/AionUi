/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { ConfigStorage } from '@/common/config/storage';
import { ASSISTANT_PRESETS, getPresetAvatarBgColor } from '@/common/config/presets/assistantPresets';
import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import DirectorySelectionModal from '@/renderer/components/settings/DirectorySelectionModal';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { ipcBridge } from '@/common';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@/renderer/pages/guid/constants';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { emitter } from '@/renderer/utils/emitter';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Dropdown, Empty, Input, Menu, Message, Modal, Tooltip } from '@arco-design/web-react';
import { DeleteOne, Down, FolderOpen, Plus, Right } from '@icon-park/react';
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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [groupMenuVisibleKey, setGroupMenuVisibleKey] = useState<string | null>(null);
  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const messagesCollapsed = collapsedSections.has('messages');

  const handleDeleteGroup = useCallback(
    (conversationIds: string[]) => {
      Modal.confirm({
        title: t('conversation.history.deleteAgentGroup'),
        content: t('conversation.history.deleteAgentGroupConfirm', { count: conversationIds.length }),
        okText: t('conversation.history.confirmDelete'),
        cancelText: t('conversation.history.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          try {
            const results = await Promise.all(
              conversationIds.map((cid) => ipcBridge.conversation.remove.invoke({ id: cid }))
            );
            const successCount = results.filter(Boolean).length;
            emitter.emit('chat.history.refresh');
            if (successCount > 0) {
              Message.success(t('conversation.history.deleteAgentGroupSuccess', { count: successCount }));
            } else {
              Message.error(t('conversation.history.deleteFailed'));
            }
          } catch (err) {
            console.error('Failed to delete agent group:', err);
            Message.error(t('conversation.history.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [t]
  );

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
    const locale = i18n.language || 'en-US';
    const map = new Map<string, { displayName: string; avatarSrc: string | null; avatarEmoji?: string }>();

    /** Resolve avatar string to {avatarSrc, avatarEmoji} */
    const resolveAvatar = (avatarValue: string): { avatarSrc: string | null; avatarEmoji?: string } => {
      const v = avatarValue.trim();
      if (!v) return { avatarSrc: null };
      const mapped = CUSTOM_AVATAR_IMAGE_MAP[v];
      if (mapped) return { avatarSrc: mapped };
      const resolved = resolveExtensionAssetUrl(v) || v;
      const isImage =
        /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
      if (isImage) return { avatarSrc: resolved };
      if (v.endsWith('.svg')) return { avatarSrc: null };
      return { avatarSrc: null, avatarEmoji: v };
    };

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

    // Built-in preset assistants (Gemini type with presetAssistantId)
    // agentKey can be 'financial-model-creator' or 'builtin-financial-model-creator'
    for (const preset of ASSISTANT_PRESETS) {
      const displayName = preset.nameI18n[locale] || preset.nameI18n['en-US'] || preset.id;
      const { avatarSrc, avatarEmoji } = resolveAvatar(preset.avatar || '');
      const entry = { displayName, avatarSrc, avatarEmoji };
      map.set(preset.id, entry);
      map.set(`builtin-${preset.id}`, entry);
    }

    // Custom agents (agentKey = `custom:${id}`)
    if (Array.isArray(customAgents)) {
      for (const agent of customAgents as Array<{
        id?: string;
        name?: string;
        nameI18n?: Record<string, string>;
        avatar?: string;
        presetAgentType?: string;
      }>) {
        if (!agent?.id) continue;
        const key = `custom:${agent.id}`;
        const displayName = agent.nameI18n?.[locale] || agent.nameI18n?.['en-US'] || agent.name || agent.id;
        const { avatarSrc, avatarEmoji } = resolveAvatar(agent.avatar || '');

        if (avatarSrc || avatarEmoji) {
          map.set(key, { displayName, avatarSrc: avatarSrc ?? null, avatarEmoji });
        } else {
          // No custom avatar — fall back to the backing backend's logo
          const backendSrc = agent.presetAgentType
            ? (resolveAgentLogo({ backend: agent.presetAgentType }) ?? null)
            : null;
          map.set(key, { displayName, avatarSrc: backendSrc });
        }
      }
    }

    return map;
  }, [customAgents, i18n.language]);

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

        {/* Messages section header — subtle label,退到背景 */}
        {!collapsed && (agentGroups.length > 0 || pinnedConversations.length === 0) && (
          <div
            className='group h-30px flex items-center gap-4px px-10px cursor-pointer select-none sticky top-0 z-20 bg-fill-2 min-w-0 mt-4px'
            onClick={() => toggleSection('messages')}
          >
            <span className='text-t-tertiary flex items-center mr-2px'>
              {messagesCollapsed ? (
                <Right theme='outline' size={14} style={{ lineHeight: 0 }} />
              ) : (
                <Down theme='outline' size={14} style={{ lineHeight: 0 }} />
              )}
            </span>
            <span className='text-12px text-t-tertiary font-medium flex-1 min-w-0'>
              {t('conversation.history.messagesSection')}
            </span>
            <div
              className='opacity-0 group-hover:opacity-100 transition-opacity h-18px w-18px rd-4px flex items-center justify-center cursor-pointer hover:bg-fill-3 shrink-0'
              onClick={(e) => {
                e.stopPropagation();
                void navigate('/guid');
              }}
            >
              <Plus theme='outline' size='14' fill='var(--color-text-3)' style={{ lineHeight: 0 }} />
            </div>
          </div>
        )}

        {!messagesCollapsed &&
          agentGroups.map((agentGroup) => {
            const logoSrc =
              agentGroup.avatarSrc ??
              resolveAgentLogo({
                backend: agentGroup.agentKey.startsWith('custom:') ? undefined : agentGroup.agentKey,
              });
            let groupAvatarBgColor: string | undefined;
            if (agentGroup.agentKey.startsWith('custom:')) {
              groupAvatarBgColor = getPresetAvatarBgColor(agentGroup.agentKey.slice(7));
            } else {
              try {
                groupAvatarBgColor =
                  ACP_BACKENDS_ALL[agentGroup.agentKey as keyof typeof ACP_BACKENDS_ALL]?.avatarBgColor;
              } catch {
                /* ignore */
              }
            }
            const isCollapsed = collapsedAgentGroups.has(agentGroup.agentKey);

            const isGroupMenuVisible = groupMenuVisibleKey === agentGroup.agentKey;
            const headerContent = (
              <div
                className='group h-30px flex items-center gap-8px px-10px cursor-pointer select-none sticky top-30px z-10 bg-fill-2 hover:bg-fill-3 rd-8px transition-colors min-w-0'
                onClick={() => handleToggleAgentGroup(agentGroup.agentKey)}
              >
                {/* Agent avatar */}
                <AgentAvatar
                  size={18}
                  avatarSrc={logoSrc ?? null}
                  avatarEmoji={agentGroup.avatarEmoji ?? null}
                  avatarBgColor={groupAvatarBgColor}
                />
                {/* Agent name */}
                <span className='text-13px text-t-primary font-medium truncate flex-1 min-w-0'>
                  {agentGroup.displayName}
                </span>
                {/* Three-dot dropdown menu — shown on hover */}
                <div
                  className={classNames(
                    'absolute right-0 top-0 h-full items-center justify-end pr-8px',
                    isGroupMenuVisible ? 'flex' : 'hidden group-hover:flex'
                  )}
                  style={{
                    backgroundImage: 'linear-gradient(to right, transparent, var(--aou-1) 20%)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Dropdown
                    droplist={
                      <Menu
                        onClickMenuItem={(key) => {
                          setGroupMenuVisibleKey(null);
                          if (key === 'new-chat') {
                            void navigate(`/guid?agent=${encodeURIComponent(agentGroup.agentKey)}`);
                          } else if (key === 'delete') {
                            handleDeleteGroup(agentGroup.conversations.map((c) => c.id));
                          }
                        }}
                      >
                        <Menu.Item key='new-chat'>
                          <div className='flex items-center gap-8px'>
                            <Plus theme='outline' size='14' />
                            <span>{t('conversation.welcome.newConversation')}</span>
                          </div>
                        </Menu.Item>
                        <Menu.Item key='delete'>
                          <div className='flex items-center gap-8px text-[rgb(var(--warning-6))]'>
                            <DeleteOne theme='outline' size='14' />
                            <span>{t('conversation.history.deleteAgentGroup')}</span>
                          </div>
                        </Menu.Item>
                      </Menu>
                    }
                    trigger='click'
                    position='br'
                    popupVisible={isGroupMenuVisible}
                    onVisibleChange={(visible) => setGroupMenuVisibleKey(visible ? agentGroup.agentKey : null)}
                    getPopupContainer={() => document.body}
                    unmountOnExit={false}
                  >
                    <span
                      className='flex-center cursor-pointer hover:bg-fill-2 rd-4px p-4px transition-colors text-t-primary'
                      onClick={(e) => {
                        e.stopPropagation();
                        setGroupMenuVisibleKey(agentGroup.agentKey);
                      }}
                    >
                      <div
                        className='flex flex-col gap-2px items-center justify-center'
                        style={{ width: 16, height: 16 }}
                      >
                        <div className='w-2px h-2px rounded-full bg-current' />
                        <div className='w-2px h-2px rounded-full bg-current' />
                        <div className='w-2px h-2px rounded-full bg-current' />
                      </div>
                    </span>
                  </Dropdown>
                </div>
              </div>
            );

            return (
              <div key={agentGroup.agentKey} className='mb-1px min-w-0'>
                {collapsed ? (
                  <Tooltip content={agentGroup.displayName} position='right'>
                    <div
                      className='w-full h-30px flex items-center justify-center cursor-pointer rd-8px hover:bg-fill-3 transition-colors'
                      onClick={() => handleToggleAgentGroup(agentGroup.agentKey)}
                    >
                      <AgentAvatar
                        size={18}
                        avatarSrc={logoSrc ?? null}
                        avatarEmoji={agentGroup.avatarEmoji ?? null}
                        avatarBgColor={groupAvatarBgColor}
                      />
                    </div>
                  </Tooltip>
                ) : (
                  headerContent
                )}
                {!isCollapsed && (
                  <div className='min-w-0 pt-1px'>
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
