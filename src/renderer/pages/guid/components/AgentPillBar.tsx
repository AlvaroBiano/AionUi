/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AgentAvatar from '@/renderer/components/AgentAvatar';
import { Down } from '@icon-park/react';
import { Dropdown, Input } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAcpBackendConfig, type AcpBackend, type AcpBackendConfig } from '@/common/types/acpTypes';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { getPresetAvatarBgColor } from '@/common/config/presets/assistantPresets';
import { getPresetProfile } from '@/renderer/assets/profiles';
import { CUSTOM_AVATAR_IMAGE_MAP } from '../constants';
import type { AvailableAgent } from '../types';
import styles from '../index.module.css';

type AgentSelectorPopoverProps = {
  displayAgentName: string;
  regularAgents: AvailableAgent[];
  presetAssistants: AcpBackendConfig[];
  selectedAgentKey: string | undefined;
  isPresetAgent: boolean;
  localeKey: string;
  selectedCustomAgentId: string | undefined;
  getAgentKey: (agent: AvailableAgent) => string;
  onSelect: (key: string) => void;
  /** Custom trigger element. When provided, replaces the default name+arrow row. */
  triggerNode?: React.ReactNode;
};

const AgentSelectorPopover: React.FC<AgentSelectorPopoverProps> = ({
  displayAgentName,
  triggerNode,
  regularAgents,
  presetAssistants,
  selectedAgentKey,
  isPresetAgent,
  localeKey,
  selectedCustomAgentId,
  getAgentKey,
  onSelect,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const handleSelect = useCallback(
    (key: string) => {
      onSelect(key);
      setOpen(false);
      setQuery('');
    },
    [onSelect]
  );

  const enabledPresets = useMemo(
    () => presetAssistants.filter((a) => a.isPreset && a.enabled !== false),
    [presetAssistants]
  );

  const filteredRegularAgents = useMemo(() => {
    if (!query.trim()) return regularAgents;
    const q = query.toLowerCase();
    return regularAgents.filter((a) => a.name.toLowerCase().includes(q));
  }, [regularAgents, query]);

  const filteredPresetAssistants = useMemo(() => {
    if (!query.trim()) return enabledPresets;
    const q = query.toLowerCase();
    return enabledPresets.filter(
      (a) =>
        (a.nameI18n?.[localeKey] || a.name || '').toLowerCase().includes(q) ||
        (a.descriptionI18n?.[localeKey] || a.description || '').toLowerCase().includes(q)
    );
  }, [enabledPresets, query, localeKey]);

  const getAgentDescription = useCallback(
    (agent: AvailableAgent): string => {
      try {
        const config = getAcpBackendConfig(agent.backend as AcpBackend);
        return config.descriptionI18n?.[localeKey] || config.description || '';
      } catch {
        return '';
      }
    },
    [localeKey]
  );

  const panel = (
    <div
      className={styles.agentSelectorPanel}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {/* Search */}
      <div className={styles.agentSelectorSearch}>
        <Input
          allowClear
          placeholder={t('guid.searchAgent', { defaultValue: '搜索 Agent...' })}
          value={query}
          onChange={setQuery}
          className={styles.agentSelectorSearchInput}
        />
      </div>

      <div className={styles.agentSelectorList}>
        {/* AI AGENT section */}
        {filteredRegularAgents.length > 0 && (
          <>
            <div className={styles.agentSelectorSectionLabel}>AI Agent</div>
            {filteredRegularAgents.map((agent) => {
              const key = getAgentKey(agent);
              const isActive = key === selectedAgentKey && !isPresetAgent;
              const extensionAvatar = resolveExtensionAssetUrl(agent.isExtension ? agent.avatar : undefined);
              const emojiAvatar = agent.backend === 'remote' && agent.avatar ? agent.avatar : undefined;
              const logoSrc =
                extensionAvatar ||
                (!emojiAvatar
                  ? resolveAgentLogo({
                      backend: agent.backend,
                      customAgentId: agent.customAgentId,
                      isExtension: agent.isExtension,
                    })
                  : undefined);
              const description = getAgentDescription(agent);
              let agentBgColor: string | undefined;
              try {
                agentBgColor = getAcpBackendConfig(agent.backend as AcpBackend).avatarBgColor;
              } catch {
                /* extension */
              }
              return (
                <div
                  key={key}
                  className={classNames(styles.agentSelectorItem, isActive && styles.agentSelectorItemActive)}
                  onClick={() => handleSelect(key)}
                >
                  <AgentAvatar
                    size={32}
                    avatarSrc={logoSrc ?? null}
                    avatarEmoji={emojiAvatar ?? null}
                    avatarBgColor={agentBgColor}
                    style={{ marginTop: 1 }}
                  />
                  <div className={styles.agentSelectorItemInfo}>
                    <div className={styles.agentSelectorItemName}>{agent.name}</div>
                    {description && <div className={styles.agentSelectorItemDesc}>{description}</div>}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Preset assistants section */}
        {filteredPresetAssistants.length > 0 && (
          <>
            {filteredRegularAgents.length > 0 && <div className={styles.agentSelectorDivider} />}
            <div className={styles.agentSelectorSectionLabel}>{t('conversation.dropdown.presetAssistants')}</div>
            {filteredPresetAssistants.map((assistant) => {
              const key = `custom:${assistant.id}`;
              const profileImage = getPresetProfile(assistant.id);
              const avatarValue = assistant.avatar?.trim();
              const mappedAvatar = avatarValue ? CUSTOM_AVATAR_IMAGE_MAP[avatarValue] : undefined;
              const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
              const avatarImage = profileImage ?? mappedAvatar ?? resolvedAvatar;
              const isImageAvatar = Boolean(
                avatarImage &&
                (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) ||
                  /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage))
              );
              const name = assistant.nameI18n?.[localeKey] || assistant.name || '';
              const description = assistant.descriptionI18n?.[localeKey] || assistant.description || '';
              const isActive = isPresetAgent && (selectedAgentKey === key || selectedCustomAgentId === assistant.id);
              const presetBgColor = getPresetAvatarBgColor(assistant.id) ?? assistant.avatarBgColor;
              return (
                <div
                  key={assistant.id}
                  className={classNames(styles.agentSelectorItem, isActive && styles.agentSelectorItemActive)}
                  onClick={() => handleSelect(key)}
                >
                  <AgentAvatar
                    size={32}
                    avatarSrc={isImageAvatar ? avatarImage : null}
                    avatarEmoji={!isImageAvatar && avatarValue ? avatarValue : null}
                    avatarBgColor={presetBgColor}
                    style={{ marginTop: 1 }}
                  />
                  <div className={styles.agentSelectorItemInfo}>
                    <div className={styles.agentSelectorItemName}>{name}</div>
                    {description && <div className={styles.agentSelectorItemDesc}>{description}</div>}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {filteredRegularAgents.length === 0 && filteredPresetAssistants.length === 0 && (
          <div className='py-16px text-center text-13px text-t-tertiary'>
            {t('common.noResult', { defaultValue: '无结果' })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={styles.agentSelectorFooter}
        onClick={() => {
          setOpen(false);
          void navigate('/assistants');
        }}
      >
        {t('guid.addMoreAssistants')}
      </div>
    </div>
  );

  return (
    <Dropdown
      trigger='hover'
      position='bottom'
      popupVisible={open}
      onVisibleChange={setOpen}
      droplist={panel}
      unmountOnExit={false}
    >
      {triggerNode ?? (
        <div className={styles.heroAgentNameRow} data-testid='guid-agent-selector'>
          <span className={styles.heroAgentName}>{displayAgentName}</span>
          <Down theme='outline' size={14} fill='currentColor' style={{ lineHeight: 0, flexShrink: 0 }} />
        </div>
      )}
    </Dropdown>
  );
};

export default AgentSelectorPopover;
