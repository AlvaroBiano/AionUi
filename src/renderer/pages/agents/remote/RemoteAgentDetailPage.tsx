/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import AppLoader from '@/renderer/components/layout/AppLoader';
import type { RemoteAgentConfig } from '@process/agent/remote/types';
import { Button, Message, Modal, Tag } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

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

const InfoRow: React.FC<{ label: string; value?: string | React.ReactNode }> = ({ label, value }) => (
  <div className='flex flex-col gap-4px py-12px border-b border-border-2 last:border-b-0'>
    <span className='text-11px font-semibold uppercase tracking-wider text-t-secondary'>{label}</span>
    <span className='text-14px text-t-primary'>{value ?? '—'}</span>
  </div>
);

const RemoteAgentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);

  const { data: agents, mutate } = useSWR<RemoteAgentConfig[]>('remote-agents.list', () =>
    ipcBridge.remoteAgent.list.invoke()
  );

  const agent = agents?.find((a) => a.id === id);

  const handleDelete = () => {
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
  };

  if (!agents) return <AppLoader />;
  if (!agent) {
    return (
      <div className='size-full flex items-center justify-center text-t-secondary'>
        {t('common.notFound', { defaultValue: 'Not found' })}
      </div>
    );
  }

  const initial = agent.name.charAt(0).toUpperCase();

  return (
    <div className='size-full overflow-y-auto'>
      <div className='px-12px md:px-40px py-32px mx-auto w-full md:max-w-800px'>
        {/* Header */}
        <div className='flex items-start gap-12px mb-28px'>
          <button
            type='button'
            className='mt-2px flex items-center justify-center w-28px h-28px rd-6px hover:bg-fill-2 transition-colors cursor-pointer text-t-secondary hover:text-t-primary shrink-0'
            onClick={() => navigate(-1)}
          >
            <Left size={18} />
          </button>

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
            <Button size='small' className='!rounded-[100px]' onClick={() => navigate('/settings/agent')}>
              {t('common.edit', { defaultValue: 'Edit' })}
            </Button>
            <Button status='danger' size='small' loading={deleting} className='!rounded-[100px]' onClick={handleDelete}>
              {t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          </div>
        </div>

        {/* Info section */}
        <div className='bg-fill-2 rd-12px px-16px mb-20px'>
          <InfoRow label='URL' value={agent.url} />
          <InfoRow label={t('settings.remoteAgent.authType', { defaultValue: 'Auth Type' })} value={agent.authType} />
          <InfoRow label={t('settings.remoteAgent.protocol', { defaultValue: 'Protocol' })} value={agent.protocol} />
          {agent.lastConnectedAt && (
            <InfoRow
              label={t('settings.remoteAgent.lastConnected', { defaultValue: 'Last Connected' })}
              value={new Date(agent.lastConnectedAt).toLocaleString()}
            />
          )}
          <InfoRow
            label={t('settings.remoteAgent.created', { defaultValue: 'Created' })}
            value={new Date(agent.createdAt).toLocaleDateString()}
          />
        </div>

        <div className='flex items-center gap-8px text-13px text-t-secondary'>
          <span>
            {t('settings.remoteAgent.editHint', {
              defaultValue: 'To configure connection details, use the full editor in',
            })}
          </span>
          <Button
            type='text'
            size='mini'
            className='!p-0 !text-primary-6 hover:!underline'
            onClick={() => navigate('/settings/agent')}
          >
            {t('settings.agents', { defaultValue: 'Agent Settings' })}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RemoteAgentDetailPage;
