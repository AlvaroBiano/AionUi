/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Progress } from '@arco-design/web-react';
import { CheckOne, CloseOne, LoadingOne, Round } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Data structure for a task progress card,
 * parsed from ```progress code blocks in admin messages.
 */
export type ProgressCardData = {
  title: string;
  overall: number; // 0-100
  phases: Array<{
    name: string;
    agent?: string;
    status: 'done' | 'running' | 'pending' | 'failed';
    progress?: number;
  }>;
};

/**
 * Parse a message content string for ```progress code blocks.
 * Returns the parsed ProgressCardData or null if no valid progress block found.
 */
export function parseProgressBlock(content: string): ProgressCardData | null {
  // Match ```progress ... ``` blocks
  const regex = /```progress\s*\n([\s\S]*?)```/;
  const match = regex.exec(content);
  if (!match?.[1]) return null;

  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    if (typeof parsed !== 'object' || parsed === null) return null;

    const data = parsed as Record<string, unknown>;

    // Validate required fields
    if (typeof data.title !== 'string') return null;
    if (typeof data.overall !== 'number' || data.overall < 0 || data.overall > 100) return null;
    if (!Array.isArray(data.phases)) return null;

    // Validate phases
    const validStatuses = new Set(['done', 'running', 'pending', 'failed']);
    const phases = (data.phases as unknown[])
      .filter((phase): phase is Record<string, unknown> => typeof phase === 'object' && phase !== null)
      .filter(
        (phase) => typeof phase.name === 'string' && typeof phase.status === 'string' && validStatuses.has(phase.status)
      )
      .map((phase) => ({
        name: phase.name as string,
        agent: typeof phase.agent === 'string' ? phase.agent : undefined,
        status: phase.status as 'done' | 'running' | 'pending' | 'failed',
        progress: typeof phase.progress === 'number' ? phase.progress : undefined,
      }));

    if (phases.length === 0) return null;

    return {
      title: data.title as string,
      overall: Math.round(data.overall as number),
      phases,
    };
  } catch {
    return null;
  }
}

/** Status icon for each phase status */
const PhaseStatusIcon: React.FC<{ status: 'done' | 'running' | 'pending' | 'failed' }> = ({ status }) => {
  switch (status) {
    case 'done':
      return <CheckOne theme='filled' size='16' className='text-green-6' />;
    case 'running':
      return <LoadingOne theme='filled' size='16' className='text-blue-6 animate-spin' />;
    case 'pending':
      return <Round theme='outline' size='16' className='text-t-tertiary' />;
    case 'failed':
      return <CloseOne theme='filled' size='16' className='text-red-6' />;
  }
};

/** Visual card component for task progress reporting */
const ProgressCard: React.FC<{ data: ProgressCardData }> = ({ data }) => {
  const { t } = useTranslation();

  return (
    <div className='bg-fill-2 rounded-8px p-12px'>
      {/* Header: title + overall progress */}
      <div className='flex items-center justify-between mb-8px'>
        <span className='text-14px font-medium text-t-primary'>{data.title}</span>
        <span className='text-12px text-t-secondary'>{t('dispatch.progress.overall', { percent: data.overall })}</span>
      </div>

      {/* Overall progress bar */}
      <Progress
        percent={data.overall}
        showText={false}
        size='small'
        status={data.overall >= 100 ? 'success' : 'normal'}
      />

      {/* Phase list */}
      <div className='mt-8px flex flex-col gap-4px'>
        {data.phases.map((phase) => (
          <div key={phase.name} className='flex items-center gap-8px text-13px'>
            <PhaseStatusIcon status={phase.status} />
            <span className='text-t-primary flex-1 min-w-0 truncate'>{phase.name}</span>
            {phase.agent && <span className='text-t-tertiary text-12px flex-shrink-0'>{phase.agent}</span>}
            {phase.status === 'running' && typeof phase.progress === 'number' && (
              <span className='text-t-secondary text-12px flex-shrink-0'>
                {t('dispatch.progress.phasePercent', { percent: phase.progress })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProgressCard;
