/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Robot } from '@icon-park/react';
import React from 'react';

type AgentAvatarProps = {
  /** Diameter of the circular avatar in px */
  size: number;
  /** Resolved image URL (takes priority over emoji) */
  avatarSrc?: string | null;
  /** Emoji character shown when no image is available */
  avatarEmoji?: string | null;
  /**
   * Background color (any CSS color, e.g. "hsl(14 72% 85%)").
   * Only applied when there is no image avatar (emoji or Robot fallback).
   * When omitted, falls back to the default neutral background.
   */
  avatarBgColor?: string;
  /** @deprecated Use avatarBgColor instead */
  colorSeed?: string;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Circular agent/assistant avatar that scales proportionally.
 * Priority: image → emoji → Robot icon fallback.
 *
 * When `avatarBgColor` is set and there is no image, the background uses
 * the provided color so each agent has a unique, stable tint.
 */
const AgentAvatar: React.FC<AgentAvatarProps> = ({ size, avatarSrc, avatarEmoji, avatarBgColor, className, style }) => {
  const iconSize = Math.round(size * 0.5);
  const emojiSize = Math.round(size * 0.7);

  const hasImage = Boolean(avatarSrc);
  const useTint = !hasImage && Boolean(avatarBgColor);

  const bgStyle: React.CSSProperties = hasImage
    ? { background: 'var(--color-bg-2)', border: '1.5px solid var(--color-border-3)' }
    : useTint
      ? { background: avatarBgColor, border: 'none' }
      : { background: 'var(--color-fill-2)', border: '1px solid var(--color-border-2)' };

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
        flexShrink: 0,
        boxSizing: 'border-box',
        ...bgStyle,
        ...style,
      }}
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt=''
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            borderRadius: '50%',
          }}
        />
      ) : avatarEmoji ? (
        <span style={{ fontSize: emojiSize, lineHeight: 1, userSelect: 'none' }}>{avatarEmoji}</span>
      ) : (
        <Robot theme='outline' size={iconSize} fill='currentColor' />
      )}
    </span>
  );
};

export default AgentAvatar;
