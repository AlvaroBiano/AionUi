/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AgentAvatar from '@/renderer/components/AgentAvatar';
import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import { ASSISTANT_PRESETS, getPresetAvatarBgColor } from '@/common/config/presets/assistantPresets';
import { ConfigStorage } from '@/common/config/storage';
import { getPresetProfile } from '@/renderer/assets/profiles';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { resolveAgentKey } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import { cleanupSiderTooltips } from '@/renderer/utils/ui/siderTooltip';
import type { TTeam } from '@/common/types/teamTypes';
import type { AcpBackendConfig } from '@/common/types/acpTypes';
import { Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Down, Pushpin, Right } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import SiderRow from './SiderRow';

/** Slack-style # icon for team channels */
const TeamHashIcon: React.FC = () => (
  <span
    className='shrink-0 flex items-center justify-center text-t-primary select-none'
    style={{ width: 20, height: 20, fontSize: 14, fontWeight: 500, lineHeight: 1 }}
  >
    #
  </span>
);

/** Three-dot button shared across pinned rows */
const ThreeDots: React.FC = () => (
  <div className='flex flex-col gap-2px items-center justify-center' style={{ width: '16px', height: '16px' }}>
    <div className='w-2px h-2px rounded-full bg-current' />
    <div className='w-2px h-2px rounded-full bg-current' />
    <div className='w-2px h-2px rounded-full bg-current' />
  </div>
);

interface PinnedRowMenuProps {
  isActive: boolean;
  droplist: React.ReactElement;
}

const PinnedRowMenu: React.FC<PinnedRowMenuProps> = ({ isActive, droplist }) => (
  <div
    className='absolute right-0px top-0px h-full items-center justify-end pr-8px hidden group-hover:flex'
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
        <ThreeDots />
      </span>
    </Dropdown>
  </div>
);

interface PinnedSiderSectionProps {
  pinnedAgentKeys: string[];
  pinnedTeamIds: string[];
  teams: TTeam[];
  collapsed: boolean;
  tooltipEnabled: boolean;
  onUnpinAgent: (agentKey: string) => void;
  onUnpinTeam: (teamId: string) => void;
  onSessionClick?: () => void;
}

const PinnedSiderSection: React.FC<PinnedSiderSectionProps> = ({
  pinnedAgentKeys,
  pinnedTeamIds,
  teams,
  collapsed,
  tooltipEnabled,
  onUnpinAgent,
  onUnpinTeam,
  onSessionClick,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { conversations } = useConversationHistoryContext();
  const [sectionCollapsed, setSectionCollapsed] = useState(false);

  const { data: customAgents } = useSWR('acp.customAgents', () => ConfigStorage.get('acp.customAgents'));

  const locale = i18n.language || 'en-US';

  // Build display info for pinned agent keys
  const pinnedAgentInfos = useMemo(() => {
    return pinnedAgentKeys.map((agentKey) => {
      // Check custom agents first
      if (agentKey.startsWith('custom:')) {
        const customId = agentKey.slice(7);
        const customList = (customAgents as AcpBackendConfig[] | null | undefined) ?? [];
        const custom = customList.find((a) => a.id === customId);
        if (custom) {
          return {
            agentKey,
            displayName: custom.name,
            avatarSrc: null as string | null,
            avatarEmoji: custom.name.charAt(0).toUpperCase() as string | undefined,
            avatarBgColor: getPresetAvatarBgColor(customId) as string | undefined,
          };
        }
      }

      // Check preset assistants
      const preset = ASSISTANT_PRESETS.find((p) => p.id === agentKey);
      if (preset) {
        const displayName = preset.nameI18n?.[locale] ?? preset.nameI18n?.['en-US'] ?? preset.id;
        const profileImage = getPresetProfile(preset.id);
        const rawAvatar = preset.avatar ?? '';
        const avatarSrc = profileImage ?? null;
        const avatarEmoji = profileImage ? undefined : rawAvatar || undefined;
        return {
          agentKey,
          displayName,
          avatarSrc,
          avatarEmoji,
          avatarBgColor: preset.avatarBgColor as string | undefined,
        };
      }

      // Check ACP backends
      const acpConfig = ACP_BACKENDS_ALL[agentKey as keyof typeof ACP_BACKENDS_ALL];
      if (acpConfig) {
        const logo = resolveAgentLogo({ backend: agentKey }) ?? null;
        return {
          agentKey,
          displayName: acpConfig.name,
          avatarSrc: logo as string | null,
          avatarEmoji: undefined as string | undefined,
          avatarBgColor: (acpConfig as { avatarBgColor?: string }).avatarBgColor,
        };
      }

      // Fallback
      return {
        agentKey,
        displayName: agentKey,
        avatarSrc: null as string | null,
        avatarEmoji: agentKey.charAt(0).toUpperCase() as string | undefined,
        avatarBgColor: undefined as string | undefined,
      };
    });
  }, [pinnedAgentKeys, customAgents, locale]);

  // Map agentKey → last conversation id for navigation
  const agentLastConvMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const conv of conversations) {
      const key = resolveAgentKey(conv);
      if (!map.has(key)) {
        map.set(key, conv.id);
      }
    }
    return map;
  }, [conversations]);

  // Pinned teams
  const pinnedTeams = useMemo(
    () => pinnedTeamIds.map((id) => teams.find((team) => team.id === id)).filter(Boolean) as TTeam[],
    [pinnedTeamIds, teams]
  );

  const hasPinned = pinnedAgentKeys.length > 0 || pinnedTeamIds.length > 0;
  if (!hasPinned) return null;

  const handleAgentClick = (agentKey: string) => {
    cleanupSiderTooltips();
    const lastConvId = agentLastConvMap.get(agentKey);
    if (lastConvId) {
      void navigate(`/conversation/${lastConvId}`);
    } else {
      void navigate(`/guid?agent=${encodeURIComponent(agentKey)}`);
    }
    onSessionClick?.();
  };

  const handleTeamClick = (teamId: string) => {
    cleanupSiderTooltips();
    void navigate(`/team/${teamId}`);
    onSessionClick?.();
  };

  if (collapsed) {
    return (
      <div className='shrink-0 flex flex-col gap-1px'>
        {pinnedAgentInfos.map((info) => (
          <Tooltip key={info.agentKey} content={info.displayName} position='right' disabled={!tooltipEnabled}>
            <SiderRow
              level={2}
              collapsed
              icon={
                <AgentAvatar
                  size={20}
                  avatarSrc={info.avatarSrc}
                  avatarEmoji={info.avatarEmoji}
                  avatarBgColor={info.avatarBgColor}
                />
              }
              isActive={false}
              onClick={() => handleAgentClick(info.agentKey)}
            />
          </Tooltip>
        ))}
        {pinnedTeams.map((team) => (
          <Tooltip key={team.id} content={team.name} position='right' disabled={!tooltipEnabled}>
            <SiderRow
              level={2}
              collapsed
              icon={<TeamHashIcon />}
              isActive={false}
              onClick={() => handleTeamClick(team.id)}
            />
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className='shrink-0 flex flex-col gap-1px'>
      {/* Section header */}
      <div
        className='group h-30px flex items-center gap-8px px-10px mt-4px cursor-pointer select-none sticky top-0 z-20 bg-fill-2'
        onClick={() => setSectionCollapsed((v) => !v)}
      >
        <span className='w-18px h-18px flex items-center justify-center shrink-0 text-t-primary'>
          {sectionCollapsed ? (
            <Right theme='outline' size={18} fill='currentColor' style={{ lineHeight: 0 }} />
          ) : (
            <Down theme='outline' size={18} fill='currentColor' style={{ lineHeight: 0 }} />
          )}
        </span>
        <span className='text-14px font-medium text-t-primary flex-1 min-w-0'>
          {t('conversation.history.pinnedSection')}
        </span>
      </div>

      {/* Pinned items */}
      {!sectionCollapsed && (
        <>
          {pinnedAgentInfos.map((info) => {
            const droplist = (
              <Menu onClickMenuItem={(key) => key === 'unpin' && onUnpinAgent(info.agentKey)}>
                <Menu.Item key='unpin'>
                  <div className='flex items-center gap-8px'>
                    <Pushpin theme='outline' size='14' />
                    <span>{t('conversation.history.unpin')}</span>
                  </div>
                </Menu.Item>
              </Menu>
            );

            return (
              <SiderRow
                key={info.agentKey}
                level={2}
                icon={
                  <AgentAvatar
                    size={20}
                    avatarSrc={info.avatarSrc}
                    avatarEmoji={info.avatarEmoji}
                    avatarBgColor={info.avatarBgColor}
                  />
                }
                label={info.displayName}
                isActive={false}
                onClick={() => handleAgentClick(info.agentKey)}
              >
                <PinnedRowMenu isActive={false} droplist={droplist} />
              </SiderRow>
            );
          })}

          {pinnedTeams.map((team) => {
            const droplist = (
              <Menu onClickMenuItem={(key) => key === 'unpin' && onUnpinTeam(team.id)}>
                <Menu.Item key='unpin'>
                  <div className='flex items-center gap-8px'>
                    <Pushpin theme='outline' size='14' />
                    <span>{t('team.sider.unpin')}</span>
                  </div>
                </Menu.Item>
              </Menu>
            );

            return (
              <SiderRow
                key={team.id}
                level={2}
                icon={<TeamHashIcon />}
                label={team.name}
                isActive={false}
                onClick={() => handleTeamClick(team.id)}
              >
                <PinnedRowMenu isActive={false} droplist={droplist} />
              </SiderRow>
            );
          })}
        </>
      )}
    </div>
  );
};

export default PinnedSiderSection;
