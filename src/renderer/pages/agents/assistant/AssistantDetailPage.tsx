/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import coworkSvg from '@/renderer/assets/icons/cowork.svg';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import AppLoader from '@/renderer/components/layout/AppLoader';
import EmojiPicker from '@/renderer/components/chat/EmojiPicker';
import MarkdownView from '@/renderer/components/Markdown';
import {
  useAssistantBackends,
  useAssistantEditor,
  useAssistantList,
  useAssistantSkills,
} from '@/renderer/hooks/assistant';
import { useAgentUserConfig } from '@/renderer/hooks/agent/useAgentUserConfig';
import { ConfigStorage } from '@/common/config/storage';
import { getAgentModes } from '@/renderer/utils/model/agentModes';
import type { AcpModelInfo } from '@/common/types/acpTypes';
import {
  hasBuiltinSkills,
  resolveAvatarImageSrc,
} from '@/renderer/pages/settings/AgentSettings/AssistantManagement/assistantUtils';
import type { AssistantListItem } from '@/renderer/pages/settings/AgentSettings/AssistantManagement/types';
import AddCustomPathModal from '@/renderer/pages/settings/AgentSettings/AssistantManagement/AddCustomPathModal';
import AddSkillsModal from '@/renderer/pages/settings/AgentSettings/AssistantManagement/AddSkillsModal';
import DeleteAssistantModal from '@/renderer/pages/settings/AgentSettings/AssistantManagement/DeleteAssistantModal';
import SkillConfirmModals from '@/renderer/pages/settings/AgentSettings/AssistantManagement/SkillConfirmModals';
import { Button, Checkbox, Collapse, Input, Message, Select, Tag, Typography } from '@arco-design/web-react';
import { Delete, Plus, Robot } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

type LocationState = { duplicateFromId?: string } | null;

const AssistantDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [messageApi, contextHolder] = Message.useMessage();
  const { duplicateFromId } = (location.state as LocationState) ?? {};

  const avatarImageMap = useMemo<Record<string, string>>(
    () => ({ 'cowork.svg': coworkSvg, '\u{1F6E0}\u{FE0F}': coworkSvg }),
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
    localeKey,
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
    message: messageApi,
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
    message: messageApi,
  });

  // Per-assistant config (preferredModelId, preferredMode) — only meaningful for saved assistants
  const { config: agentConfig, save: saveAgentConfig } = useAgentUserConfig(id !== 'new' ? (id ?? '') : '');
  const [cachedModels, setCachedModels] = useState<AcpModelInfo | null>(null);

  // Reload model cache whenever the selected backend changes
  useEffect(() => {
    if (!editor.editAgent) return;
    void ConfigStorage.get('acp.cachedModels').then((all) => {
      const key = editor.editAgent as string;
      if (all && key in all) setCachedModels((all as Record<string, AcpModelInfo>)[key] ?? null);
      else setCachedModels(null);
    });
  }, [editor.editAgent]);

  const [initialized, setInitialized] = useState(false);
  const initIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (id === 'new') {
      if (initIdRef.current === 'new') return;
      initIdRef.current = 'new';
      void (async () => {
        if (duplicateFromId && assistants.length > 0) {
          const source = assistants.find((a) => a.id === duplicateFromId);
          if (source) {
            await editor.handleDuplicate(source);
            setInitialized(true);
            return;
          }
        }
        await editor.handleCreate();
        setInitialized(true);
      })();
      return;
    }

    if (!id || assistants.length === 0) return;
    if (initIdRef.current === id) return;

    const target = assistants.find((a) => a.id === id);
    if (!target) {
      void navigate('/guid', { replace: true });
      return;
    }

    initIdRef.current = id;
    setActiveAssistantId(id);
    void (async () => {
      await editor.handleEdit(target);
      setInitialized(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, assistants.length, duplicateFromId]);

  const handleSave = async () => {
    const wasCreating = editor.isCreating;
    await editor.handleSave();
    if (wasCreating) {
      // After creating, go back (the new assistant is in the sidebar list)
      navigate(-1);
    }
  };

  const handleDeleteConfirm = async () => {
    await editor.handleDeleteConfirm();
    navigate(-1);
  };

  const editAvatarImage = resolveAvatarImageSrc(editor.editAvatar, avatarImageMap);
  const canEditIdentity = !activeAssistant?.isBuiltin && !isReadonlyAssistant;
  const isRuleEditable = !activeAssistant?.isBuiltin && !isReadonlyAssistant;

  const showSkills =
    editor.isCreating ||
    (activeAssistantId !== null && hasBuiltinSkills(activeAssistantId)) ||
    (activeAssistant !== null && !activeAssistant.isBuiltin && !isExtensionAssistant(activeAssistant));

  const customSkillItems = editor.availableSkills.filter((s) => s.isCustom);
  const builtinSkillItems = editor.availableSkills.filter((s) => !s.isCustom);
  const totalSkillsCount = editor.pendingSkills.length + customSkillItems.length + builtinSkillItems.length;
  const totalActiveSkillsCount = editor.selectedSkills.filter(
    (name) => editor.pendingSkills.some((s) => s.name === name) || editor.availableSkills.some((s) => s.name === name)
  ).length;

  if (!initialized) return <AppLoader />;

  return (
    <div className='size-full overflow-y-auto'>
      {contextHolder}
      <div className='px-12px md:px-40px py-32px mx-auto w-full md:max-w-800px'>
        {/* ── Header ── */}
        <div className='flex items-start gap-12px mb-28px'>
          {/* Avatar (large, clickable if editable) */}
          {canEditIdentity ? (
            <EmojiPicker value={editor.editAvatar} onChange={editor.setEditAvatar} placement='br'>
              <div className='cursor-pointer shrink-0'>
                {editAvatarImage ? (
                  <img
                    src={editAvatarImage}
                    alt=''
                    className='w-56px h-56px rd-12px object-contain border border-border-2 bg-fill-2'
                  />
                ) : (
                  <AgentAvatar size={56} avatarEmoji={editor.editAvatar || undefined} />
                )}
              </div>
            </EmojiPicker>
          ) : editAvatarImage ? (
            <img
              src={editAvatarImage}
              alt=''
              className='w-56px h-56px rd-12px object-contain border border-border-2 bg-fill-2 shrink-0'
            />
          ) : (
            <AgentAvatar size={56} avatarEmoji={editor.editAvatar || undefined} className='shrink-0' />
          )}

          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-6px flex-wrap'>
              <span className='text-18px font-semibold text-t-primary'>
                {editor.editName || t('common.untitled', { defaultValue: 'Untitled' })}
              </span>
              {activeAssistant?.isBuiltin && (
                <Tag size='small' color='orange'>
                  Builtin
                </Tag>
              )}
              {isExtensionAssistant(activeAssistant as AssistantListItem | null | undefined) && (
                <Tag size='small' color='arcoblue'>
                  Extension
                </Tag>
              )}
            </div>
            {editor.editDescription && <p className='text-13px text-t-secondary mt-4px'>{editor.editDescription}</p>}
          </div>

          {/* Actions */}
          <div className='flex items-center gap-8px shrink-0'>
            {!isReadonlyAssistant && (
              <Button type='primary' size='small' className='!rounded-[100px]' onClick={() => void handleSave()}>
                {editor.isCreating
                  ? t('common.create', { defaultValue: 'Create' })
                  : t('common.save', { defaultValue: 'Save' })}
              </Button>
            )}
            {!editor.isCreating && activeAssistant && (
              <Button
                size='small'
                className='!rounded-[100px]'
                onClick={() => navigate('/agents/assistant/new', { state: { duplicateFromId: activeAssistant.id } })}
              >
                {t('settings.duplicate', { defaultValue: 'Duplicate' })}
              </Button>
            )}
            {!editor.isCreating &&
              !activeAssistant?.isBuiltin &&
              !isExtensionAssistant(activeAssistant as AssistantListItem | null | undefined) && (
                <Button
                  status='danger'
                  size='small'
                  className='!rounded-[100px]'
                  onClick={() => editor.handleDeleteClick()}
                >
                  {t('common.delete', { defaultValue: 'Delete' })}
                </Button>
              )}
          </div>
        </div>

        {/* ── Form body ── */}
        <div className='flex flex-col gap-20px'>
          {/* Name & Avatar */}
          <div className='flex flex-col gap-8px'>
            <Typography.Text bold>
              <span className='text-red-500'>* </span>
              {t('settings.assistantNameAvatar', { defaultValue: 'Name & Avatar' })}
            </Typography.Text>
            <div className='flex items-center gap-12px'>
              {canEditIdentity ? (
                <EmojiPicker value={editor.editAvatar} onChange={editor.setEditAvatar} placement='br'>
                  <div className='cursor-pointer w-40px h-40px rd-8px flex items-center justify-center bg-fill-2 hover:bg-fill-3 transition-colors border border-border-2'>
                    {editAvatarImage ? (
                      <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} />
                    ) : editor.editAvatar ? (
                      <span className='text-20px'>{editor.editAvatar}</span>
                    ) : (
                      <Robot theme='outline' size={20} />
                    )}
                  </div>
                </EmojiPicker>
              ) : (
                <div className='w-40px h-40px rd-8px flex items-center justify-center bg-fill-2 border border-border-2'>
                  {editAvatarImage ? (
                    <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} />
                  ) : editor.editAvatar ? (
                    <span className='text-20px'>{editor.editAvatar}</span>
                  ) : (
                    <Robot theme='outline' size={20} />
                  )}
                </div>
              )}
              <Input
                value={editor.editName}
                onChange={editor.setEditName}
                disabled={!canEditIdentity}
                placeholder={t('settings.agentNamePlaceholder', { defaultValue: 'Enter a name for this agent' })}
                className='flex-1 !rounded-8px'
              />
            </div>
          </div>

          {/* Description */}
          <div className='flex flex-col gap-8px'>
            <Typography.Text bold>
              {t('settings.assistantDescription', { defaultValue: 'Description' })}
            </Typography.Text>
            <Input
              value={editor.editDescription}
              onChange={editor.setEditDescription}
              disabled={!canEditIdentity}
              placeholder={t('settings.assistantDescriptionPlaceholder', {
                defaultValue: 'What can this assistant help with?',
              })}
              className='!rounded-8px'
            />
          </div>

          {/* Main Agent */}
          <div className='flex flex-col gap-8px'>
            <Typography.Text bold>{t('settings.assistantMainAgent', { defaultValue: 'Main Agent' })}</Typography.Text>
            <Select
              value={editor.editAgent}
              onChange={(v) => editor.setEditAgent(v as string)}
              disabled={isReadonlyAssistant}
              className='w-full !rounded-8px'
            >
              {[
                { value: 'gemini', label: 'Gemini CLI' },
                { value: 'claude', label: 'Claude Code' },
                { value: 'qwen', label: 'Qwen Code' },
                { value: 'codex', label: 'Codex' },
                { value: 'codebuddy', label: 'CodeBuddy' },
                { value: 'opencode', label: 'OpenCode' },
              ]
                .filter((opt) => availableBackends.has(opt.value))
                .map((opt) => (
                  <Select.Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Option>
                ))}
              {extensionAcpAdapters?.map((adapter) => {
                const adId = adapter.id as string;
                const adName = (adapter.name as string) || adId;
                return (
                  <Select.Option key={adId} value={adId}>
                    <span className='flex items-center gap-6px'>
                      {adName}
                      <Tag size='small' color='arcoblue'>
                        ext
                      </Tag>
                    </span>
                  </Select.Option>
                );
              })}
            </Select>
          </div>

          {/* Summary */}
          <div className='flex flex-wrap items-center gap-8px p-10px rd-10px bg-fill-1'>
            <span className='text-12px text-t-secondary'>
              {t('settings.assistantMainAgent', { defaultValue: 'Main Agent' })}:
            </span>
            <Tag size='small' color='arcoblue'>
              {editor.editAgent}
            </Tag>
            <span className='text-12px text-t-secondary ml-6px'>
              {t('settings.assistantSkills', { defaultValue: 'Skills' })}:
            </span>
            <Tag size='small' color={totalActiveSkillsCount > 0 ? 'green' : 'gray'}>
              {totalActiveSkillsCount > 0 ? `${totalActiveSkillsCount}/${totalSkillsCount}` : totalSkillsCount}
            </Tag>
          </div>

          {/* Default Model */}
          {id !== 'new' && (
            <div className='flex flex-col gap-8px'>
              <Typography.Text bold>{t('common.defaultModel', { defaultValue: 'Default Model' })}</Typography.Text>
              {cachedModels && cachedModels.availableModels.length > 0 ? (
                <Select
                  value={agentConfig.preferredModelId ?? ''}
                  placeholder={t('common.default', { defaultValue: 'Default' })}
                  allowClear
                  className='w-full !rounded-8px'
                  onChange={(v: string) => void saveAgentConfig({ preferredModelId: v || undefined })}
                >
                  {cachedModels.availableModels.map((m) => (
                    <Select.Option key={m.id} value={m.id}>
                      {m.label}
                    </Select.Option>
                  ))}
                </Select>
              ) : (
                <span className='text-12px text-t-secondary'>
                  {t('common.agents.noModelCache', {
                    defaultValue: 'Start a conversation to populate the model list.',
                  })}
                </span>
              )}
            </div>
          )}

          {/* Permissions */}
          {id !== 'new' && getAgentModes(editor.editAgent).length > 0 && (
            <div className='flex flex-col gap-8px'>
              <Typography.Text bold>{t('common.agents.permissions', { defaultValue: 'Permissions' })}</Typography.Text>
              <Select
                value={agentConfig.preferredMode ?? ''}
                placeholder={t('common.default', { defaultValue: 'Default' })}
                allowClear
                className='w-full !rounded-8px'
                onChange={(v: string) => void saveAgentConfig({ preferredMode: v || undefined })}
              >
                {getAgentModes(editor.editAgent).map((m) => (
                  <Select.Option key={m.value} value={m.value}>
                    {t(`agentMode.${m.value}`, { defaultValue: m.label })}
                  </Select.Option>
                ))}
              </Select>
            </div>
          )}

          {/* Rules / System Prompt */}
          <div className='flex flex-col gap-8px'>
            <Typography.Text bold>{t('settings.assistantRules', { defaultValue: 'Rules' })}</Typography.Text>
            <div className='border border-border-2 overflow-hidden rd-8px'>
              {isRuleEditable && (
                <div className='flex items-center h-36px bg-fill-2 border-b border-border-2 shrink-0'>
                  {(['edit', 'preview'] as const).map((mode) => (
                    <div
                      key={mode}
                      className={`flex items-center h-full px-16px cursor-pointer transition-all text-13px font-medium ${
                        editor.promptViewMode === mode
                          ? 'text-primary border-b-2 border-primary bg-bg-1'
                          : 'text-t-secondary hover:text-t-primary'
                      }`}
                      onClick={() => editor.setPromptViewMode(mode)}
                    >
                      {mode === 'edit'
                        ? t('settings.promptEdit', { defaultValue: 'Edit' })
                        : t('settings.promptPreview', { defaultValue: 'Preview' })}
                    </div>
                  ))}
                </div>
              )}
              <div className='bg-fill-2' style={{ minHeight: 160, overflow: 'auto' }}>
                {editor.promptViewMode === 'edit' && isRuleEditable ? (
                  <Input.TextArea
                    value={editor.editContext}
                    onChange={editor.setEditContext}
                    placeholder={t('settings.assistantRulesPlaceholder', {
                      defaultValue: 'Enter rules in Markdown format...',
                    })}
                    autoSize={{ minRows: 8, maxRows: 24 }}
                    className='!border-none !rounded-none !bg-transparent resize-none'
                  />
                ) : (
                  <div className='p-16px text-14px leading-7'>
                    {editor.editContext ? (
                      <MarkdownView hiddenCodeCopyButton>{editor.editContext}</MarkdownView>
                    ) : (
                      <div className='text-t-secondary text-center py-32px'>
                        {t('settings.promptPreviewEmpty', { defaultValue: 'No content to preview' })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Skills */}
          {showSkills && (
            <div className='flex flex-col gap-8px'>
              <div className='flex items-center justify-between'>
                <Typography.Text bold>{t('settings.assistantSkills', { defaultValue: 'Skills' })}</Typography.Text>
                <Button
                  size='small'
                  type='outline'
                  icon={<Plus size={14} />}
                  onClick={() => editor.setSkillsModalVisible(true)}
                  className='!rounded-[100px]'
                >
                  {t('settings.addSkills', { defaultValue: 'Add Skills' })}
                </Button>
              </div>

              <Collapse defaultActiveKey={['custom-skills']}>
                <Collapse.Item
                  header={
                    <span className='text-13px font-medium'>
                      {t('settings.customSkills', { defaultValue: 'Imported Skills (Library)' })}
                    </span>
                  }
                  name='custom-skills'
                >
                  <div className='space-y-4px'>
                    {editor.pendingSkills.map((skill) => (
                      <div
                        key={`pending-${skill.name}`}
                        className='flex items-start gap-8px p-8px hover:bg-fill-1 rounded-4px group'
                      >
                        <Checkbox
                          checked={editor.selectedSkills.includes(skill.name)}
                          onChange={() => {
                            if (editor.selectedSkills.includes(skill.name)) {
                              editor.setSelectedSkills(editor.selectedSkills.filter((s) => s !== skill.name));
                            } else {
                              editor.setSelectedSkills([...editor.selectedSkills, skill.name]);
                            }
                          }}
                        />
                        <div className='flex-1 min-w-0'>
                          <div className='flex items-center gap-6px'>
                            <span className='text-13px font-medium'>{skill.name}</span>
                            <span className='bg-[rgba(var(--primary-6),0.08)] text-primary-6 border border-[rgba(var(--primary-6),0.2)] text-10px px-4px py-1px rd-4px font-medium uppercase'>
                              Pending
                            </span>
                          </div>
                          {skill.description && (
                            <p className='text-12px text-t-secondary mt-2px'>{skill.description}</p>
                          )}
                        </div>
                        <button
                          type='button'
                          className='opacity-0 group-hover:opacity-100 transition-opacity p-4px hover:bg-fill-2 rounded-4px'
                          onClick={() => editor.setDeletePendingSkillName(skill.name)}
                        >
                          <Delete size={16} fill='var(--color-text-3)' />
                        </button>
                      </div>
                    ))}
                    {customSkillItems.map((skill) => (
                      <div
                        key={`custom-${skill.name}`}
                        className='flex items-start gap-8px p-8px hover:bg-fill-1 rounded-4px group'
                      >
                        <Checkbox
                          checked={editor.selectedSkills.includes(skill.name)}
                          onChange={() => {
                            if (editor.selectedSkills.includes(skill.name)) {
                              editor.setSelectedSkills(editor.selectedSkills.filter((s) => s !== skill.name));
                            } else {
                              editor.setSelectedSkills([...editor.selectedSkills, skill.name]);
                            }
                          }}
                        />
                        <div className='flex-1 min-w-0'>
                          <span className='text-13px font-medium'>{skill.name}</span>
                          {skill.description && (
                            <p className='text-12px text-t-secondary mt-2px'>{skill.description}</p>
                          )}
                        </div>
                        <button
                          type='button'
                          className='opacity-0 group-hover:opacity-100 transition-opacity p-4px hover:bg-fill-2 rounded-4px'
                          onClick={() => editor.setDeleteCustomSkillName(skill.name)}
                        >
                          <Delete size={16} fill='var(--color-text-3)' />
                        </button>
                      </div>
                    ))}
                    {editor.pendingSkills.length === 0 && customSkillItems.length === 0 && (
                      <div className='text-center text-t-secondary text-12px py-16px'>
                        {t('settings.noCustomSkills', { defaultValue: 'No custom skills added' })}
                      </div>
                    )}
                  </div>
                </Collapse.Item>

                <Collapse.Item
                  header={
                    <span className='text-13px font-medium'>
                      {t('settings.builtinSkills', { defaultValue: 'Builtin Skills' })}
                    </span>
                  }
                  name='builtin-skills'
                >
                  {builtinSkillItems.length > 0 ? (
                    <div className='space-y-4px'>
                      {builtinSkillItems.map((skill) => (
                        <div key={skill.name} className='flex items-start gap-8px p-8px hover:bg-fill-1 rounded-4px'>
                          <Checkbox
                            checked={editor.selectedSkills.includes(skill.name)}
                            onChange={() => {
                              if (editor.selectedSkills.includes(skill.name)) {
                                editor.setSelectedSkills(editor.selectedSkills.filter((s) => s !== skill.name));
                              } else {
                                editor.setSelectedSkills([...editor.selectedSkills, skill.name]);
                              }
                            }}
                          />
                          <div className='flex-1 min-w-0'>
                            <span className='text-13px font-medium'>{skill.name}</span>
                            {skill.description && (
                              <p className='text-12px text-t-secondary mt-2px'>{skill.description}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className='text-center text-t-secondary text-12px py-16px'>
                      {t('settings.noBuiltinSkills', { defaultValue: 'No builtin skills available' })}
                    </div>
                  )}
                </Collapse.Item>
              </Collapse>
            </div>
          )}

          {/* Bottom action bar */}
          <div className='flex items-center gap-8px mt-8px pb-32px'>
            {!isReadonlyAssistant && (
              <Button type='primary' onClick={() => void handleSave()} className='!rounded-[100px] w-[100px]'>
                {editor.isCreating
                  ? t('common.create', { defaultValue: 'Create' })
                  : t('common.save', { defaultValue: 'Save' })}
              </Button>
            )}
            <Button onClick={() => navigate(-1)} className='!rounded-[100px] w-[100px] !bg-fill-2'>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <DeleteAssistantModal
        visible={editor.deleteConfirmVisible}
        onCancel={() => editor.setDeleteConfirmVisible(false)}
        onConfirm={() => void handleDeleteConfirm()}
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
        message={messageApi}
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
    </div>
  );
};

export default AssistantDetailPage;
