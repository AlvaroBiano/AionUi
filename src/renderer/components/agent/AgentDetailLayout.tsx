/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

type AgentDetailLayoutProps = {
  /** Rendered before the scrollable content area (e.g. Arco Message contextHolder). */
  prefix?: React.ReactNode;
  /** Rendered after the scrollable content area (e.g. modal components). */
  suffix?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Shared scroll wrapper used across all agent detail pages
 * (Local, Remote, Assistant). Provides a full-height scrollable outer div
 * with a centered, max-width inner content area.
 */
const AgentDetailLayout: React.FC<AgentDetailLayoutProps> = ({ prefix, suffix, children }) => (
  <div className='size-full overflow-y-auto'>
    {prefix}
    <div className='px-12px md:px-40px py-32px mx-auto w-full md:max-w-800px'>{children}</div>
    {suffix}
  </div>
);

export default AgentDetailLayout;
