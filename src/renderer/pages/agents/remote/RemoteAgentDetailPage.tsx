/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import { useNavigateToAgent } from '@/renderer/hooks/agent/useNavigateToAgent';
import AppLoader from '@/renderer/components/layout/AppLoader';
import AgentDetailLayout from '@/renderer/components/agent/AgentDetailLayout';
import { AgentConfigSection as Section } from '@/renderer/components/agent/AgentConfigLayout';
import type { RemoteAgentConfig, RemoteAgentInput } from '@process/agent/remote/types';
import { Button, Form, Input, Message, Modal, Select, Switch, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

const FormItem = Form.Item;

const statusColor = (status?: string): string => {
  switch (status) {
    case 'connected':
      return 'green';
    case 'pending':
      return 'orange';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
};

const RemoteAgentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const navigateToAgent = useNavigateToAgent();
  const { t } = useTranslation();
  const [form] = Form.useForm<RemoteAgentInput>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data: agents, mutate } = useSWR<RemoteAgentConfig[]>('remote-agents.list', () =>
    ipcBridge.remoteAgent.list.invoke()
  );

  const agent = agents?.find((a) => a.id === id);

  // Populate form once agent is loaded
  useEffect(() => {
    if (!agent) return;
    form.setFieldsValue({
      name: agent.name,
      url: agent.url,
      protocol: agent.protocol,
      authType: agent.authType,
      authToken: agent.authToken,
      allowInsecure: agent.allowInsecure,
      description: agent.description,
      avatar: agent.avatar,
    });
    setDirty(false);
  }, [agent, form]);

  const handleSave = useCallback(async () => {
    if (!agent) return;
    try {
      setSaving(true);
      const values = await form.validate();
      await ipcBridge.remoteAgent.update.invoke({ id: agent.id, updates: values });
      await mutate();
      setDirty(false);
      Message.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
    } catch (e) {
      if (e && typeof e === 'object' && 'errors' in e) return; // form validation error
      Message.error(t('common.saveFailed', { defaultValue: 'Failed to save' }));
    } finally {
      setSaving(false);
    }
  }, [agent, form, mutate, t]);

  const handleDelete = useCallback(() => {
    if (!agent) return;
    Modal.confirm({
      title: t('settings.remoteAgent.deleteConfirm'),
      content: t('settings.remoteAgent.deleteConfirmContent', { name: agent.name }),
      okText: t('settings.remoteAgent.deleteOk', { defaultValue: 'Delete' }),
      cancelText: t('settings.remoteAgent.cancel', { defaultValue: 'Cancel' }),
      okButtonProps: { status: 'warning' },
      alignCenter: true,
      style: { borderRadius: 12 },
      getPopupContainer: () => document.body,
      onOk: async () => {
        setDeleting(true);
        try {
          await ipcBridge.remoteAgent.delete.invoke({ id: agent.id });
          await mutate();
          Message.success(t('settings.remoteAgent.deleted', { defaultValue: 'Deleted' }));
          navigate(-1);
        } catch {
          Message.error(t('common.failed', { defaultValue: 'Failed' }));
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [agent, mutate, navigate, t]);

  if (!agents) return <AppLoader />;
  if (!agent) {
    return (
      <div className='size-full flex items-center justify-center text-t-secondary'>
        {t('common.notFound', { defaultValue: 'Not found' })}
      </div>
    );
  }

  const initial = agent.name.charAt(0).toUpperCase();
  const authType = Form.useWatch('authType', form) ?? agent.authType;

  return (
    <AgentDetailLayout>
      {/* ── Header ── */}
      <div className='flex items-start gap-16px mb-32px'>
        <AgentAvatar
          size={56}
          avatarEmoji={agent.avatar || initial}
          avatarBgColor='var(--color-fill-3)'
          className='shrink-0'
        />
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-8px flex-wrap'>
            <span className='text-18px font-semibold text-t-primary'>{agent.name}</span>
            <Tag size='small' color={statusColor(agent.status)}>
              {agent.status ?? 'unknown'}
            </Tag>
          </div>
          {agent.description && <p className='text-13px text-t-secondary mt-4px'>{agent.description}</p>}
        </div>
        <div className='flex items-center gap-8px shrink-0'>
          <Button
            type='primary'
            size='small'
            className='!rounded-[100px]'
            onClick={() => navigateToAgent(`remote:${agent.id}`)}
          >
            {t('common.agents.talkToAgent')}
          </Button>
          <Button status='danger' size='small' loading={deleting} className='!rounded-[100px]' onClick={handleDelete}>
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        </div>
      </div>

      {/* ── Edit form ── */}
      <Form form={form} layout='vertical' autoComplete='off' onChange={() => setDirty(true)}>
        <Section title={t('common.agents.section.remote', { defaultValue: 'Connection' })}>
          <div className='py-8px flex flex-col gap-12px'>
            <FormItem
              field='name'
              label={t('settings.remoteAgent.name', { defaultValue: 'Name' })}
              rules={[{ required: true, message: t('settings.remoteAgent.nameRequired') }]}
            >
              <Input placeholder={t('settings.remoteAgent.namePlaceholder')} />
            </FormItem>
            <FormItem
              field='url'
              label='URL'
              rules={[{ required: true, message: t('settings.remoteAgent.urlRequired') }]}
            >
              <Input placeholder='https://' />
            </FormItem>
            <FormItem field='authType' label={t('settings.remoteAgent.authType', { defaultValue: 'Auth Type' })}>
              <Select>
                <Select.Option value='none'>
                  {t('settings.remoteAgent.authNone', { defaultValue: 'None' })}
                </Select.Option>
                <Select.Option value='bearer'>
                  {t('settings.remoteAgent.authBearer', { defaultValue: 'Bearer Token' })}
                </Select.Option>
              </Select>
            </FormItem>
            {authType === 'bearer' && (
              <FormItem
                field='authToken'
                label={t('settings.remoteAgent.authToken', { defaultValue: 'Token' })}
                rules={[{ required: true, message: t('settings.remoteAgent.tokenRequired') }]}
              >
                <Input.Password placeholder={t('settings.remoteAgent.tokenPlaceholder')} />
              </FormItem>
            )}
            <FormItem
              field='description'
              label={t('settings.remoteAgent.description', { defaultValue: 'Description' })}
            >
              <Input placeholder={t('settings.remoteAgent.descriptionPlaceholder')} />
            </FormItem>
            <FormItem
              field='allowInsecure'
              label={t('settings.remoteAgent.allowInsecure', { defaultValue: 'Allow Insecure' })}
              triggerPropName='checked'
            >
              <Switch />
            </FormItem>
          </div>
        </Section>
      </Form>

      {/* ── Connection metadata ── */}
      <Section title={t('settings.remoteAgent.protocol', { defaultValue: 'Protocol' })}>
        <div className='py-8px flex flex-col gap-4px'>
          <div className='flex justify-between py-8px border-b border-border-2'>
            <span className='text-13px text-t-secondary'>
              {t('settings.remoteAgent.protocol', { defaultValue: 'Protocol' })}
            </span>
            <span className='text-13px text-t-primary font-mono'>{agent.protocol}</span>
          </div>
          {agent.lastConnectedAt && (
            <div className='flex justify-between py-8px border-b border-border-2'>
              <span className='text-13px text-t-secondary'>
                {t('settings.remoteAgent.lastConnected', { defaultValue: 'Last Connected' })}
              </span>
              <span className='text-13px text-t-primary'>{new Date(agent.lastConnectedAt).toLocaleString()}</span>
            </div>
          )}
          <div className='flex justify-between py-8px'>
            <span className='text-13px text-t-secondary'>
              {t('settings.remoteAgent.created', { defaultValue: 'Created' })}
            </span>
            <span className='text-13px text-t-primary'>{new Date(agent.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </Section>

      {/* ── Save / Delete ── */}
      {dirty && (
        <div className='flex gap-8px justify-end mt-8px'>
          <Button
            className='!rounded-[100px]'
            onClick={() => {
              form.setFieldsValue({
                name: agent.name,
                url: agent.url,
                protocol: agent.protocol,
                authType: agent.authType,
                authToken: agent.authToken,
                allowInsecure: agent.allowInsecure,
                description: agent.description,
              });
              setDirty(false);
            }}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type='primary' loading={saving} className='!rounded-[100px]' onClick={handleSave}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      )}
    </AgentDetailLayout>
  );
};

export default RemoteAgentDetailPage;
