/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Shared section wrapper used across agent detail pages (Local, Remote, Assistant).
 * Renders a labelled card with a gray-fill rounded container.
 */
export const AgentConfigSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className='mb-20px'>
    <h3 className='text-13px font-semibold text-t-secondary uppercase tracking-wider mb-8px px-4px'>{title}</h3>
    <div className='bg-fill-2 rd-12px px-16px py-4px'>{children}</div>
  </div>
);

/**
 * Shared row inside an AgentConfigSection.
 * Left: label + optional hint. Right: control slot.
 */
export const AgentConfigRow: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
  mono?: boolean;
}> = ({ label, hint, children, mono }) => (
  <div className='flex items-center justify-between gap-16px py-12px border-b border-border-2 last:border-b-0'>
    <div className='flex flex-col gap-2px min-w-0'>
      <span className={`text-14px text-t-primary${mono ? ' font-mono' : ''}`}>{label}</span>
      {hint && <span className='text-12px text-t-secondary'>{hint}</span>}
    </div>
    <div className='shrink-0'>{children}</div>
  </div>
);
