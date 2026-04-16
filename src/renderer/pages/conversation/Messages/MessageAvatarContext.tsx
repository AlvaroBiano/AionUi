/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';

export type MessageAvatarInfo = {
  /** Image URL or emoji string for the agent avatar */
  agentLogo: string;
  /** Whether agentLogo is an emoji (true) or image URL (false) */
  agentLogoIsEmoji: boolean;
  /** Display name of the agent */
  agentName: string;
} | null;

const MessageAvatarContext = createContext<MessageAvatarInfo>(null);

export const MessageAvatarProvider = MessageAvatarContext.Provider;

export const useMessageAvatar = (): MessageAvatarInfo => useContext(MessageAvatarContext);
