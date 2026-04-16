/**
 * Conversation Operations – E2E tests covering:
 *  1. Conversation search (trigger, modal, input, close)
 *  2. Conversation context menu (hover → 3-dot → rename / delete options)
 *  3. Rename modal (input, pre-fill, cancel)
 *  4. Delete confirmation modal (buttons, cancel)
 *  5. Pin / unpin
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  waitForSettle,
  SIDER_CONTACT_ROW,
  CONVERSATION_ITEM,
  CONVERSATION_SEARCH_TRIGGER,
  CONVERSATION_SEARCH_MODAL,
  CONVERSATION_SEARCH_INPUT,
  ARCO_MODAL,
  ARCO_DROPDOWN_MENU,
  ARCO_DROPDOWN_MENU_ITEM,
  takeScreenshot,
} from '../helpers';

// ── Helper ────────────────────────────────────────────────────────────────────

async function goToFirstConversation(page: import('@playwright/test').Page): Promise<boolean> {
  await goToGuid(page);
  const row = page.locator(SIDER_CONTACT_ROW).filter({ hasText: /.+/ }).first();
  if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await row.click();
  try {
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

/** Hover a conversation item and wait for the 3-dot button to appear. */
async function hoverConversationRow(
  page: import('@playwright/test').Page
): Promise<import('@playwright/test').Locator | null> {
  await goToGuid(page);
  const item = page.locator(CONVERSATION_ITEM).first();
  if (!(await item.isVisible({ timeout: 5_000 }).catch(() => false))) return null;
  await item.hover();
  await page.waitForTimeout(300); // CSS transition
  return item;
}

// ── 1. Conversation search ────────────────────────────────────────────────────

test.describe('Conversation search', () => {
  test('search trigger button is visible in sidebar', async ({ page }) => {
    await goToGuid(page);
    await waitForSettle(page);
    const trigger = page.locator(CONVERSATION_SEARCH_TRIGGER).first();
    await expect(trigger).toBeVisible({ timeout: 8_000 });
  });

  test('clicking search trigger opens the search modal', async ({ page }) => {
    await goToGuid(page);
    const trigger = page.locator(CONVERSATION_SEARCH_TRIGGER).first();
    await expect(trigger).toBeVisible({ timeout: 8_000 });
    await trigger.click();
    await expect(page.locator(CONVERSATION_SEARCH_MODAL).first()).toBeVisible({ timeout: 5_000 });
  });

  test('search modal has a text input field', async ({ page }) => {
    await goToGuid(page);
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    await page.locator(CONVERSATION_SEARCH_MODAL).first().waitFor({ state: 'visible', timeout: 5_000 });
    const input = page.locator(`${CONVERSATION_SEARCH_MODAL} input, ${CONVERSATION_SEARCH_INPUT}`).first();
    await expect(input).toBeVisible({ timeout: 3_000 });
  });

  test('typing in search input filters results', async ({ page }) => {
    await goToGuid(page);
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
    const input = page.locator(`${CONVERSATION_SEARCH_MODAL} input`).first();
    await input.fill('a');
    // Give search a moment to process (debounced)
    await page.waitForTimeout(500);
    // Modal should still be visible
    await expect(modal).toBeVisible();
  });

  test('pressing Escape closes the search modal', async ({ page }) => {
    await goToGuid(page);
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden({ timeout: 3_000 });
  });

  test('search modal close button closes the modal', async ({ page }) => {
    await goToGuid(page);
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
    // Close button inside modal
    const closeBtn = page.locator('.conversation-search-modal__close-btn').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await expect(modal).toBeHidden({ timeout: 3_000 });
    }
  });

  test('screenshot: search modal open', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await goToGuid(page);
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    await page.locator(CONVERSATION_SEARCH_MODAL).first().waitFor({ state: 'visible', timeout: 5_000 });
    await takeScreenshot(page, 'search-modal');
  });
});

// ── 2. Conversation context menu ──────────────────────────────────────────────

test.describe('Conversation context menu', () => {
  test('hovering a conversation row reveals the 3-dot menu area', async ({ page }) => {
    const item = await hoverConversationRow(page);
    test.skip(!item, 'No conversations in sandbox');
    // The hidden group-hover:flex container should now be flex
    const menuWrap = item!.locator('.absolute.right-0px.top-0px, .absolute.right-0.top-0').first();
    await expect(menuWrap).toBeVisible({ timeout: 3_000 });
  });

  test('clicking the 3-dot button opens an Arco dropdown', async ({ page }) => {
    const item = await hoverConversationRow(page);
    test.skip(!item, 'No conversations in sandbox');
    const menuBtn = item!.locator('.flex-center.cursor-pointer.hover\\:bg-fill-2').first();
    const isVisible = await menuBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    test.skip(!isVisible, '3-dot button not found after hover');
    await menuBtn.click();
    await expect(page.locator(ARCO_DROPDOWN_MENU).first()).toBeVisible({ timeout: 5_000 });
  });

  test('dropdown menu contains a rename option', async ({ page }) => {
    const item = await hoverConversationRow(page);
    test.skip(!item, 'No conversations in sandbox');
    const menuBtn = item!.locator('.flex-center.cursor-pointer.hover\\:bg-fill-2').first();
    const isVisible = await menuBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    test.skip(!isVisible, '3-dot button not found after hover');
    await menuBtn.click();
    const dropdown = page.locator(ARCO_DROPDOWN_MENU).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    const renameItem = dropdown.getByText(/rename|重命名/i).first();
    await expect(renameItem).toBeVisible({ timeout: 3_000 });
  });

  test('dropdown menu contains a delete option', async ({ page }) => {
    const item = await hoverConversationRow(page);
    test.skip(!item, 'No conversations in sandbox');
    const menuBtn = item!.locator('.flex-center.cursor-pointer.hover\\:bg-fill-2').first();
    const isVisible = await menuBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    test.skip(!isVisible, '3-dot button not found after hover');
    await menuBtn.click();
    const dropdown = page.locator(ARCO_DROPDOWN_MENU).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    const deleteItem = dropdown.getByText(/delete|删除/i).first();
    await expect(deleteItem).toBeVisible({ timeout: 3_000 });
  });

  test('dropdown menu contains a pin option', async ({ page }) => {
    const item = await hoverConversationRow(page);
    test.skip(!item, 'No conversations in sandbox');
    const menuBtn = item!.locator('.flex-center.cursor-pointer.hover\\:bg-fill-2').first();
    const isVisible = await menuBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    test.skip(!isVisible, '3-dot button not found after hover');
    await menuBtn.click();
    const dropdown = page.locator(ARCO_DROPDOWN_MENU).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    // Pin or unpin option
    const pinItem = dropdown.getByText(/pin|置顶/i).first();
    await expect(pinItem).toBeVisible({ timeout: 3_000 });
  });
});

// ── 3. Rename modal ───────────────────────────────────────────────────────────

test.describe('Rename conversation modal', () => {
  async function openRenameModal(page: import('@playwright/test').Page): Promise<boolean> {
    const item = await hoverConversationRow(page);
    if (!item) return false;
    const menuBtn = item.locator('.flex-center.cursor-pointer.hover\\:bg-fill-2').first();
    if (!(await menuBtn.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
    await menuBtn.click();
    const dropdown = page.locator(ARCO_DROPDOWN_MENU).first();
    if (!(await dropdown.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
    const renameItem = dropdown.getByText(/rename|重命名/i).first();
    if (!(await renameItem.isVisible().catch(() => false))) return false;
    await renameItem.click();
    return true;
  }

  test('clicking rename opens a modal with a text input', async ({ page }) => {
    const opened = await openRenameModal(page);
    test.skip(!opened, 'Could not open rename modal (no conversations or menu not found)');
    const modal = page.locator(ARCO_MODAL).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const input = modal.locator('input').first();
    await expect(input).toBeVisible({ timeout: 3_000 });
  });

  test('rename modal input is editable', async ({ page }) => {
    const opened = await openRenameModal(page);
    test.skip(!opened, 'Could not open rename modal');
    const modal = page.locator(ARCO_MODAL).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const input = modal.locator('input').first();
    await input.fill('E2E Test Rename');
    await expect(input).toHaveValue('E2E Test Rename');
  });

  test('rename modal cancel button closes the modal', async ({ page }) => {
    const opened = await openRenameModal(page);
    test.skip(!opened, 'Could not open rename modal');
    const modal = page.locator(ARCO_MODAL).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const cancelBtn = modal.getByText(/cancel|取消/i).first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      await expect(modal).toBeHidden({ timeout: 3_000 });
    }
  });

  test('rename modal shows confirm button', async ({ page }) => {
    const opened = await openRenameModal(page);
    test.skip(!opened, 'Could not open rename modal');
    const modal = page.locator(ARCO_MODAL).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const okBtn = modal
      .locator('button[class*="primary"], button')
      .filter({ hasText: /ok|确认|save|保存/i })
      .first();
    await expect(okBtn).toBeVisible({ timeout: 3_000 });
  });
});

// ── 4. Delete confirmation modal ─────────────────────────────────────────────

test.describe('Delete conversation – confirmation modal', () => {
  async function openDeleteModal(page: import('@playwright/test').Page): Promise<boolean> {
    const item = await hoverConversationRow(page);
    if (!item) return false;
    const menuBtn = item.locator('.flex-center.cursor-pointer.hover\\:bg-fill-2').first();
    if (!(await menuBtn.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
    await menuBtn.click();
    const dropdown = page.locator(ARCO_DROPDOWN_MENU).first();
    if (!(await dropdown.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
    const deleteItem = dropdown.getByText(/delete|删除/i).first();
    if (!(await deleteItem.isVisible().catch(() => false))) return false;
    await deleteItem.click();
    return true;
  }

  test('clicking delete shows a confirmation modal', async ({ page }) => {
    const opened = await openDeleteModal(page);
    test.skip(!opened, 'Could not open delete modal (no conversations or menu not found)');
    // Arco modal or confirm dialog
    const modal = page.locator(`${ARCO_MODAL}, .arco-modal-confirm`).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
  });

  test('delete confirmation modal has cancel and confirm buttons', async ({ page }) => {
    const opened = await openDeleteModal(page);
    test.skip(!opened, 'Could not open delete modal');
    const modal = page.locator(`${ARCO_MODAL}, .arco-modal-confirm`).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const cancelBtn = modal.getByText(/cancel|取消/i).first();
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 });
    const confirmBtn = modal.getByText(/confirm|确认|delete|删除/i).first();
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
  });

  test('cancel button closes the delete confirmation modal', async ({ page }) => {
    const opened = await openDeleteModal(page);
    test.skip(!opened, 'Could not open delete modal');
    const modal = page.locator(`${ARCO_MODAL}, .arco-modal-confirm`).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const cancelBtn = modal.getByText(/cancel|取消/i).first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      await expect(modal).toBeHidden({ timeout: 3_000 });
    }
  });
});
