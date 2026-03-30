/**
 * CDP Helper for interacting with Electron renderer
 */
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

export class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.handlers = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.handlers.has(msg.id)) {
        this.handlers.get(msg.id)(msg);
        this.handlers.delete(msg.id);
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = ++this.id;
      const timer = setTimeout(() => {
        this.handlers.delete(msgId);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.handlers.set(msgId, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Eval error: ${desc}`);
    }
    return result.result.value;
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    console.log(`    📸 ${name}.png`);
    return filePath;
  }

  async mouseClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async rightClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  }

  async clickSelector(selector) {
    const coords = await this.eval(`
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    `);
    if (!coords) throw new Error(`Not found: ${selector}`);
    await this.mouseClick(coords.x, coords.y);
  }

  async clickText(text) {
    const coords = await this.eval(`
      const els = [...document.querySelectorAll('button, a, span, div, label, li')];
      for (const el of els) {
        if (el.innerText?.trim() === '${text}' || el.textContent?.trim() === '${text}') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    `);
    if (!coords) throw new Error(`Text not found: "${text}"`);
    await this.mouseClick(coords.x, coords.y);
  }

  async typeInFocused(text) {
    await this.send('Input.insertText', { text });
  }

  async pressKey(key) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.charCodeAt(0),
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }

  async wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async waitFor(expression, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await this.eval(expression).catch(() => false);
      if (result) return true;
      await this.wait(300);
    }
    return false;
  }

  async navigate(hash) {
    await this.eval(`window.location.hash = '${hash}'`);
    await this.wait(800);
  }
}

export async function connectToElectron() {
  const version = await fetch('http://127.0.0.1:9230/json/version').then((r) => r.json());
  const browserWsUrl = version.webSocketDebuggerUrl;

  // Find the renderer target
  const targetId = await new Promise((resolve, reject) => {
    const bws = new WebSocket(browserWsUrl);
    bws.on('open', () => {
      bws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
    });
    bws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === 1) {
        bws.close();
        const page = msg.result.targetInfos.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
        if (page) resolve(page.targetId);
        else reject(new Error('Electron renderer not found'));
      }
    });
    bws.on('error', reject);
  });

  // Connect to the renderer
  const ws = new WebSocket(`ws://127.0.0.1:9230/devtools/page/${targetId}`);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const cdp = new CDPClient(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  return { cdp, ws, targetId };
}

// Test runner
let _passed = 0;
let _failed = 0;
const _results = [];

export async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    _passed++;
    console.log('✅');
    _results.push({ name, status: 'pass' });
  } catch (e) {
    _failed++;
    console.log(`❌ ${e.message}`);
    _results.push({ name, status: 'fail', error: e.message });
  }
}

export function summary() {
  console.log('\n' + '='.repeat(50));
  console.log(`📊 ${_passed} passed, ${_failed} failed (${_passed + _failed} total)`);
  if (_failed > 0) {
    console.log('\n❌ Failures:');
    _results.filter((r) => r.status === 'fail').forEach((r) => console.log(`   ${r.name}: ${r.error}`));
  }
  return _failed;
}
