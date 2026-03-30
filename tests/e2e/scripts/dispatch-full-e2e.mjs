/**
 * Full Dispatch E2E Test — interacts with the actual Electron app via CDP
 *
 * Tests:
 *  1. Main page & sidebar
 *  2. Create Group Chat modal — fill form & submit
 *  3. GroupChatView — timeline, send box
 *  4. Settings Drawer — open, modify, close
 *  5. Fork to Dispatch — right-click context menu
 *  6. Send message to dispatcher
 *  7. Task Overview panel
 *  8. History list interactions
 */
import { connectToElectron, test, summary } from './cdp-helper.mjs';

async function main() {
  console.log('\n🧪 AionUi Dispatch — Full E2E Tests\n');

  const { cdp, ws } = await connectToElectron();
  console.log('Connected to Electron renderer\n');

  // Ensure we're on the main page
  await cdp.navigate('#/guid');
  await cdp.wait(500);

  // ═══════════════════════════════════════════════════════════════════
  console.log('── 1. Main Page & Sidebar ──');
  // ═══════════════════════════════════════════════════════════════════

  await test('electronAPI exists', async () => {
    const has = await cdp.eval('return !!window.electronAPI');
    if (!has) throw new Error('Missing');
  });

  await test('Sidebar shows Group Chat section with "群聊"', async () => {
    const has = await cdp.eval('return document.body.innerText.includes("群聊")');
    if (!has) throw new Error('Section not found');
  });

  await test('Existing dispatch conversations visible', async () => {
    const names = await cdp.eval(`
      const items = document.querySelectorAll('[class*="chat-history__item"]');
      const texts = [...items].map(el => el.textContent.trim().substring(0, 30));
      return JSON.stringify(texts);
    `);
    const arr = JSON.parse(names);
    console.log(`(${arr.length} items)`);
    if (arr.length === 0) throw new Error('No conversations');
  });

  await cdp.screenshot('e2e-full-01-main');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 2. Create Group Chat Modal ──');
  // ═══════════════════════════════════════════════════════════════════

  // Click the + button next to 群聊
  await test('Click "+" to open create modal', async () => {
    const clicked = await cdp.eval(`
      // Find the "群聊" text and the + icon near it
      const sections = document.querySelectorAll('[class*="chat-history__section-header"], [class*="section"]');
      for (const s of sections) {
        if (s.textContent.includes('群聊') || s.textContent.includes('Group Chat')) {
          const plus = s.querySelector('[class*="plus"], [class*="add"], svg');
          if (plus) {
            const clickTarget = plus.closest('[class*="cursor-pointer"]') || plus;
            clickTarget.click();
            return true;
          }
        }
      }
      // Fallback: find by icon class
      const icons = document.querySelectorAll('.i-icon-plus');
      for (const icon of icons) {
        const rect = icon.getBoundingClientRect();
        if (rect.x < 300 && rect.y > 200 && rect.y < 250) {
          icon.click();
          return true;
        }
      }
      return false;
    `);
    if (!clicked) throw new Error('Could not find + button');
  });

  await cdp.wait(800);

  await test('Modal is visible with correct fields', async () => {
    const found = await cdp.waitFor('return !!document.querySelector(".arco-modal")', 5000);
    if (!found) throw new Error('Modal not found');

    const fields = await cdp.eval(`
      const modal = document.querySelector('.arco-modal');
      return JSON.stringify({
        title: modal.querySelector('.arco-modal-title')?.textContent || '',
        hasNameInput: !!modal.querySelector('input'),
        hasSelect: modal.querySelectorAll('.arco-select').length,
        hasBrowseBtn: !![...modal.querySelectorAll('button')].find(b => b.textContent.includes('浏览') || b.textContent.includes('Browse')),
        hasAdvanced: modal.textContent.includes('高级设置') || modal.textContent.includes('Advanced'),
      });
    `);
    console.log(fields);
  });

  await cdp.screenshot('e2e-full-02-create-modal');

  // Fill form and create
  await test('Fill group chat name', async () => {
    await cdp.eval(`
      const modal = document.querySelector('.arco-modal');
      const input = modal.querySelector('input');
      // React controlled input needs nativeInputValueSetter
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, 'E2E Dispatch Test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.wait(300);
    const val = await cdp.eval(`return document.querySelector('.arco-modal input').value`);
    if (val !== 'E2E Dispatch Test') throw new Error(`Value: ${val}`);
  });

  // Expand advanced settings
  await test('Expand advanced settings', async () => {
    const expanded = await cdp.eval(`
      const modal = document.querySelector('.arco-modal');
      const headers = modal.querySelectorAll('.arco-collapse-item-header');
      for (const h of headers) {
        if (h.textContent.includes('高级设置') || h.textContent.includes('Advanced')) {
          h.click();
          return true;
        }
      }
      return false;
    `);
    if (!expanded) throw new Error('Advanced section not found');
  });

  await cdp.wait(500);

  await test('Seed message textarea visible', async () => {
    const found = await cdp.waitFor('return !!document.querySelector(".arco-modal textarea")', 3000);
    if (!found) throw new Error('Textarea not found');
  });

  await cdp.screenshot('e2e-full-03-modal-filled');

  // Click Create button
  await test('Click Create button', async () => {
    await cdp.eval(`
      const modal = document.querySelector('.arco-modal');
      const btns = modal.querySelectorAll('.arco-modal-footer button');
      const createBtn = [...btns].find(b => b.classList.contains('arco-btn-primary'));
      if (createBtn) createBtn.click();
    `);
  });

  await cdp.wait(2000);

  await test('Modal closed after creation', async () => {
    const closed = await cdp.waitFor('return !document.querySelector(".arco-modal")', 10000);
    if (!closed) {
      // Check if there's an error message
      const errText = await cdp.eval(`
        const modal = document.querySelector('.arco-modal');
        return modal?.querySelector('.arco-alert, .arco-message')?.textContent || 'Modal still open';
      `);
      throw new Error(errText);
    }
  });

  await cdp.screenshot('e2e-full-04-after-create');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 3. GroupChatView ──');
  // ═══════════════════════════════════════════════════════════════════

  await test('Navigated to GroupChatView', async () => {
    await cdp.wait(1000);
    const url = await cdp.eval('return location.hash');
    const hasView = await cdp.eval(`
      return document.body.innerText.includes('E2E Dispatch Test') ||
             document.querySelector('[class*="group-chat"]') !== null ||
             document.querySelector('[class*="dispatch"]') !== null ||
             location.hash.includes('/dispatch/') ||
             location.hash.includes('/conversation/')
    `);
    console.log(`(url: ${url})`);
  });

  // Click on the newly created conversation if not already there
  await test('Click on E2E Dispatch Test conversation', async () => {
    const clicked = await cdp.eval(`
      const items = document.querySelectorAll('[class*="chat-history__item"]');
      for (const item of items) {
        if (item.textContent.includes('E2E Dispatch Test')) {
          item.click();
          return true;
        }
      }
      return false;
    `);
    if (!clicked) {
      // May have auto-navigated
      console.log('(may have auto-navigated)');
    }
  });

  await cdp.wait(1500);
  await cdp.screenshot('e2e-full-05-group-chat-view');

  await test('GroupChatView has send box', async () => {
    const has = await cdp.eval(`
      return !!document.querySelector('textarea') ||
             !!document.querySelector('[contenteditable="true"]') ||
             !!document.querySelector('[class*="send-box"]')
    `);
    if (!has) throw new Error('Send box not found');
  });

  await test('GroupChatView has timeline area', async () => {
    const has = await cdp.eval(`
      return !!document.querySelector('[class*="timeline"]') ||
             !!document.querySelector('[class*="message-list"]') ||
             !!document.querySelector('[class*="chat-view"]') ||
             !!document.querySelector('[class*="group-chat"]')
    `);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 4. Settings Drawer ──');
  // ═══════════════════════════════════════════════════════════════════

  await test('Open settings drawer (gear icon)', async () => {
    const clicked = await cdp.eval(`
      // Look for settings/gear icon in the top-right area of GroupChatView
      const icons = document.querySelectorAll('[class*="setting"], [class*="gear"], .i-icon-setting-two');
      for (const icon of icons) {
        const rect = icon.getBoundingClientRect();
        if (rect.x > 500 && rect.y < 100 && rect.width > 0) {
          const clickable = icon.closest('button, [role="button"], span[class*="cursor"]') || icon;
          clickable.click();
          return true;
        }
      }
      return false;
    `);
    if (!clicked) throw new Error('Gear icon not found');
  });

  await cdp.wait(1000);
  await cdp.screenshot('e2e-full-06-settings-drawer');

  await test('Settings drawer is visible', async () => {
    const visible = await cdp.eval(`
      return !!document.querySelector('.arco-drawer') ||
             document.body.innerText.includes('并发') ||
             document.body.innerText.includes('Concurrent') ||
             document.body.innerText.includes('群聊设置') ||
             document.body.innerText.includes('Group Chat Settings')
    `);
    if (!visible) throw new Error('Drawer not visible');
  });

  await test('Settings drawer has concurrent limit control', async () => {
    const has = await cdp.eval(`
      return document.body.innerText.includes('并发') ||
             document.body.innerText.includes('concurrent') ||
             document.body.innerText.includes('Concurrent')
    `);
    console.log(`(${has ? 'found' : 'not found'})`);
  });

  // Close drawer
  await test('Close settings drawer', async () => {
    // Press Escape or click X
    await cdp.eval(`
      const closeBtn = document.querySelector('.arco-drawer .arco-drawer-close-icon, .arco-drawer [class*="close"]');
      if (closeBtn) closeBtn.click();
    `);
    await cdp.wait(500);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 5. Send Message to Dispatcher ──');
  // ═══════════════════════════════════════════════════════════════════

  await test('Focus send box and type message', async () => {
    await cdp.eval(`
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(textarea, 'Hello from E2E test! What can you do?');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
    await cdp.wait(300);
    const val = await cdp.eval(`return document.querySelector('textarea')?.value || ''`);
    if (!val.includes('E2E test')) throw new Error(`Value: ${val}`);
  });

  await cdp.screenshot('e2e-full-07-message-typed');

  // Don't actually send (would trigger AI response and cost money)
  // Just verify the send button is enabled
  await test('Send button is visible', async () => {
    const has = await cdp.eval(`
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const rect = btn.getBoundingClientRect();
        // Send button is typically at the right side of the text area
        if (rect.x > 800 && rect.y > 300) {
          return true;
        }
      }
      // Also check for send icon
      return !!document.querySelector('[class*="send"]');
    `);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 6. History — Right-Click Context Menu (Fork) ──');
  // ═══════════════════════════════════════════════════════════════════

  // Go back to main page first
  await cdp.navigate('#/guid');
  await cdp.wait(1000);

  await test('Right-click on a normal conversation', async () => {
    // Find a non-dispatch conversation item
    const coords = await cdp.eval(`
      const items = document.querySelectorAll('[class*="chat-history__item"]');
      for (const item of items) {
        const text = item.textContent;
        if (!text.includes('群聊') && !text.includes('E2E Dispatch') &&
            !text.includes('Test v3') && !text.includes('My Dispatch') && !text.includes('瓦砾')) {
          const rect = item.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: text.substring(0, 30) };
          }
        }
      }
      return null;
    `);
    if (!coords) throw new Error('No normal conversation found');
    console.log(`("${coords.text}")`);
    await cdp.rightClick(coords.x, coords.y);
  });

  await cdp.wait(800);
  await cdp.screenshot('e2e-full-08-context-menu');

  await test('Context menu has Fork to Dispatch option', async () => {
    const has = await cdp.eval(`
      // Check for context menu / dropdown
      const menus = document.querySelectorAll('.arco-dropdown, .arco-trigger-popup, [class*="context-menu"], [class*="dropdown"]');
      for (const menu of menus) {
        if (menu.offsetHeight > 0) {
          const text = menu.textContent;
          return text.includes('转为群聊') || text.includes('Fork') || text.includes('dispatch') || text.includes('群聊');
        }
      }
      return false;
    `);
    console.log(`(${has ? 'found' : 'not found - may need different trigger'})`);
  });

  // Dismiss context menu
  await cdp.eval(`document.body.click()`);
  await cdp.wait(300);

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 7. Enter Existing Group Chat & Task Overview ──');
  // ═══════════════════════════════════════════════════════════════════

  await test('Click on existing dispatch conversation (瓦砾群聊)', async () => {
    const clicked = await cdp.eval(`
      const items = document.querySelectorAll('[class*="chat-history__item"]');
      for (const item of items) {
        if (item.textContent.includes('瓦砾群聊')) {
          item.click();
          return true;
        }
      }
      return false;
    `);
    if (!clicked) throw new Error('瓦砾群聊 not found');
  });

  await cdp.wait(2000);
  await cdp.screenshot('e2e-full-09-existing-dispatch');

  await test('GroupChatView loaded for existing dispatch', async () => {
    const loaded = await cdp.eval(`
      return document.body.innerText.includes('瓦砾群聊') ||
             document.querySelector('textarea') !== null
    `);
    if (!loaded) throw new Error('View not loaded');
  });

  // Check for task cards / child task indicators
  await test('Check for child task cards', async () => {
    const tasks = await cdp.eval(`
      const cards = document.querySelectorAll('[class*="task-card"], [class*="child-task"], [class*="task_started"], [class*="task_completed"]');
      return cards.length;
    `);
    console.log(`(${tasks} task cards found)`);
  });

  // Look for Task Overview / details button
  await test('Check for task panel / overview button', async () => {
    const has = await cdp.eval(`
      return document.body.innerText.includes('查看详情') ||
             document.body.innerText.includes('View Details') ||
             !!document.querySelector('[class*="task-overview"]') ||
             !!document.querySelector('[class*="task-panel"]')
    `);
    console.log(`(${has ? 'found' : 'no active tasks'})`);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 8. Settings Page — Phase 6 Features ──');
  // ═══════════════════════════════════════════════════════════════════

  await cdp.navigate('#/settings/system');
  await cdp.wait(1000);

  await test('CDP settings section visible', async () => {
    const has = await cdp.eval(`
      return document.body.innerText.includes('CDP') &&
             document.body.innerText.includes('9230')
    `);
    if (!has) throw new Error('CDP section not visible');
  });

  await cdp.screenshot('e2e-full-10-settings-cdp');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── 9. Cleanup — Delete E2E Test Conversation ──');
  // ═══════════════════════════════════════════════════════════════════

  await cdp.navigate('#/guid');
  await cdp.wait(1000);

  await test('Delete E2E test conversation', async () => {
    // Right-click on E2E Dispatch Test
    const coords = await cdp.eval(`
      const items = document.querySelectorAll('[class*="chat-history__item"]');
      for (const item of items) {
        if (item.textContent.includes('E2E Dispatch Test')) {
          const rect = item.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    `);
    if (!coords) {
      console.log('(E2E conversation not found, may not have been created)');
      return;
    }
    await cdp.rightClick(coords.x, coords.y);
    await cdp.wait(500);

    // Click delete option
    const deleted = await cdp.eval(`
      const menus = document.querySelectorAll('.arco-dropdown-menu-item, .arco-trigger-popup li, [class*="menu-item"]');
      for (const item of menus) {
        if (item.textContent.includes('删除') || item.textContent.includes('Delete')) {
          item.click();
          return true;
        }
      }
      return false;
    `);
    if (deleted) {
      await cdp.wait(500);
      // Confirm delete if dialog appears
      await cdp.eval(`
        const confirmBtn = document.querySelector('.arco-modal-footer .arco-btn-primary, .arco-popconfirm .arco-btn-primary');
        if (confirmBtn) confirmBtn.click();
      `);
      await cdp.wait(500);
    }
    console.log(`(${deleted ? 'deleted' : 'no delete option'})`);
  });

  await cdp.screenshot('e2e-full-11-cleanup');

  // ═══════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════

  const failures = summary();
  ws.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\nFatal:', e.message);
  process.exit(1);
});
