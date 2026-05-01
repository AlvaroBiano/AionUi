/**
 * BianinhoBridge — IPC handlers para o Electron main process
 * Regista handlers para: ping, status, checkHermes, listSkills, etc.
 */

import { ipcMain, app } from 'electron';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { platform } from 'os';

const BRIDGE_PORT = 18743;
const MAX_RETRIES = 2;
const RETRY_DELAY = 300;

// ── Paths ──────────────────────────────────────────────────

function getBasePath(): string {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return app.getAppPath();
}

// ── TCP send helper ───────────────────────────────────────

async function tcpSend(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const payload = JSON.stringify({ cmd, args });
  const encoded = Buffer.from(payload, 'utf-8');

  return new Promise((resolve) => {
    const sock = new net.Socket();
    let connected = false;
    let retries = 0;

    const tryConnect = () => {
      sock.connect(BRIDGE_PORT, '127.0.0.1', () => {
        connected = true;
        sock.write(encoded);
        sock.write('\n');
      });
    };

    let responseData = Buffer.alloc(0);

    sock.on('data', (chunk: Buffer) => {
      responseData = Buffer.concat([responseData, chunk]);
    });

    sock.on('close', () => {
      if (!connected) return;
      try {
        const text = responseData.toString('utf-8').trim();
        if (text) {
          resolve(JSON.parse(text));
        } else {
          resolve({ ok: false, error: 'Empty response from bridge' });
        }
      } catch {
        resolve({ ok: false, error: 'Invalid JSON from bridge' });
      }
    });

    sock.on('error', (err) => {
      if (retries < MAX_RETRIES) {
        retries++;
        setTimeout(tryConnect, RETRY_DELAY);
      } else {
        resolve({ ok: false, error: `Connection failed: ${err.message}` });
      }
    });

    tryConnect();

    // Timeout
    setTimeout(() => {
      if (!connected) {
        sock.destroy();
        resolve({ ok: false, error: 'Bridge connection timeout' });
      }
    }, 5000);
  });
}

// ── Register IPC handlers ──────────────────────────────────

function registerHandlers(): void {
  console.log('[BianinhoBridge] Registering IPC handlers');

  // Auto-start bridge on first call
  startBridgeProcess();
}

// ── Bridge process management ──────────────────────────────

let bridgeProcess: ReturnType<typeof spawn> | null = null;

function getPythonBin(): string {
  const base = getBasePath();
  const venvPython = platform() === 'win32'
    ? path.join(base, 'bianinho-venv', 'Scripts', 'python.exe')
    : path.join(base, 'bianinho-venv', 'bin', 'python3');

  if (fs.existsSync(venvPython)) return venvPython;
  return 'python3';
}

function getBridgeScript(): string {
  const base = getBasePath();
  const scriptPath = path.join(base, 'scripts', 'bianinho_bridge.py');
  if (fs.existsSync(scriptPath)) return scriptPath;
  // Fallback para desenvolvimento
  return path.join(__dirname, '..', '..', 'scripts', 'bianinho_bridge.py');
}

function startBridgeProcess(): void {
  if (bridgeProcess) return;
  const pythonBin = getPythonBin();
  const script = getBridgeScript();

  console.log(`[BianinhoBridge] Starting Python bridge: ${pythonBin} ${script}`);

  bridgeProcess = spawn(pythonBin, [script, String(BRIDGE_PORT)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    detached: true,
  });

  bridgeProcess.stdout?.on('data', (d) => console.log(`[Bridge] ${d.toString().trim()}`));
  bridgeProcess.stderr?.on('data', (d) => console.error(`[Bridge ERR] ${d.toString().trim()}`));
  bridgeProcess.on('exit', (code) => {
    console.warn(`[BianinhoBridge] Process exited with code ${code}`);
    bridgeProcess = null;
  });
}

// ── Register IPC handlers ──────────────────────────────────

export function registerBianinhoBridge(): void {
  console.log('[BianinhoBridge] Registering IPC handlers');

  // Auto-start bridge on first call
  startBridgeProcess();

  ipcMain.handle('bianinho.ping', async (_event, args?: { echo?: string }) => {
    return tcpSend('ping', { echo: args?.echo ?? 'pong' });
  });

  ipcMain.handle('bianinho.status', async () => {
    return tcpSend('status');
  });

  ipcMain.handle('bianinho.checkHermes', async () => {
    return tcpSend('check_hermes');
  });

  ipcMain.handle('bianinho.listSkills', async () => {
    return tcpSend('list_skills');
  });

  ipcMain.handle('bianinho.hermesPath', async () => {
    return tcpSend('hermes_path');
  });

  ipcMain.handle('bianinho.platformInfo', async () => {
    return tcpSend('platform_info');
  });

  ipcMain.handle('bianinho.syncStatus', async () => {
    // Sync status — lido do ficheiro de estado
    const base = getBasePath();
    const stateFile = path.join(base, 'config', 'sync_state.json');
    try {
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        return {
          lastSync: state.lastSync ?? 0,
          pendingChanges: 0,
          direction: 'idle',
          errors: [],
          ...state,
        };
      }
    } catch { /* ignore */ }
    return { lastSync: 0, pendingChanges: 0, direction: 'idle', errors: [] };
  });

  console.log('[BianinhoBridge] IPC handlers registered');
}
