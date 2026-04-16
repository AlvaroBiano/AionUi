/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { resolveAgentKey } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import { emitter } from '@/renderer/utils/emitter';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Returns a function that navigates to the most recent conversation for a given
 * agentKey, or falls back to /guid?agent=<agentKey> if none exists.
 *
 * agentKey formats:
 *   - Local backends:  'aionrs' | 'gemini' | 'claude-code' | ...
 *   - Remote agents:   'remote:<id>'
 *   - Custom/preset:   'custom:<id>'
 */
export const useNavigateToAgent = () => {
  const navigate = useNavigate();
  const { conversations } = useConversationHistoryContext();

  return useCallback(
    (agentKey: string) => {
      // Remote agents are stored in conversations with resolveAgentKey returning
      // 'custom:<id>', so remap the lookup key accordingly.
      const lookupKey = agentKey.startsWith('remote:') ? `custom:${agentKey.slice(7)}` : agentKey;

      // Gemini-based preset assistants: resolveAgentKey returns the raw presetAssistantId
      // (e.g. 'builtin-word-creator'), but our lookupKey is 'custom:builtin-word-creator'.
      // Strip the 'custom:' prefix for a secondary match so we can find those conversations too.
      const geminiLookupKey = lookupKey.startsWith('custom:') ? lookupKey.slice(7) : null;

      // Find the most recent conversation for this agent (exclude team conversations)
      const match = conversations
        .filter((c) => {
          if ((c.extra as { teamId?: string } | undefined)?.teamId) return false;
          const resolved = resolveAgentKey(c);
          return resolved === lookupKey || (geminiLookupKey !== null && resolved === geminiLookupKey);
        })
        .sort((a, b) => (b.modifyTime ?? 0) - (a.modifyTime ?? 0))[0];

      emitter.emit('sider.tab.switch', 'messages');
      if (match) {
        void navigate(`/conversation/${match.id}`);
      } else {
        void navigate(`/guid?agent=${encodeURIComponent(agentKey)}`);
      }
    },
    [conversations, navigate]
  );
};
