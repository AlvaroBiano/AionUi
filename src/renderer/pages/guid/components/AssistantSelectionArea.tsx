/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import coworkSvg from '@/renderer/assets/icons/cowork.svg';
import {
  useAssistantBackends,
  useAssistantEditor,
  useAssistantList,
  useAssistantSkills,
} from '@/renderer/hooks/assistant';
import AddCustomPathModal from '@/renderer/pages/settings/AgentSettings/AssistantManagement/AddCustomPathModal';
import AddSkillsModal from '@/renderer/pages/settings/AgentSettings/AssistantManagement/AddSkillsModal';
import AssistantEditDrawer from '@/renderer/pages/settings/AgentSettings/AssistantManagement/AssistantEditDrawer';
import DeleteAssistantModal from '@/renderer/pages/settings/AgentSettings/AssistantManagement/DeleteAssistantModal';
import SkillConfirmModals from '@/renderer/pages/settings/AgentSettings/AssistantManagement/SkillConfirmModals';
import { resolveAvatarImageSrc } from '@/renderer/pages/settings/AgentSettings/AssistantManagement/assistantUtils';
import { CUSTOM_AVATAR_IMAGE_MAP } from '../constants';
import styles from '../index.module.css';
import type { AcpBackend, AcpBackendConfig, AvailableAgent } from '../types';
import { getAcpBackendConfig } from '@/common/types/acpTypes';
import { getPresetAvatarBgColor } from '@/common/config/presets/assistantPresets';
import { getPresetProfile } from '@/renderer/assets/profiles';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { Message } from '@arco-design/web-react';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import { Comment } from '@icon-park/react';
import React, { useCallback, useLayoutEffect, useMemo } from 'react';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type AssistantSelectionAreaProps = {
  selectedAgentKey?: string;
  selectedAgentInfo: AvailableAgent | undefined;
  customAgents: AcpBackendConfig[];
  localeKey: string;
  regularAgents: AvailableAgent[];
  getAgentKey: (agent: AvailableAgent) => string;
  onSelectAssistant: (key: string) => void;
  onSetInput: (text: string) => void;
  onFocusInput: () => void;
  onRegisterOpenDetails?: (openDetails: (() => void) | null) => void;
};

const resolveAssistantCandidateIds = (assistantId: string): string[] => {
  const stripped = assistantId.replace(/^builtin-/, '');
  return Array.from(new Set([assistantId, `builtin-${stripped}`, stripped]));
};

const AssistantSelectionArea: React.FC<AssistantSelectionAreaProps> = ({
  selectedAgentKey,
  selectedAgentInfo,
  customAgents,
  localeKey,
  regularAgents,
  getAgentKey,
  onSelectAssistant,
  onSetInput,
  onFocusInput,
  onRegisterOpenDetails,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [agentMessage, agentMessageContext] = Message.useMessage({ maxCount: 10 });

  const avatarImageMap: Record<string, string> = useMemo(
    () => ({
      'cowork.svg': coworkSvg,
      '\u{1F6E0}\u{FE0F}': coworkSvg,
    }),
    []
  );

  const {
    assistants,
    activeAssistantId,
    setActiveAssistantId,
    activeAssistant,
    isReadonlyAssistant,
    isExtensionAssistant,
    loadAssistants,
  } = useAssistantList();
  const { availableBackends, extensionAcpAdapters, refreshAgentDetection } = useAssistantBackends();

  const editor = useAssistantEditor({
    localeKey,
    activeAssistant,
    isReadonlyAssistant,
    isExtensionAssistant,
    setActiveAssistantId,
    loadAssistants,
    refreshAgentDetection,
    message: agentMessage,
  });

  const skills = useAssistantSkills({
    skillsModalVisible: editor.skillsModalVisible,
    customSkills: editor.customSkills,
    selectedSkills: editor.selectedSkills,
    pendingSkills: editor.pendingSkills,
    availableSkills: editor.availableSkills,
    setPendingSkills: editor.setPendingSkills,
    setCustomSkills: editor.setCustomSkills,
    setSelectedSkills: editor.setSelectedSkills,
    message: agentMessage,
  });

  const editAvatarImage = resolveAvatarImageSrc(editor.editAvatar, avatarImageMap);

  const modalTree = (
    <>
      {agentMessageContext}
      <AssistantEditDrawer
        editVisible={editor.editVisible}
        setEditVisible={editor.setEditVisible}
        isCreating={editor.isCreating}
        editName={editor.editName}
        setEditName={editor.setEditName}
        editDescription={editor.editDescription}
        setEditDescription={editor.setEditDescription}
        editAvatar={editor.editAvatar}
        setEditAvatar={editor.setEditAvatar}
        editAvatarImage={editAvatarImage}
        editAgent={editor.editAgent}
        setEditAgent={editor.setEditAgent}
        editContext={editor.editContext}
        setEditContext={editor.setEditContext}
        promptViewMode={editor.promptViewMode}
        setPromptViewMode={editor.setPromptViewMode}
        availableSkills={editor.availableSkills}
        selectedSkills={editor.selectedSkills}
        setSelectedSkills={editor.setSelectedSkills}
        pendingSkills={editor.pendingSkills}
        customSkills={editor.customSkills}
        setDeletePendingSkillName={editor.setDeletePendingSkillName}
        setDeleteCustomSkillName={editor.setDeleteCustomSkillName}
        setSkillsModalVisible={editor.setSkillsModalVisible}
        activeAssistant={activeAssistant}
        activeAssistantId={activeAssistantId}
        isReadonlyAssistant={isReadonlyAssistant}
        isExtensionAssistant={isExtensionAssistant}
        availableBackends={availableBackends}
        extensionAcpAdapters={extensionAcpAdapters}
        handleSave={editor.handleSave}
        handleDeleteClick={editor.handleDeleteClick}
      />
      <DeleteAssistantModal
        visible={editor.deleteConfirmVisible}
        onCancel={() => editor.setDeleteConfirmVisible(false)}
        onConfirm={editor.handleDeleteConfirm}
        activeAssistant={activeAssistant}
        avatarImageMap={avatarImageMap}
      />
      <AddSkillsModal
        visible={editor.skillsModalVisible}
        onCancel={() => {
          editor.setSkillsModalVisible(false);
          skills.setSearchExternalQuery('');
        }}
        externalSources={skills.externalSources}
        activeSourceTab={skills.activeSourceTab}
        setActiveSourceTab={skills.setActiveSourceTab}
        activeSource={skills.activeSource}
        filteredExternalSkills={skills.filteredExternalSkills}
        externalSkillsLoading={skills.externalSkillsLoading}
        searchExternalQuery={skills.searchExternalQuery}
        setSearchExternalQuery={skills.setSearchExternalQuery}
        refreshing={skills.refreshing}
        handleRefreshExternal={skills.handleRefreshExternal}
        setShowAddPathModal={skills.setShowAddPathModal}
        customSkills={editor.customSkills}
        handleAddFoundSkills={skills.handleAddFoundSkills}
      />
      <SkillConfirmModals
        deletePendingSkillName={editor.deletePendingSkillName}
        setDeletePendingSkillName={editor.setDeletePendingSkillName}
        pendingSkills={editor.pendingSkills}
        setPendingSkills={editor.setPendingSkills}
        deleteCustomSkillName={editor.deleteCustomSkillName}
        setDeleteCustomSkillName={editor.setDeleteCustomSkillName}
        customSkills={editor.customSkills}
        setCustomSkills={editor.setCustomSkills}
        selectedSkills={editor.selectedSkills}
        setSelectedSkills={editor.setSelectedSkills}
        message={agentMessage}
      />
      <AddCustomPathModal
        visible={skills.showAddPathModal}
        onCancel={() => {
          skills.setShowAddPathModal(false);
          skills.setCustomPathName('');
          skills.setCustomPathValue('');
        }}
        onOk={() => void skills.handleAddCustomPath()}
        customPathName={skills.customPathName}
        setCustomPathName={skills.setCustomPathName}
        customPathValue={skills.customPathValue}
        setCustomPathValue={skills.setCustomPathValue}
      />
    </>
  );

  const resolveOpenAssistantId = (): string | null => {
    if (selectedAgentInfo?.customAgentId) return selectedAgentInfo.customAgentId;
    if (selectedAgentKey?.startsWith('custom:')) return selectedAgentKey.slice(7);
    return null;
  };

  const openAssistantDetails = useCallback(() => {
    const assistantId = resolveOpenAssistantId();
    if (!assistantId) {
      agentMessage.warning(
        t('common.failed', { defaultValue: 'Failed' }) +
          `: ${t('settings.editAssistant', { defaultValue: 'Assistant Details' })}`
      );
      return;
    }

    const candidates = resolveAssistantCandidateIds(assistantId);
    const targetAssistant = [...assistants, ...customAgents].find((assistant) => candidates.includes(assistant.id));
    if (!targetAssistant) {
      agentMessage.warning(
        t('common.failed', { defaultValue: 'Failed' }) +
          `: ${t('settings.editAssistant', { defaultValue: 'Assistant Details' })}`
      );
      return;
    }

    void editor.handleEdit(targetAssistant);
  }, [agentMessage, assistants, customAgents, editor, selectedAgentInfo?.customAgentId, selectedAgentKey, t]);

  useLayoutEffect(() => {
    if (!onRegisterOpenDetails) return;
    onRegisterOpenDetails(openAssistantDetails);
  }, [onRegisterOpenDetails, openAssistantDetails]);

  // Build recommendation cards: row 1 = preset assistants (up to 3),
  // row 2 = AI agents (up to 3, padded with more assistants if needed)
  const enabledPresets = useMemo(
    () =>
      customAgents
        .filter((a) => a.isPreset && a.enabled !== false)
        .toSorted((a, b) => {
          if (a.id === 'cowork') return -1;
          if (b.id === 'cowork') return 1;
          return 0;
        }),
    [customAgents]
  );

  // displayText: shown in the card body
  // clickPrompt: filled into the input on click — only explicit prompts, never description fallback
  type AgentCard = {
    kind: 'agent';
    agent: AvailableAgent;
    agentKey: string;
    displayText: string;
    clickPrompt: string;
    avatarBgColor: string | undefined;
  };
  type AssistantCard = { kind: 'assistant'; assistant: AcpBackendConfig; displayText: string; clickPrompt: string };
  type RecommendCard = AgentCard | AssistantCard;

  const cards = useMemo((): RecommendCard[] => {
    // Exclude the currently selected item so it doesn't appear in recommendations
    const selectedCustomId = selectedAgentInfo?.customAgentId;
    const isPresetSelected = selectedAgentKey?.startsWith('custom:');
    const selectedPresetId = isPresetSelected ? selectedAgentKey.slice(7) : null;

    const availablePresets = enabledPresets.filter((a) => a.id !== selectedPresetId && a.id !== selectedCustomId);
    const availableAgents = regularAgents.filter((a) => getAgentKey(a) !== selectedAgentKey);

    const row1: AssistantCard[] = availablePresets.slice(0, 3).map((a) => {
      const prompts = a.promptsI18n?.[localeKey] || a.promptsI18n?.['en-US'] || a.prompts;
      const clickPrompt = prompts?.[0] || '';
      const displayText = clickPrompt || a.descriptionI18n?.[localeKey] || a.description || '';
      return { kind: 'assistant', assistant: a, displayText, clickPrompt };
    });

    const agentSlots: AgentCard[] = availableAgents.slice(0, 3).map((agent) => {
      let displayText = '';
      let clickPrompt = '';
      let avatarBgColor: string | undefined;
      try {
        const config = getAcpBackendConfig(agent.backend as AcpBackend);
        const prompts = config.promptsI18n?.[localeKey] || config.prompts;
        clickPrompt = prompts?.[0] || '';
        // Show description in the card but never inject it into the input box
        displayText = clickPrompt || config.descriptionI18n?.[localeKey] || config.description || '';
        avatarBgColor = config.avatarBgColor;
      } catch {
        // extension agent without config
      }
      return { kind: 'agent', agent, agentKey: getAgentKey(agent), displayText, clickPrompt, avatarBgColor };
    });

    const fillCount = Math.max(0, 3 - agentSlots.length);
    const row2Fill: AssistantCard[] = availablePresets.slice(3, 3 + fillCount).map((a) => {
      const prompts = a.promptsI18n?.[localeKey] || a.promptsI18n?.['en-US'] || a.prompts;
      const clickPrompt = prompts?.[0] || '';
      const displayText = clickPrompt || a.descriptionI18n?.[localeKey] || a.description || '';
      return { kind: 'assistant', assistant: a, displayText, clickPrompt };
    });

    return [...row1, ...agentSlots, ...row2Fill];
  }, [enabledPresets, regularAgents, localeKey, getAgentKey, selectedAgentKey, selectedAgentInfo?.customAgentId]);

  if (cards.length === 0) return null;

  return (
    <div data-testid='guid-quick-start' className={`${styles.assistantGrid} mt-12px w-full`}>
      <p className={styles.assistantGridLabel}>{t('guid.selectAssistant')}</p>
      <div className={styles.assistantGridCards}>
        {cards.map((card, idx) => {
          if (card.kind === 'assistant') {
            const { assistant, displayText, clickPrompt } = card;
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
            const presetBgColor = getPresetAvatarBgColor(assistant.id) ?? assistant.avatarBgColor;
            return (
              <div
                key={`a-${assistant.id}`}
                data-testid='guid-quick-start-card'
                className={styles.assistantCard}
                onClick={() => {
                  onSelectAssistant(`custom:${assistant.id}`);
                  if (clickPrompt) {
                    onSetInput(clickPrompt);
                    onFocusInput();
                  }
                }}
              >
                <div className={styles.assistantCardHeader}>
                  <AgentAvatar
                    size={22}
                    avatarSrc={isImageAvatar ? avatarImage : null}
                    avatarEmoji={!isImageAvatar && avatarValue ? avatarValue : null}
                    avatarBgColor={presetBgColor}
                  />
                  <span className={styles.assistantCardName}>{name}</span>
                  <span className={styles.assistantCardHoverBubble}>
                    <Comment theme='outline' size={15} fill='currentColor' />
                  </span>
                </div>
                {displayText && <p className={styles.assistantCardPrompt}>{displayText}</p>}
              </div>
            );
          }

          // Agent card
          const { agent, agentKey, displayText, clickPrompt } = card;
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
          return (
            <div
              key={`g-${agentKey}`}
              data-testid='guid-quick-start-card'
              className={styles.assistantCard}
              onClick={() => {
                onSelectAssistant(agentKey);
                if (clickPrompt) {
                  onSetInput(clickPrompt);
                  onFocusInput();
                }
              }}
            >
              <div className={styles.assistantCardHeader}>
                <AgentAvatar
                  size={22}
                  avatarSrc={logoSrc ?? null}
                  avatarEmoji={emojiAvatar ?? null}
                  avatarBgColor={card.avatarBgColor}
                />
                <span className={styles.assistantCardName}>{agent.name}</span>
                <span className={styles.assistantCardHoverBubble}>
                  <Comment theme='outline' size={15} fill='currentColor' />
                </span>
              </div>
              {displayText && <p className={styles.assistantCardPrompt}>{displayText}</p>}
            </div>
          );
        })}
      </div>
      <div className={styles.assistantGridFooter}>
        <span className={styles.assistantGridViewAll} onClick={() => navigate('/assistants')}>
          {t('guid.addMoreAssistants')}
        </span>
      </div>
      {modalTree}
    </div>
  );
};

export default AssistantSelectionArea;
