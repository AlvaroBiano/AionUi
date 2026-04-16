/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AgentAvatar from '@/renderer/components/AgentAvatar';
import { useUserProfile } from '@/renderer/hooks/user/useUserProfile';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { Input, Message } from '@arco-design/web-react';
import { EditOne } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const UserProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile, save } = useUserProfile();

  const defaultName = t('common.agents.user.defaultName');
  const displayName = profile.displayName ?? defaultName;
  const initial = displayName.charAt(0).toUpperCase();

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setEditValue(profile.displayName ?? '');
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmed = editValue.trim();
      await save({ displayName: trimmed || undefined });
      setEditing(false);
      Message.success(t('common.saveSuccess'));
    } catch {
      Message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
  };

  return (
    <div className='size-full overflow-y-auto'>
      <div className='px-12px md:px-40px py-32px mx-auto w-full md:max-w-800px'>
        {/* Header */}
        <div className='flex items-start gap-12px mb-28px'>
          <AgentAvatar size={56} avatarEmoji={initial} avatarBgColor='var(--color-fill-3)' className='shrink-0' />

          <div className='flex-1 min-w-0'>
            {editing ? (
              <div className='flex items-center gap-8px'>
                <Input
                  autoFocus
                  value={editValue}
                  onChange={setEditValue}
                  onPressEnter={() => void handleSave()}
                  placeholder={defaultName}
                  className='!text-18px !font-semibold'
                  style={{ maxWidth: 220 }}
                  allowClear
                />
                <button
                  className='px-12px py-4px rd-6px text-13px font-medium cursor-pointer transition-opacity hover:opacity-80'
                  style={{ backgroundColor: 'var(--color-text-1)', color: 'var(--color-bg-1)', border: 'none' }}
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {t('common.save')}
                </button>
                <button
                  className='px-12px py-4px rd-6px text-13px font-medium cursor-pointer transition-opacity hover:opacity-80'
                  style={{
                    backgroundColor: 'var(--color-fill-2)',
                    color: 'var(--color-text-1)',
                    border: '1px solid var(--color-border-2)',
                  }}
                  onClick={handleCancel}
                  disabled={saving}
                >
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <div className='flex items-center gap-8px'>
                <span className='text-18px font-semibold text-t-primary'>{displayName}</span>
                <button
                  className='flex-center cursor-pointer p-4px rd-4px hover:bg-fill-3 transition-colors text-t-secondary'
                  style={{ border: 'none', backgroundColor: 'transparent' }}
                  onClick={startEdit}
                  title={t('common.edit')}
                >
                  <EditOne theme='outline' size={16} fill='currentColor' />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        {user?.username && (
          <div className='bg-fill-2 rd-12px px-16px'>
            <div className='flex flex-col gap-4px py-12px'>
              <span className='text-11px font-semibold uppercase tracking-wider text-t-secondary'>
                {t('common.username')}
              </span>
              <span className='text-14px text-t-primary'>{user.username}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfilePage;
