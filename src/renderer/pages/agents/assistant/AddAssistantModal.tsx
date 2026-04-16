/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionModal from '@/renderer/components/base/AionModal';
import EmojiPicker from '@/renderer/components/chat/EmojiPicker';
import { useAssistantBackends } from '@/renderer/hooks/assistant';
import { ConfigStorage } from '@/common/config/storage';
import type { AcpBackendConfig } from '@/common/types/acpTypes';
import { Button, Input, Message, Select } from '@arco-design/web-react';
import { Robot } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const BACKEND_OPTIONS = [
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'qwen', label: 'Qwen Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'codebuddy', label: 'CodeBuddy' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'aionrs', label: 'Aion CLI' },
];

const Label: React.FC<{ text: string; required?: boolean }> = ({ text, required }) => (
  <div className='text-13px font-medium text-t-primary mb-4px'>
    {required && <span className='text-red-500 mr-2px'>*</span>}
    {text}
  </div>
);

const AddAssistantModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
}> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [avatar, setAvatar] = useState('🤖');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [backend, setBackend] = useState('gemini');
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);
  const { availableBackends, extensionAcpAdapters } = useAssistantBackends();

  const visibleBackends = BACKEND_OPTIONS.filter((opt) => availableBackends.has(opt.value));

  const handleClose = useCallback(() => {
    setAvatar('🤖');
    setName('');
    setDescription('');
    setBackend('gemini');
    setNameError('');
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setNameError(t('settings.remoteAgent.nameRequired'));
      return;
    }
    setNameError('');
    setSaving(true);
    try {
      const newId = `custom-${Date.now()}`;
      const newAssistant: AcpBackendConfig = {
        id: newId,
        name: name.trim(),
        description: description.trim() || undefined,
        avatar,
        isPreset: true,
        isBuiltin: false,
        presetAgentType: backend,
        enabled: true,
        enabledSkills: [],
        customSkillNames: [],
      };
      const existing = (await ConfigStorage.get('acp.customAgents')) ?? [];
      await ConfigStorage.set('acp.customAgents', [...(existing as AcpBackendConfig[]), newAssistant]);
      Message.success(t('common.createSuccess', { defaultValue: 'Created successfully' }));
      onCreated?.();
      handleClose();
      void navigate(`/agents/assistant/${newId}`);
    } catch {
      Message.error(t('common.failed', { defaultValue: 'Failed' }));
    } finally {
      setSaving(false);
    }
  }, [avatar, backend, description, handleClose, name, navigate, onCreated, t]);

  return (
    <AionModal
      visible={visible}
      onCancel={handleClose}
      header={{ title: t('common.agents.addAssistant', { defaultValue: 'Add Assistant' }), showClose: true }}
      footer={null}
      style={{ maxWidth: '92vw', width: 480, borderRadius: 16 }}
      contentStyle={{ background: 'var(--dialog-fill-0)', borderRadius: 16, padding: '20px 24px 16px' }}
    >
      <div className='flex flex-col gap-16px'>
        {/* Avatar + Name */}
        <div>
          <Label text={t('settings.remoteAgent.name', { defaultValue: 'Name' })} required />
          <div className='flex items-center gap-10px'>
            <EmojiPicker value={avatar} onChange={setAvatar} placement='br'>
              <div className='cursor-pointer w-36px h-36px rd-8px flex items-center justify-center bg-fill-2 hover:bg-fill-3 transition-colors border border-border-2 shrink-0'>
                {avatar ? (
                  <span className='text-20px'>{avatar}</span>
                ) : (
                  <Robot theme='outline' size={18} fill='var(--color-text-3)' />
                )}
              </div>
            </EmojiPicker>
            <div className='flex-1'>
              <Input
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (v.trim()) setNameError('');
                }}
                error={!!nameError}
                placeholder={t('settings.agentNamePlaceholder', { defaultValue: 'Enter a name for this assistant' })}
                className='!rounded-8px'
              />
              {nameError && <div className='text-12px text-[rgb(var(--danger-6))] mt-2px'>{nameError}</div>}
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <Label text={t('settings.assistantDescription', { defaultValue: 'Description' })} />
          <Input
            value={description}
            onChange={setDescription}
            placeholder={t('settings.assistantDescriptionPlaceholder', {
              defaultValue: 'What can this assistant help with?',
            })}
            className='!rounded-8px'
          />
        </div>

        {/* Backend */}
        <div>
          <Label text={t('settings.assistantMainAgent', { defaultValue: 'Main Agent' })} required />
          <Select value={backend} onChange={(v) => setBackend(v as string)} className='w-full !rounded-8px'>
            {visibleBackends.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
            {extensionAcpAdapters?.map((adapter) => {
              const adId = adapter.id as string;
              const adName = (adapter.name as string) || adId;
              return (
                <Select.Option key={adId} value={adId}>
                  {adName}
                </Select.Option>
              );
            })}
          </Select>
        </div>

        <div className='flex justify-end gap-8px mt-4px'>
          <Button className='!rounded-[100px]' onClick={handleClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type='primary' loading={saving} className='!rounded-[100px]' onClick={() => void handleSave()}>
            {t('common.create', { defaultValue: 'Create' })}
          </Button>
        </div>
      </div>
    </AionModal>
  );
};

export default AddAssistantModal;
