/**
 * Workspace Panel – E2E tests covering Module 5 ACs beyond the basic
 * DOM-existence check in conversation-lifecycle.e2e.ts:
 *
 *  1. Empty state when no workspace is associated (AC2)
 *  2. Right-click file shows context menu with "添加至聊天" (AC6)
 *  3. Refresh button is visible in file tab (AC4b)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from '../fixtures';
import { goToGuid, waitForSettle, WORKSPACE_RIGHT_PANEL, invokeBridge } from '../helpers';

// ── Selectors (confirmed against actual DOM structure) ────────────────────────

/** "Files" tab – Arco Tabs header title */
const WORKSPACE_FILES_TAB = `.arco-tabs-header-title`;

/**
 * Refresh button – WorkspaceToolbar renders an icon-park span
 * with class 'workspace-toolbar-icon-btn'. NOT a <button> element.
 */
const WORKSPACE_REFRESH_BTN = `${WORKSPACE_RIGHT_PANEL} .workspace-toolbar-icon-btn`;

/**
 * File tree node – Arco Design Tree renders nodes with class .arco-tree-node.
 */
const WORKSPACE_FILE_NODE = `${WORKSPACE_RIGHT_PANEL} .workspace-tree .arco-tree-node`;

/**
 * Context menu add-to-chat option text (zh-CN: "添加到聊天" / en-US: "Add to chat")
 */
const CONTEXT_MENU_ADD_TO_CHAT = `button:has-text("添加到聊天"), button:has-text("Add to chat")`;

// ── Conversation IDs created in beforeAll ─────────────────────────────────────

/** Conversation WITH a real workspace dir – used for file tree / refresh / context-menu tests */
let _testConversationId: string | null = null;
let _testWorkspaceDir: string | null = null;

/** Conversation WITHOUT workspace – used for empty-state tests */
let _noWorkspaceConvId: string | null = null;

test.beforeAll(async ({ page }) => {
  // 1. Create a temporary workspace directory with a placeholder file
  try {
    _testWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-workspace-'));
    fs.writeFileSync(path.join(_testWorkspaceDir, 'e2e-test-placeholder.txt'), 'E2E workspace placeholder\n');
  } catch (err) {
    console.warn('[workspace-panel] beforeAll: failed to create temp workspace dir:', err);
  }

  // 2. Navigate to guid so the renderer bridge is initialised
  await goToGuid(page);
  await waitForSettle(page);

  type TChatConversation = { id: string; [key: string]: unknown };

  // 3. Create a conversation WITH workspace (file tree / refresh / context menu tests)
  try {
    const conv = await invokeBridge<TChatConversation>(page, 'create-conversation', {
      type: 'acp',
      name: 'E2E Test Conversation (workspace-panel)',
      model: { id: 'builtin-claude', useModel: 'claude-3-5-haiku-20241022' },
      extra: {
        backend: 'claude',
        agentName: 'claude',
        workspace: _testWorkspaceDir ?? undefined,
        customWorkspace: true,
      },
    });
    if (conv?.id) _testConversationId = conv.id;
  } catch (err) {
    console.warn('[workspace-panel] beforeAll: failed to create workspace conversation:', err);
  }

  // 4. Create a conversation WITHOUT workspace (empty-state tests)
  try {
    const conv = await invokeBridge<TChatConversation>(page, 'create-conversation', {
      type: 'acp',
      name: 'E2E Test Conversation (no-workspace)',
      model: { id: 'builtin-claude', useModel: 'claude-3-5-haiku-20241022' },
      extra: { backend: 'claude', agentName: 'claude' },
    });
    if (conv?.id) _noWorkspaceConvId = conv.id;
  } catch (err) {
    console.warn('[workspace-panel] beforeAll: failed to create no-workspace conversation:', err);
  }
});

test.afterAll(async ({ page }) => {
  await Promise.all(
    [_testConversationId, _noWorkspaceConvId]
      .filter(Boolean)
      .map((id) => invokeBridge(page, 'remove-conversation', { id }).catch(() => undefined))
  );
  _testConversationId = null;
  _noWorkspaceConvId = null;

  if (_testWorkspaceDir) {
    try {
      fs.rmSync(_testWorkspaceDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    _testWorkspaceDir = null;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function navigateToConversation(page: import('@playwright/test').Page, id: string): Promise<void> {
  const hash = `#/conversation/${id}`;
  await page.evaluate((h) => window.location.assign(h), hash);
  await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
}

/**
 * Ensure the workspace right panel is expanded.
 * WorkspaceCollapse defaults to collapsed=true; dispatching the toggle event expands it.
 */
async function ensureWorkspacePanelExpanded(page: import('@playwright/test').Page): Promise<void> {
  const panel = page.locator(WORKSPACE_RIGHT_PANEL).first();
  const isVisible = await panel.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!isVisible) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('aionui-workspace-toggle')));
    await page.waitForTimeout(500);
  }
}

// ── 1. Empty state ────────────────────────────────────────────────────────────

test.describe('Workspace panel – empty state', () => {
  test('AC2: no file tree nodes for conversation without workspace', async ({ page }) => {
    await navigateToConversation(page, _noWorkspaceConvId!);
    await waitForSettle(page);

    // A conversation with no workspace should have zero file tree nodes
    const fileNodes = page.locator(WORKSPACE_FILE_NODE);
    await page.waitForTimeout(1_000); // let panel settle
    const count = await fileNodes.count();
    expect(count).toBe(0);
  });

  test('AC2: workspace panel is present and visible for conversation with workspace', async ({ page }) => {
    await navigateToConversation(page, _testConversationId!);
    await waitForSettle(page);
    await ensureWorkspacePanelExpanded(page);

    const panel = page.locator(WORKSPACE_RIGHT_PANEL).first();
    await expect(panel).toBeVisible({ timeout: 8_000 });
  });

  test('AC2: empty state has no file nodes when no workspace is set', async ({ page }) => {
    await navigateToConversation(page, _noWorkspaceConvId!);
    await waitForSettle(page);

    // Confirm no file-tree nodes regardless of panel visibility
    const fileNodes = page.locator(WORKSPACE_FILE_NODE);
    await page.waitForTimeout(1_000);
    expect(await fileNodes.count()).toBe(0);
  });
});

// ── 2. File right-click context menu ─────────────────────────────────────────

test.describe('Workspace panel – file context menu', () => {
  test('AC6: right-clicking a file node shows context menu with "添加至聊天"', async ({ page }) => {
    await navigateToConversation(page, _testConversationId!);
    await waitForSettle(page);
    await ensureWorkspacePanelExpanded(page);

    const panel = page.locator(WORKSPACE_RIGHT_PANEL).first();
    await expect(panel).toBeVisible({ timeout: 8_000 });

    // Wait for at least one file tree node to appear
    await page.waitForSelector(WORKSPACE_FILE_NODE, { state: 'attached', timeout: 10_000 });

    const fileNodes = panel.locator('.workspace-tree .arco-tree-node');
    const firstFile = fileNodes.first();
    await firstFile.click({ button: 'right' });
    await page.waitForTimeout(400);

    // "添加到聊天" / "Add to chat" button must be visible in the context menu
    const addToChatOption = page.locator(CONTEXT_MENU_ADD_TO_CHAT).first();
    await expect(addToChatOption).toBeVisible({ timeout: 5_000 });

    // Dismiss context menu
    await page.keyboard.press('Escape');
  });
});

// ── 3. Refresh button ─────────────────────────────────────────────────────────

test.describe('Workspace panel – refresh button', () => {
  test('AC4b: workspace panel has a refresh button', async ({ page }) => {
    await navigateToConversation(page, _testConversationId!);
    await waitForSettle(page);
    await ensureWorkspacePanelExpanded(page);

    const panel = page.locator(WORKSPACE_RIGHT_PANEL).first();
    await expect(panel).toBeVisible({ timeout: 8_000 });

    // Switch to Files tab if tabs are rendered
    const filesTab = panel.locator(WORKSPACE_FILES_TAB).first();
    const tabVisible = await filesTab.isVisible({ timeout: 3_000 }).catch(() => false);
    if (tabVisible) {
      await filesTab.click();
      await page.waitForTimeout(300);
    }

    // Refresh button is an icon-park span (.workspace-toolbar-icon-btn), not a <button>
    const refreshBtn = page.locator(WORKSPACE_REFRESH_BTN).first();
    await expect(refreshBtn).toBeVisible({ timeout: 8_000 });
  });

  test('AC4b: clicking refresh button does not crash the panel', async ({ page }) => {
    await navigateToConversation(page, _testConversationId!);
    await waitForSettle(page);
    await ensureWorkspacePanelExpanded(page);

    const panel = page.locator(WORKSPACE_RIGHT_PANEL).first();
    await expect(panel).toBeVisible({ timeout: 8_000 });

    const refreshBtn = page.locator(WORKSPACE_REFRESH_BTN).first();
    await expect(refreshBtn).toBeVisible({ timeout: 8_000 });

    await refreshBtn.click();
    await page.waitForTimeout(500);

    // Panel must still be visible after refresh (no crash)
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });
});
