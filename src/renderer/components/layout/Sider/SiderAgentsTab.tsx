/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AgentAvatar from '@/renderer/components/AgentAvatar';
import { ASSISTANT_PRESETS } from '@/common/config/presets/assistantPresets';
import { ACP_BACKENDS_ALL, ACP_ENABLED_BACKENDS } from '@/common/types/acpTypes';
import { getPresetProfile } from '@/renderer/assets/profiles';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { cleanupSiderTooltips } from '@/renderer/utils/ui/siderTooltip';
import { useUserProfile } from '@/renderer/hooks/user/useUserProfile';
import { useAssistantList } from '@/renderer/hooks/assistant';
import AionModal from '@/renderer/components/base/AionModal';
import InlineAgentEditor from '@/renderer/pages/settings/AgentSettings/InlineAgentEditor';
import { RemoteAgentFormModal } from '@/renderer/pages/settings/AgentSettings/RemoteAgentManagement';
import AddAssistantModal from '@/renderer/pages/agents/assistant/AddAssistantModal';
import { ConfigStorage } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import type { AcpBackendConfig } from '@/common/types/acpTypes';
import type { RemoteAgentConfig } from '@process/agent/remote/types';
import SiderRow from './SiderRow';
import { Dropdown, Menu, Message, Modal, Tooltip } from '@arco-design/web-react';
import { Down, Right, Plus } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

type SiderAgentsTabProps = {
  collapsed: boolean;
  tooltipEnabled: boolean;
  onSessionClick?: () => void;
};

/** Three-dot "⋮" button shown on row hover */
const ThreeDotButton: React.FC = () => (
  <div className='flex flex-col gap-2px items-center justify-center' style={{ width: 16, height: 16 }}>
    <div className='w-2px h-2px rounded-full bg-current' />
    <div className='w-2px h-2px rounded-full bg-current' />
    <div className='w-2px h-2px rounded-full bg-current' />
  </div>
);

/** Collapsible section header */
const SectionHeader: React.FC<{
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  onAdd?: () => void;
}> = ({ label, collapsed: sectionCollapsed, onToggle, onAdd }) => (
  <div
    className='group h-30px flex items-center gap-8px px-10px mt-4px cursor-pointer select-none sticky top-0 z-20 bg-[var(--color-fill-2)]'
    onClick={onToggle}
  >
    <span className='w-18px h-18px flex items-center justify-center shrink-0 text-t-primary'>
      {sectionCollapsed ? (
        <Right theme='outline' size={18} fill='currentColor' style={{ lineHeight: 0 }} />
      ) : (
        <Down theme='outline' size={18} fill='currentColor' style={{ lineHeight: 0 }} />
      )}
    </span>
    <span className='text-14px font-medium text-t-primary flex-1 min-w-0'>{label}</span>
    {onAdd && (
      <div
        className='h-20px w-20px rd-4px flex items-center justify-center cursor-pointer hover:bg-fill-3 shrink-0'
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
      >
        <Plus theme='outline' size='16' fill='var(--color-text-3)' style={{ lineHeight: 0 }} />
      </div>
    )}
  </div>
);

/** Overlay with three-dot dropdown, shown on hover */
const RowMenu: React.FC<{ isActive: boolean; droplist: React.ReactElement }> = ({ isActive, droplist }) => (
  <div
    className='absolute right-0 top-0 h-full items-center justify-end pr-8px hidden group-hover:flex'
    style={{
      backgroundImage: isActive
        ? 'linear-gradient(to right, transparent, var(--aou-2) 20%)'
        : 'linear-gradient(to right, transparent, var(--aou-1) 20%)',
    }}
    onClick={(e) => e.stopPropagation()}
  >
    <Dropdown
      droplist={droplist}
      trigger='click'
      position='br'
      getPopupContainer={() => document.body}
      unmountOnExit={false}
    >
      <span
        className='flex-center cursor-pointer hover:bg-fill-2 rd-4px p-4px transition-colors text-t-primary'
        onClick={(e) => e.stopPropagation()}
      >
        <ThreeDotButton />
      </span>
    </Dropdown>
  </div>
);

const SiderAgentsTab: React.FC<SiderAgentsTabProps> = ({ collapsed, tooltipEnabled, onSessionClick }) => {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { id: activeConvId } = useParams();
  const { profile: userProfile } = useUserProfile();
  const locale = i18n.language || 'en-US';

  const [localCollapsed, setLocalCollapsed] = useState(true);
  const [remoteCollapsed, setRemoteCollapsed] = useState(true);
  const [assistantsCollapsed, setAssistantsCollapsed] = useState(true);
  const [peopleCollapsed, setPeopleCollapsed] = useState(true);
  const [addAgentVisible, setAddAgentVisible] = useState(false);
  const [addRemoteAgentVisible, setAddRemoteAgentVisible] = useState(false);
  const [addAssistantVisible, setAddAssistantVisible] = useState(false);

  const { data: remoteAgentList, mutate: mutateRemote } = useSWR<RemoteAgentConfig[]>('remote-agents.list', () =>
    ipcBridge.remoteAgent.list.invoke()
  );

  // Detect which local backends are actually installed
  const { data: detectedBackends } = useSWR('sider.local-agents.detected', async () => {
    const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    if (result.success) return new Set(result.data.map((a) => a.backend as string));
    return null;
  });

  // Assistant list for "..." delete/duplicate
  const { assistants, loadAssistants } = useAssistantList();

  const navigate_ = useCallback(
    (path: string) => {
      cleanupSiderTooltips();
      onSessionClick?.();
      void navigate(path);
    },
    [navigate, onSessionClick]
  );

  const handleSaveAgent = useCallback(async (agent: AcpBackendConfig) => {
    const current = (await ConfigStorage.get('acp.customAgents')) ?? [];
    const list = current as AcpBackendConfig[];
    const idx = list.findIndex((a) => a.id === agent.id);
    const updated = idx >= 0 ? list.map((a, i) => (i === idx ? agent : a)) : [...list, agent];
    await ConfigStorage.set('acp.customAgents', updated);
    setAddAgentVisible(false);
  }, []);

  const handleDeleteAssistant = useCallback(
    async (assistantId: string) => {
      Modal.confirm({
        title: t('team.sider.deleteConfirm'),
        okText: t('team.sider.deleteOk'),
        cancelText: t('team.sider.deleteCancel'),
        okButtonProps: { status: 'warning' },
        alignCenter: true,
        style: { borderRadius: 12 },
        getPopupContainer: () => document.body,
        onOk: async () => {
          try {
            await Promise.all([
              ipcBridge.fs.deleteAssistantRule.invoke({ assistantId }),
              ipcBridge.fs.deleteAssistantSkill.invoke({ assistantId }),
            ]);
            const agents = (await ConfigStorage.get('acp.customAgents')) ?? [];
            await ConfigStorage.set(
              'acp.customAgents',
              (agents as AcpBackendConfig[]).filter((a) => a.id !== assistantId)
            );
            await loadAssistants();
            Message.success(t('common.success', { defaultValue: 'Deleted' }));
          } catch {
            Message.error(t('common.failed', { defaultValue: 'Failed' }));
          }
        },
      });
    },
    [loadAssistants, t]
  );

  const handleDeleteRemote = useCallback(
    async (agentId: string, agentName: string) => {
      Modal.confirm({
        title: t('settings.remoteAgent.deleteConfirm'),
        content: t('settings.remoteAgent.deleteConfirmContent', { name: agentName }),
        okText: t('settings.remoteAgent.deleteOk', { defaultValue: 'Delete' }),
        cancelText: t('settings.remoteAgent.cancel', { defaultValue: 'Cancel' }),
        okButtonProps: { status: 'warning' },
        alignCenter: true,
        style: { borderRadius: 12 },
        getPopupContainer: () => document.body,
        onOk: async () => {
          try {
            await ipcBridge.remoteAgent.delete.invoke({ id: agentId });
            await mutateRemote();
            Message.success(t('settings.remoteAgent.deleted', { defaultValue: 'Deleted' }));
          } catch {
            Message.error(t('common.failed', { defaultValue: 'Failed' }));
          }
        },
      });
    },
    [mutateRemote, t]
  );

  // Assistant rows — derived from the live assistants list so IDs always match
  const assistantRows = useMemo(() => {
    return assistants.map((a) => {
      const presetId = a.id.startsWith('builtin-') ? a.id.slice(8) : null;
      const profileImage = presetId ? getPresetProfile(presetId) : null;
      const preset = presetId ? ASSISTANT_PRESETS.find((p) => p.id === presetId) : null;
      return {
        key: a.id,
        displayName: (a.nameI18n as Record<string, string> | undefined)?.[locale] ?? a.name,
        avatarSrc: profileImage ?? null,
        avatarEmoji: profileImage ? undefined : (a.avatar ?? undefined),
        avatarBgColor: preset?.avatarBgColor ?? a.avatarBgColor,
      };
    });
  }, [assistants, locale]);

  // Local ACP backends — only show detected (installed) agents.
  // Gemini and Aion CLI are built-in agents — always shown first regardless of detection.
  // Other ACP agents are filtered to only detected ones.
  // While detection is loading (undefined), fall back to showing all.
  const localAgents = useMemo(() => {
    // Built-in agents always shown first: Gemini CLI, then Aion CLI
    const BUILTIN_KEYS = ['gemini', 'aionrs'] as const;
    const builtinEntries = BUILTIN_KEYS.flatMap((k) => {
      const cfg = ACP_BACKENDS_ALL[k] ?? ACP_ENABLED_BACKENDS[k];
      return cfg ? [[k, cfg] as [string, typeof cfg]] : [];
    });

    // Remaining ACP agents (excluding builtins, remote, custom), filtered by detection
    const otherEntries = Object.entries(ACP_ENABLED_BACKENDS).filter(([key]) => {
      if (['remote', 'custom', ...BUILTIN_KEYS].includes(key as (typeof BUILTIN_KEYS)[number])) return false;
      if (detectedBackends === undefined) return true; // still loading
      return detectedBackends !== null && detectedBackends.has(key);
    });

    return [...builtinEntries, ...otherEntries].map(([key, config]) => ({
      key,
      displayName: config.name,
      avatarSrc: resolveAgentLogo({ backend: key }) ?? null,
      avatarBgColor: (config as { avatarBgColor?: string }).avatarBgColor,
    }));
  }, [detectedBackends]);

  const remoteAgents: RemoteAgentConfig[] = remoteAgentList ?? [];

  // Active path detection
  const isAssistantActive = (id: string) =>
    typeof window !== 'undefined' && window.location.hash.includes(`/agents/assistant/${id}`);
  const isRemoteActive = (id: string) =>
    typeof window !== 'undefined' && window.location.hash.includes(`/agents/remote/${id}`);
  const isLocalActive = (key: string) =>
    typeof window !== 'undefined' && window.location.hash.includes(`/agents/local/${key}`);
  const isUserActive = typeof window !== 'undefined' && window.location.hash.includes('/agents/user');

  // ── Render helpers ───────────────────────────────────────────

  const renderLocalRow = (agent: {
    key: string;
    displayName: string;
    avatarSrc: string | null;
    avatarBgColor?: string;
  }) => {
    const isActive = isLocalActive(agent.key);
    const icon = <AgentAvatar size={20} avatarSrc={agent.avatarSrc} avatarBgColor={agent.avatarBgColor} />;

    if (collapsed) {
      return (
        <Tooltip key={agent.key} content={agent.displayName} position='right' disabled={!tooltipEnabled}>
          <SiderRow
            level={2}
            collapsed
            icon={icon}
            isActive={isActive}
            onClick={() => navigate_(`/agents/local/${agent.key}`)}
          />
        </Tooltip>
      );
    }

    return (
      <SiderRow
        key={agent.key}
        level={2}
        icon={icon}
        label={agent.displayName}
        isActive={isActive}
        onClick={() => navigate_(`/agents/local/${agent.key}`)}
      />
    );
  };

  const renderRemoteRow = (agent: RemoteAgentConfig) => {
    const isActive = isRemoteActive(agent.id);
    const icon = (
      <AgentAvatar
        size={20}
        avatarEmoji={agent.avatar ?? agent.name.charAt(0).toUpperCase()}
        avatarBgColor='var(--color-fill-3)'
      />
    );
    const droplist = (
      <Menu>
        <Menu.Item key='delete' onClick={() => void handleDeleteRemote(agent.id, agent.name)}>
          <span className='text-[rgb(var(--warning-6))]'>{t('common.delete', { defaultValue: 'Delete' })}</span>
        </Menu.Item>
      </Menu>
    );

    if (collapsed) {
      return (
        <Tooltip key={agent.id} content={agent.name} position='right' disabled={!tooltipEnabled}>
          <SiderRow
            level={2}
            collapsed
            icon={icon}
            isActive={isActive}
            onClick={() => navigate_(`/agents/remote/${agent.id}`)}
          />
        </Tooltip>
      );
    }

    return (
      <SiderRow
        key={agent.id}
        level={2}
        icon={icon}
        label={agent.name}
        isActive={isActive}
        onClick={() => navigate_(`/agents/remote/${agent.id}`)}
      >
        <RowMenu isActive={isActive} droplist={droplist} />
      </SiderRow>
    );
  };

  const renderAssistantRow = (agent: {
    key: string;
    displayName: string;
    avatarSrc: string | null;
    avatarEmoji?: string;
    avatarBgColor?: string;
  }) => {
    const isActive = isAssistantActive(agent.key);
    const icon = (
      <AgentAvatar
        size={20}
        avatarSrc={agent.avatarSrc}
        avatarEmoji={agent.avatarEmoji}
        avatarBgColor={agent.avatarBgColor}
      />
    );

    // Find the full assistant record to check isBuiltin
    const fullAssistant = assistants.find((a) => a.id === agent.key);
    const canDelete = fullAssistant && !fullAssistant.isBuiltin && !fullAssistant._source;

    const droplist = (
      <Menu>
        <Menu.Item
          key='duplicate'
          onClick={() => {
            cleanupSiderTooltips();
            onSessionClick?.();
            void navigate(`/agents/assistant/new`, { state: { duplicateFromId: agent.key } });
          }}
        >
          {t('settings.duplicate', { defaultValue: 'Duplicate' })}
        </Menu.Item>
        {canDelete && (
          <Menu.Item key='delete' onClick={() => void handleDeleteAssistant(agent.key)}>
            <span className='text-[rgb(var(--warning-6))]'>{t('common.delete', { defaultValue: 'Delete' })}</span>
          </Menu.Item>
        )}
      </Menu>
    );

    if (collapsed) {
      return (
        <Tooltip key={agent.key} content={agent.displayName} position='right' disabled={!tooltipEnabled}>
          <SiderRow
            level={2}
            collapsed
            icon={icon}
            isActive={isActive}
            onClick={() => navigate_(`/agents/assistant/${agent.key}`)}
          />
        </Tooltip>
      );
    }

    return (
      <SiderRow
        key={agent.key}
        level={2}
        icon={icon}
        label={agent.displayName}
        isActive={isActive}
        onClick={() => navigate_(`/agents/assistant/${agent.key}`)}
      >
        <RowMenu isActive={isActive} droplist={droplist} />
      </SiderRow>
    );
  };

  const userName = userProfile.displayName ?? t('common.agents.user.defaultName');
  const userInitial = userName.charAt(0).toUpperCase();

  const userRow = collapsed ? (
    <Tooltip key='__user' content={userName} position='right' disabled={!tooltipEnabled}>
      <SiderRow
        level={2}
        collapsed
        icon={<AgentAvatar size={20} avatarEmoji={userInitial} avatarBgColor='var(--color-fill-3)' />}
        isActive={isUserActive}
        onClick={() => navigate_('/agents/user')}
      />
    </Tooltip>
  ) : (
    <SiderRow
      key='__user'
      level={2}
      icon={<AgentAvatar size={20} avatarEmoji={userInitial} avatarBgColor='var(--color-fill-3)' />}
      label={userName}
      isActive={isUserActive}
      onClick={() => navigate_('/agents/user')}
    />
  );

  // ── Collapsed: flat list ─────────────────────────────────────
  if (collapsed) {
    return (
      <div className='flex flex-col gap-1px'>
        {localAgents.map(renderLocalRow)}
        {remoteAgents.map(renderRemoteRow)}
        {assistantRows.map(renderAssistantRow)}
        {userRow}
      </div>
    );
  }

  // ── Expanded: sectioned layout ───────────────────────────────
  return (
    <>
      <div className='flex flex-col gap-1px'>
        {/* ── 本地 Agent ── */}
        <SectionHeader
          label={t('common.agents.section.local')}
          collapsed={localCollapsed}
          onToggle={() => setLocalCollapsed((v) => !v)}
          onAdd={() => setAddAgentVisible(true)}
        />
        {!localCollapsed && localAgents.length === 0 && (
          <p className='px-10px py-4px text-13px text-[var(--color-text-3)]'>{t('common.agents.section.localEmpty')}</p>
        )}
        {!localCollapsed && localAgents.length > 0 && (
          <div className={classNames('flex flex-col gap-1px')}>{localAgents.map(renderLocalRow)}</div>
        )}

        {/* ── 远端 Agent ── */}
        <SectionHeader
          label={t('common.agents.section.remote')}
          collapsed={remoteCollapsed}
          onToggle={() => setRemoteCollapsed((v) => !v)}
          onAdd={() => setAddRemoteAgentVisible(true)}
        />
        {!remoteCollapsed && remoteAgents.length === 0 && (
          <p className='px-10px py-4px text-13px text-[var(--color-text-3)]'>
            {t('common.agents.section.remoteEmpty')}
          </p>
        )}
        {!remoteCollapsed && remoteAgents.length > 0 && (
          <div className='flex flex-col gap-1px'>{remoteAgents.map(renderRemoteRow)}</div>
        )}

        {/* ── 助手 ── */}
        <SectionHeader
          label={t('common.agents.section.assistants')}
          collapsed={assistantsCollapsed}
          onToggle={() => setAssistantsCollapsed((v) => !v)}
          onAdd={() => setAddAssistantVisible(true)}
        />
        {!assistantsCollapsed && assistantRows.length === 0 && (
          <p className='px-10px py-4px text-13px text-[var(--color-text-3)]'>
            {t('common.agents.section.assistantsEmpty')}
          </p>
        )}
        {!assistantsCollapsed && assistantRows.length > 0 && (
          <div className='flex flex-col gap-1px'>{assistantRows.map(renderAssistantRow)}</div>
        )}

        {/* ── 人类 ── */}
        <SectionHeader
          label={t('common.agents.section.people')}
          collapsed={peopleCollapsed}
          onToggle={() => setPeopleCollapsed((v) => !v)}
        />
        {!peopleCollapsed && <div className='flex flex-col gap-1px'>{userRow}</div>}
      </div>

      {/* Add custom local agent modal */}
      <AionModal
        visible={addAgentVisible}
        onCancel={() => setAddAgentVisible(false)}
        header={{ title: t('settings.agentManagement.detectCustomAgent'), showClose: true }}
        footer={null}
        style={{ maxWidth: '92vw', borderRadius: 16 }}
        contentStyle={{
          background: 'var(--dialog-fill-0)',
          borderRadius: 16,
          padding: '20px 24px 16px',
          overflow: 'auto',
        }}
      >
        <InlineAgentEditor onSave={(agent) => void handleSaveAgent(agent)} onCancel={() => setAddAgentVisible(false)} />
      </AionModal>

      {/* Add remote agent modal */}
      <RemoteAgentFormModal
        visible={addRemoteAgentVisible}
        onClose={() => setAddRemoteAgentVisible(false)}
        onSaved={() => void mutateRemote()}
      />

      {/* Add assistant modal */}
      <AddAssistantModal
        visible={addAssistantVisible}
        onClose={() => setAddAssistantVisible(false)}
        onCreated={() => void loadAssistants()}
      />
    </>
  );
};

export default SiderAgentsTab;
