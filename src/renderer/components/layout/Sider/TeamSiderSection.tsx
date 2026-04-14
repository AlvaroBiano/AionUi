/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DeleteOne, Down, EditOne, Plus, Pushpin, Right } from '@icon-park/react';
import { Dropdown, Input, Menu, Message, Modal, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import type { TeamAgent } from '@/common/types/teamTypes';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { resolveAgentLogo } from '@renderer/utils/model/agentLogo';
import { iconColors } from '@renderer/styles/colors';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';
import { useSiderTeamBadges } from '@renderer/pages/team/hooks/useSiderTeamBadges';
import TeamCreateModal from '@renderer/pages/team/components/TeamCreateModal';
import AgentAvatar from '@renderer/components/AgentAvatar';
import { ipcBridge } from '@/common';

const DASHED = 'w-14px h-14px rounded-full border border-dashed border-current opacity-20 shrink-0';

/** Stacked avatar: up to 2 agent logos overlapping, Accio-style.
 *  If only 1 agent, shows a dashed placeholder next to it. */
const TeamStackedAvatar: React.FC<{ agents: TeamAgent[] }> = ({ agents }) => {
  const logos = agents
    .slice(0, 2)
    .map((a) => resolveAgentLogo({ backend: a.agentType }))
    .filter((l): l is string => Boolean(l));

  if (logos.length === 0) {
    // No resolvable logos — show placeholder + dashed slot
    return (
      <div className='flex items-center shrink-0'>
        <AgentAvatar size={18} avatarSrc={null} avatarEmoji={null} style={{ position: 'relative', zIndex: 1 }} />
        <span className={`${DASHED} -ml-8px`} />
      </div>
    );
  }
  if (logos.length === 1) {
    return (
      <div className='flex items-center shrink-0'>
        <AgentAvatar size={18} avatarSrc={logos[0]} style={{ position: 'relative', zIndex: 1 }} />
        <span className={`${DASHED} -ml-8px`} />
      </div>
    );
  }
  return (
    <div className='flex items-center shrink-0'>
      <AgentAvatar size={18} avatarSrc={logos[0]} style={{ position: 'relative', zIndex: 1 }} />
      <AgentAvatar size={18} avatarSrc={logos[1]} style={{ marginLeft: '-8px' }} />
    </div>
  );
};

const TEAM_PINNED_KEY = 'team-pinned-ids';

type SiderTooltipProps = React.ComponentProps<typeof Tooltip>;

interface TeamSiderSectionProps {
  collapsed: boolean;
  pathname: string;
  siderTooltipProps: Partial<SiderTooltipProps>;
  onSessionClick?: () => void;
}

const TeamSiderSection: React.FC<TeamSiderSectionProps> = ({
  collapsed,
  pathname,
  siderTooltipProps,
  onSessionClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams, mutate: refreshTeams, removeTeam } = useTeamList();
  const teamBadgeCounts = useSiderTeamBadges(teams);
  const { mutate: globalMutate } = useSWRConfig();

  const [createTeamVisible, setCreateTeamVisible] = useState(false);

  const [teamsCollapsed, setTeamsCollapsed] = useState(false);

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(TEAM_PINNED_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(TEAM_PINNED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameId || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      await ipcBridge.team.renameTeam.invoke({ id: renameId, name: renameName.trim() });
      await refreshTeams();
      await globalMutate(`team/${renameId}`);
      Message.success(t('team.sider.renameSuccess'));
      setRenameVisible(false);
      setRenameId(null);
      setRenameName('');
    } catch (err) {
      console.error('Failed to rename team:', err);
      Message.error(t('team.sider.rename'));
    } finally {
      setRenameLoading(false);
    }
  }, [globalMutate, refreshTeams, renameId, renameName, t]);

  const sortedTeams = useMemo(() => {
    const pinned = teams.filter((team) => pinnedIds.includes(team.id));
    const unpinned = teams.filter((team) => !pinnedIds.includes(team.id));
    return [...pinned, ...unpinned];
  }, [teams, pinnedIds]);

  const handleTeamClick = useCallback(
    (teamId: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      Promise.resolve(navigate(`/team/${teamId}`)).catch(console.error);
      // Refresh team list to sync member avatars
      void refreshTeams();
      if (onSessionClick) onSessionClick();
    },
    [navigate, onSessionClick, refreshTeams]
  );

  return (
    <>
      {collapsed ? (
        sortedTeams.length > 0 && (
          <div className='shrink-0 flex flex-col gap-1px'>
            {sortedTeams.map((team) => {
              const isActive = pathname.startsWith(`/team/${team.id}`);
              return (
                <Tooltip key={team.id} {...siderTooltipProps} content={team.name} position='right'>
                  <div
                    data-testid={`collapsed-team-item-${team.id}`}
                    className={classNames(
                      'relative w-full h-30px flex items-center justify-center cursor-pointer transition-colors rd-8px',
                      isActive ? '!bg-active' : 'hover:bg-fill-3 active:bg-fill-4'
                    )}
                    onClick={() => handleTeamClick(team.id)}
                  >
                    <span data-testid={`collapsed-team-icon-${team.id}`} data-icon-fill={iconColors.primary}>
                      <TeamStackedAvatar agents={team.agents} />
                    </span>
                    {(teamBadgeCounts.get(team.id) ?? 0) > 0 && (
                      <span
                        className='absolute top-4px right-4px w-18px h-18px rounded-full text-10px font-bold flex items-center justify-center leading-none'
                        style={{ backgroundColor: '#F53F3F', color: '#fff', lineHeight: 1 }}
                      >
                        {(teamBadgeCounts.get(team.id) ?? 0) > 99 ? '99+' : teamBadgeCounts.get(team.id)}
                      </span>
                    )}
                  </div>
                </Tooltip>
              );
            })}
          </div>
        )
      ) : (
        <div className='shrink-0 flex flex-col gap-1px'>
          <div
            className='group h-30px flex items-center gap-4px px-10px mt-4px cursor-pointer select-none sticky top-0 z-20 bg-fill-2'
            onClick={() => setTeamsCollapsed((v) => !v)}
          >
            <span className='text-t-tertiary flex items-center mr-2px'>
              {teamsCollapsed ? (
                <Right theme='outline' size={14} style={{ lineHeight: 0 }} />
              ) : (
                <Down theme='outline' size={14} style={{ lineHeight: 0 }} />
              )}
            </span>
            <span className='text-12px text-t-tertiary font-medium flex-1 min-w-0'>{t('team.sider.title')}</span>
            <div
              className='opacity-0 group-hover:opacity-100 transition-opacity h-18px w-18px rd-4px flex items-center justify-center cursor-pointer hover:bg-fill-3 shrink-0'
              onClick={(e) => {
                e.stopPropagation();
                setCreateTeamVisible(true);
              }}
            >
              <Plus theme='outline' size='14' fill='var(--color-text-3)' style={{ lineHeight: 0 }} />
            </div>
          </div>
          {!teamsCollapsed &&
            sortedTeams.length > 0 &&
            sortedTeams.map((team) => {
              const isPinned = pinnedIds.includes(team.id);
              const isActive = pathname.startsWith(`/team/${team.id}`);
              const teamBadge = teamBadgeCounts.get(team.id) ?? 0;
              return (
                <div
                  key={team.id}
                  className={classNames(
                    'group h-30px flex items-center gap-8px px-10px cursor-pointer rd-8px transition-colors min-w-0 relative',
                    isActive ? '!bg-active' : 'hover:bg-fill-3'
                  )}
                  onClick={() => handleTeamClick(team.id)}
                >
                  {/* Stacked agent avatar */}
                  <span className='shrink-0 flex items-center justify-center'>
                    <TeamStackedAvatar agents={team.agents} />
                  </span>
                  {/* Team name */}
                  <span className='text-13px text-t-primary font-medium truncate flex-1 min-w-0'>{team.name}</span>
                  {/* Unread badge (hidden on hover, replaced by three-dot) */}
                  {teamBadge > 0 && (
                    <span
                      className='w-18px h-18px rounded-full text-10px font-bold flex items-center justify-center shrink-0 group-hover:hidden'
                      style={{ backgroundColor: '#F53F3F', color: '#fff', lineHeight: 1 }}
                    >
                      {teamBadge > 99 ? '99+' : teamBadge}
                    </span>
                  )}
                  {/* Pin indicator */}
                  {isPinned && (
                    <span className='absolute right-8px top-1/2 -translate-y-1/2 text-t-secondary pointer-events-none group-hover:hidden'>
                      <Pushpin theme='outline' size='14' />
                    </span>
                  )}
                  {/* Three-dot menu */}
                  <div
                    className={classNames(
                      'absolute right-0 top-0 h-full items-center justify-end pr-8px hidden group-hover:flex',
                      { flex: false }
                    )}
                    style={{
                      backgroundImage: isActive
                        ? 'linear-gradient(to right, transparent, var(--aou-2) 20%)'
                        : 'linear-gradient(to right, transparent, var(--aou-1) 20%)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Dropdown
                      droplist={
                        <Menu
                          onClickMenuItem={(key) => {
                            if (key === 'pin') {
                              togglePin(team.id);
                            } else if (key === 'rename') {
                              setRenameId(team.id);
                              setRenameName(team.name);
                              setRenameVisible(true);
                            } else if (key === 'delete') {
                              Modal.confirm({
                                title: t('team.sider.deleteConfirm'),
                                content: t('team.sider.deleteConfirmContent'),
                                okText: t('team.sider.deleteOk'),
                                cancelText: t('team.sider.deleteCancel'),
                                okButtonProps: { status: 'warning' },
                                onOk: async () => {
                                  await removeTeam(team.id);
                                  Message.success(t('team.sider.deleteSuccess'));
                                  if (pathname.startsWith(`/team/${team.id}`)) {
                                    Promise.resolve(navigate('/')).catch(() => {});
                                  }
                                },
                                style: { borderRadius: '12px' },
                                alignCenter: true,
                                getPopupContainer: () => document.body,
                              });
                            }
                          }}
                        >
                          <Menu.Item key='pin'>
                            <div className='flex items-center gap-8px'>
                              <Pushpin theme='outline' size='14' />
                              <span>{isPinned ? t('team.sider.unpin') : t('team.sider.pin')}</span>
                            </div>
                          </Menu.Item>
                          <Menu.Item key='rename'>
                            <div className='flex items-center gap-8px'>
                              <EditOne theme='outline' size='14' />
                              <span>{t('team.sider.rename')}</span>
                            </div>
                          </Menu.Item>
                          <Menu.Item key='delete'>
                            <div className='flex items-center gap-8px text-[rgb(var(--warning-6))]'>
                              <DeleteOne theme='outline' size='14' />
                              <span>{t('team.sider.delete')}</span>
                            </div>
                          </Menu.Item>
                        </Menu>
                      }
                      trigger='click'
                      position='br'
                      getPopupContainer={() => document.body}
                      unmountOnExit={false}
                    >
                      <span
                        className='flex-center cursor-pointer hover:bg-fill-2 rd-4px p-4px transition-colors text-t-primary'
                        onClick={(e) => e.stopPropagation()}
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
            })}
        </div>
      )}
      <TeamCreateModal
        visible={createTeamVisible}
        onClose={() => setCreateTeamVisible(false)}
        onCreated={(team) => {
          void refreshTeams();
          Promise.resolve(navigate(`/team/${team.id}`)).catch(console.error);
        }}
      />
      <Modal
        title={t('team.sider.renameTitle')}
        visible={renameVisible}
        onOk={() => void handleRenameConfirm()}
        onCancel={() => {
          setRenameVisible(false);
          setRenameId(null);
          setRenameName('');
        }}
        okText={t('team.sider.renameOk')}
        cancelText={t('team.sider.renameCancel')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameName}
          onChange={setRenameName}
          onPressEnter={() => void handleRenameConfirm()}
          placeholder={t('team.sider.renamePlaceholder')}
          allowClear
        />
      </Modal>
    </>
  );
};

export default TeamSiderSection;
