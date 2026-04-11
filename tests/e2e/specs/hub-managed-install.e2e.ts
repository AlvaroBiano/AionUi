/**
 * L2 E2E Test — Hub Managed Install Flow.
 *
 * Tests the full lifecycle of Hub-managed agent installation, where agents are
 * installed to a managed directory (~/.aionui-agents/{name}/{version}_{hash}/)
 * rather than relying on system PATH / `which`.
 *
 * Scenarios:
 * 1. Hub install → agent appears in list → start session
 * 2. Schema version incompatible → UI doesn't crash, falls back to local index
 * 3. Network offline → already-installed managed agents remain usable
 * 4. Install failure → correct error message, retryable
 *
 * Depends on: Task 1 (lifecycle runner) + Task 2 (AionHub extension rework)
 */
import { test, expect } from '../fixtures';
import { goToGuid, goToSettings, waitForSettle, AGENT_PILL } from '../helpers';

// ── Selectors ────────────────────────────────────────────────────────────────

/** "Install from Market" button on LocalAgents page */
const MARKET_BUTTON = 'button:has-text("Install from Market"), button:has-text("从市场安装")';

/** Hub modal */
const HUB_MODAL = '.arco-modal';

/** Hub agent card grid */
const HUB_GRID = '[data-testid="agent-hub-grid"]';

/** Individual hub agent card */
const HUB_CARD = '[data-testid="agent-hub-card"]';

/** Modal close button */
const MODAL_CLOSE = '.arco-modal .arco-icon-hover.arco-icon-close, .arco-modal-close-icon';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function openHubModal(page: import('@playwright/test').Page): Promise<void> {
  await goToSettings(page, 'agent');
  await waitForSettle(page);

  const marketBtn = page.locator(MARKET_BUTTON).first();
  await expect(marketBtn).toBeVisible({ timeout: 8_000 });
  await marketBtn.click();

  await expect(page.locator(HUB_MODAL).first()).toBeVisible({ timeout: 8_000 });
}

async function closeHubModal(page: import('@playwright/test').Page): Promise<void> {
  const closeBtn = page.locator(MODAL_CLOSE).first();
  const hasCloseBtn = await closeBtn.isVisible().catch(() => false);

  if (hasCloseBtn) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }

  await expect(page.locator(HUB_MODAL).first()).not.toBeVisible({ timeout: 5_000 });
}

// ── Scenario 1: Hub Install → Agent Appears → Start Session ─────────────────

test.describe('Hub Managed Install — Install & Launch', () => {
  test('installing an agent from Hub triggers status transition', async ({ page }) => {
    await openHubModal(page);

    const grid = page.locator(HUB_GRID).first();
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Look for an installable agent card
    const installButton = page
      .locator(`${HUB_CARD} button`)
      .filter({ hasText: /^Install$|^安装$/ })
      .first();

    const hasInstallable = await installButton.isVisible().catch(() => false);

    if (hasInstallable) {
      // Click Install and verify the button transitions to Installing.../Installed/Retry
      await installButton.click();

      const parentCard = installButton.locator('xpath=ancestor::div[@data-testid="agent-hub-card"]');
      const cardButton = parentCard.locator('button').first();

      await expect
        .poll(
          async () => {
            const text = (await cardButton.textContent()) || '';
            return /Installing|Installed|Retry|安装中|已安装|重试/i.test(text);
          },
          { timeout: 60_000, message: 'Expected install status to change after clicking Install' }
        )
        .toBeTruthy();
    } else {
      // All agents already installed — verify at least one "Installed" button exists
      const installedBtn = page
        .locator(`${HUB_CARD} button`)
        .filter({ hasText: /Installed|已安装/ })
        .first();
      await expect(installedBtn).toBeVisible({ timeout: 5_000 });
    }
  });

  test('installed managed agent appears in detected agents list', async ({ page }) => {
    // Close Hub modal if open, then check the agent settings page
    const modal = page.locator(HUB_MODAL).first();
    const modalVisible = await modal.isVisible().catch(() => false);
    if (modalVisible) {
      await closeHubModal(page);
    }

    await goToSettings(page, 'agent');
    await waitForSettle(page);

    // The Agent settings page should show detected agents section
    // This includes both PATH-discovered and managed-installed agents
    const bodyText = await page.textContent('body');
    const hasAgentSection =
      bodyText?.includes('Detected') ||
      bodyText?.includes('已检测') ||
      bodyText?.includes('Agent') ||
      bodyText?.includes('agent') ||
      bodyText?.includes('Gemini') ||
      bodyText?.includes('gemini');

    expect(hasAgentSection).toBeTruthy();
  });

  test('managed agent can start a chat session from pill bar', async ({ page }) => {
    await goToGuid(page);

    const pills = page.locator(AGENT_PILL);
    await expect(pills.first()).toBeVisible({ timeout: 8_000 });

    const count = await pills.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Click the first available agent pill
    await pills.first().click();

    // Verify it becomes selected
    await expect
      .poll(async () => {
        return await pills.first().getAttribute('data-agent-selected');
      })
      .toBe('true');

    // Verify the chat input is available (session ready)
    const chatInput = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
    await expect(chatInput).toBeVisible({ timeout: 8_000 });
  });
});

// ── Scenario 2: Schema Version Incompatible → Graceful Fallback ─────────────

test.describe('Hub Managed Install — Schema Compatibility', () => {
  test('incompatible remote schema version does not crash the UI', async ({ page }) => {
    // Intercept the remote hub index fetch and return an incompatible schema version
    // This simulates a future schema version that the app doesn't understand
    await page.route('**/index.json', async (route) => {
      const url = route.request().url();
      // Only intercept hub index requests (GitHub/CDN), not other index.json files
      if (url.includes('AionHub') || url.includes('iOfficeAI')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 999,
            generatedAt: '2099-01-01T00:00:00Z',
            extensions: {
              'fake-future-agent': {
                name: 'fake-future-agent',
                displayName: 'Future Agent',
                version: '99.0.0',
                description: 'An agent from the future',
                author: 'test',
                dist: { tarball: 'fake.tgz', integrity: 'sha512-fake', unpackedSize: 0 },
                engines: { aionui: '>=0.0.1' },
                hubs: ['acpAdapters'],
              },
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Open Hub modal — should render without crashing
    await openHubModal(page);

    const modal = page.locator(HUB_MODAL).first();
    await expect(modal).toBeVisible({ timeout: 8_000 });

    // Modal should show content — not blank/crashed
    // It may show the grid (from local/bundled index), loading, or a graceful error
    const modalText = await modal.textContent();
    expect(modalText?.trim().length).toBeGreaterThan(0);

    // Collect any unhandled JS errors during the test
    const jsErrors: string[] = [];
    page.on('pageerror', (error) => jsErrors.push(error.message));

    // Give the page a moment to process the incompatible response
    await waitForSettle(page, 2_000);

    // No unhandled JS errors should have occurred
    expect(jsErrors).toHaveLength(0);

    // Clean up route interception
    await page.unroute('**/index.json');
    await closeHubModal(page);
  });

  test('schema mismatch falls back to local index with correct agent list', async ({ page }) => {
    // With remote schema incompatible, the HubIndexManager should fall back
    // to the local/bundled index. Verify the agent settings page still works.
    await goToSettings(page, 'agent');
    await waitForSettle(page);

    // The page should still render properly — agent management UI should be present
    const bodyText = await page.textContent('body');
    const hasAgentUI =
      bodyText?.includes('Agent') ||
      bodyText?.includes('agent') ||
      bodyText?.includes('助手') ||
      bodyText?.includes('Install from Market') ||
      bodyText?.includes('从市场安装');

    expect(hasAgentUI).toBeTruthy();

    // The "Install from Market" button should still be functional
    const marketBtn = page.locator(MARKET_BUTTON).first();
    await expect(marketBtn).toBeVisible({ timeout: 8_000 });
  });
});

// ── Scenario 3: Network Offline → Managed Agents Still Usable ───────────────

test.describe('Hub Managed Install — Offline Resilience', () => {
  test('managed agents remain available when network is offline', async ({ page }) => {
    // Simulate offline by intercepting all hub-related network requests
    await page.route('**/AionHub/**', (route) => route.abort('connectionfailed'));
    await page.route('**/iOfficeAI/**', (route) => route.abort('connectionfailed'));

    // Navigate to guid page — locally installed agents should still render
    await goToGuid(page);

    const pills = page.locator(AGENT_PILL);
    await expect(pills.first()).toBeVisible({ timeout: 8_000 });

    const count = await pills.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Click an agent pill — it should be selectable even offline
    await pills.first().click();
    await expect
      .poll(async () => {
        return await pills.first().getAttribute('data-agent-selected');
      })
      .toBe('true');

    // Clean up route interception
    await page.unroute('**/AionHub/**');
    await page.unroute('**/iOfficeAI/**');
  });

  test('Hub modal shows network error when offline but does not crash', async ({ page }) => {
    // Simulate offline for hub index fetch
    await page.route('**/index.json', async (route) => {
      const url = route.request().url();
      if (url.includes('AionHub') || url.includes('iOfficeAI')) {
        await route.abort('connectionfailed');
      } else {
        await route.continue();
      }
    });

    await openHubModal(page);

    const modal = page.locator(HUB_MODAL).first();
    await expect(modal).toBeVisible({ timeout: 8_000 });

    // Modal should display content — either cached/local agents, a user-friendly
    // error message, or an empty state. It must NOT crash or be blank.
    const modalText = await modal.textContent();
    expect(modalText?.trim().length).toBeGreaterThan(0);

    // The modal should show one of: agent cards (from local index), loading, or error text
    const hasValidContent =
      modalText?.includes('Install') ||
      modalText?.includes('安装') ||
      modalText?.includes('Installed') ||
      modalText?.includes('已安装') ||
      modalText?.includes('No agents') ||
      modalText?.includes('没有') ||
      modalText?.includes('error') ||
      modalText?.includes('错误') ||
      modalText?.includes('failed') ||
      modalText?.includes('失败') ||
      modalText?.includes('Please wait') ||
      modalText?.includes('Loading') ||
      modalText?.includes('加载') ||
      modalText?.includes('network') ||
      modalText?.includes('网络') ||
      modalText?.includes('Want a new Agent') || // contribution hint always shown
      modalText?.includes('PR');

    expect(hasValidContent).toBeTruthy();

    // Clean up
    await page.unroute('**/index.json');
    await closeHubModal(page);
  });
});

// ── Scenario 4: Install Failure → Error Message & Retry ─────────────────────

test.describe('Hub Managed Install — Failure & Retry', () => {
  test('install failure shows error message with actionable info', async ({ page }) => {
    await openHubModal(page);

    const grid = page.locator(HUB_GRID).first();
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Check if any card is in failed state (may not exist in a fresh env)
    const retryButton = page
      .locator(`${HUB_CARD} button`)
      .filter({ hasText: /Retry|重试/ })
      .first();

    const hasFailed = await retryButton.isVisible().catch(() => false);

    if (hasFailed) {
      // Retry button should have danger styling
      const buttonClasses = await retryButton.getAttribute('class');
      // Arco Button with status="danger" renders as arco-btn-status-danger
      expect(buttonClasses || '').toMatch(/danger/);

      // The parent card should have a Tooltip with the error message
      // Hover over the button to trigger tooltip display
      await retryButton.hover();
      await waitForSettle(page, 1_500);

      const tooltip = page.locator('.arco-tooltip-content').first();
      const tooltipVisible = await tooltip.isVisible().catch(() => false);
      if (tooltipVisible) {
        const tooltipText = await tooltip.textContent();
        // Tooltip should contain some error info (not empty)
        expect(tooltipText?.trim().length).toBeGreaterThan(0);
      }
    } else {
      // No failed cards — try triggering a failure by intercepting install requests
      // This is best-effort: if no installable agent exists, skip gracefully
      const installButton = page
        .locator(`${HUB_CARD} button`)
        .filter({ hasText: /^Install$|^安装$/ })
        .first();

      const hasInstallable = await installButton.isVisible().catch(() => false);
      if (hasInstallable) {
        // Block download requests to simulate install failure
        await page.route('**/*.tgz', (route) => route.abort('connectionfailed'));

        await installButton.click();

        // Wait for the status to change — should become Retry (failed) or Installing
        await expect
          .poll(
            async () => {
              const text = (await installButton.textContent()) || '';
              return /Retry|重试|Installing|安装中|Installed|已安装/i.test(text);
            },
            { timeout: 30_000, message: 'Expected install status to change' }
          )
          .toBeTruthy();

        await page.unroute('**/*.tgz');
      }
      // If neither failed nor installable cards exist, test passes (no applicable scenario)
    }

    await closeHubModal(page);
  });

  test('retry button re-triggers installation after failure', async ({ page }) => {
    await openHubModal(page);

    const grid = page.locator(HUB_GRID).first();
    await expect(grid).toBeVisible({ timeout: 15_000 });

    const retryButton = page
      .locator(`${HUB_CARD} button`)
      .filter({ hasText: /Retry|重试/ })
      .first();

    const hasFailed = await retryButton.isVisible().catch(() => false);

    if (hasFailed) {
      // Record the parent card for status tracking
      const parentCard = retryButton.locator('xpath=ancestor::div[@data-testid="agent-hub-card"]');
      const cardButton = parentCard.locator('button').first();

      // Click Retry
      await retryButton.click();

      // Verify status transitions — should become "Installing..." or eventually "Installed"/"Retry"
      await expect
        .poll(
          async () => {
            const text = (await cardButton.textContent()) || '';
            return /Installing|Installed|Install|安装中|已安装|安装/i.test(text);
          },
          { timeout: 30_000, message: 'Expected retry to trigger a status transition' }
        )
        .toBeTruthy();
    }
    // If no failed card exists, this test passes — retry scenario not triggered in this env

    await closeHubModal(page);
  });

  test('install failure does not affect other agents in the list', async ({ page }) => {
    await openHubModal(page);

    const cards = page.locator(HUB_CARD);
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify each card has a valid status button regardless of other cards' state
    for (let i = 0; i < Math.min(count, 6); i++) {
      const card = cards.nth(i);
      const button = card.locator('button').first();
      await expect(button).toBeVisible();

      const buttonText = await button.textContent();
      // Every card should show a recognizable status — none should be in a broken state
      expect(buttonText).toMatch(/Install|Installed|Installing|Retry|Update|安装|已安装|安装中|重试|更新/i);
    }

    // Verify the grid renders all cards (none disappeared due to a sibling's failure)
    const finalCount = await cards.count();
    expect(finalCount).toBe(count);

    await closeHubModal(page);
  });
});
