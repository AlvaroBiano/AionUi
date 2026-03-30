/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import { uuid } from '@/common/utils';
import SendBox from '@/renderer/components/chat/sendbox';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { MessageListProvider, useAddOrUpdateMessage, useMessageLstCache } from '@/renderer/pages/conversation/Messages/hooks';
import MessageList from '@/renderer/pages/conversation/Messages/MessageList';
import HOC from '@/renderer/utils/ui/HOC';
import { Alert, Button, Drawer, Tag, Tooltip } from '@arco-design/web-react';
import { Close, Info, Pound, SettingTwo, Shield } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CronJobManager } from '@/renderer/pages/cron';
import { emitter } from '@/renderer/utils/emitter';
import { useAgentRegistry } from '@/renderer/hooks/useAgentRegistry';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import { iconColors } from '@/renderer/styles/colors';

import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import ChatLayout from '../components/ChatLayout';
import ChatSider from '../components/ChatSider';
import ConversationChatConfirm from '../components/ConversationChatConfirm';
import AddMemberModal from './components/AddMemberModal';
import CostPanel from './components/CostPanel';
import MemberProfileDrawer from './components/MemberProfileDrawer';
import TeammateTabBar from './components/TeammateTabBar';
import TeammateTabView from './components/TeammateTabView';
import { useDispatchAdminStream } from './hooks/useDispatchAdminStream';
import { useGroupChatInfo } from './hooks/useGroupChatInfo';
import { useGroupChatTabs } from './hooks/useGroupChatTabs';
import type { GroupChatViewProps } from './types';

/**
 * Resolve admin agent name from conversation extra.
 * Priority: registry (dynamic, i18n-aware) > DB snapshot > conversation.name fallback
 */
function resolveAdminAgentName(
  extra: { leaderName?: string; leaderAgentId?: string },
  fallback: string,
  agentRegistry?: Map<string, { name: string }>,
): string {
  const id = extra.leaderAgentId;
  // Prefer registry name (dynamic, reflects current naming like "Gemini CLI")
  if (id && agentRegistry) {
    const registryAgent = agentRegistry.get(id);
    if (registryAgent) return registryAgent.name;
  }
  if (extra.leaderName) return extra.leaderName;
  return fallback;
}

/**
 * Resolve admin agent avatar from conversation extra.
 * Priority: DB snapshot > CLI agent logo > undefined
 */
function resolveAdminAgentAvatar(extra: { leaderAvatar?: string; teammateConfig?: { avatar?: string }; leaderAgentId?: string }): string | undefined {
  if (extra.leaderAvatar) return extra.leaderAvatar;
  if (extra.teammateConfig?.avatar) return extra.teammateConfig.avatar;
  if (extra.leaderAgentId) return getAgentLogo(extra.leaderAgentId) ?? undefined;
  return undefined;
}

const GroupChatView: React.FC<GroupChatViewProps> = ({ conversation }) => {
  const { t } = useTranslation();
  const agentRegistry = useAgentRegistry();

  // ── Extract extra fields once ──
  const extra = conversation.extra as {
    groupChatName?: string;
    teammateConfig?: { avatar?: string };
    leaderAgentId?: string;
    leaderName?: string;
    leaderAvatar?: string;
    adminAgentType?: string;
    backend?: string;
    sessionMode?: string;
  };

  // ── Two distinct identities ──
  // 1. Channel name: user-given title for the group chat (header, sidebar, placeholder)
  const groupChatName = extra.groupChatName || conversation.name;
  // 2. Admin agent: the AI orchestrator (tab label, message attribution, avatar)
  const leaderAgentId = extra.leaderAgentId;
  const leaderAgentName = resolveAdminAgentName(extra, conversation.name, agentRegistry);
  const leaderAgentAvatar = resolveAdminAgentAvatar(extra);
  // Backend type for mode selector (ACP path stores it, Gemini path uses 'gemini')
  const leaderBackend = extra.backend || extra.adminAgentType || 'gemini';
  const initialSessionMode = extra.sessionMode;

  // ── Message list: load from DB + subscribe to live stream ──
  useMessageLstCache(conversation.id);
  const { running: adminRunning, thought: adminThought } = useDispatchAdminStream(conversation.id);
  const addOrUpdateMessage = useAddOrUpdateMessage();

  const {
    info,
    error: infoError,
    retry: retryInfo,
    refresh: refreshInfo,
  } = useGroupChatInfo(conversation.id, {
    autoRefreshInterval: 5_000,
  });
  const [sendBoxContent, setSendBoxContent] = useState('');
  const [sending, setSending] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const activeChildCount = useMemo(() => {
    if (!info?.children) return 0;
    return info.children.filter((c) => c.status === 'running' || c.status === 'pending').length;
  }, [info?.children]);

  const pendingCount = info?.pendingNotificationCount ?? 0;
  const showBanner = pendingCount > 0 && !bannerDismissed;

  // G3.3: Tab state — admin row uses leader agent name/avatar
  const { members, tabs, activeTabKey, onTabChange, onTabClose } = useGroupChatTabs(conversation.id, info, {
    name: leaderAgentName,
    avatar: leaderAgentAvatar,
  });

  // G3.5: Member profile drawer
  const [profileTarget, setProfileTarget] = useState<string | null>(null);

  // G3.6: Add member modal
  const [addMemberVisible, setAddMemberVisible] = useState(false);

  // Settings drawer
  const [settingsVisible, setSettingsVisible] = useState(false);

  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim()) return;
      const msgId = uuid();
      setSending(true);
      setBannerDismissed(true);

      // Optimistic update: show user message immediately via MessageList
      const userMessage: TMessage = {
        id: msgId,
        type: 'text',
        position: 'right',
        conversation_id: conversation.id,
        content: { content: message },
        createdAt: Date.now(),
      };
      addOrUpdateMessage(userMessage, true);

      try {
        console.log('[GroupChatView] handleSend: invoking sendMessage', { conversation_id: conversation.id, msgId, message });
        const result = await ipcBridge.conversation.sendMessage.invoke({
          input: message,
          msg_id: msgId,
          conversation_id: conversation.id,
        });
        console.log('[GroupChatView] handleSend: result', result);
        emitter.emit('chat.history.refresh');
        refreshInfo();
      } catch (err) {
        console.error('[GroupChatView] handleSend: error', err);
      } finally {
        setSending(false);
      }
    },
    [conversation.id, refreshInfo, addOrUpdateMessage],
  );

  // Header extra: task count + cron + settings icon (replaces AgentModeSelector position)
  const headerExtra = useMemo(
    () => (
      <div className='flex items-center gap-8px'>
        {activeChildCount > 0 && (
          <Tag color='arcoblue'>{t('dispatch.header.taskCount', { count: activeChildCount })}</Tag>
        )}
        <div className='shrink-0'>
          <CronJobManager conversationId={conversation.id} />
        </div>
        <Tooltip content={t('dispatch.settings.title')}>
          <div
            className='shrink-0 p-4px rd-4px cursor-pointer text-t-secondary hover:text-t-primary hover:bg-fill-2 transition-colors'
            onClick={() => setSettingsVisible(true)}
            style={{ lineHeight: 0 }}
          >
            <SettingTwo theme='outline' size='18' />
          </div>
        </Tooltip>
      </div>
    ),
    [activeChildCount, t, conversation.id],
  );

  // CF-3: Error state for group chat info fetch failure
  if (infoError) {
    return (
      <ChatLayout
        workspaceEnabled={true}
        hideTabs
        agentId={leaderAgentId}
        titleIcon={<Pound theme='outline' size='18' className='text-t-secondary' />}
        sider={<ChatSider conversation={conversation} />}
        siderTitle={<span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>}
        conversationId={conversation.id}
        title={groupChatName}
      >
        <div className='flex-center flex-1 flex-col gap-12px'>
          <Alert type='error' content={t('dispatch.error.groupChatLoadFailed')} style={{ maxWidth: '400px' }} />
          <Button type='primary' onClick={retryInfo}>
            {t('dispatch.error.retry')}
          </Button>
        </div>
      </ChatLayout>
    );
  }

  return (
    <ChatLayout
      workspaceEnabled={true}
      hideTabs
      agentId={leaderAgentId}
      titleIcon={<Pound theme='outline' size='18' className='text-t-secondary' />}
      headerExtra={headerExtra}
      sider={<ChatSider conversation={conversation} />}
      siderTitle={<span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>}
      conversationId={conversation.id}
      title={groupChatName}
    >
      {/* Unified member tab bar (Slack-like): admin first, then members, then [+] */}
      <TeammateTabBar
        tabs={tabs}
        activeTabKey={activeTabKey}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        onAddMemberClick={() => setAddMemberVisible(true)}
      />

      {/* Active tab content */}
      <div className='flex-1 flex flex-col min-h-0'>
        {/* Group chat tab: timeline + sendbox (CSS display:none to preserve scroll) */}
        <div style={{ display: activeTabKey === 'group-chat' ? 'flex' : 'none' }} className='flex-1 flex-col min-h-0'>
          {showBanner && (
            <div
              className='mx-16px mt-8px px-16px py-12px rd-8px flex items-center justify-between'
              style={{
                backgroundColor: 'rgba(var(--primary-6), 0.08)',
                border: '1px solid rgba(var(--primary-6), 0.2)',
              }}
            >
              <div className='flex items-center gap-8px text-14px text-t-primary'>
                <Info theme='outline' size='16' fill='rgb(var(--primary-6))' />
                <span>{t('dispatch.notification.pendingTasks', { count: pendingCount })}</span>
              </div>
              <Button
                type='text'
                size='mini'
                icon={<Close theme='outline' size='14' />}
                onClick={() => setBannerDismissed(true)}
              />
            </div>
          )}

          <ConversationProvider value={{ conversationId: conversation.id, type: 'dispatch' }}>
            <div className='flex-1 flex flex-col px-20px min-h-0'>
              <FlexFullContainer>
                <MessageList className='flex-1' />
              </FlexFullContainer>
              <ConversationChatConfirm conversation_id={conversation.id}>
                <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px'>
                  <ThoughtDisplay thought={adminThought} running={adminRunning} />
                  <SendBox
                    value={sendBoxContent}
                    onChange={setSendBoxContent}
                    loading={sending || adminRunning}
                    placeholder={t('dispatch.timeline.sendPlaceholder', { name: leaderAgentName })}
                    onSend={handleSend}
                    defaultMultiLine={true}
                    lockMultiLine={true}
                    className='z-10'
                    tools={
                      <AgentModeSelector
                        backend={leaderBackend}
                        conversationId={conversation.id}
                        compact
                        initialMode={initialSessionMode}
                        compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                      />
                    }
                  />
                </div>
              </ConversationChatConfirm>
            </div>
          </ConversationProvider>
        </div>

        {/* G3.4: Teammate tabs (read-only conversation view) */}
        {tabs
          .filter((tab) => tab.key !== 'group-chat')
          .map((tab) => (
            <div
              key={tab.key}
              style={{ display: activeTabKey === tab.key ? 'flex' : 'none' }}
              className='flex-1 flex-col min-h-0'
            >
              <TeammateTabView childSessionId={tab.key} conversationId={conversation.id} />
            </div>
          ))}
      </div>

      {/* G3.5: Member Profile Drawer */}
      <MemberProfileDrawer
        visible={Boolean(profileTarget)}
        memberId={profileTarget}
        members={members}
        childrenInfo={info?.children || []}
        conversationId={conversation.id}
        onClose={() => setProfileTarget(null)}
        onModelChange={() => refreshInfo()}
        onRemoveMember={(_memberId) => {
          setProfileTarget(null);
        }}
      />

      {/* G3.6: Add Member Modal */}
      <AddMemberModal
        visible={addMemberVisible}
        onClose={() => setAddMemberVisible(false)}
        conversationId={conversation.id}
        existingMemberIds={members.map((m) => m.agentId).filter((id): id is string => Boolean(id))}
        onMemberAdded={() => {
          refreshInfo();
          setAddMemberVisible(false);
        }}
      />

      {/* Settings Drawer */}
      <Drawer
        visible={settingsVisible}
        width={400}
        placement='right'
        title={t('dispatch.settings.title')}
        onCancel={() => setSettingsVisible(false)}
        footer={null}
      >
        <CostPanel conversationId={conversation.id} />
      </Drawer>
    </ChatLayout>
  );
};

export default HOC(MessageListProvider)(GroupChatView);
