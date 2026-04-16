import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAddEventListener } from '@renderer/utils/emitter';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useThemeContext } from '@renderer/hooks/context/ThemeContext';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';
import { SiderToolbar, SiderScheduledEntry, SiderSearchEntry } from './SiderNav';
import SiderFooter from './SiderFooter';
import SiderAgentsTab from './SiderAgentsTab';
import SiderRow from './SiderRow';
import TeamSiderSection from './TeamSiderSection';
import PinnedSiderSection from './PinnedSiderSection';
import siderStyles from './Sider.module.css';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { Comments, MessageOne, Peoples } from '@icon-park/react';

const DM_PINNED_KEY = 'dm-pinned-agent-keys';
const TEAM_PINNED_KEY = 'team-pinned-ids';

const readPinnedFromStorage = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const WorkspaceGroupedHistory = React.lazy(() => import('@renderer/pages/conversation/GroupedHistory'));
const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

type SiderTab = 'messages' | 'agents';

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname, search, hash } = location;
  const { t } = useTranslation();

  const navigate = useNavigate();
  const { closePreview } = usePreviewContext();
  const { theme, setTheme } = useThemeContext();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [siderTab, setSiderTab] = useState<SiderTab>('messages');

  useAddEventListener('sider.tab.switch', (tab) => setSiderTab(tab), []);

  const { teams } = useTeamList();

  const [pinnedAgentKeys, setPinnedAgentKeys] = useState<string[]>(() => readPinnedFromStorage(DM_PINNED_KEY));
  const [pinnedTeamIds, setPinnedTeamIds] = useState<string[]>(() => readPinnedFromStorage(TEAM_PINNED_KEY));

  const handleToggleAgentPin = useCallback((agentKey: string) => {
    setPinnedAgentKeys((prev) => {
      const next = prev.includes(agentKey) ? prev.filter((k) => k !== agentKey) : [...prev, agentKey];
      try {
        localStorage.setItem(DM_PINNED_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleToggleTeamPin = useCallback((teamId: string) => {
    setPinnedTeamIds((prev) => {
      const next = prev.includes(teamId) ? prev.filter((k) => k !== teamId) : [...prev, teamId];
      try {
        localStorage.setItem(TEAM_PINNED_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const handleNewChat = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/guid', { state: { resetAssistant: true } })).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
    } else {
      Promise.resolve(navigate('/settings/gemini')).catch((error) => {
        console.error('Navigation failed:', error);
      });
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
  };

  const handleScheduledClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/scheduled')).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleMessagesTabClick = () => {
    setSiderTab('messages');
    cleanupSiderTooltips();
    void navigate('/guid');
  };

  const handleQuickThemeToggle = () => {
    void setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
    pinnedAgentKeys,
    onToggleAgentPin: handleToggleAgentPin,
  };

  const renderTabSwitcher = () => {
    if (collapsed) {
      return (
        <div className='shrink-0 flex flex-col gap-1px py-2px'>
          <Tooltip content={t('common.nav.messages')} position='right' disabled={!tooltipEnabled}>
            <div
              className={classNames(
                'h-28px flex items-center justify-center cursor-pointer rd-6px transition-colors',
                siderTab === 'messages' ? 'text-primary' : 'text-t-secondary hover:text-t-primary hover:bg-fill-2'
              )}
              onClick={handleMessagesTabClick}
            >
              <MessageOne theme='outline' size={14} fill='currentColor' style={{ lineHeight: 0 }} />
            </div>
          </Tooltip>
          <Tooltip content={t('common.nav.agents')} position='right' disabled={!tooltipEnabled}>
            <div
              className={classNames(
                'h-28px flex items-center justify-center cursor-pointer rd-6px transition-colors',
                siderTab === 'agents' ? 'text-primary' : 'text-t-secondary hover:text-t-primary hover:bg-fill-2'
              )}
              onClick={() => setSiderTab('agents')}
            >
              <Peoples theme='outline' size={14} fill='currentColor' style={{ lineHeight: 0 }} />
            </div>
          </Tooltip>
        </div>
      );
    }

    return (
      <div className='shrink-0 flex gap-2px mx-4px mt-4px mb-8px bg-fill-3 rd-8px p-2px'>
        <div
          className={classNames(
            'flex-1 h-30px flex items-center justify-center rd-6px cursor-pointer transition-all select-none',
            siderTab === 'messages'
              ? 'bg-[var(--color-bg-1)] text-t-primary shadow-sm'
              : 'text-t-secondary hover:text-t-primary'
          )}
          onClick={handleMessagesTabClick}
        >
          <MessageOne theme='outline' size={18} fill='currentColor' style={{ lineHeight: 0 }} />
        </div>
        <div
          className={classNames(
            'flex-1 h-30px flex items-center justify-center rd-6px cursor-pointer transition-all select-none',
            siderTab === 'agents'
              ? 'bg-[var(--color-bg-1)] text-t-primary shadow-sm'
              : 'text-t-secondary hover:text-t-primary'
          )}
          onClick={() => setSiderTab('agents')}
        >
          <Peoples theme='outline' size={18} fill='currentColor' style={{ lineHeight: 0 }} />
        </div>
      </div>
    );
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled} />
          </Suspense>
        ) : (
          <div className='size-full flex flex-col gap-1px'>
            {/* Tab switcher: Messages / Agents */}
            {renderTabSwitcher()}

            {/* Messages tab */}
            {siderTab === 'messages' && (
              <div className='flex-1 min-h-0 flex flex-col gap-1px'>
                {/* New conversation */}
                <SiderToolbar
                  isMobile={isMobile}
                  collapsed={collapsed}
                  siderTooltipProps={siderTooltipProps}
                  onNewChat={handleNewChat}
                />
                {/* Search */}
                <SiderSearchEntry
                  isMobile={isMobile}
                  collapsed={collapsed}
                  siderTooltipProps={siderTooltipProps}
                  onConversationSelect={handleConversationSelect}
                  onSessionClick={onSessionClick}
                />
                {/* Scheduled tasks */}
                <SiderScheduledEntry
                  isMobile={isMobile}
                  isActive={pathname === '/scheduled'}
                  collapsed={collapsed}
                  siderTooltipProps={siderTooltipProps}
                  onClick={handleScheduledClick}
                />
                {/* Threads placeholder */}
                <Tooltip {...siderTooltipProps} content={t('common.nav.threads')} position='right'>
                  <SiderRow
                    level={1}
                    hoverable
                    icon={
                      <Comments
                        theme='outline'
                        size={18}
                        fill='currentColor'
                        className='block leading-none'
                        style={{ lineHeight: 0 }}
                      />
                    }
                    label={t('common.nav.threads')}
                    collapsed={collapsed}
                  />
                </Tooltip>

                {/* Divider */}
                <div
                  className={classNames(
                    'shrink-0 mt-6px mb-2px h-1px bg-[var(--color-border-2)]',
                    collapsed ? 'mx-6px' : 'mx-10px'
                  )}
                />

                {/* Scrollable: pinned + conversation history + teams */}
                <div className={classNames('flex-1 min-h-0 overflow-y-auto', siderStyles.scrollArea)}>
                  <PinnedSiderSection
                    pinnedAgentKeys={pinnedAgentKeys}
                    pinnedTeamIds={pinnedTeamIds}
                    teams={teams}
                    collapsed={collapsed}
                    tooltipEnabled={tooltipEnabled}
                    onUnpinAgent={handleToggleAgentPin}
                    onUnpinTeam={handleToggleTeamPin}
                    onSessionClick={onSessionClick}
                  />
                  <Suspense fallback={<div className='min-h-200px' />}>
                    <WorkspaceGroupedHistory {...workspaceHistoryProps} />
                  </Suspense>
                  <div className='mt-4px'>
                    <TeamSiderSection
                      collapsed={collapsed}
                      pathname={pathname}
                      siderTooltipProps={siderTooltipProps}
                      onSessionClick={onSessionClick}
                      pinnedTeamIds={pinnedTeamIds}
                      onToggleTeamPin={handleToggleTeamPin}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Agents tab */}
            {siderTab === 'agents' && (
              <div className={classNames('flex-1 min-h-0 overflow-y-auto', siderStyles.scrollArea)}>
                <SiderAgentsTab collapsed={collapsed} tooltipEnabled={tooltipEnabled} onSessionClick={onSessionClick} />
              </div>
            )}
          </div>
        )}
      </div>
      {/* Footer */}
      <SiderFooter
        isMobile={isMobile}
        isSettings={isSettings}
        collapsed={collapsed}
        theme={theme}
        siderTooltipProps={siderTooltipProps}
        onSettingsClick={handleSettingsClick}
        onThemeToggle={handleQuickThemeToggle}
      />
    </div>
  );
};

export default Sider;
