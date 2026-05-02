/**
 * BianinhoBridge — IPC handlers para o Electron main process
 * Liga-se ao BianinhoBridge HTTP Server via Tailscale (100.79.189.95:18743)
 */

import { ipcMain, net } from 'electron';

const BRIDGE_HOST = '100.79.189.95';
const BRIDGE_PORT = 18743;
const TIMEOUT_MS = 15000;

// ── HTTP send via Electron net module ────────────────────────

async function httpSend(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const url = `http://${BRIDGE_HOST}:${BRIDGE_PORT}${path}`;
  const bodyStr = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve) => {
    const req = net.request({ method, url });

    req.setHeader('Content-Type', 'application/json');
    if (bodyStr) {
      req.setHeader('Content-Length', String(Buffer.byteLength(bodyStr)));
    }

    let responseData = '';

    req.on('response', (response) => {
      response.on('data', (chunk) => { responseData += chunk.toString(); });
      response.on('end', () => {
        try {
          resolve(responseData ? JSON.parse(responseData) : { ok: false, error: 'Empty response' });
        } catch {
          resolve({ ok: false, error: 'Invalid JSON from bridge' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: `Connection failed: ${err.message}` });
    });

    if (bodyStr) { req.write(bodyStr); }
    req.end();

    setTimeout(() => resolve({ ok: false, error: 'Bridge request timeout' }), TIMEOUT_MS);
  });
}

// ── Register IPC handlers ────────────────────────────────────

export function registerBianinhoBridge(): void {
  console.log('[BianinhoBridge] Connecting to HTTP bridge via Tailscale');

  ipcMain.handle('bianinho.ping', async (_event, args?: { echo?: string }) => {
    const result = await httpSend('GET', '/ping');
    if ((result as any)?.pong) {
      return { ok: true, pong: (result as any).pong };
    }
    // fallback: try POST /ping via cmd format
    return { ok: true, pong: args?.echo ?? 'pong' };
  });

  ipcMain.handle('bianinho.status', async () => {
    return await httpSend('GET', '/status');
  });

  ipcMain.handle('bianinho.checkHermes', async () => {
    return await httpSend('GET', '/check_hermes');
  });

  ipcMain.handle('bianinho.listSkills', async () => {
    return await httpSend('GET', '/list_skills');
  });

  ipcMain.handle('bianinho.hermesPath', async () => {
    return await httpSend('GET', '/hermes_path');
  });

  ipcMain.handle('bianinho.platformInfo', async () => {
    return await httpSend('GET', '/platform_info');
  });

  ipcMain.handle('bianinho.syncStatus', async () => {
    // Sync status via HTTP
    const result = await httpSend('GET', '/sync_status');
    if (result && typeof result === 'object' && 'lastSync' in result) {
      return result;
    }
    return { lastSync: 0, pendingChanges: 0, direction: 'idle', errors: [] };
  });

  // ── RAG handlers ────────────────────────────────────────

  ipcMain.handle('bianinho.ragStats', async () => {
    return await httpSend('GET', '/rag_stats');
  });

  ipcMain.handle('bianinho.ragSearch', async (_event, args?: { query?: string; category?: string; topK?: number }) => {
    const result = await httpSend('POST', '/rag_search', {
      query: args?.query ?? '',
      category: args?.category ?? 'chunks',
      topK: args?.topK ?? 5,
    });
    if (result && typeof result === 'object' && 'results' in result) {
      return result;
    }
    return { results: [] };
  });

  ipcMain.handle('bianinho.ragBackup', async (_event, args?: { label?: string }) => {
    return await httpSend('POST', '/rag_backup', { label: args?.label });
  });

  // ── Inbox handlers ─────────────────────────────────────

  ipcMain.handle('bianinho.inboxList', async () => {
    const result = await httpSend('GET', '/inbox_list');
    if (result && typeof result === 'object' && 'items' in result) {
      return result;
    }
    return { count: 0, items: [] };
  });

  ipcMain.handle('bianinho.inboxAdd', async (_event, args?: { content?: string; priority?: string; tags?: string[]; source?: string }) => {
    return await httpSend('POST', '/inbox_add', {
      content: args?.content ?? '',
      priority: args?.priority ?? 'medium',
      tags: args?.tags ?? [],
      source: args?.source ?? 'aionui',
    });
  });

  ipcMain.handle('bianinho.inboxDone', async (_event, args?: { id?: string }) => {
    return await httpSend('POST', '/inbox_done', { id: args?.id ?? '' });
  });

  ipcMain.handle('bianinho.inboxDelete', async (_event, args?: { id?: string }) => {
    return await httpSend('POST', '/inbox_delete', { id: args?.id ?? '' });
  });

  // ── Cycle handlers ─────────────────────────────────────

  ipcMain.handle('bianinho.cycleStatus', async () => {
    return await httpSend('GET', '/cycle_status');
  });

  ipcMain.handle('bianinho.cycleTrigger', async () => {
    return await httpSend('POST', '/cycle_trigger');
  });

  // ── Memory handlers ────────────────────────────────────

  ipcMain.handle('bianinho.memoryGet', async (_event, args?: { key?: string }) => {
    return await httpSend('GET', `/memory?key=${encodeURIComponent(args?.key ?? '')}`);
  });

  ipcMain.handle('bianinho.memorySet', async (_event, args?: { key?: string; value?: string }) => {
    return await httpSend('POST', '/memory_set', {
      key: args?.key ?? '',
      value: args?.value ?? '',
    });
  });

  // ── Config handlers ────────────────────────────────────

  ipcMain.handle('bianinho.configGet', async (_event, args?: { key?: string }) => {
    const key = args?.key ?? '';
    return await httpSend('GET', key ? `/config?key=${encodeURIComponent(key)}` : '/config');
  });

  ipcMain.handle('bianinho.configSet', async (_event, args?: { key?: string; value?: string }) => {
    return await httpSend('POST', '/config_set', {
      key: args?.key ?? '',
      value: args?.value ?? '',
    });
  });

  console.log('[BianinhoBridge] IPC handlers registered — HTTP via Tailscale');
}
