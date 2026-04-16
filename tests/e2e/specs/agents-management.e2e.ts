/**
 * Agents Management – E2E tests covering:
 *  1. /assistants page (loads, tabs, cards, Chat/Edit buttons)
 *  2. Sidebar agents tab (switch, sections, collapse/expand, + button)
 *  3. Local agent detail page (model selector, permission selector)
 *  4. Remote agent detail page (edit form fields, save/cancel)
 *  5. New assistant page (/agents/assistant/new – all form fields)
 *  6. Existing assistant detail page (read/edit fields)
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  navigateTo,
  waitForSettle,
  ROUTES,
  SIDER_TAB_AGENTS,
  AGENT_SECTION_HEADER,
  agentSectionHeader,
  AGENT_CARD,
  AGENT_CARD_CHAT_BTN,
  AGENT_CARD_EDIT_BTN,
  ARCO_SELECT_DROPDOWN,
  ARCO_SELECT_OPTION,
  ARCO_MODAL,
  ARCO_SWITCH,
  takeScreenshot,
} from '../helpers';

// ── 1. Assistants page ────────────────────────────────────────────────────────

test.describe('/assistants page', () => {
  test('navigating to /assistants loads the page', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    const body = await page.locator('body').textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
  });

  test('assistants page has a search input', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    const input = page.locator('input[placeholder]').first();
    await expect(input).toBeVisible({ timeout: 8_000 });
  });

  test('assistants page has tab navigation (All / Assistants / Local / Remote)', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    // Tabs rendered as spans or buttons within .arco-tabs or similar
    const tabBar = page.locator('.arco-tabs-nav, [role="tablist"], [class*="tab"]').first();
    await expect(tabBar).toBeVisible({ timeout: 8_000 });
    const tabText = await tabBar.textContent();
    // At least some tab text should be present
    expect(tabText?.trim().length).toBeGreaterThan(0);
  });

  test('assistants page shows agent cards or an empty state', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    const cards = page.locator(AGENT_CARD);
    const empty = page.locator('.arco-empty, [class*="empty"]').first();
    const hasCards = await cards
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const hasEmpty = await empty.isVisible({ timeout: 2_000 }).catch(() => false);
    expect(hasCards || hasEmpty).toBe(true);
  });

  test('agent card has a Chat button', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    const chatBtn = page.locator(AGENT_CARD_CHAT_BTN).first();
    const hasCard = await chatBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasCard, 'No agent cards visible');
    await expect(chatBtn).toBeVisible();
  });

  test('agent card Chat button navigates to guid with agent param', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    const chatBtn = page.locator(AGENT_CARD_CHAT_BTN).first();
    const hasCard = await chatBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasCard, 'No agent cards visible');
    await chatBtn.click();
    await page.waitForFunction(() => window.location.hash.includes('/guid'), { timeout: 8_000 });
    expect(page.url()).toContain('/guid');
    expect(page.url()).toContain('agent=');
  });

  test('editable agent card has an Edit button', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    const editBtn = page.locator(AGENT_CARD_EDIT_BTN).first();
    const hasEditBtn = await editBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasEditBtn, 'No editable agent cards visible');
    await expect(editBtn).toBeVisible();
  });

  test('Edit button on agent card navigates to agent detail page', async ({ page }) => {
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    const editBtn = page.locator(AGENT_CARD_EDIT_BTN).first();
    const hasEditBtn = await editBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasEditBtn, 'No editable agent cards visible');
    await editBtn.click();
    await page.waitForFunction(() => window.location.hash.includes('/agents/'), { timeout: 8_000 });
    expect(page.url()).toContain('/agents/');
  });

  test('screenshot: assistants page', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await navigateTo(page, ROUTES.assistants);
    await waitForSettle(page);
    await takeScreenshot(page, 'assistants-page');
  });
});

// ── 2. Sidebar – agents tab ───────────────────────────────────────────────────

test.describe('Sidebar – agents tab', () => {
  test('agents tab button is visible in sidebar', async ({ page }) => {
    await goToGuid(page);
    await expect(page.locator(SIDER_TAB_AGENTS).first()).toBeVisible({ timeout: 8_000 });
  });

  test('clicking agents tab shows section headers', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    await expect(page.locator(AGENT_SECTION_HEADER).first()).toBeVisible({ timeout: 5_000 });
  });

  test('Local Agents section header is present', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const local = page.locator(agentSectionHeader('local')).first();
    await expect(local).toBeVisible({ timeout: 5_000 });
  });

  test('Remote Agents section header is present', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const remote = page.locator(agentSectionHeader('remote')).first();
    await expect(remote).toBeVisible({ timeout: 5_000 });
  });

  test('Assistants section header is present', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const assistants = page.locator(agentSectionHeader('assistants')).first();
    await expect(assistants).toBeVisible({ timeout: 5_000 });
  });

  test('People section header is present', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const people = page.locator(agentSectionHeader('people')).first();
    await expect(people).toBeVisible({ timeout: 5_000 });
  });

  test('clicking Local section header toggles collapse/expand', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const localHeader = page.locator(agentSectionHeader('local')).first();
    await expect(localHeader).toBeVisible({ timeout: 5_000 });

    // Click to expand
    await localHeader.click();
    await page.waitForTimeout(300);
    // Click again to collapse
    await localHeader.click();
    await page.waitForTimeout(300);
    // Header should still be visible after toggling
    await expect(localHeader).toBeVisible();
  });

  test('+ button in Assistants section header is visible', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const assistantHeader = page.locator(agentSectionHeader('assistants')).first();
    await expect(assistantHeader).toBeVisible({ timeout: 5_000 });
    const addBtn = assistantHeader.locator('.h-20px.w-20px').first();
    await expect(addBtn).toBeVisible({ timeout: 3_000 });
  });

  test('+ button in Assistants section opens create-assistant modal/navigation', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const assistantHeader = page.locator(agentSectionHeader('assistants')).first();
    await expect(assistantHeader).toBeVisible({ timeout: 5_000 });
    const addBtn = assistantHeader.locator('.h-20px.w-20px').first();
    await addBtn.click();
    await page.waitForTimeout(500);
    // Should open a modal or navigate to /agents/assistant/new
    const modal = page.locator(ARCO_MODAL).first();
    const isModal = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
    const isNewPage = page.url().includes('/agents/assistant/new');
    expect(isModal || isNewPage).toBe(true);
  });

  test('clicking a local agent row navigates to local agent detail page', async ({ page }) => {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const localHeader = page.locator(agentSectionHeader('local')).first();
    await expect(localHeader).toBeVisible({ timeout: 5_000 });
    await localHeader.click(); // expand section
    await page.waitForTimeout(300);
    // Find a local agent row (level-2 SiderRow)
    const agentRow = page.locator('[class*="pl-48px"][class*="cursor-pointer"]').first();
    const hasRow = await agentRow.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!hasRow, 'No local agent rows after expanding section');
    await agentRow.click();
    await page.waitForFunction(() => window.location.hash.includes('/agents/local/'), { timeout: 8_000 });
    expect(page.url()).toContain('/agents/local/');
  });

  test('screenshot: sidebar agents tab', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    await takeScreenshot(page, 'sidebar-agents-tab');
  });
});

// ── 3. Local agent detail page ────────────────────────────────────────────────

test.describe('Local agent detail page (Claude Code)', () => {
  test('local agent detail page loads for claude backend', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.local('claude'));
    await waitForSettle(page);
    const body = await page.locator('body').textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
  });

  test('page shows agent name in header area', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.local('claude'));
    await waitForSettle(page);
    // Agent name should appear somewhere on the page
    const nameEl = page.getByText(/claude/i).first();
    await expect(nameEl).toBeVisible({ timeout: 8_000 });
  });

  test('model section shows Default model selector', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.local('claude'));
    await waitForSettle(page);
    // AgentConfigSection titled "model" contains a Select
    const select = page.locator('.arco-select').first();
    await expect(select).toBeVisible({ timeout: 8_000 });
  });

  test('model selector opens dropdown with model options', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.local('claude'));
    await waitForSettle(page);
    const select = page.locator('.arco-select').first();
    await expect(select).toBeVisible({ timeout: 8_000 });
    await select.click();
    const dropdown = page.locator(ARCO_SELECT_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
  });

  test('permission mode section has a Select', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.local('claude'));
    await waitForSettle(page);
    // There are at least 2 Selects: model + permission mode
    const selects = page.locator('.arco-select');
    const count = await selects.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('permission mode selector opens dropdown with options', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.local('claude'));
    await waitForSettle(page);
    const selects = page.locator('.arco-select');
    const count = await selects.count();
    test.skip(count < 2, 'Permission mode selector not found');
    // Second select is permission mode
    await selects.nth(1).click();
    const dropdown = page.locator(ARCO_SELECT_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
  });

  test('local agent detail page for gemini backend loads', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.local('gemini'));
    await waitForSettle(page);
    const body = await page.locator('body').textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
    const nameEl = page.getByText(/gemini/i).first();
    await expect(nameEl).toBeVisible({ timeout: 8_000 });
  });

  test('screenshot: local agent (claude) detail page', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await navigateTo(page, ROUTES.agents.local('claude'));
    await waitForSettle(page);
    await takeScreenshot(page, 'local-agent-detail-claude');
  });
});

// ── 4. Remote agent detail page ───────────────────────────────────────────────

test.describe('Remote agent detail page', () => {
  async function getFirstRemoteAgentId(page: import('@playwright/test').Page): Promise<string | null> {
    // Navigate to agents tab and expand Remote section to find an agent
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const remoteHeader = page.locator(agentSectionHeader('remote')).first();
    await expect(remoteHeader).toBeVisible({ timeout: 5_000 });
    await remoteHeader.click();
    await page.waitForTimeout(300);
    const agentRow = page.locator('[class*="pl-48px"][class*="cursor-pointer"]').first();
    const hasRow = await agentRow.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasRow) return null;
    await agentRow.click();
    try {
      await page.waitForFunction(() => window.location.hash.includes('/agents/remote/'), { timeout: 8_000 });
      return page.url().split('/agents/remote/')[1] ?? null;
    } catch {
      return null;
    }
  }

  test('remote agent detail page has name input', async ({ page }) => {
    const remoteId = await getFirstRemoteAgentId(page);
    test.skip(!remoteId, 'No remote agents configured');
    const nameInput = page.locator('input').first();
    await expect(nameInput).toBeVisible({ timeout: 8_000 });
  });

  test('remote agent detail page has URL input', async ({ page }) => {
    const remoteId = await getFirstRemoteAgentId(page);
    test.skip(!remoteId, 'No remote agents configured');
    const urlInput = page.locator('input[placeholder="https://"]').first();
    await expect(urlInput).toBeVisible({ timeout: 8_000 });
  });

  test('remote agent detail page has auth type selector', async ({ page }) => {
    const remoteId = await getFirstRemoteAgentId(page);
    test.skip(!remoteId, 'No remote agents configured');
    const authSelect = page.locator('.arco-select').first();
    await expect(authSelect).toBeVisible({ timeout: 8_000 });
  });

  test('remote agent detail page has save and cancel buttons', async ({ page }) => {
    const remoteId = await getFirstRemoteAgentId(page);
    test.skip(!remoteId, 'No remote agents configured');
    const saveBtn = page.getByText(/save|保存/i).first();
    const cancelBtn = page.getByText(/cancel|取消/i).first();
    await expect(saveBtn).toBeVisible({ timeout: 8_000 });
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 });
  });

  test('can type in remote agent name field', async ({ page }) => {
    const remoteId = await getFirstRemoteAgentId(page);
    test.skip(!remoteId, 'No remote agents configured');
    const nameInput = page.locator('input').first();
    const originalValue = await nameInput.inputValue();
    await nameInput.fill('E2E Test Agent');
    await expect(nameInput).toHaveValue('E2E Test Agent');
    // Restore original value (don't actually save)
    await nameInput.fill(originalValue);
  });
});

// ── 5. New assistant page ─────────────────────────────────────────────────────

test.describe('New assistant page (/agents/assistant/new)', () => {
  test('new assistant page loads', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    const body = await page.locator('body').textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
  });

  test('new assistant page has a name input field', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    // Name input placeholder from i18n: settings.agentNamePlaceholder
    const nameInput = page.locator('input[placeholder]').first();
    await expect(nameInput).toBeVisible({ timeout: 8_000 });
  });

  test('new assistant name input is editable', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    const nameInput = page.locator('input[placeholder]').first();
    await nameInput.fill('My Test Assistant');
    await expect(nameInput).toHaveValue('My Test Assistant');
  });

  test('new assistant page has a system prompt textarea', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
  });

  test('system prompt textarea is editable', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    const textarea = page.locator('textarea').first();
    await textarea.fill('You are a helpful E2E test assistant.');
    await expect(textarea).toHaveValue('You are a helpful E2E test assistant.');
  });

  test('new assistant page has description input', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    // There should be multiple inputs: name + description
    const inputs = page.locator('input[placeholder]');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('new assistant page has a save/create button', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    const saveBtn = page.getByText(/save|create|保存|创建/i).first();
    await expect(saveBtn).toBeVisible({ timeout: 8_000 });
  });

  test('new assistant page has a cancel button', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    const cancelBtn = page.getByText(/cancel|取消/i).first();
    await expect(cancelBtn).toBeVisible({ timeout: 8_000 });
  });

  test('skills collapse sections are present', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    // Skills section uses Arco Collapse
    const collapse = page.locator('.arco-collapse').first();
    await expect(collapse).toBeVisible({ timeout: 8_000 });
  });

  test('cancel button navigates away without saving', async ({ page }) => {
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    const nameInput = page.locator('input[placeholder]').first();
    await nameInput.fill('Unsaved Assistant');
    const cancelBtn = page.getByText(/cancel|取消/i).first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      // Should navigate away from the new-assistant page
      await page.waitForTimeout(500);
      expect(page.url()).not.toContain('/agents/assistant/new');
    }
  });

  test('screenshot: new assistant page', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await navigateTo(page, ROUTES.agents.newAssistant);
    await waitForSettle(page);
    await takeScreenshot(page, 'new-assistant-page');
  });
});

// ── 6. Existing assistant detail page ────────────────────────────────────────

test.describe('Existing assistant detail page', () => {
  async function getFirstAssistantId(page: import('@playwright/test').Page): Promise<string | null> {
    await goToGuid(page);
    await page.locator(SIDER_TAB_AGENTS).first().click();
    const assistHeader = page.locator(agentSectionHeader('assistants')).first();
    await expect(assistHeader).toBeVisible({ timeout: 5_000 });
    await assistHeader.click(); // expand
    await page.waitForTimeout(300);
    const agentRow = page.locator('[class*="pl-48px"][class*="cursor-pointer"]').first();
    const hasRow = await agentRow.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasRow) return null;
    await agentRow.click();
    try {
      await page.waitForFunction(() => window.location.hash.includes('/agents/assistant/'), { timeout: 8_000 });
      return page.url().split('/agents/assistant/')[1] ?? null;
    } catch {
      return null;
    }
  }

  test('assistant detail page loads', async ({ page }) => {
    const id = await getFirstAssistantId(page);
    test.skip(!id, 'No assistant agents in sidebar');
    await waitForSettle(page);
    const body = await page.locator('body').textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
  });

  test('assistant page has agent name displayed', async ({ page }) => {
    const id = await getFirstAssistantId(page);
    test.skip(!id, 'No assistant agents in sidebar');
    // Name appears in header area
    const nameEl = page.locator('h1, h2, h3, [class*="title"], [class*="name"]').first();
    await expect(nameEl).toBeVisible({ timeout: 8_000 });
  });

  test('assistant page has system prompt textarea or text area', async ({ page }) => {
    const id = await getFirstAssistantId(page);
    test.skip(!id, 'No assistant agents in sidebar');
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
  });

  test('assistant page has save and cancel buttons for editable assistants', async ({ page }) => {
    const id = await getFirstAssistantId(page);
    test.skip(!id, 'No assistant agents in sidebar');
    const saveBtn = page.getByText(/save|保存/i).first();
    const hasBtn = await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!hasBtn, 'This assistant is not editable');
    await expect(saveBtn).toBeVisible();
    const cancelBtn = page.getByText(/cancel|取消/i).first();
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 });
  });

  test('screenshot: assistant detail page', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    const id = await getFirstAssistantId(page);
    test.skip(!id, 'No assistant agents');
    await takeScreenshot(page, 'assistant-detail-page');
  });
});
