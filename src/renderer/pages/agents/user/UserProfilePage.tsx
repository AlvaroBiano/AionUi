/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AgentAvatar from '@/renderer/components/AgentAvatar';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const InfoRow: React.FC<{ label: string; value?: string | React.ReactNode }> = ({ label, value }) => (
  <div className='flex flex-col gap-4px py-12px border-b border-border-2 last:border-b-0'>
    <span className='text-11px font-semibold uppercase tracking-wider text-t-secondary'>{label}</span>
    <span className='text-14px text-t-primary'>{value ?? '—'}</span>
  </div>
);

const UserProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const displayName = user?.username ?? t('common.agents.user.defaultName');
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className='size-full overflow-y-auto'>
      <div className='px-12px md:px-40px py-32px mx-auto w-full md:max-w-800px'>
        {/* Header */}
        <div className='flex items-start gap-12px mb-28px'>
          <AgentAvatar size={56} avatarEmoji={initial} avatarBgColor='var(--color-fill-3)' className='shrink-0' />

          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-18px font-semibold text-t-primary'>{displayName}</span>
              <span className='text-13px text-t-secondary'>({t('common.you', { defaultValue: 'you' })})</span>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className='bg-fill-2 rd-12px px-16px'>
          {user?.username && (
            <InfoRow label={t('common.username', { defaultValue: 'Username' })} value={user.username} />
          )}
          <InfoRow
            label={t('common.role', { defaultValue: 'Role' })}
            value={t('common.userRole', { defaultValue: 'Member' })}
          />
        </div>
      </div>
    </div>
  );
};

export default UserProfilePage;
