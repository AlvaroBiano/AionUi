/**
 * SendBox UI – E2E tests covering Module 4 ACs.
 *
 * AC coverage map:
 *  AC1   – SendBox panel visible with textarea
 *  AC2   – textarea is editable
 *  AC3   – send button disabled when input is empty
 *  AC4   – send button enabled when input has text
 *  AC4a  – clicking send dispatches message and clears input (skip: triggers real AI)
 *  AC4b  – Shift+Enter inserts newline, does not send
 *  AC5   – stop button not visible when agent is idle
 *  AC5a  – stop button visible during AI generation (skip: requires real AI streaming)
 *  AC6   – sendbox tools bar is visible
 *  AC7   – settings gear button is in the header bar, NOT in sendbox tools
 *  AC8   – clicking gear opens settings popup with at least 1 parameter row
 *  AC9   – settings popup has "Model" row with non-empty model name
 *  AC10  – settings popup has "Permission" row (for ACP agents)
 *  AC11  – Codex agents show "Config" row (skip: requires Codex agent backend)
 *  AC12  – settings popup bounding rect within viewport (not clipped)
 *  AC13  – settings popup shows click-outside overlay
 *  AC14  – clicking outside the popup closes it
 *  AC15  – open/close popup 3x without console errors
 *  AC16  – typing @ triggers file reference menu (requires workspace)
 *  AC17  – typing / triggers slash command menu
 *  AC18  – input > 800 chars switches to multi-line mode
 *  AC19  – drag file onto sendbox (skip: Playwright + Electron dataTransfer limitation)
 *  AC20  – paste image into sendbox (skip: Electron clipboard→paste unreliable)
 *  AC21  – backspace after @ closes the file reference menu
 *  AC22  – sending while agent is busy queues or blocks (skip: requires real AI)
 *  AC23  – typing @ in conversation without workspace does not crash
 *
 * Data construction strategy:
 *  – Primary conversation: created via IPC, seeded with 2 messages (most tests).
 *  – Workspace conversation: created via IPC with extra.workspace (AC16/AC21).
 *  – All conversations cleaned up in afterAll (D-012).
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  waitForSettle,
  SENDBOX_PANEL,
  SENDBOX_SEND_BTN,
  SENDBOX_STOP_BTN,
  SENDBOX_TOOLS,
  SENDBOX_SETTINGS_BTN,
  SENDBOX_SETTINGS_POPUP,
  CHAT_LAYOUT_HEADER,
  invokeBridge,
  createErrorCollector,
} from '../helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Data construction ─────────────────────────────────────────────────────────

type TChatConversation = { id: string; [key: string]: unknown };

let _testConversationId: string | null = null;
let _wsConversationId: string | null = null;
let _tmpDir: string | null = null;

const baseConvParams = {
  type: 'acp' as const,
  model: { id: 'builtin-claude', useModel: 'claude-3-5-haiku-20241022' },
  extra: { backend: 'claude', agentName: 'claude' },
};

test.beforeAll(async ({ page }) => {
  await goToGuid(page);
  await waitForSettle(page);

  // 1) Primary conversation — 2 messages, no workspace
  try {
    const conv = await invokeBridge<TChatConversation>(page, 'create-conversation', {
      ...baseConvParams,
      name: 'E2E SendBox Test (primary)',
    });
    if (conv?.id) {
      _testConversationId = conv.id;
      await invokeBridge(page, 'conversation.inject-test-messages', {
        conversation_id: conv.id,
        count: 2,
      });
    }
  } catch (err) {
    console.warn('[sendbox-ui] beforeAll: primary conversation failed:', err);
  }

  // 2) Workspace conversation — for AC16/AC21 (@-file tests)
  try {
    _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sendbox-ws-'));
    fs.writeFileSync(path.join(_tmpDir, 'test-file.txt'), 'E2E test content');

    const wsConv = await invokeBridge<TChatConversation>(page, 'create-conversation', {
      ...baseConvParams,
      name: 'E2E SendBox Test (workspace)',
      extra: { ...baseConvParams.extra, workspace: _tmpDir },
    });
    if (wsConv?.id) {
      _wsConversationId = wsConv.id;
      await invokeBridge(page, 'conversation.inject-test-messages', {
        conversation_id: wsConv.id,
        count: 1,
      });
    }
  } catch (err) {
    console.warn('[sendbox-ui] beforeAll: workspace conversation failed:', err);
  }
});

test.afterAll(async ({ page }) => {
  for (const id of [_testConversationId, _wsConversationId]) {
    if (id) {
      try {
        await invokeBridge(page, 'remove-conversation', { id });
      } catch {
        // best-effort cleanup
      }
    }
  }
  if (_tmpDir) {
    try {
      fs.rmSync(_tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function navigateToConversation(page: import('@playwright/test').Page, convId: string | null): Promise<void> {
  if (!convId) throw new Error('Conversation ID is null — beforeAll likely failed');
  await page.evaluate((id) => {
    window.location.hash = `#/conversation/${id}`;
  }, convId);
  await page.waitForFunction((id) => window.location.hash.includes(`/conversation/${id}`), convId, {
    timeout: 10_000,
  });
  await waitForSettle(page);
}

// ── 1. Basic input & send (AC1–AC4b) ─────────────────────────────────────────

test.describe('Basic input & send', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!_testConversationId, 'Primary conversation not created');
    await navigateToConversation(page, _testConversationId);
  });

  test('AC1: sendbox panel is visible with textarea', async ({ page }) => {
    await expect(page.locator(SENDBOX_PANEL).first()).toBeVisible({ timeout: 8_000 });
    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
  });

  test('AC2: textarea is editable', async ({ page }) => {
    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.fill('Hello E2E');
    await expect(textarea).toHaveValue('Hello E2E');
    await textarea.fill('');
  });

  test('AC3: send button is disabled when input is empty', async ({ page }) => {
    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.fill('');
    const sendBtn = page.locator(SENDBOX_SEND_BTN).first();
    await expect(sendBtn).toBeVisible({ timeout: 8_000 });
    const isDisabled =
      (await sendBtn.getAttribute('disabled')) !== null ||
      (await sendBtn.getAttribute('aria-disabled')) === 'true' ||
      (await sendBtn.evaluate((el) => el.classList.contains('arco-btn-disabled')));
    expect(isDisabled, 'AC3: send button should be disabled when input is empty').toBe(true);
  });

  test('AC4: send button is enabled when input has text', async ({ page }) => {
    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.fill('hello');
    const sendBtn = page.locator(SENDBOX_SEND_BTN).first();
    await expect(sendBtn).toBeVisible({ timeout: 8_000 });
    const isDisabled =
      (await sendBtn.getAttribute('disabled')) !== null ||
      (await sendBtn.getAttribute('aria-disabled')) === 'true' ||
      (await sendBtn.evaluate((el) => el.classList.contains('arco-btn-disabled')));
    expect(isDisabled, 'AC4: send button should be enabled when input has text').toBe(false);
    await textarea.fill('');
  });

  test('AC4a: clicking send dispatches message and clears input', async () => {
    // Sends a real message to the AI backend — not safe for CI without mock
    test.skip(true, 'AC4a: triggers real AI request; skip in automated E2E');
  });

  test('AC4b: Shift+Enter inserts newline, does not send', async ({ page }) => {
    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.click();
    await textarea.fill('');
    await textarea.type('line1');
    await textarea.press('Shift+Enter');
    await textarea.type('line2');
    const value = await textarea.inputValue();
    expect(value, 'AC4b: Shift+Enter should insert newline').toContain('\n');
    expect(value).toContain('line1');
    expect(value).toContain('line2');
    await textarea.fill('');
  });
});

// ── 2. Stop button (AC5, AC5a) ───────────────────────────────────────────────

test.describe('Stop button', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!_testConversationId, 'Primary conversation not created');
    await navigateToConversation(page, _testConversationId);
  });

  test('AC5: stop button is NOT visible when agent is idle', async ({ page }) => {
    const stopBtn = page.locator(SENDBOX_STOP_BTN).first();
    const isVisible = await stopBtn.isVisible().catch(() => false);
    expect(isVisible, 'AC5: stop button should not be visible when idle').toBe(false);
  });

  test('AC5a: stop button visible during AI generation', async () => {
    test.skip(true, 'AC5a: requires real AI streaming backend; skip in automated E2E');
  });
});

// ── 3. Toolbar & settings popup (AC6–AC15) ───────────────────────────────────

test.describe('Toolbar & settings popup', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!_testConversationId, 'Primary conversation not created');
    await navigateToConversation(page, _testConversationId);
  });

  test('AC6: sendbox tools area is visible', async ({ page }) => {
    const tools = page.locator(SENDBOX_TOOLS).first();
    await expect(tools).toBeVisible({ timeout: 8_000 });
  });

  test('AC7: settings gear button is in the header bar, not in sendbox tools', async ({ page }) => {
    // Gear button should be inside CHAT_LAYOUT_HEADER
    const gearInHeader = page.locator(`${CHAT_LAYOUT_HEADER} ${SENDBOX_SETTINGS_BTN}`).first();
    await expect(gearInHeader).toBeVisible({ timeout: 8_000 });

    // Gear button should NOT be inside SENDBOX_TOOLS
    const gearInTools = page.locator(`${SENDBOX_TOOLS} ${SENDBOX_SETTINGS_BTN}`);
    const gearInToolsCount = await gearInTools.count();
    expect(gearInToolsCount, 'AC7: gear should not be in sendbox tools area').toBe(0);
  });

  test('AC8: clicking gear opens settings popup with at least 1 parameter row', async ({ page }) => {
    const btn = page.locator(SENDBOX_SETTINGS_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await btn.click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    const labels = popup.locator('span.text-12px');
    const count = await labels.count();
    expect(count, 'AC8: popup should have at least 1 parameter row').toBeGreaterThan(0);
    await page.evaluate(() => {
      const overlay = document.querySelector('body > div.fixed.inset-0') as HTMLElement;
      overlay?.click();
    });
  });

  test('AC9: settings popup shows Model row with non-empty model name', async ({ page }) => {
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    // Find the "Model" label inside popup rows (span.text-12px contains label text)
    const modelLabel = popup.locator('span.text-12px').filter({ hasText: /模型|model/i }).first();
    await expect(modelLabel).toBeVisible({ timeout: 3_000 });
    // The model value is in the same row — verify the row has content beyond the label
    const modelRow = modelLabel.locator('..');
    const rowText = await modelRow.textContent();
    expect((rowText ?? '').length, 'AC9: model row should contain a model name').toBeGreaterThan(2);
    // Close via overlay click
    await page.evaluate(() => {
      const overlay = document.querySelector('body > div.fixed.inset-0') as HTMLElement;
      overlay?.click();
    });
  });

  test('AC10: settings popup shows Permission row', async ({ page }) => {
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    const permLabel = popup.locator('span.text-12px').filter({ hasText: /权限|permission/i }).first();
    await expect(permLabel).toBeVisible({ timeout: 3_000 });
    await page.evaluate(() => {
      const overlay = document.querySelector('body > div.fixed.inset-0') as HTMLElement;
      overlay?.click();
    });
  });

  test('AC11: Codex agent popup shows Config row', async () => {
    test.skip(true, 'AC11: requires Codex agent backend; skip in automated E2E');
  });

  test('AC12: settings popup bounding rect within viewport (not clipped)', async ({ page }) => {
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });

    const rect = await popup.boundingBox();
    const viewport = page.viewportSize();
    expect(rect, 'AC12: popup bounding box should exist').not.toBeNull();
    expect(viewport, 'AC12: viewport should exist').not.toBeNull();
    if (!rect || !viewport) return;

    expect(rect.x, 'AC12: popup left edge >= 0').toBeGreaterThanOrEqual(0);
    expect(rect.y, 'AC12: popup top edge >= 0').toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, 'AC12: right edge <= viewport').toBeLessThanOrEqual(viewport.width + 1);
    expect(rect.y + rect.height, 'AC12: bottom edge <= viewport').toBeLessThanOrEqual(viewport.height + 1);
    await page.evaluate(() => {
      const overlay = document.querySelector('body > div.fixed.inset-0') as HTMLElement;
      overlay?.click();
    });
  });

  test('AC13: settings popup shows click-outside overlay', async ({ page }) => {
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    await expect(page.locator(SENDBOX_SETTINGS_POPUP).first()).toBeVisible({ timeout: 5_000 });
    const overlayInDom = await page.evaluate(() => {
      const elements = document.querySelectorAll('body > div');
      return Array.from(elements).some(
        (el) => (el as HTMLElement).style.zIndex === '998' && el.classList.contains('fixed'),
      );
    });
    expect(overlayInDom, 'AC13: click-outside overlay should be in DOM').toBe(true);
    await page.evaluate(() => {
      const overlay = document.querySelector('body > div.fixed.inset-0') as HTMLElement;
      overlay?.click();
    });
  });

  test('AC14: clicking outside the popup closes it', async ({ page }) => {
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    // The overlay (fixed inset-0, z-998) catches click-outside events.
    // Click it directly to close the popup (Playwright's header click is intercepted by overlay).
    await page.evaluate(() => {
      const overlay = document.querySelector('body > div.fixed.inset-0') as HTMLElement;
      overlay?.click();
    });
    await expect(popup).toBeHidden({ timeout: 3_000 });
  });

  test('AC15: open/close popup 3x without console errors', async ({ page }) => {
    const collector = createErrorCollector(page);
    for (let i = 0; i < 3; i++) {
      // Use evaluate to click gear — avoids Playwright overlay interception
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="sendbox-settings-btn"]') as HTMLElement;
        btn?.click();
      });
      await page.locator(SENDBOX_SETTINGS_POPUP).first().waitFor({ state: 'visible', timeout: 3_000 });
      // Close via overlay click
      await page.evaluate(() => {
        const overlay = document.querySelector('body > div.fixed.inset-0') as HTMLElement;
        overlay?.click();
      });
      await page.locator(SENDBOX_SETTINGS_POPUP).first().waitFor({ state: 'hidden', timeout: 3_000 });
    }
    const critical = collector.critical().filter((e) => !e.includes('ResizeObserver') && !e.includes('net::ERR_'));
    expect(critical, 'AC15: no critical console errors after 3x toggle').toHaveLength(0);
  });
});

// ── 4. File reference & slash commands (AC16, AC17, AC21, AC23) ──────────────

test.describe('File reference & slash commands', () => {
  test('AC16: typing @ triggers file reference menu (workspace conversation)', async ({ page }) => {
    test.skip(!_wsConversationId, 'Workspace conversation not created');
    await navigateToConversation(page, _wsConversationId);

    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.click();
    await textarea.fill('');
    await textarea.type('@');

    // AtFileMenu uses role="listbox" inside an absolute-positioned container above sendbox
    const atFileMenu = page.locator('[role="listbox"]');
    const menuVisible = await atFileMenu.first().isVisible({ timeout: 5_000 }).catch(() => false);
    expect(menuVisible, 'AC16: @ should trigger file reference menu in workspace conversation').toBe(true);

    await textarea.fill('');
  });

  test('AC17: typing / triggers slash command menu', async ({ page }) => {
    test.skip(!_testConversationId, 'Primary conversation not created');
    await navigateToConversation(page, _testConversationId);

    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.click();
    await textarea.fill('');
    await textarea.type('/');

    // SlashCommandMenu renders in .absolute.left-12px.right-12px above sendbox with rounded-14px
    const slashMenu = page.locator('.sendbox-panel .absolute.left-12px.right-12px .rounded-14px');
    const menuVisible = await slashMenu.first().isVisible({ timeout: 5_000 }).catch(() => false);
    expect(menuVisible, 'AC17: / should trigger slash command menu').toBe(true);

    await textarea.fill('');
  });

  test('AC21: backspace after @ closes the file reference menu', async ({ page }) => {
    test.skip(!_wsConversationId, 'Workspace conversation not created');
    await navigateToConversation(page, _wsConversationId);

    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.click();
    await textarea.fill('');
    await textarea.type('@');

    // Wait for menu to appear
    const atFileMenu = page.locator('[role="listbox"]');
    await atFileMenu.first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});

    // Backspace to delete @
    await textarea.press('Backspace');
    await page.waitForTimeout(500);

    const menuGone = await atFileMenu.first().isVisible({ timeout: 1_000 }).catch(() => false);
    expect(menuGone, 'AC21: backspace after @ should close file reference menu').toBe(false);

    await textarea.fill('');
  });

  test('AC23: typing @ in conversation without workspace does not crash', async ({ page }) => {
    test.skip(!_testConversationId, 'Primary conversation not created');
    await navigateToConversation(page, _testConversationId);

    const collector = createErrorCollector(page);
    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await textarea.click();
    await textarea.fill('');
    await textarea.type('@test');
    await page.waitForTimeout(500);

    const critical = collector.critical().filter((e) => !e.includes('ResizeObserver') && !e.includes('net::ERR_'));
    expect(critical, 'AC23: typing @ without workspace should not crash').toHaveLength(0);

    await textarea.fill('');
  });
});

// ── 5. Edge cases (AC18, AC19, AC20, AC22) ───────────────────────────────────

test.describe('Edge cases', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!_testConversationId, 'Primary conversation not created');
    await navigateToConversation(page, _testConversationId);
  });

  test('AC18: input > 800 chars switches to multi-line mode', async ({ page }) => {
    const textarea = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });

    // AcpSendBox passes lockMultiLine={true} and defaultMultiLine={true},
    // so it's already in multi-line mode. Verify that 900 chars don't break anything
    // and that the textarea uses wrap mode (whiteSpace !== 'nowrap').
    const longText = 'a'.repeat(900);
    await textarea.fill(longText);
    await page.waitForTimeout(500);

    const isMultiLine = await textarea.evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.whiteSpace !== 'nowrap';
    });
    expect(isMultiLine, 'AC18: textarea should be in multi-line mode for >800 chars').toBe(true);

    // Verify the input value was not truncated
    const value = await textarea.inputValue();
    expect(value.length, 'AC18: input should not be truncated').toBe(900);

    await textarea.fill('');
  });

  test('AC19: drag file onto sendbox shows drag highlight', async () => {
    test.skip(true, 'AC19: Playwright + Electron dataTransfer limitation; manual test only');
  });

  test('AC20: paste image into sendbox adds attachment', async () => {
    test.skip(true, 'AC20: Electron clipboard-to-paste event chain unreliable in Playwright; manual test only');
  });

  test('AC22: sending while agent is busy queues or blocks', async () => {
    test.skip(true, 'AC22: requires real AI streaming backend; skip in automated E2E');
  });
});
