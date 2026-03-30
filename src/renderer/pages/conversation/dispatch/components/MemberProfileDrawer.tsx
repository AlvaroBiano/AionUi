/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * G3.5: Member profile drawer.
 * Shows different fields based on memberType (admin/permanent/temporary).
 * Model field is editable (Select component).
 * "Remove from group" button for permanent members.
 */

import { ipcBridge } from '@/common';
import { Button, Drawer, Message, Modal, Select, Tag, Typography } from '@arco-design/web-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChildTaskInfoVO, GroupChatMemberBarItem } from '../types';

type MemberProfileDrawerProps = {
  visible: boolean;
  memberId: string | null;
  members: GroupChatMemberBarItem[];
  childrenInfo: ChildTaskInfoVO[];
  conversationId: string;
  onClose: () => void;
  onModelChange: () => void;
  onRemoveMember: (memberId: string) => void;
};

/** Format elapsed time from a timestamp */
function formatElapsed(startTime: number): string {
  const diff = Date.now() - startTime;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const statusDotClassMap: Record<string, string> = {
  online: 'bg-green-6',
  working: 'bg-blue-6',
  idle: 'bg-gray-6',
  error: 'bg-red-6',
};

const statusLabelMap: Record<string, string> = {
  online: 'dispatch.profile.statusOnline',
  working: 'dispatch.profile.statusWorking',
  idle: 'dispatch.profile.statusIdle',
  error: 'dispatch.profile.statusError',
};

const memberTypeLabelMap: Record<string, string> = {
  admin: 'dispatch.profile.typeAdmin',
  permanent: 'dispatch.profile.typePermanent',
  temporary: 'dispatch.profile.typeTemporary',
};

/** Reusable field label + content row */
const ProfileField: React.FC<{
  label: string;
  value?: string;
  children?: React.ReactNode;
}> = ({ label, value, children }) => (
  <div className='mb-12px'>
    <div className='text-12px text-t-secondary mb-4px'>{label}</div>
    {children || <div className='text-13px text-t-primary'>{value}</div>}
  </div>
);

const MemberProfileDrawer: React.FC<MemberProfileDrawerProps> = ({
  visible,
  memberId,
  members,
  childrenInfo,
  conversationId,
  onClose,
  onModelChange,
  onRemoveMember,
}) => {
  const { t } = useTranslation();
  const [updatingModel, setUpdatingModel] = useState(false);

  // Find member data
  const member = useMemo(() => members.find((m) => m.id === memberId), [members, memberId]);

  // Find child info for non-admin members
  const childInfo = useMemo(
    () => (member?.memberType !== 'admin' ? childrenInfo.find((c) => c.sessionId === memberId) : undefined),
    [childrenInfo, memberId, member?.memberType]
  );

  // Current model name
  const currentModel = childInfo?.modelName || t('dispatch.childModel.default');

  // Handle model change via IPC
  const handleModelChange = useCallback(
    async (newModel: string) => {
      if (!memberId) return;
      setUpdatingModel(true);
      try {
        const result = await ipcBridge.dispatch.updateChildModel.invoke({
          conversationId,
          childSessionId: memberId,
          model: { providerId: '', modelName: newModel },
        });
        if (result.success) {
          Message.success(t('dispatch.profile.modelChangeSuccess'));
          onModelChange();
        } else {
          Message.error(result.msg || t('dispatch.profile.modelChangeFailed'));
        }
      } catch (_err) {
        Message.error(t('dispatch.profile.modelChangeFailed'));
      } finally {
        setUpdatingModel(false);
      }
    },
    [memberId, conversationId, onModelChange, t]
  );

  // Handle remove member with confirmation
  const handleRemove = useCallback(() => {
    if (!member) return;
    Modal.confirm({
      title: t('dispatch.profile.removeConfirmTitle'),
      content: t('dispatch.profile.removeConfirmContent', { name: member.name }),
      okButtonProps: { status: 'danger' },
      onOk: () => {
        onRemoveMember(member.id);
      },
    });
  }, [member, onRemoveMember, t]);

  if (!member) {
    return <Drawer visible={visible} width={320} placement='right' title='' onCancel={onClose} footer={null} />;
  }

  return (
    <Drawer visible={visible} width={320} placement='right' title={member.name} onCancel={onClose} footer={null}>
      {/* Status badge */}
      <div className='flex items-center gap-8px mb-16px'>
        <span className={`w-8px h-8px rd-full flex-shrink-0 ${statusDotClassMap[member.status]}`} />
        <span className='text-13px text-t-secondary'>
          {t(statusLabelMap[member.status])} &mdash; {t(memberTypeLabelMap[member.memberType])}
        </span>
      </div>

      {/* Base Agent (read-only) */}
      {childInfo && (
        <ProfileField label={t('dispatch.profile.baseAgent')} value={childInfo.teammateName || childInfo.title} />
      )}

      {/* Model (editable for non-admin) */}
      <ProfileField label={t('dispatch.profile.model')}>
        {member.memberType !== 'admin' ? (
          <Select
            value={currentModel}
            onChange={handleModelChange}
            size='small'
            loading={updatingModel}
            className='w-full'
          >
            <Select.Option value={currentModel}>{currentModel}</Select.Option>
          </Select>
        ) : (
          <span className='text-13px text-t-primary'>{currentModel}</span>
        )}
      </ProfileField>

      {/* Rules (permanent members only) */}
      {member.memberType === 'permanent' && childInfo?.presetRules && (
        <ProfileField label={t('dispatch.profile.rules')}>
          <Typography.Paragraph ellipsis={{ rows: 3, expandable: true }} className='text-13px text-t-primary mb-0'>
            {childInfo.presetRules}
          </Typography.Paragraph>
        </ProfileField>
      )}

      {/* Rules placeholder if permanent but no rules */}
      {member.memberType === 'permanent' && !childInfo?.presetRules && (
        <ProfileField label={t('dispatch.profile.rules')} value={t('dispatch.profile.noRules')} />
      )}

      {/* Current task + elapsed time */}
      {childInfo && (
        <ProfileField label={t('dispatch.profile.currentTask')}>
          <div className='flex items-center gap-8px'>
            <span className='text-13px text-t-primary truncate flex-1'>{childInfo.title}</span>
            {childInfo.status === 'running' && (
              <Tag size='small' color='arcoblue'>
                {t('dispatch.profile.elapsed', {
                  time: formatElapsed(childInfo.createdAt),
                })}
              </Tag>
            )}
          </div>
        </ProfileField>
      )}

      {/* Workspace */}
      {childInfo?.workspace && (
        <ProfileField
          label={t('dispatch.memberSider.workspace')}
          value={childInfo.workspace.split('/').pop() || childInfo.workspace}
        />
      )}

      {/* Remove button (permanent members only) */}
      {member.memberType === 'permanent' && (
        <Button type='outline' status='danger' long className='mt-24px' onClick={handleRemove}>
          {t('dispatch.profile.removeMember')}
        </Button>
      )}
    </Drawer>
  );
};

export default MemberProfileDrawer;
