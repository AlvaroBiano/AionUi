// src/renderer/pages/team/hooks/useTeamList.ts
import { ipcBridge } from '@/common';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import type { TTeam } from '@/common/types/teamTypes';
import { useCallback, useEffect } from 'react';
import useSWR from 'swr';

export function useTeamList() {
  const { user } = useAuth();
  const userId = user?.id ?? 'system_default_user';

  const { data: teams = [], mutate } = useSWR<TTeam[]>(
    `teams/${userId}`,
    () => ipcBridge.team.list.invoke({ userId }).then((data) => {
      // Defensive: ensure the IPC call always returns an array
      if (Array.isArray(data)) return data;
      // If backend returns an error object, return empty array
      console.warn('[useTeamList] IPC returned non-array:', data);
      return [];
    }),
    { revalidateOnFocus: false }
  );

  // Refresh list when backend creates/removes a team (e.g. via MCP)
  useEffect(() => {
    return ipcBridge.team.listChanged.on(() => {
      void mutate();
    });
  }, [mutate]);

  const removeTeam = useCallback(
    async (id: string) => {
      await ipcBridge.team.remove.invoke({ id });
      localStorage.removeItem(`team-active-slot-${id}`);
      await mutate();
    },
    [mutate]
  );

  return { teams, mutate, removeTeam };
}
