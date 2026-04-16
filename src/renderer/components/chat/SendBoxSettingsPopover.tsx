/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Trigger } from '@arco-design/web-react';
import { Setting } from '@icon-park/react';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

type SettingsSection = {
  key: string;
  label: string;
  node: React.ReactNode;
};

/**
 * A gear icon button that opens a settings popup for the send box.
 * Accepts optional model, permission, and config selector nodes.
 * Only sections with a non-null node are rendered.
 */
const SendBoxSettingsPopover: React.FC<{
  modelNode?: React.ReactNode;
  permissionNode?: React.ReactNode;
  configNode?: React.ReactNode;
}> = ({ modelNode, permissionNode, configNode }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  const sections: SettingsSection[] = [
    { key: 'model', label: t('common.model', { defaultValue: '模型' }), node: modelNode },
    { key: 'permission', label: t('agentMode.permission', { defaultValue: '权限' }), node: permissionNode },
    { key: 'config', label: t('acp.config.thought_level', { defaultValue: '配置' }), node: configNode },
  ].filter((s): s is SettingsSection => Boolean(s.node));

  if (sections.length === 0) return null;

  const popup = (
    <div
      className='min-w-220px rounded-8px overflow-hidden'
      style={{
        backgroundColor: 'var(--color-bg-1)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        border: '1px solid var(--color-border-2)',
      }}
    >
      {sections.map((section, i) => (
        <div
          key={section.key}
          className={classNames(
            'flex items-center justify-between gap-16px px-12px py-8px',
            i > 0 && 'border-t border-[var(--color-border-2)]'
          )}
        >
          <span className='text-12px text-t-secondary shrink-0 select-none'>{section.label}</span>
          <div className='flex justify-end min-w-0'>{section.node}</div>
        </div>
      ))}
    </div>
  );

  return (
    <Trigger
      trigger='click'
      position='top'
      popup={() => popup}
      popupVisible={visible}
      onVisibleChange={setVisible}
      popupStyle={{ padding: 0 }}
    >
      <Button type='secondary' shape='circle' icon={<Setting theme='outline' size='14' strokeWidth={2} />} />
    </Trigger>
  );
};

export default SendBoxSettingsPopover;
