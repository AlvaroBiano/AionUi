/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Setting } from '@icon-park/react';
import classNames from 'classnames';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
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
 *
 * Uses a portal-based overlay (z-998) to detect click-outside without
 * interfering with child Dropdown portals (z-1000), which would cause
 * the nested Trigger+Dropdown nesting bug where clicking a child dropdown
 * item closes the parent popup before the action can fire.
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

  return (
    // z-999 stacking context ensures button+popup sit above the z-998 overlay,
    // while Arco inner dropdowns at z-1000 remain on top of everything.
    <div className='relative' style={visible ? { zIndex: 999 } : undefined}>
      {/* Portal overlay: captures click-outside at z-998 (below Arco z-1000 inner popups) */}
      {visible &&
        createPortal(
          <div className='fixed inset-0' style={{ zIndex: 998 }} onClick={() => setVisible(false)} />,
          document.body
        )}

      <Button
        type='secondary'
        shape='circle'
        icon={<Setting theme='outline' size='14' strokeWidth={2} />}
        onClick={() => setVisible((v) => !v)}
      />

      {visible && (
        <div
          className='absolute bottom-full mb-4px right-0 min-w-220px rounded-8px overflow-hidden'
          style={{
            zIndex: 1,
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
      )}
    </div>
  );
};

export default SendBoxSettingsPopover;
