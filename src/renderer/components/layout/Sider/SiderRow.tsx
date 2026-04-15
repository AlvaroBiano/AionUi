/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';

export type SiderRowProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** 1 = first-level nav item (px-10px gap-8px); 2 = second-level contact item (pl-48px, icon absolute) */
  level?: 1 | 2;
  icon: React.ReactNode;
  label?: React.ReactNode;
  isActive?: boolean;
  /** 'primary' = subtle primary tint; 'active' = bg-active token (default) */
  activeStyle?: 'primary' | 'active';
  collapsed?: boolean;
  /** Show hover background even without an onClick handler (e.g. placeholder nav items) */
  hoverable?: boolean;
  children?: React.ReactNode;
};

const SiderRow = React.forwardRef<HTMLDivElement, SiderRowProps>(
  (
    {
      level = 1,
      icon,
      label,
      isActive = false,
      activeStyle = 'active',
      collapsed = false,
      hoverable = false,
      className,
      style,
      onClick,
      onContextMenu,
      children,
      ...rest
    },
    ref
  ) => {
    const canHover = Boolean(onClick) || hoverable;

    const interactiveClass = isActive
      ? activeStyle === 'primary'
        ? 'bg-[rgba(var(--primary-6),0.12)] text-primary'
        : '!bg-active'
      : canHover
        ? activeStyle === 'primary'
          ? 'hover:bg-fill-3 active:bg-fill-4'
          : 'hover:bg-fill-3'
        : '';

    const cursorClass = onClick ? 'cursor-pointer' : 'cursor-default';

    if (collapsed) {
      return (
        <div
          ref={ref}
          className={classNames(
            'relative h-30px w-full flex items-center justify-center rd-8px transition-colors text-t-primary',
            cursorClass,
            interactiveClass,
            className
          )}
          style={style}
          onClick={onClick}
          onContextMenu={onContextMenu}
          {...rest}
        >
          {icon}
          {children}
        </div>
      );
    }

    if (level === 2) {
      return (
        <div
          ref={ref}
          className={classNames(
            'relative h-30px rd-8px flex items-center pl-48px pr-10px shrink-0 min-w-0 transition-colors group text-t-primary',
            cursorClass,
            interactiveClass,
            className
          )}
          style={style}
          onClick={onClick}
          onContextMenu={onContextMenu}
          {...rest}
        >
          <span className='absolute left-20px top-1/2 -translate-y-1/2 flex items-center justify-center'>{icon}</span>
          {label !== undefined && (
            <span className='text-13px font-medium truncate flex-1 min-w-0 select-none text-t-primary'>{label}</span>
          )}
          {children}
        </div>
      );
    }

    // Level 1 expanded
    return (
      <div
        ref={ref}
        className={classNames(
          'relative box-border h-30px w-full flex items-center justify-start gap-8px px-10px rd-8px shrink-0 transition-colors group text-t-primary',
          cursorClass,
          interactiveClass,
          className
        )}
        style={style}
        onClick={onClick}
        onContextMenu={onContextMenu}
        {...rest}
      >
        <span className='size-18px flex items-center justify-center shrink-0'>{icon}</span>
        {label !== undefined && (
          <span className='collapsed-hidden text-t-primary text-13px font-medium leading-24px flex-1 min-w-0 truncate'>
            {label}
          </span>
        )}
        {children}
      </div>
    );
  }
);

SiderRow.displayName = 'SiderRow';

export default SiderRow;
