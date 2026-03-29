/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Alert, Button, Drawer, Form, Input, InputNumber, Message, Select } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupChatSettingsDrawerProps } from '../types';

type AgentOption = {
  id: string;
  name: string;
  avatar?: string;
};

const GroupChatSettingsDrawer: React.FC<GroupChatSettingsDrawerProps> = ({
  visible,
  onClose,
  conversationId,
  currentSettings,
  onSaved,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(currentSettings.groupChatName || '');
  const [leaderAgentId, setLeaderAgentId] = useState(currentSettings.leaderAgentId || '');
  const [seedMessages, setSeedMessages] = useState(currentSettings.seedMessages || '');
  const [maxConcurrent, setMaxConcurrent] = useState(currentSettings.maxConcurrentChildren ?? 3);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);

  // Fetch available agents for leader selection
  useEffect(() => {
    if (visible) {
      void ipcBridge.acpConversation.getAvailableAgents
        .invoke()
        .then((res) => {
          if (res.success && res.data) {
            const customAgents = res.data
              .filter((a) => a.customAgentId)
              .map((a) => ({ id: a.customAgentId!, name: a.name, avatar: a.avatar }));
            setAgents(customAgents);
          }
        })
        .catch(() => {
          /* agent list unavailable — dropdown stays empty */
        });
    }
  }, [visible]);

  // Reset form when drawer opens
  useEffect(() => {
    if (visible) {
      setName(currentSettings.groupChatName || '');
      setLeaderAgentId(currentSettings.leaderAgentId || '');
      setSeedMessages(currentSettings.seedMessages || '');
      setMaxConcurrent(currentSettings.maxConcurrentChildren ?? 3);
    }
  }, [visible, currentSettings]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const result = await ipcBridge.dispatch.updateGroupChatSettings.invoke({
        conversationId,
        groupChatName: name || undefined,
        leaderAgentId: leaderAgentId || undefined,
        seedMessages: seedMessages || undefined,
        maxConcurrentChildren: maxConcurrent,
      });
      if (result.success) {
        Message.success(t('dispatch.settings.saveSuccess'));
        onSaved();
        onClose();
      } else {
        Message.error(result.msg || t('dispatch.settings.saveFailed'));
      }
    } catch (err) {
      if (err instanceof Error) {
        Message.error(err.message);
      } else {
        Message.error(t('dispatch.settings.saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  }, [conversationId, name, leaderAgentId, seedMessages, maxConcurrent, onSaved, onClose, t]);

  return (
    <Drawer
      title={t('dispatch.settings.title')}
      visible={visible}
      onCancel={onClose}
      width={400}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type='primary' loading={saving} onClick={() => void handleSave()}>
            {t('dispatch.settings.save')}
          </Button>
        </div>
      }
    >
      <Alert type='info' content={t('dispatch.settings.coldSwapNotice')} className='mb-16px' />
      <Form layout='vertical'>
        <Form.Item label={t('dispatch.settings.nameLabel')}>
          <Input value={name} onChange={setName} placeholder={t('dispatch.settings.namePlaceholder')} maxLength={50} />
        </Form.Item>
        <Form.Item label={t('dispatch.settings.leaderAgentLabel')}>
          <Select
            value={leaderAgentId || undefined}
            onChange={(val: string) => setLeaderAgentId(val || '')}
            placeholder={t('dispatch.settings.leaderAgentPlaceholder')}
            allowClear
          >
            {agents.map((a) => (
              <Select.Option key={a.id} value={a.id}>
                {a.avatar && <span className='mr-4px'>{a.avatar}</span>}
                {a.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item label={t('dispatch.settings.seedMessagesLabel')}>
          <Input.TextArea
            value={seedMessages}
            onChange={setSeedMessages}
            placeholder={t('dispatch.settings.seedMessagesPlaceholder')}
            autoSize={{ minRows: 4, maxRows: 10 }}
            maxLength={2000}
            showWordLimit
          />
        </Form.Item>
        <Form.Item label={t('dispatch.settings.maxConcurrentLabel')}>
          <InputNumber
            value={maxConcurrent}
            onChange={(val) => setMaxConcurrent(typeof val === 'number' ? val : 3)}
            min={1}
            max={10}
            style={{ width: '100%' }}
          />
          <div className='text-12px text-t-secondary mt-4px'>{t('dispatch.settings.maxConcurrentHelp')}</div>
        </Form.Item>
      </Form>
    </Drawer>
  );
};

export default GroupChatSettingsDrawer;
