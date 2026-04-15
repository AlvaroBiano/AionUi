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
   * When both avatarSrc and avatarBgColor are provided, the image is displayed
   * at 75% scale on top of the tinted background so each agent has a visually
   * distinct colour. When only avatarSrc is provided (e.g. portrait photos),
   * the image fills the full circle.
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
 * Rendering rules:
 * - image + color  → logo at 75% centred on tinted background (brand identity)
 * - image only     → portrait/logo fills the circle (no tint)
 * - emoji + color  → emoji centred on tinted background
 * - fallback       → Robot icon on neutral fill
 */
const AgentAvatar: React.FC<AgentAvatarProps> = ({ size, avatarSrc, avatarEmoji, avatarBgColor, className, style }) => {
  const iconSize = Math.round(size * 0.5);
  const emojiSize = Math.round(size * 0.7);
  // Scale border-radius proportionally so all avatar sizes look visually consistent.
  // 20px → 6px (30%), 32px → 10px, 64px → 19px, etc.
  const borderRadius = Math.round(size * 0.3);

  const hasImage = Boolean(avatarSrc);
  const hasColor = Boolean(avatarBgColor);

  let bgStyle: React.CSSProperties;
  if (hasColor) {
    bgStyle = { background: avatarBgColor };
  } else if (hasImage) {
    bgStyle = { background: 'var(--color-fill-2)', border: '1px solid var(--color-border-2)' };
  } else {
    bgStyle = { background: 'var(--color-fill-2)', border: '1px solid var(--color-border-2)' };
  }

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
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
