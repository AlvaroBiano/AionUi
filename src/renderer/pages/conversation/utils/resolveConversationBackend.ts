import type { TChatConversation } from '@/common/config/storage';
import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import type { AcpBackendAll } from '@/common/types/acpTypes';

/**
 * Resolve a human-readable display name for an ACP backend.
 * Prefers the explicit agentName, then the backend's registered name, then a capitalized fallback.
 */
export const resolveAcpDisplayName = (backend: string, agentName?: string): string =>
  agentName ||
  ACP_BACKENDS_ALL[backend as keyof typeof ACP_BACKENDS_ALL]?.name ||
  backend.charAt(0).toUpperCase() + backend.slice(1);

export const resolveConversationBackend = (conversation?: TChatConversation): AcpBackendAll | undefined => {
  if (!conversation) {
    return undefined;
  }

  switch (conversation.type) {
    case 'acp':
      return conversation.extra?.backend || 'claude';
    case 'aionrs':
      return 'aionrs';
    case 'codex':
      return 'codex';
    case 'openclaw-gateway':
      return 'openclaw-gateway';
    case 'nanobot':
      return 'nanobot';
    case 'remote':
      return 'remote';
    default:
      return undefined;
  }
};
