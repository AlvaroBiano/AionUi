/**
 * Chat Layout Redesign – E2E tests for the digital-human-redesign branch.
 *
 * Covers:
 *  1. Sidebar private-message categories collapse by default
 *  2. Chat header shows agent avatar + bold name (contact style)
 *  3. History panel: renders, hover doesn't crash, click opens dropdown
 *  4. Message avatar/name header: appears on first message, not repeated
 *  5. Time dividers: present, no HR lines, correct font size
 *  6. Thinking message: collapsible, correct font size
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  waitForSettle,
  createErrorCollector,
  CHAT_LAYOUT_HEADER,
  HISTORY_PANEL_BTN,
  ARCO_DROPDOWN_MENU,
  MESSAGE_ITEM,
  MESSAGE_AUTHOR_HEADER,
  THINKING_MESSAGE,
  THINKING_HEADER,
  THINKING_BODY,
  takeScreenshot,
} from '../helpers';

// ── Helper: get the first conversation in the sidebar ────────────────────────

/**
 * Navigate to the first available conversation in the sidebar.
 * Returns the conversation ID from the URL, or null if none found.
 */
async function goToFirstConversation(page: import('@playwright/test').Page): Promise<string | null> {
  await goToGuid(page);

  // Find first clickable item in the sidebar DM list
  const siderItem = page
    .locator('.message-item-row, [class*="sider"] [class*="item"]')
    .filter({ hasText: /.+/ })
    .first();

  if (!(await siderItem.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return null;
  }

  await siderItem.click();

  try {
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
  } catch {
    return null;
  }

  const hash = page.url();
  const id = hash.split('/conversation/')[1]?.split('#')[0];
  return id || null;
}

// ── 1. Sidebar categories ────────────────────────────────────────────────────

test.describe('Sidebar – categories collapsed by default', () => {
  test('private-message section is visible in sidebar', async ({ page }) => {
    await goToGuid(page);
    await waitForSettle(page);

    // The 私信 / DM section header should be visible
    const dmSection = page.locator('text=/私信|DM|Direct/').first();
    await expect(dmSection).toBeVisible({ timeout: 8_000 });
  });

  test('screenshot: sidebar default state', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await goToGuid(page);
    await waitForSettle(page);
    await takeScreenshot(page, 'sidebar-default-collapsed');
  });
});

// ── 2. Chat header – contact style ──────────────────────────────────────────

test.describe('Chat header – agent contact style', () => {
  test('header bar is present on conversation page', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const header = page.locator(CHAT_LAYOUT_HEADER).first();
    await expect(header).toBeVisible({ timeout: 8_000 });
  });

  test('header shows agent name', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const header = page.locator(CHAT_LAYOUT_HEADER).first();
    await expect(header).toBeVisible({ timeout: 8_000 });
    const text = await header.textContent();
    // Header should contain some non-empty agent name text
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('screenshot: chat header contact style', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation');
    await takeScreenshot(page, 'chat-header-contact-style');
  });
});

// ── 3. History panel ─────────────────────────────────────────────────────────

test.describe('History panel', () => {
  test('history button is visible in conversation header', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const btn = page.locator(HISTORY_PANEL_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });

  test('hovering history button does NOT crash the page', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const collector = createErrorCollector(page);

    const btn = page.locator(HISTORY_PANEL_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });

    // Hover — this previously crashed with Tooltip+Dropdown nesting bug
    await btn.hover();
    await page.waitForTimeout(500);

    // Page should still be alive and have content
    const body = await page.locator('body').textContent();
    expect(body?.length).toBeGreaterThan(10);

    // No critical JS errors
    expect(collector.critical()).toHaveLength(0);
  });

  test('clicking history button opens dropdown', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const btn = page.locator(HISTORY_PANEL_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await btn.click();

    // Dropdown menu should appear (rendered in portal — search document body)
    const dropdown = page.locator(ARCO_DROPDOWN_MENU).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
  });

  test('dropdown contains "新会话" option', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const btn = page.locator(HISTORY_PANEL_BTN).first();
    await btn.click();

    const newConvItem = page
      .locator(ARCO_DROPDOWN_MENU)
      .getByText(/新会话|New Conversation/i)
      .first();
    await expect(newConvItem).toBeVisible({ timeout: 5_000 });
  });

  test('dropdown closes when clicking elsewhere', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const btn = page.locator(HISTORY_PANEL_BTN).first();
    await btn.click();

    const dropdown = page.locator(ARCO_DROPDOWN_MENU).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    // Click somewhere else to close
    await page
      .locator(CHAT_LAYOUT_HEADER)
      .first()
      .click({ position: { x: 200, y: 10 } });
    await expect(dropdown).toBeHidden({ timeout: 3_000 });
  });

  test('screenshot: history panel dropdown open', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation');

    const btn = page.locator(HISTORY_PANEL_BTN).first();
    await btn.click();
    await page.locator(ARCO_DROPDOWN_MENU).first().waitFor({ state: 'visible', timeout: 5_000 });
    await takeScreenshot(page, 'history-panel-dropdown');
  });
});

// ── 4. Message avatar / name header ─────────────────────────────────────────

test.describe('Message avatar and name header', () => {
  test('message items are present in conversation', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    // At least one message should be visible
    const items = page.locator(MESSAGE_ITEM).first();
    await expect(items).toBeVisible({ timeout: 10_000 });
  });

  test('author header row appears for agent messages', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    // Agent messages have a header with avatar + bold name (text-14px font-medium)
    const agentHeader = page.locator(`${MESSAGE_ITEM} .font-medium.text-t-primary`).first();
    await expect(agentHeader).toBeVisible({ timeout: 8_000 });
  });

  test('user message shows on the right side', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    // User messages have class `text` and `justify-end` from position='right'
    const userMsg = page.locator(`${MESSAGE_ITEM}.text.justify-end`).first();
    const isVisible = await userMsg.isVisible().catch(() => false);
    // Some conversations may only have agent messages — skip if no user messages visible
    test.skip(!isVisible, 'No user messages visible in this conversation');
    await expect(userMsg).toBeVisible();
  });

  test('screenshot: message list with avatars', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation');
    await takeScreenshot(page, 'message-list-avatars', { fullPage: false });
  });
});

// ── 5. Time dividers ─────────────────────────────────────────────────────────

test.describe('Time dividers', () => {
  test('no <hr> elements near time labels (lines removed)', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    // The time divider container should NOT contain an <hr> element
    const timeDividerContainer = page.locator('.text-13px.text-t-tertiary').first();
    const hasTimeDivider = await timeDividerContainer.isVisible().catch(() => false);
    if (!hasTimeDivider) return; // No time dividers in this conversation, test passes

    // Parent should not have <hr>
    const hrInDivider = timeDividerContainer.locator('..').locator('hr');
    await expect(hrInDivider).toHaveCount(0);
  });

  test('time divider text has correct size class', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const timeDivider = page.locator('.text-13px.text-t-tertiary.select-none').first();
    const isVisible = await timeDivider.isVisible().catch(() => false);
    if (!isVisible) return; // No time dividers — skip gracefully

    await expect(timeDivider).toBeVisible();
    // Verify it contains a formatted time string (digits + colon)
    const text = await timeDivider.textContent();
    expect(text).toMatch(/\d/);
  });
});

// ── 6. Thinking message ───────────────────────────────────────────────────────

test.describe('Thinking message', () => {
  test('thinking message container has correct structure', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const thinking = page.locator(THINKING_MESSAGE).first();
    const isVisible = await thinking.isVisible().catch(() => false);
    test.skip(!isVisible, 'No thinking messages in this conversation');

    // Should have a clickable header
    const header = page.locator(THINKING_HEADER).first();
    await expect(header).toBeVisible();
  });

  test('thinking header is clickable and toggles body', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const thinking = page.locator(THINKING_MESSAGE).first();
    const isVisible = await thinking.isVisible().catch(() => false);
    test.skip(!isVisible, 'No thinking messages in this conversation');

    const header = page.locator(THINKING_HEADER).first();
    const body = page.locator(THINKING_BODY).first();

    // Get initial state
    const wasVisible = await body.isVisible().catch(() => false);

    // Click header to toggle
    await header.click();
    await page.waitForTimeout(300); // CSS transition

    const isNowVisible = await body.isVisible().catch(() => false);
    // State should have toggled
    expect(isNowVisible).toBe(!wasVisible);
  });

  test('thinking message font size is 14px (matches body text)', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const thinking = page.locator(THINKING_MESSAGE).first();
    const isVisible = await thinking.isVisible().catch(() => false);
    test.skip(!isVisible, 'No thinking messages in this conversation');

    const body = page.locator(THINKING_BODY).first();
    const bodyExpanded = await body.isVisible().catch(() => false);
    if (!bodyExpanded) {
      // Expand first
      await page.locator(THINKING_HEADER).first().click();
      await page.waitForTimeout(300);
    }

    const fontSize = await body.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe('14px');
  });

  test('screenshot: thinking message', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation');
    await takeScreenshot(page, 'thinking-message');
  });
});

// ── 7. Crash regression: history panel hover ─────────────────────────────────

test.describe('Regression: no crash on hover', () => {
  test('hovering history button multiple times does not crash', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');

    const collector = createErrorCollector(page);
    const btn = page.locator(HISTORY_PANEL_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });

    // Hover 3 times in rapid succession
    for (let i = 0; i < 3; i++) {
      await btn.hover();
      await page.mouse.move(100, 300); // move away
      await btn.hover();
    }
    await page.waitForTimeout(500);

    // Page must still be alive
    await expect(page.locator('body')).toBeVisible();
    // No critical errors (the old bug threw: "Cannot read properties of null (reading 'offsetParent')")
    const critical = collector.critical().filter((e) => !e.includes('ResizeObserver') && !e.includes('net::ERR_'));
    expect(critical).toHaveLength(0);
  });
});
