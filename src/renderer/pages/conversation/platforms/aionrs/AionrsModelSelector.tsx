/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AionrsModelSelection } from './useAionrsModelSelection';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getModelDisplayLabel } from '@/renderer/utils/model/agentLogo';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Down, Plus } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';

const AionrsModelSelector: React.FC<{
  selection?: AionrsModelSelection;
  disabled?: boolean;
  variant?: 'header' | 'settings';
}> = ({ selection, disabled = false, variant = 'header' }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isOpen: isPreviewOpen } = usePreviewContext();
  const layout = useLayoutContext();
  const compact = variant === 'header' && (isPreviewOpen || layout?.isMobile);
  const isMobileHeaderCompact = variant === 'header' && Boolean(layout?.isMobile);
  const defaultModelLabel = t('common.defaultModel');

  const { data: modelConfig } = useSWR<IProvider[]>('model.config', () => ipcBridge.mode.getModelConfig.invoke());

  const currentModel = selection?.currentModel;
  const currentModelHealth = useMemo(() => {
    if (!currentModel || !modelConfig) return { status: 'unknown', color: 'bg-gray-400' };
    const matchedProvider = modelConfig.find((p) => p.id === currentModel.id);
    const healthStatus = matchedProvider?.modelHealth?.[currentModel.useModel]?.status || 'unknown';
    const healthColor =
      healthStatus === 'healthy' ? 'bg-green-500' : healthStatus === 'unhealthy' ? 'bg-red-500' : 'bg-gray-400';
    return { status: healthStatus, color: healthColor };
  }, [currentModel, modelConfig]);

  if (disabled || !selection) {
    return (
      <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
        <Button
          className={classNames(
            'sendbox-model-btn header-model-btn',
            compact && '!max-w-[120px]',
            isMobileHeaderCompact && '!max-w-[160px]'
          )}
          shape='round'
          size='small'
          style={{ cursor: 'default' }}
        >
          <span className='flex items-center gap-6px min-w-0'>
            <span className={compact ? 'block truncate' : undefined}>{t('conversation.welcome.useCliModel')}</span>
          </span>
        </Button>
      </Tooltip>
    );
  }

  const { providers, getAvailableModels, handleSelectModel } = selection;

  const label = getModelDisplayLabel({
    selectedValue: currentModel?.useModel,
    selectedLabel: currentModel?.useModel || '',
    defaultModelLabel,
    fallbackLabel: t('conversation.welcome.selectModel'),
  });

  const droplist = (
    <Menu>
      {providers.map((provider) => {
        const models = getAvailableModels(provider);
        if (!models.length) return null;

        return (
          <Menu.ItemGroup title={provider.name} key={provider.id}>
            {models.map((modelName) => {
              const matchedProvider = modelConfig?.find((p) => p.id === provider.id);
              const healthStatus = matchedProvider?.modelHealth?.[modelName]?.status || 'unknown';
              const healthColor =
                healthStatus === 'healthy'
                  ? 'bg-green-500'
                  : healthStatus === 'unhealthy'
                    ? 'bg-red-500'
                    : 'bg-gray-400';

              return (
                <Menu.Item
                  key={`${provider.id}-${modelName}`}
                  className={currentModel?.id + currentModel?.useModel === provider.id + modelName ? '!bg-2' : ''}
                  onClick={() => void handleSelectModel(provider, modelName)}
                >
                  <div className='flex items-center gap-8px w-full'>
                    {healthStatus !== 'unknown' && (
                      <div className={`w-6px h-6px rounded-full shrink-0 ${healthColor}`} />
                    )}
                    <span>{modelName}</span>
                  </div>
                </Menu.Item>
              );
            })}
          </Menu.ItemGroup>
        );
      })}
      <Menu.Item
        key='add-model'
        className='text-12px text-t-secondary'
        onClick={() => void navigate('/settings/model')}
      >
        <Plus theme='outline' size='12' />
        {t('settings.addModel')}
      </Menu.Item>
    </Menu>
  );

  const triggerButton =
    variant === 'settings' ? (
      <Button type='secondary' className='min-w-160px flex items-center justify-between gap-8px'>
        <div className='flex items-center gap-8px min-w-0'>
          {currentModelHealth.status !== 'unknown' && (
            <div className={`w-6px h-6px rounded-full shrink-0 ${currentModelHealth.color}`} />
          )}
          <span className='truncate'>{label}</span>
        </div>
        <Down theme='outline' size={14} />
      </Button>
    ) : (
      <Button
        className={classNames(
          'sendbox-model-btn header-model-btn',
          compact && '!max-w-[120px]',
          isMobileHeaderCompact && '!max-w-[160px]'
        )}
        shape='round'
        size='small'
      >
        <span className='flex items-center gap-6px min-w-0'>
          {currentModelHealth.status !== 'unknown' && (
            <div className={`w-6px h-6px rounded-full shrink-0 ${currentModelHealth.color}`} />
          )}
          <span className={compact ? 'block truncate' : undefined}>{label}</span>
        </span>
      </Button>
    );

  return (
    <Dropdown trigger='click' position={variant === 'settings' ? 'br' : undefined} droplist={droplist}>
      {triggerButton}
    </Dropdown>
  );
};

export default AionrsModelSelector;
