// ============================================================
// BianinhoBridge — Type definitions
// ============================================================

export interface BianinhoConfig {
  hermesPath: string;
  aionuiPath: string;
  apiKey: string;
  model: string;
  syncEnabled: boolean;
  adminMode: boolean;
}

export interface BianinhoMessage {
  id: string;
  type: 'user' | 'bianinho' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface BianinhoResponse {
  success: boolean;
  content?: string;
  error?: string;
  toolCalls?: BianinhoToolCall[];
  metadata?: Record<string, unknown>;
}

export interface BianinhoToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface SyncStatus {
  lastSync: number;
  pendingChanges: number;
  direction: 'push' | 'pull' | 'idle';
  errors: string[];
}

export interface BridgeStats {
  uptime: number;
  messagesProcessed: number;
  errors: number;
  lastError?: string;
}

// Platform detection
export type Platform = 'darwin' | 'linux' | 'win32';

export function getPlatform(): Platform {
  const p = process.platform;
  if (p === 'darwin') return 'darwin';
  if (p === 'win32') return 'win32';
  return 'linux';
}

export function getBianinhoPaths() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const platform = getPlatform();

  const base = platform === 'win32'
    ? `${process.env.APPDATA}\\AionUI-Bianinho`
    : `${home}/AionUI-Bianinho`;

  return {
    base,
    hermesPath: `${home}/.hermes`,
    venvPath: `${base}/bianinho-venv`,
    scriptsPath: `${base}/scripts`,
    configPath: `${base}/config`,
    dataPath: `${base}/data`,
    logPath: `${base}/logs`,
  };
}
