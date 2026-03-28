/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useCallback, useEffect, useState } from 'react';

/**
 * Check whether a teammate name already exists in acp.customAgents.
 * Uses ipcBridge.acpConversation.getAvailableAgents to read the list.
 */
export function useIsSavedTeammate(teammateName?: string): {
  isSaved: boolean;
  isChecking: boolean;
  recheck: () => void;
} {
  const [isSaved, setIsSaved] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const check = useCallback(() => {
    if (!teammateName) {
      setIsSaved(false);
      return;
    }

    setIsChecking(true);
    ipcBridge.acpConversation.getAvailableAgents
      .invoke()
      .then((res) => {
        if (res.success && res.data) {
          const exists = res.data.some((agent) => agent.name === teammateName);
          setIsSaved(exists);
        }
      })
      .catch(() => {
        // Silently fail - default to not saved
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, [teammateName]);

  useEffect(() => {
    check();
  }, [check]);

  return { isSaved, isChecking, recheck: check };
}
