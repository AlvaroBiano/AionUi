/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Setting } from '@icon-park/react';
import classNames from 'classnames';
import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type SettingsSection = {
  key: string;
  label: string;
  node: React.ReactNode;
};

// Z-index layers for the settings popup.
// Arco Design inner dropdowns render at z-1000; the popup wrapper must sit below
// that to avoid capturing their portal clicks, while the click-outside overlay
// must sit below the popup so its own children stay on top.
const POPUP_ZINDEX = 999; // popup stacking context — above UI chrome, below Arco dropdowns
const OVERLAY_ZINDEX = 998; // click-outside catcher — below popup, above rest of UI

type PopupPos = { bottom: number; right: number };

/**
 * A gear icon button that opens a settings popup for the send box.
 * Accepts optional model, permission, and config selector nodes.
 * Only sections with a non-null node are rendered.
 *
 * Uses portal-based rendering for both the popup and the click-outside overlay
 * so that the popup escapes any overflow:hidden ancestor (sendbox-panel switches
 * between overflow-hidden / overflow-visible depending on command-menu state,
 * which would otherwise clip the absolute bottom-full popup).
 */
const SendBoxSettingsPopover: React.FC<{
  modelNode?: React.ReactNode;
  permissionNode?: React.ReactNode;
  configNode?: React.ReactNode;
}> = ({ modelNode, permissionNode, configNode }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [popupPos, setPopupPos] = useState<PopupPos | null>(null);
  const buttonRef = useRef<HTMLElement | null>(null);

  const sections: SettingsSection[] = [
    { key: 'model', label: t('common.model', { defaultValue: '模型' }), node: modelNode },
    { key: 'permission', label: t('agentMode.permission', { defaultValue: '权限' }), node: permissionNode },
    { key: 'config', label: t('acp.config.thought_level', { defaultValue: '配置' }), node: configNode },
  ].filter((s): s is SettingsSection => Boolean(s.node));

  if (sections.length === 0) return null;

  const handleToggle = useCallback(() => {
    if (!visible && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopupPos({
        bottom: window.innerHeight - rect.top + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setVisible((v) => !v);
  }, [visible]);

  return (
    <div className='relative'>
      <Button
        ref={buttonRef as React.Ref<unknown>}
        type='secondary'
        shape='circle'
        data-testid='sendbox-settings-btn'
        icon={<Setting theme='outline' size='14' strokeWidth={2} />}
        onClick={handleToggle}
      />

      {visible &&
        popupPos &&
        createPortal(
          <>
            {/* Click-outside overlay at OVERLAY_ZINDEX (below Arco inner dropdowns at z-1000) */}
            <div className='fixed inset-0' style={{ zIndex: OVERLAY_ZINDEX }} onClick={() => setVisible(false)} />

            {/* Settings popup — portal-rendered with fixed positioning to escape overflow:hidden */}
            <div
              data-testid='sendbox-settings-popup'
              className='fixed min-w-220px rounded-8px overflow-hidden'
              style={{
                zIndex: POPUP_ZINDEX,
                bottom: `${popupPos.bottom}px`,
                right: `${popupPos.right}px`,
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
          </>,
          document.body
        )}
    </div>
  );
};

export default SendBoxSettingsPopover;
