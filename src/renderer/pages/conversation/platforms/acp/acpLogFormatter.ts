import { resolveAcpDisplayName } from '@/renderer/pages/conversation/utils/resolveConversationBackend';
import type { AcpLogEntry } from './acpRuntimeDiagnostics';

export const formatAcpLogEntry = (
  entry: AcpLogEntry,
  t: (key: string, options?: Record<string, unknown>) => string
): { summary: string; detail?: string } => {
  const displayName = resolveAcpDisplayName(entry.backend ?? '', entry.agentName);
  const modelId = entry.modelId || 'unknown';
  const duration = entry.durationMs ?? 0;

  switch (entry.kind) {
    case 'request_started':
      return {
        summary: t('acp.logs.requestStarted', {
          backend: displayName,
          model: modelId,
        }),
      };
    case 'first_response':
      return {
        summary: t('acp.logs.firstResponse', {
          backend: displayName,
          model: modelId,
          duration,
        }),
      };
    case 'request_finished':
      return {
        summary: t('acp.logs.requestFinished', {
          backend: displayName,
          model: modelId,
          duration,
        }),
      };
    case 'request_error':
      return {
        summary: t('acp.logs.requestErrored', {
          backend: displayName,
          model: modelId,
          duration,
        }),
        detail:
          entry.detail ||
          (entry.disconnectCode !== undefined || entry.disconnectSignal !== undefined
            ? t('acp.logs.disconnectReason', {
                code: entry.disconnectCode ?? '-',
                signal: entry.disconnectSignal ?? '-',
              })
            : undefined),
      };
    case 'send_failed':
      return {
        summary: t('acp.logs.sendFailed', { agent: displayName }),
        detail: entry.detail,
      };
    case 'auth_requested':
      return {
        summary: t('acp.logs.authRequested', { agent: displayName }),
      };
    case 'auth_ready':
      return {
        summary: t('acp.logs.authReady', { agent: displayName }),
      };
    case 'auth_failed':
      return {
        summary: t('acp.logs.authFailed', { agent: displayName }),
        detail: entry.detail,
      };
    case 'retry_requested':
      return {
        summary: t('acp.logs.retryRequested', { agent: displayName }),
      };
    case 'retry_ready':
      return {
        summary: t('acp.logs.retryReady', { agent: displayName }),
      };
    case 'retry_failed':
      return {
        summary: t('acp.logs.retryFailed', { agent: displayName }),
        detail: entry.detail,
      };
    case 'send_now_requested':
      return {
        summary: t('acp.logs.sendNowRequested', { agent: displayName }),
      };
    case 'cancel_requested':
      return {
        summary: t('acp.logs.cancelRequested'),
      };
    case 'status':
      if (!entry.status) {
        return {
          summary: t('acp.status.unknown'),
        };
      }

      if (entry.status === 'error') {
        return {
          summary: t('acp.status.error'),
          detail:
            entry.detail ||
            (entry.disconnectCode !== undefined || entry.disconnectSignal !== undefined
              ? t('acp.logs.disconnectReason', {
                  code: entry.disconnectCode ?? '-',
                  signal: entry.disconnectSignal ?? '-',
                })
              : undefined),
        };
      }

      return {
        summary: t(`acp.status.${entry.status}`, { agent: displayName }),
        detail:
          entry.status === 'disconnected'
            ? t('acp.logs.disconnectReason', {
                code: entry.disconnectCode ?? '-',
                signal: entry.disconnectSignal ?? '-',
              })
            : undefined,
      };
  }
};
