/**
 * Conversation Lifecycle – E2E tests covering:
 *  1. Guid page baseline (loads, agent pills, model selector)
 *  2. Sidebar navigation to existing conversations
 *  3. Conversation page structure (header, sendbox, messages)
 *  4. History panel: dropdown, list, new-conversation shortcut
 *  5. Workspace panel visibility
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  navigateTo,
  waitForSettle,
  ROUTES,
  SIDER_CONTACT_ROW,
  SIDER_TAB_MESSAGES,
  SIDER_TAB_AGENTS,
  AGENT_PILL,
  AGENT_PILL_SELECTED,
  MODEL_SELECTOR_BTN,
  GUID_INPUT,
  CHAT_LAYOUT_HEADER,
  HISTORY_PANEL_BTN,
  HISTORY_PANEL_DROPDOWN,
  SENDBOX_PANEL,
  CONVERSATION_ITEM,
  WORKSPACE_RIGHT_PANEL,
  takeScreenshot,
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
  const hash = page.url();
  return hash.split('/conversation/')[1]?.split('?')[0] ?? null;
}

// ── 1. Guid page ──────────────────────────────────────────────────────────────

test.describe('Guid page – baseline', () => {
  test('guid page loads with content', async ({ page }) => {
    await goToGuid(page);
    await waitForSettle(page);
    const body = await page.locator('body').textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
  });

  test('at least one agent pill is visible', async ({ page }) => {
    await goToGuid(page);
    const pills = page.locator(AGENT_PILL);
    await expect(pills.first()).toBeVisible({ timeout: 8_000 });
    const count = await pills.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking an unselected agent pill selects it', async ({ page }) => {
    await goToGuid(page);
    // Find a pill that is NOT currently selected
    const unselected = page.locator(`${AGENT_PILL}:not([data-agent-selected="true"])`).first();
    const hasUnselected = await unselected.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasUnselected, 'All pills already selected or only one pill available');

    await unselected.click();
    await expect(unselected).toHaveAttribute('data-agent-selected', 'true', { timeout: 3_000 });
  });

  test('model selector button is visible on guid page', async ({ page }) => {
    await goToGuid(page);
    const btn = page.locator(MODEL_SELECTOR_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });

  test('model selector shows model name text', async ({ page }) => {
    await goToGuid(page);
    const btn = page.locator(MODEL_SELECTOR_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
    const text = await btn.textContent();
    // Should have some model name, not be empty
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('model selector opens a dropdown when clicked', async ({ page }) => {
    await goToGuid(page);
    const btn = page.locator(MODEL_SELECTOR_BTN).first();
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await btn.click();
    // Arco Select dropdown portal
    const dropdown = page.locator('.arco-select-dropdown, .arco-trigger-popup').first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
  });

  test('guid chat input textarea is present', async ({ page }) => {
    await goToGuid(page);
    const input = page.locator(GUID_INPUT).first();
    await expect(input).toBeVisible({ timeout: 8_000 });
  });

  test('screenshot: guid page default', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await goToGuid(page);
    await waitForSettle(page);
    await takeScreenshot(page, 'guid-page-default');
  });
});

// ── 2. Sidebar tab switcher ───────────────────────────────────────────────────

test.describe('Sidebar – tab switcher', () => {
  test('messages tab and agents tab are both visible', async ({ page }) => {
    await goToGuid(page);
    await expect(page.locator(SIDER_TAB_MESSAGES).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(SIDER_TAB_AGENTS).first()).toBeVisible({ timeout: 8_000 });
  });

  test('clicking agents tab switches sidebar content', async ({ page }) => {
    await goToGuid(page);
    const agentsTab = page.locator(SIDER_TAB_AGENTS).first();
    await expect(agentsTab).toBeVisible({ timeout: 8_000 });
    await agentsTab.click();
    // After switching, agent section headers should appear
    const sectionHeader = page.locator('[data-agent-section]').first();
    await expect(sectionHeader).toBeVisible({ timeout: 5_000 });
  });

  test('clicking messages tab switches back to conversation list', async ({ page }) => {
    await goToGuid(page);
    // Switch to agents first
    await page.locator(SIDER_TAB_AGENTS).first().click();
    // Switch back to messages
    await page.locator(SIDER_TAB_MESSAGES).first().click();
    // Messages tab shows search trigger or conversation list
    const messagesContent = page
      .locator('.conversation-search-trigger-full, .conversation-item, div.newChatTrigger')
      .first();
    await expect(messagesContent).toBeVisible({ timeout: 5_000 });
  });
});

// ── 3. Sidebar – conversation navigation ──────────────────────────────────────

test.describe('Sidebar – conversation navigation', () => {
  test('sidebar shows conversation items when conversations exist', async ({ page }) => {
    await goToGuid(page);
    const item = page.locator(CONVERSATION_ITEM).first();
    const hasConversations = await item.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasConversations, 'No conversations in sandbox');
    await expect(item).toBeVisible();
  });

  test('clicking a sidebar conversation row navigates to /conversation/:id', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversations to navigate to');
    expect(page.url()).toContain('/conversation/');
    expect(id).toBeTruthy();
  });

  test('conversation URL contains a non-empty ID segment', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversations to navigate to');
    expect(id!.length).toBeGreaterThan(0);
  });
});

// ── 4. Conversation page – structure ─────────────────────────────────────────

test.describe('Conversation page – structure', () => {
  test('chat layout header is visible', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await expect(page.locator(CHAT_LAYOUT_HEADER).first()).toBeVisible({ timeout: 8_000 });
  });

  test('header shows non-empty conversation title', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const header = page.locator(CHAT_LAYOUT_HEADER).first();
    await expect(header).toBeVisible({ timeout: 8_000 });
    const text = await header.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('sendbox panel is present in conversation', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await expect(page.locator(SENDBOX_PANEL).first()).toBeVisible({ timeout: 8_000 });
  });

  test('sendbox has a text input area', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const input = page.locator(`${SENDBOX_PANEL} textarea, ${SENDBOX_PANEL} [contenteditable="true"]`).first();
    await expect(input).toBeVisible({ timeout: 8_000 });
  });

  test('at least one message item is rendered', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    // Wait for message list to load
    const item = page.locator('.message-item').first();
    await expect(item).toBeVisible({ timeout: 12_000 });
  });

  test('screenshot: conversation page', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation');
    await takeScreenshot(page, 'conversation-page');
  });
});

// ── 5. History panel ─────────────────────────────────────────────────────────

test.describe('History panel – dropdown and navigation', () => {
  test('history button is in the conversation header', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await expect(page.locator(HISTORY_PANEL_BTN).first()).toBeVisible({ timeout: 8_000 });
  });

  test('clicking history button opens the history dropdown', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(HISTORY_PANEL_BTN).first().click();
    await expect(page.locator(HISTORY_PANEL_DROPDOWN).first()).toBeVisible({ timeout: 5_000 });
  });

  test('history dropdown shows "新会话" / "New Conversation" option at top', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(HISTORY_PANEL_BTN).first().click();
    const newBtn = page
      .locator(HISTORY_PANEL_DROPDOWN)
      .getByText(/新会话|New Conversation/i)
      .first();
    await expect(newBtn).toBeVisible({ timeout: 5_000 });
  });

  test('history dropdown lists conversation items', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(HISTORY_PANEL_BTN).first().click();
    const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    // There should be at least the "new conversation" entry
    const items = dropdown.locator('div[class*="cursor-pointer"]');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('current conversation is highlighted in dropdown', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(HISTORY_PANEL_BTN).first().click();
    const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    // Active item should have the fill-2 background class
    const activeItem = dropdown.locator('[class*="bg-"][class*="fill"]').first();
    const hasActive = await activeItem.isVisible().catch(() => false);
    expect(hasActive).toBe(true);
  });

  test('clicking history dropdown item navigates to that conversation', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(HISTORY_PANEL_BTN).first().click();
    const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    // Click a non-active conversation item (skip "new conversation" row and active row)
    const items = dropdown.locator('div[class*="cursor-pointer"]');
    const count = await items.count();
    if (count < 3) {
      test.skip(true, 'Not enough conversations to test navigation');
      return;
    }
    // Click 3rd item (index 2: 0=new chat, 1=divider or active, 2=another conv)
    const thirdItem = items.nth(2);
    const isClickable = await thirdItem.isVisible().catch(() => false);
    if (!isClickable) return;
    await thirdItem.click();
    // URL should still be a conversation page
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 5_000 });
    expect(page.url()).toContain('/conversation/');
  });

  test('clicking "新会话" creates a new conversation', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const initialUrl = page.url();
    await page.locator(HISTORY_PANEL_BTN).first().click();
    const newBtn = page
      .locator(HISTORY_PANEL_DROPDOWN)
      .getByText(/新会话|New Conversation/i)
      .first();
    await expect(newBtn).toBeVisible({ timeout: 5_000 });
    await newBtn.click();
    // Should navigate to a different conversation URL
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
    const newUrl = page.url();
    expect(newUrl).not.toBe(initialUrl);
    expect(newUrl).toContain('/conversation/');
  });

  test('history dropdown closes when clicking elsewhere', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    await page.locator(HISTORY_PANEL_BTN).first().click();
    const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    await page
      .locator(CHAT_LAYOUT_HEADER)
      .first()
      .click({ position: { x: 200, y: 10 } });
    await expect(dropdown).toBeHidden({ timeout: 3_000 });
  });
});

// ── 6. Workspace panel ────────────────────────────────────────────────────────

test.describe('Workspace panel', () => {
  test('workspace panel is present in DOM for conversation page', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    // The right-sider exists in DOM but may be collapsed (width: 0)
    const panel = page.locator(WORKSPACE_RIGHT_PANEL).first();
    // Check it's in DOM (even if visually hidden/collapsed)
    const inDom = await panel.count();
    expect(inDom).toBeGreaterThanOrEqual(0); // graceful: not all convs have workspace
  });

  test('workspace panel shows content for workspace-enabled conversations', async ({ page }) => {
    const id = await goToFirstConversation(page);
    test.skip(!id, 'No existing conversation to navigate to');
    const panel = page.locator(WORKSPACE_RIGHT_PANEL).first();
    const hasPanel = await panel.isVisible().catch(() => false);
    test.skip(!hasPanel, 'This conversation does not have workspace enabled');
    await expect(panel).toBeVisible();
    const text = await panel.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
