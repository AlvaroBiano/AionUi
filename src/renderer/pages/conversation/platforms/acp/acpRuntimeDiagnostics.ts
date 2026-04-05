import { useCallback, useSyncExternalStore } from 'react';

export type AcpRuntimeStatus =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'session_active'
  | 'auth_required'
  | 'disconnected'
  | 'error';

export type AcpRuntimeStatusSource = 'live' | 'hydrated';
export type AcpRuntimeActivityPhase = 'idle' | 'waiting' | 'streaming';

export type AcpLogLevel = 'info' | 'success' | 'warning' | 'error';

export type AcpLogEntry = {
  id: string;
  kind:
    | 'status'
    | 'request_started'
    | 'first_response'
    | 'request_finished'
    | 'request_error'
    | 'send_failed'
    | 'auth_requested'
    | 'auth_ready'
    | 'auth_failed'
    | 'retry_requested'
    | 'retry_ready'
    | 'retry_failed'
    | 'send_now_requested'
    | 'cancel_requested';
  level: AcpLogLevel;
  timestamp: number;
  source: 'live' | 'hydrated' | 'ui';
  backend?: string;
  modelId?: string;
  sessionMode?: string;
  agentName?: string;
  status?: AcpRuntimeStatus;
  durationMs?: number;
  disconnectCode?: number | null;
  disconnectSignal?: string | null;
  detail?: string;
};

export type AcpRuntimeDiagnosticsSnapshot = {
  status: AcpRuntimeStatus | null;
  statusSource: AcpRuntimeStatusSource | null;
  statusRevision: number;
  activityPhase: AcpRuntimeActivityPhase;
  hasThinkingMessage?: boolean;
  logs: AcpLogEntry[];
};

const EMPTY_ACP_RUNTIME_DIAGNOSTICS_SNAPSHOT: AcpRuntimeDiagnosticsSnapshot = Object.freeze({
  status: null,
  statusSource: null,
  statusRevision: 0,
  activityPhase: 'idle',
  hasThinkingMessage: false,
  logs: [],
});

const acpRuntimeDiagnosticsStore = new Map<string, AcpRuntimeDiagnosticsSnapshot>();
const acpRuntimeDiagnosticsListeners = new Map<string, Set<() => void>>();

export const readAcpRuntimeDiagnosticsSnapshot = (conversationId: string): AcpRuntimeDiagnosticsSnapshot => {
  return acpRuntimeDiagnosticsStore.get(conversationId) ?? EMPTY_ACP_RUNTIME_DIAGNOSTICS_SNAPSHOT;
};

const emitAcpRuntimeDiagnosticsSnapshot = (conversationId: string): void => {
  for (const listener of acpRuntimeDiagnosticsListeners.get(conversationId) ?? []) {
    listener();
  }
};

export const publishAcpRuntimeDiagnosticsSnapshot = (
  conversationId: string,
  snapshot: AcpRuntimeDiagnosticsSnapshot
): void => {
  const currentSnapshot = acpRuntimeDiagnosticsStore.get(conversationId);
  if (
    currentSnapshot &&
    currentSnapshot.status === snapshot.status &&
    currentSnapshot.statusSource === snapshot.statusSource &&
    currentSnapshot.statusRevision === snapshot.statusRevision &&
    currentSnapshot.activityPhase === snapshot.activityPhase &&
    Boolean(currentSnapshot.hasThinkingMessage) === Boolean(snapshot.hasThinkingMessage) &&
    currentSnapshot.logs === snapshot.logs
  ) {
    return;
  }

  if (
    snapshot.status === null &&
    snapshot.statusSource === null &&
    snapshot.statusRevision === 0 &&
    snapshot.activityPhase === 'idle' &&
    !snapshot.hasThinkingMessage &&
    snapshot.logs.length === 0
  ) {
    acpRuntimeDiagnosticsStore.delete(conversationId);
  } else {
    acpRuntimeDiagnosticsStore.set(conversationId, snapshot);
  }

  emitAcpRuntimeDiagnosticsSnapshot(conversationId);
};

export const clearAcpRuntimeDiagnosticsSnapshot = (conversationId: string): void => {
  if (!acpRuntimeDiagnosticsStore.has(conversationId)) {
    return;
  }

  acpRuntimeDiagnosticsStore.delete(conversationId);
  emitAcpRuntimeDiagnosticsSnapshot(conversationId);
};

const subscribeAcpRuntimeDiagnosticsSnapshot = (conversationId: string, listener: () => void): (() => void) => {
  const listeners = acpRuntimeDiagnosticsListeners.get(conversationId) ?? new Set<() => void>();
  listeners.add(listener);
  acpRuntimeDiagnosticsListeners.set(conversationId, listeners);

  return () => {
    const currentListeners = acpRuntimeDiagnosticsListeners.get(conversationId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      acpRuntimeDiagnosticsListeners.delete(conversationId);
    }
  };
};

export const useAcpRuntimeDiagnostics = (conversationId: string): AcpRuntimeDiagnosticsSnapshot => {
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribeAcpRuntimeDiagnosticsSnapshot(conversationId, listener),
      [conversationId]
    ),
    useCallback(() => readAcpRuntimeDiagnosticsSnapshot(conversationId), [conversationId]),
    () => EMPTY_ACP_RUNTIME_DIAGNOSTICS_SNAPSHOT
  );
};
