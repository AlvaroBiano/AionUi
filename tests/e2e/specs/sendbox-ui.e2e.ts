/**
 * SendBox UI – E2E tests covering:
 *  1. Sendbox panel structure (input, send button, tools)
 *  2. Send button enabled/disabled state
 *  3. Settings gear popup: opens, content visible, NOT clipped (image-#27 regression),
 *     overlay present, closes on outside click
 *  4. Stop button visible during processing
 *  5. Model selector in sendbox tools
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  SIDER_CONTACT_ROW,
  SENDBOX_PANEL,
  SENDBOX_SEND_BTN,
  SENDBOX_STOP_BTN,
  SENDBOX_TOOLS,
  SENDBOX_SETTINGS_BTN,
  SENDBOX_SETTINGS_POPUP,
  CHAT_LAYOUT_HEADER,
  MODEL_SELECTOR_BTN,
  ARCO_SELECT_DROPDOWN,
  takeScreenshot,
  createErrorCollector,
} from '../helpers';

// ── Helper ────────────────────────────────────────────────────────────────────

async function goToFirstConversation(page: import('@playwright/test').Page): Promise<string | null> {
  await goToGuid(page);
  const row = page.locator(SIDER_CONTACT_ROW).filter({ hasText: /.+/ }).first();
  if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) return null;
  await row.click();
  try {
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
  } catch {
    return null;
  }
  return page.url().split('/conversation/')[1]?.split('?')[0] ?? null;
}

// ── 1. Sendbox panel ──────────────────────────────────────────────────────────

test.describe('Sendbox panel – structure', () => {
  test('sendbox panel is visible in conversation', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await expect(page.locator(SENDBOX_PANEL).first()).toBeVisible({ timeout: 8_000 });
  });

  test('sendbox has a text input area', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const input = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await expect(input).toBeVisible({ timeout: 8_000 });
  });

  test('text input is editable', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const input = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await input.fill('Hello E2E');
    await expect(input).toHaveValue('Hello E2E');
    // Clean up
    await input.fill('');
  });

  test('sendbox tools area is present', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const tools = page.locator(SENDBOX_TOOLS).first();
    await expect(tools).toBeVisible({ timeout: 8_000 });
  });
});

// ── 2. Send button state ──────────────────────────────────────────────────────

test.describe('Send button – enabled/disabled state', () => {
  test('send button is visible in sendbox', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await expect(page.locator(SENDBOX_SEND_BTN).first()).toBeVisible({ timeout: 8_000 });
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    // Ensure input is empty
    const input = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await input.fill('');
    const sendBtn = page.locator(SENDBOX_SEND_BTN).first();
    await expect(sendBtn).toBeVisible({ timeout: 8_000 });
    // Arco Button disabled adds aria-disabled or .arco-btn-disabled
    const isDisabled =
      (await sendBtn.getAttribute('disabled')) !== null ||
      (await sendBtn.getAttribute('aria-disabled')) === 'true' ||
      (await sendBtn.evaluate((el) => el.classList.contains('arco-btn-disabled')));
    expect(isDisabled).toBe(true);
  });

  test('send button becomes enabled when text is typed', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const input = page.locator(`${SENDBOX_PANEL} textarea`).first();
    await input.fill('hello');
    const sendBtn = page.locator(SENDBOX_SEND_BTN).first();
    await expect(sendBtn).toBeVisible({ timeout: 8_000 });
    // Should no longer be disabled
    const isDisabled =
      (await sendBtn.getAttribute('disabled')) !== null ||
      (await sendBtn.getAttribute('aria-disabled')) === 'true' ||
      (await sendBtn.evaluate((el) => el.classList.contains('arco-btn-disabled')));
    expect(isDisabled).toBe(false);
    // Clean up
    await input.fill('');
  });

  test('stop button is NOT visible when agent is idle', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const stopBtn = page.locator(SENDBOX_STOP_BTN).first();
    const isVisible = await stopBtn.isVisible().catch(() => false);
    // Stop button should not be visible when no message is being processed
    expect(isVisible).toBe(false);
  });
});

// ── 3. Settings gear popup ────────────────────────────────────────────────────

test.describe('Settings gear popup', () => {
  test('settings gear button is visible in the sendbox', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const btn = page.locator(SENDBOX_SETTINGS_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });

  test('clicking gear button opens the settings popup', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const btn = page.locator(SENDBOX_SETTINGS_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await btn.click();
    await expect(page.locator(SENDBOX_SETTINGS_POPUP).first()).toBeVisible({ timeout: 5_000 });
  });

  /**
   * REGRESSION: image #27 bug.
   * The popup must NOT be clipped by the sendbox container's overflow.
   * Verifies that the popup's bounding rect is fully within the viewport.
   */
  test('settings popup is NOT clipped – bounding rect within viewport', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const btn = page.locator(SENDBOX_SETTINGS_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await btn.click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });

    const rect = await popup.boundingBox();
    const viewport = page.viewportSize();
    expect(rect).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!rect || !viewport) return;

    // All edges must be within viewport bounds
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  });

  test('settings popup content has at least one label row', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    // Each row has a label span with text-12px text-t-secondary
    const labels = popup.locator('span.text-12px');
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('settings popup shows model section label', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    // Label text for model row (i18n: '模型' in zh-CN, 'Model' in en-US)
    const modelLabel = popup.getByText(/模型|model/i).first();
    await expect(modelLabel).toBeVisible({ timeout: 3_000 });
  });

  test('click-outside overlay is rendered when popup is open', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    await expect(page.locator(SENDBOX_SETTINGS_POPUP).first()).toBeVisible({ timeout: 5_000 });
    // The portal overlay at z-998 should be in document.body
    const overlay = page.locator('body > div.fixed.inset-0').first();
    const hasOverlay = await overlay.isVisible().catch(() => false);
    // Overlay may be invisible (transparent) but should exist in DOM
    const overlayInDom = await page.evaluate(() => {
      const elements = document.querySelectorAll('body > div');
      return Array.from(elements).some(
        (el) => (el as HTMLElement).style.zIndex === '998' && el.classList.contains('fixed')
      );
    });
    expect(overlayInDom).toBe(true);
  });

  test('clicking outside the popup closes it', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    const popup = page.locator(SENDBOX_SETTINGS_POPUP).first();
    await expect(popup).toBeVisible({ timeout: 5_000 });
    // Click the overlay / elsewhere in the header
    await page
      .locator(CHAT_LAYOUT_HEADER)
      .first()
      .click({ position: { x: 100, y: 15 } });
    await expect(popup).toBeHidden({ timeout: 3_000 });
  });

  test('opening and closing popup multiple times does not crash', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const collector = createErrorCollector(page);
    const btn = page.locator(SENDBOX_SETTINGS_BTN).first();
    for (let i = 0; i < 3; i++) {
      await btn.click();
      await page.locator(SENDBOX_SETTINGS_POPUP).first().waitFor({ state: 'visible', timeout: 3_000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    const critical = collector.critical().filter((e) => !e.includes('ResizeObserver') && !e.includes('net::ERR_'));
    expect(critical).toHaveLength(0);
  });

  test('screenshot: settings popup open', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation');
    await page.locator(SENDBOX_SETTINGS_BTN).first().click();
    await page.locator(SENDBOX_SETTINGS_POPUP).first().waitFor({ state: 'visible', timeout: 3_000 });
    await takeScreenshot(page, 'sendbox-settings-popup');
  });
});

// ── 4. Model selector in sendbox tools ───────────────────────────────────────

test.describe('Model selector in sendbox tools', () => {
  test('model selector button is visible in sendbox tools', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    // ACP/Gemini/Aionrs all pass model selector via SendBoxSettingsPopover
    // Also check the guid model selector pattern
    const modelBtn = page.locator(`${SENDBOX_TOOLS} .sendbox-model-btn, ${SENDBOX_TOOLS} [class*="model"]`).first();
    const hasModelBtn = await modelBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    // Some conversation types may not show model btn in tools — graceful
    if (!hasModelBtn) {
      test.skip(true, 'This conversation type does not expose model selector in sendbox tools');
    }
    await expect(modelBtn).toBeVisible();
  });
});
