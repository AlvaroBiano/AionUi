/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACP_ENABLED_BACKENDS } from '@/common/types/acpTypes';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { Button } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

/** Map local agent backend key → settings route */
const SETTINGS_ROUTE_MAP: Record<string, string> = {
  aionrs: '/settings/aionrs',
  gemini: '/settings/gemini',
};

const InfoRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className='flex flex-col gap-4px py-12px border-b border-border-2 last:border-b-0'>
    <span className='text-11px font-semibold uppercase tracking-wider text-t-secondary'>{label}</span>
    <span className='text-14px text-t-primary font-mono'>{value ?? '—'}</span>
  </div>
);

const LocalAgentDetailPage: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const config = key ? ACP_ENABLED_BACKENDS[key] : undefined;

  if (!config) {
    return (
      <div className='size-full flex items-center justify-center text-t-secondary'>
        {t('common.notFound', { defaultValue: 'Not found' })}
      </div>
    );
  }

  const avatarSrc = resolveAgentLogo({ backend: key! }) ?? null;
  const settingsRoute = key ? (SETTINGS_ROUTE_MAP[key] ?? '/settings/agent') : '/settings/agent';

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
            avatarSrc={avatarSrc}
            avatarBgColor={(config as { avatarBgColor?: string }).avatarBgColor}
            className='shrink-0'
          />

          <div className='flex-1 min-w-0'>
            <span className='text-18px font-semibold text-t-primary'>{config.name}</span>
            {config.description && <p className='text-13px text-t-secondary mt-4px'>{config.description}</p>}
          </div>

          <Button
            type='primary'
            size='small'
            className='!rounded-[100px] shrink-0'
            onClick={() => navigate(settingsRoute)}
          >
            {t('settings.configure', { defaultValue: 'Settings' })}
          </Button>
        </div>

        {/* Info */}
        <div className='bg-fill-2 rd-12px px-16px'>
          {config.cliCommand && (
            <InfoRow
              label={t('settings.agentManagement.cliCommand', { defaultValue: 'CLI Command' })}
              value={config.cliCommand}
            />
          )}
          {config.defaultCliPath && (
            <InfoRow
              label={t('settings.agentManagement.defaultPath', { defaultValue: 'Default Path' })}
              value={config.defaultCliPath}
            />
          )}
          <InfoRow label={t('settings.agentManagement.backendKey', { defaultValue: 'Backend ID' })} value={key} />
          {config.presetAgentType && (
            <InfoRow
              label={t('settings.agentManagement.agentType', { defaultValue: 'Agent Type' })}
              value={config.presetAgentType}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default LocalAgentDetailPage;
