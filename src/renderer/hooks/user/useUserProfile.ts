/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/config/storage';
import { useCallback } from 'react';
import useSWR from 'swr';

export type UserProfile = { displayName?: string };

export const useUserProfile = () => {
  const { data, mutate } = useSWR('user.profile', () => ConfigStorage.get('user.profile'));

  const save = useCallback(
    async (patch: Partial<UserProfile>) => {
      const current = (await ConfigStorage.get('user.profile')) ?? {};
      const updated = { ...current, ...patch };
      await ConfigStorage.set('user.profile', updated);
      await mutate(updated, false);
    },
    [mutate]
  );

  return { profile: data ?? {}, save };
};
