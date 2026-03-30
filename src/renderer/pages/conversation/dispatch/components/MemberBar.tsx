/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import { Crown, People, Plus } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { MemberBarProps } from '../types';

const statusColorMap: Record<string, string> = {
  online: 'bg-green-6',
  working: 'bg-blue-6',
  idle: 'bg-gray-6',
  error: 'bg-red-6',
};

const MemberBar: React.FC<MemberBarProps> = ({ members, onMemberClick, onAddMemberClick }) => {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-4px px-16px py-6px border-b border-bd-primary overflow-x-auto flex-shrink-0'>
      {members.map((member) => (
        <Tooltip key={member.id} content={member.name}>
          <div className='relative cursor-pointer flex-shrink-0' onClick={() => onMemberClick(member.id)}>
            {/* Avatar circle (32px) */}
            <div className='w-32px h-32px rd-full flex-center bg-fill-2 text-14px'>
              {member.avatar ? <span>{member.avatar}</span> : <People size='16' />}
            </div>
            {/* Status dot (absolute, bottom-right) */}
            <span
              className={classNames(
                'absolute bottom-0 right-0 w-8px h-8px rd-full border-2 border-bg-1',
                statusColorMap[member.status]
              )}
            />
            {/* Crown badge for admin */}
            {member.memberType === 'admin' && (
              <Crown theme='filled' size={10} className='absolute top--2px right--2px text-warning-6' />
            )}
          </div>
        </Tooltip>
      ))}
      {/* [+] Add member button */}
      <Tooltip content={t('dispatch.memberBar.addMember')}>
        <div
          className='w-32px h-32px rd-full flex-center bg-fill-2 cursor-pointer hover:bg-fill-3 transition-colors flex-shrink-0'
          onClick={onAddMemberClick}
        >
          <Plus size='14' />
        </div>
      </Tooltip>
    </div>
  );
};

export default MemberBar;
