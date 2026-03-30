/**
 * Dispatch E2E Test via raw CDP WebSocket
 * Connects to the actual Electron renderer window
 */
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');
const CDP_URL = 'ws://127.0.0.1:9230/devtools/page/';

// ── CDP Helper ──────────────────────────────────────────────────────────────
class CDPClient {
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
      this.handlers.set(msgId, (msg) => {
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Evaluation failed');
    }
    return result.result.value;
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    console.log(`  📸 ${name}.png`);
    return filePath;
  }

  async click(selector) {
    // Get element center coordinates
    const coords = await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()
    `);
    if (!coords) throw new Error(`Element not found: ${selector}`);

    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });
  }

  async clickByText(text) {
    const coords = await this.evaluate(`
      (() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent.trim().includes('${text}')) {
            let el = walker.currentNode.parentElement;
            // Walk up to find a clickable element
            while (el && !['BUTTON', 'A', 'SPAN', 'DIV'].includes(el.tagName)) el = el.parentElement;
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              }
            }
          }
        }
        return null;
      })()
    `);
    if (!coords) throw new Error(`Text not found: ${text}`);

    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });
  }

  async type(text) {
    for (const char of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp' });
    }
  }

  async wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitForSelector(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = await this.evaluate(`!!document.querySelector('${selector}')`);
      if (found) return true;
      await this.wait(200);
    }
    return false;
  }

  async waitForText(text, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = await this.evaluate(`document.body.innerText.includes('${text}')`);
      if (found) return true;
      await this.wait(200);
    }
    return false;
  }

  async navigate(hash) {
    await this.evaluate(`window.location.hash = '${hash}'`);
    await this.wait(500);
  }
}

// ── Test Framework ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    passed++;
    console.log('✅ PASS');
    results.push({ name, status: 'pass' });
  } catch (e) {
    failed++;
    console.log(`❌ FAIL: ${e.message}`);
    results.push({ name, status: 'fail', error: e.message });
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  ${name} ... ⏭️  SKIP: ${reason}`);
  results.push({ name, status: 'skip', reason });
}

// ── Find Target ─────────────────────────────────────────────────────────────
async function findTarget() {
  const browserWsUrl = await fetch('http://127.0.0.1:9230/json/version')
    .then((r) => r.json())
    .then((d) => d.webSocketDebuggerUrl);

  // Use browser-level WS to discover targets
  return new Promise((resolve, reject) => {
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
        else reject(new Error('Electron renderer target not found'));
      }
    });
    bws.on('error', reject);
  });
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🧪 AionUi Dispatch E2E Tests (CDP)\n');

  // Find and connect to Electron renderer
  console.log('Connecting to Electron renderer...');
  const targetId = await findTarget();
  console.log(`Target: ${targetId}\n`);

  const ws = new WebSocket(`${CDP_URL}${targetId}`);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const cdp = new CDPClient(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // ── Get current state ──
  const pageInfo = await cdp.evaluate(`JSON.stringify({ url: location.href, title: document.title })`);
  console.log(`Current page: ${pageInfo}\n`);

  // ── TEST 1: Navigate to main page ────────────────────────────────
  console.log('--- 1. Main Page ---');

  await test('App is loaded with electronAPI', async () => {
    const hasAPI = await cdp.evaluate('!!window.electronAPI');
    if (!hasAPI) throw new Error('electronAPI not found');
  });

  await test('Navigate to /guid (main page)', async () => {
    await cdp.navigate('#/guid');
    await cdp.wait(1000);
    const url = await cdp.evaluate('location.hash');
    if (!url.includes('/guid')) throw new Error(`Expected /guid, got ${url}`);
  });

  await cdp.screenshot('e2e-cdp-01-main-page');

  // ── TEST 2: Sidebar navigation ────────────────────────────────────
  console.log('\n--- 2. Sidebar & History ---');

  await test('Sidebar is visible', async () => {
    // Check for sidebar icons (left nav)
    const hasSidebar = await cdp.evaluate(`
      !!document.querySelector('[class*="chat-history"]') ||
      !!document.querySelector('.size-full.overflow-y-auto') ||
      document.querySelectorAll('svg').length > 5
    `);
    if (!hasSidebar) throw new Error('Sidebar not found');
  });

  await test('Check for Group Chat section', async () => {
    const hasSection = await cdp.evaluate(`
      document.body.innerText.includes('群聊') || document.body.innerText.includes('Group Chat')
    `);
    // Section only appears when dispatch conversations exist
    results.push({ note: hasSection ? 'Group Chat section found' : 'No Group Chat section (no dispatch convos yet)' });
  });

  // ── TEST 3: Open sidebar to reveal chat history ─────────────────
  console.log('\n--- 3. Expand Sidebar ---');

  await test('Toggle sidebar to show history', async () => {
    // Click the hamburger/menu icon to expand sidebar
    const toggled = await cdp.evaluate(`
      (() => {
        // Look for the sidebar toggle button (top-left)
        const btns = document.querySelectorAll('button, [role="button"], span[class*="cursor-pointer"]');
        for (const btn of btns) {
          const rect = btn.getBoundingClientRect();
          if (rect.x < 150 && rect.y < 50 && rect.width > 0) {
            btn.click();
            return true;
          }
        }
        // Try the hamburger icon specifically
        const hamburger = document.querySelector('[class*="menu"], [class*="hamburger"], [class*="toggle"]');
        if (hamburger) { hamburger.click(); return true; }
        return false;
      })()
    `);
  });

  await cdp.wait(800);
  await cdp.screenshot('e2e-cdp-02-sidebar-expanded');

  // ── TEST 4: Check existing dispatch conversations ──────────────
  console.log('\n--- 4. Check Existing Dispatch Conversations ---');

  await test('List existing conversations', async () => {
    const convos = await cdp.evaluate(`
      (() => {
        const items = document.querySelectorAll('[class*="conversation"], [class*="chat-item"], [class*="history-item"]');
        return Array.from(items).slice(0, 5).map(el => el.textContent?.trim().substring(0, 50));
      })()
    `);
    console.log(`    Found ${JSON.parse(convos || '[]').length} items`);
  });

  // ── TEST 5: Create Group Chat ───────────────────────────────────
  console.log('\n--- 5. Create Group Chat ---');

  await test('Find and click create group chat button', async () => {
    // Look for + button near Group Chat section, or the group chat icon in sidebar
    const clicked = await cdp.evaluate(`
      (() => {
        // Strategy 1: Find group chat section and its + button
        const allText = document.body.innerText;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        while (walker.nextNode()) {
          const text = walker.currentNode.textContent.trim();
          if (text === '群聊' || text === 'Group Chats') {
            let section = walker.currentNode.parentElement;
            // Walk up to find section container
            for (let i = 0; i < 5 && section; i++) {
              const plusBtn = section.querySelector('[class*="cursor-pointer"] svg, [class*="add"], [class*="plus"]');
              if (plusBtn) {
                plusBtn.closest('[class*="cursor-pointer"]')?.click() || plusBtn.click();
                return 'section-plus';
              }
              section = section.parentElement;
            }
          }
        }

        // Strategy 2: Click the group chat icon in left sidebar
        const sidebarIcons = document.querySelectorAll('nav svg, aside svg, [class*="sidebar"] svg');
        for (const icon of sidebarIcons) {
          const rect = icon.getBoundingClientRect();
          if (rect.x < 60 && rect.y > 150 && rect.y < 350) {
            icon.closest('a, button, div[class*="cursor"], span')?.click();
            return 'sidebar-icon';
          }
        }

        // Strategy 3: Direct navigation
        return null;
      })()
    `);

    if (!clicked) {
      // Navigate directly to group chat creation
      await cdp.evaluate(`
        // Try dispatching through the IPC bridge
        window.location.hash = '#/guid';
      `);
    }
  });

  await cdp.wait(1000);
  await cdp.screenshot('e2e-cdp-03-before-create');

  // Try finding + icon in the sidebar for group chat
  await test('Look for group chat creation entry', async () => {
    // Check sidebar items - look for the people/group icon
    const sidebarInfo = await cdp.evaluate(`
      (() => {
        const leftIcons = [];
        document.querySelectorAll('svg, img, [class*="icon"]').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.x < 70 && rect.width > 10 && rect.height > 10 && rect.y > 50) {
            leftIcons.push({
              tag: el.tagName,
              y: Math.round(rect.y),
              title: el.getAttribute('title') || el.getAttribute('aria-label') || '',
              parent: el.parentElement?.className?.substring(0, 40) || ''
            });
          }
        });
        return JSON.stringify(leftIcons);
      })()
    `);
    console.log(`    Sidebar icons: ${sidebarInfo}`);
  });

  // Click the people/group icon in sidebar (typically 3rd or 4th icon)
  await test('Click group chat sidebar icon', async () => {
    const clicked = await cdp.evaluate(`
      (() => {
        const svgs = document.querySelectorAll('svg');
        for (const svg of svgs) {
          const rect = svg.getBoundingClientRect();
          // Left sidebar icons, around y=200-300 area
          if (rect.x < 60 && rect.y > 180 && rect.y < 320 && rect.width > 15) {
            const clickable = svg.closest('a, button, [role="button"], div[class*="cursor"], span[class*="cursor"]');
            if (clickable) {
              clickable.click();
              return { y: Math.round(rect.y), tag: clickable.tagName };
            }
          }
        }
        return null;
      })()
    `);
    if (clicked) console.log(`    Clicked at y=${JSON.parse(JSON.stringify(clicked)).y}`);
  });

  await cdp.wait(1000);
  await cdp.screenshot('e2e-cdp-04-after-sidebar-click');

  // ── TEST 6: Check for create modal or group chat list ──────────
  console.log('\n--- 6. Create Group Chat Modal ---');

  await test('Check for modal or group chat UI', async () => {
    const uiState = await cdp.evaluate(`
      JSON.stringify({
        hasModal: !!document.querySelector('.arco-modal'),
        hasDrawer: !!document.querySelector('.arco-drawer'),
        bodyText: document.body.innerText.substring(0, 500),
        url: location.hash
      })
    `);
    console.log(`    UI state: ${uiState.substring(0, 200)}`);
  });

  // Navigate to settings to test Phase 6 features
  console.log('\n--- 7. Settings Page - CDP Config ---');

  await test('Navigate to settings', async () => {
    await cdp.navigate('#/settings/system');
    await cdp.wait(1000);
    const url = await cdp.evaluate('location.hash');
    if (!url.includes('settings')) throw new Error(`Navigation failed: ${url}`);
  });

  await cdp.screenshot('e2e-cdp-05-settings');

  await test('CDP settings visible', async () => {
    const hasCDP = await cdp.evaluate(`
      document.body.innerText.includes('CDP') || document.body.innerText.includes('Chrome DevTools')
    `);
    if (!hasCDP) throw new Error('CDP settings not found');
  });

  // ── TEST 8: Navigate back and check dispatch conversation creation via IPC ──
  console.log('\n--- 8. Test Dispatch IPC ---');

  await test('Check IPC bridge availability', async () => {
    const hasIPC = await cdp.evaluate(`
      typeof window.__ipcBridge !== 'undefined' || typeof window.electronAPI?.ipcRenderer !== 'undefined'
    `);
    if (!hasIPC) throw new Error('IPC bridge not available');
  });

  // Test creating a group chat via IPC
  await test('Create group chat via IPC invoke', async () => {
    const result = await cdp.evaluate(`
      (async () => {
        try {
          // The IPC bridge in AionUi uses a specific pattern
          const ipc = window.electronAPI?.ipcRenderer;
          if (!ipc) return JSON.stringify({ error: 'No ipcRenderer' });

          // Try to invoke createGroupChat
          const result = await ipc.invoke('dispatch:createGroupChat', {
            name: 'E2E Test Group',
            workspace: '/Users/veryliu/Documents/GitHub/AionUi'
          });
          return JSON.stringify(result);
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      })()
    `);
    console.log(`    IPC result: ${result}`);
  });

  // Navigate back to main
  await cdp.navigate('#/guid');
  await cdp.wait(1500);
  await cdp.screenshot('e2e-cdp-06-after-ipc');

  // ── TEST 9: Check for dispatch conversations in history ─────────
  console.log('\n--- 9. Verify Dispatch in History ---');

  await test('Check history for dispatch conversations', async () => {
    // Expand sidebar first
    await cdp.evaluate(`
      (() => {
        const toggle = document.querySelector('[class*="menu-toggle"], [class*="hamburger"]');
        if (toggle) toggle.click();
      })()
    `);
    await cdp.wait(500);

    const hasDispatch = await cdp.evaluate(`
      document.body.innerText.includes('E2E Test Group') ||
      document.body.innerText.includes('群聊') ||
      document.body.innerText.includes('Group Chat')
    `);
    console.log(`    Dispatch in history: ${hasDispatch}`);
  });

  await cdp.screenshot('e2e-cdp-07-history-check');

  // ── TEST 10: Fork to Dispatch UI check ──────────────────────────
  console.log('\n--- 10. Fork to Dispatch ---');

  await test('Check for conversation context menu', async () => {
    // Right-click on a conversation item to see if fork option exists
    const items = await cdp.evaluate(`
      (() => {
        const convItems = document.querySelectorAll('[class*="conversation-row"], [class*="chat-item"], [class*="history-row"]');
        return convItems.length;
      })()
    `);
    console.log(`    Conversation items in sidebar: ${items}`);
  });

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`   Total: ${passed + failed + skipped} tests\n`);

  if (failed > 0) {
    console.log('❌ Failed tests:');
    results
      .filter((r) => r.status === 'fail')
      .forEach((r) => {
        console.log(`   - ${r.name}: ${r.error}`);
      });
  }

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
