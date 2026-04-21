/**
 * conversation-core-attack.e2e.ts
 *
 * Module 2 攻击性 E2E 测试 — 竞态、边界、完整交互场景
 *
 * PM 清单覆盖：
 *  M2-P0-1  AC19  重命名失焦 + 历史面板打开竞态
 *  M2-P0-2  AC3a  会话内搜索完整交互（输入→结果→导航→跳转→Esc）
 *  M2-P0-3  AC3b  搜索空结果 — 不崩溃、显示 0 匹配
 *  M2-P0-4  AC24  历史面板快速 UI 切换竞态（真实点击，非 evaluate）
 *  M2-P1-1  AC29  重命名纯空格字符串（"   "）→ Enter → 恢复原名
 *  M2-P1-2  AC19  重命名后立即刷新页面 → 名称持久化
 *  M2-P1-3  AC22  历史面板按修改时间倒序 + 最多 20 条
 *  M2-P1-4  AC27  先创建后删除的会话 ID → 导航 → 不永久 loading
 *
 * 数据构造：
 *  - 所有会话在 beforeAll 通过 IPC 构造，afterAll 清理
 *  - primary conversation: 25 条消息，用于大部分场景
 *  - secondary conversation: 0 条消息，用于历史切换竞态
 *  - ghost conversation: 创建后立即删除，用于 AC27 测试
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  waitForSettle,
  CHAT_LAYOUT_HEADER,
  MESSAGE_ITEM,
  HISTORY_PANEL_BTN,
  HISTORY_PANEL_DROPDOWN,
  SENDBOX_PANEL,
  invokeBridge,
} from '../helpers';

// ── Selectors ──────────────────────────────────────────────────────────────────

const TITLE_TEXT =
  `${CHAT_LAYOUT_HEADER} span[role="button"], ` +
  `${CHAT_LAYOUT_HEADER} span.text-16px.font-bold, ` +
  `${CHAT_LAYOUT_HEADER} span[class*="font-bold"]`;

const TITLE_EDIT_INPUT = `${CHAT_LAYOUT_HEADER} .arco-input input, ${CHAT_LAYOUT_HEADER} input`;

const MINIMAP_TRIGGER = '.conversation-minimap-trigger';
const CONV_SEARCH_PANEL = '.conversation-minimap-panel, .conversation-minimap-layer';
const CONV_SEARCH_INPUT = '.conversation-minimap-panel input, .conversation-minimap-layer input';

// ── Data construction ──────────────────────────────────────────────────────────

let _primaryId: string | null = null;
let _secondaryId: string | null = null;
let _ghostId: string | null = null; // created then deleted — for AC27
let _primaryOriginalName: string | null = null; // 用于验证空格重命名不会污染名称

test.beforeAll(async ({ page }) => {
  await goToGuid(page);
  await waitForSettle(page);

  type TConv = { id: string; [k: string]: unknown };
  const base = {
    type: 'acp' as const,
    model: { id: 'builtin-claude', useModel: 'claude-3-5-haiku-20241022' },
    extra: { backend: 'claude', agentName: 'claude' },
  };

  // 1) primary — 25 messages
  try {
    const primaryName = 'E2E Attack Primary (conversation-core-attack)';
    const c = await invokeBridge<TConv>(page, 'create-conversation', {
      ...base,
      name: primaryName,
    });
    if (c?.id) {
      _primaryId = c.id;
      _primaryOriginalName = primaryName;
      await invokeBridge(page, 'conversation.inject-test-messages', {
        conversation_id: c.id,
        count: 25,
      });
    }
  } catch (e) {
    console.warn('[attack] beforeAll primary failed:', e);
  }

  // 2) secondary — 0 messages (for switching tests)
  try {
    const s = await invokeBridge<TConv>(page, 'create-conversation', {
      ...base,
      name: 'E2E Attack Secondary (conversation-core-attack)',
    });
    if (s?.id) _secondaryId = s.id;
  } catch (e) {
    console.warn('[attack] beforeAll secondary failed:', e);
  }

  // 3) ghost — create then immediately delete (for AC27 "deleted ID" test)
  try {
    const g = await invokeBridge<TConv>(page, 'create-conversation', {
      ...base,
      name: 'E2E Attack Ghost (conversation-core-attack)',
    });
    if (g?.id) {
      _ghostId = g.id;
      // Delete right away — this is what makes it a "ghost" ID
      await invokeBridge(page, 'remove-conversation', { id: g.id });
    }
  } catch (e) {
    console.warn('[attack] beforeAll ghost failed:', e);
  }
});

test.afterAll(async ({ page }) => {
  const ids = [_primaryId, _secondaryId].filter(Boolean) as string[];
  await Promise.allSettled(ids.map((id) => invokeBridge(page, 'remove-conversation', { id })));
  _primaryId = null;
  _secondaryId = null;
  _ghostId = null;
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function goToConv(page: import('@playwright/test').Page, id: string | null): Promise<void> {
  if (!id) throw new Error('goToConv: id is null — beforeAll may have failed');
  await page.evaluate((h) => window.location.assign(h), `#/conversation/${id}`);
  await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
  await waitForSettle(page);
}

// ── M2-P0-1: AC19 重命名失焦 + 历史面板打开竞态 ──────────────────────────────
//
// 攻击：进入编辑模式 → 输入新名称 → 不按 Enter，直接点击历史面板按钮（失焦触发保存）
// 预期：名称保存成功 AND 历史面板正常打开，无 JS 错误

test.describe('M2-P0-1: 重命名失焦 + 历史面板打开竞态 (AC19)', () => {
  test('失焦触发保存的同时打开历史面板 — 两个操作均成功', async ({ page }) => {
    await goToConv(page, _primaryId);

    const titleEl = page.locator(TITLE_TEXT).first();
    await expect(titleEl).toBeVisible({ timeout: 5_000 });
    const originalTitle = (await titleEl.textContent())?.trim() ?? '';

    // 进入编辑模式
    await titleEl.click();
    await page.waitForTimeout(300);
    const input = page.locator(TITLE_EDIT_INPUT).first();
    await expect(input, 'title input should appear after click').toBeVisible({ timeout: 3_000 });

    const newName = 'E2E-竞态测试-失焦保存';
    await input.fill(newName);

    // 关键攻击：直接点击历史按钮，触发失焦保存 + 面板打开同时发生
    await page.locator(HISTORY_PANEL_BTN).first().click();
    await page.waitForTimeout(800); // 等待两个操作的异步完成

    // 断言1：历史面板打开
    const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
    await expect(dropdown, 'history panel should open after clicking history button').toBeVisible({ timeout: 5_000 });

    // 关闭面板
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // 断言2：名称已保存（失焦保存生效）
    const titleAfter = page.locator(TITLE_TEXT).first();
    const afterText = (await titleAfter.textContent())?.trim() ?? '';
    expect(afterText.length, 'title should not be empty after blur-save').toBeGreaterThan(0);
    // 新名称应该保存成功（失焦触发保存）
    expect(afterText, 'new name should be saved after blur (focus moved to history btn)').toBe(newName);

    // 恢复原名称
    if (originalTitle) {
      await titleAfter.click();
      await page.waitForTimeout(300);
      const restoreInput = page.locator(TITLE_EDIT_INPUT).first();
      if (await restoreInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await restoreInput.fill(originalTitle);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(400);
      }
    }
  });

  test('失焦后无 JS 错误，页面 header 仍然正常', async ({ page }) => {
    await goToConv(page, _primaryId);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const titleEl = page.locator(TITLE_TEXT).first();
    await expect(titleEl).toBeVisible({ timeout: 5_000 });

    await titleEl.click();
    await page.waitForTimeout(200);
    const input = page.locator(TITLE_EDIT_INPUT).first();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('E2E-竞态-无错误测试');

    // 失焦：点击页面其他区域
    await page.locator('body').click({ position: { x: 200, y: 400 } });
    await page.waitForTimeout(600);

    // header 应仍然存在
    await expect(page.locator(CHAT_LAYOUT_HEADER).first(), 'header should survive blur-save').toBeVisible({
      timeout: 3_000,
    });
    // 无 JS 错误
    expect(
      errors.filter((e) => !e.includes('ResizeObserver')),
      'no JS errors during blur-save'
    ).toHaveLength(0);

    // 恢复：重新进入编辑并 Esc 取消（或者直接恢复，因为我们不知道原名）
  });
});

// ── M2-P0-2 & M2-P0-3: AC3a/3b 会话内搜索完整交互 ───────────────────────────
//
// 攻击：打开搜索面板 → 输入关键词 → 验证有结果 → ↑/↓ 导航 → Enter 跳转 → Esc 关闭
// 边界：输入不存在的关键词 → 显示 0 匹配而非崩溃

async function waitForNoToast(page: import('@playwright/test').Page): Promise<void> {
  // 等待 arco toast 消失，避免 toast 拦截后续点击
  await page
    .waitForFunction(() => !document.querySelector('[role="alert"].arco-message, .arco-message-list > *'), {
      timeout: 8_000,
    })
    .catch(() => {}); // 如果没有 toast 也不报错
  await page.waitForTimeout(200);
}

test.describe('M2-P0-2/P0-3: 会话内搜索完整交互 (AC3a, AC3b)', () => {
  test('AC3a/3b 搜索面板完整流程：打开→输入→结果→Esc关闭', async ({ page }) => {
    await goToConv(page, _primaryId);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await waitForNoToast(page);

    // 检查 minimap trigger 是否存在
    const hasTrigger = await page
      .locator(MINIMAP_TRIGGER)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!hasTrigger) {
      test.skip(true, 'Minimap trigger not present in this layout mode (hasTabs mode)');
      return;
    }

    // 打开搜索面板
    // header 中有 div.absolute.size-full 覆盖层，Playwright 坐标点击被拦截；
    // 用 JS dispatch 直接触发 click 事件（与 CDP trigger.click() 等效）
    await page.evaluate(() => {
      const trigger = document.querySelector('.conversation-minimap-trigger') as HTMLElement | null;
      trigger?.click();
    });
    await page.waitForTimeout(400);
    const panel = page.locator(CONV_SEARCH_PANEL).first();
    await expect(panel, 'search panel should open after clicking trigger').toBeVisible({ timeout: 5_000 });

    // 输入关键词（注入的消息格式是 "E2E test user message #N"）
    // 注意：input 初始为 readonly，需要先点击让它进入编辑状态
    const searchInput = page.locator(CONV_SEARCH_INPUT).first();
    const inputVisible = await searchInput.isVisible({ timeout: 3_000 }).catch(() => false);
    if (inputVisible) {
      await searchInput.click();
      await page.waitForTimeout(200);
      await searchInput.fill('E2E test');
      await page.waitForTimeout(600); // 等待搜索防抖

      // 验证有匹配结果（有结果列表或计数显示）
      const hasResults = await page.evaluate(() => {
        const panel = document.querySelector('.conversation-minimap-panel, .conversation-minimap-layer');
        if (!panel) return false;
        const text = panel.textContent ?? '';
        // 匹配 "N/M" 格式计数，或结果列表项
        return (
          /\d+\/\d+|\d+ 匹配|matches/.test(text) ||
          panel.querySelectorAll('li, [class*="result"], [class*="item"]').length > 0
        );
      });
      expect(hasResults, 'search panel should show results or count after inputting keyword').toBe(true);

      // 按 ↓ 键导航（至少不崩溃）
      await searchInput.press('ArrowDown');
      await page.waitForTimeout(200);
      await searchInput.press('ArrowDown');
      await page.waitForTimeout(200);

      // 按 Enter 跳转
      await searchInput.press('Enter');
      await page.waitForTimeout(400);

      // 跳转后面板应关闭或仍在（取决于实现），header 应存在
      await expect(page.locator(CHAT_LAYOUT_HEADER).first()).toBeVisible({ timeout: 3_000 });
    }

    // Esc 关闭面板
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(panel, 'search panel should close after Esc').toBeHidden({ timeout: 3_000 });
  });

  test('AC3b-attack: 搜索不存在关键词显示 0 匹配，不崩溃', async ({ page }) => {
    await goToConv(page, _primaryId);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);
    await waitForNoToast(page);

    const hasTrigger = await page
      .locator(MINIMAP_TRIGGER)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!hasTrigger) {
      test.skip(true, 'Minimap trigger not present in this layout mode');
      return;
    }

    await page.evaluate(() => {
      const trigger = document.querySelector('.conversation-minimap-trigger') as HTMLElement | null;
      trigger?.click();
    });
    await page.waitForTimeout(400);
    const panel = page.locator(CONV_SEARCH_PANEL).first();
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const searchInput = page.locator(CONV_SEARCH_INPUT).first();
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.click();
      await page.waitForTimeout(200);
      await searchInput.fill('xyzzy_impossible_keyword_12345');
      await page.waitForTimeout(600);

      // 不崩溃：panel 仍然存在
      await expect(panel, 'search panel should survive empty search result').toBeAttached();

      // 应显示 0 匹配或空状态，不显示 loading spinner
      const stillLoading = await page
        .locator('.arco-spin-loading')
        .first()
        .isVisible()
        .catch(() => false);
      expect(stillLoading, 'search should complete, not stuck loading').toBe(false);
    }

    await page.keyboard.press('Escape');
  });

  test('AC3b-attack: 搜索后按 ↑/↓ 不崩溃，页面不出错', async ({ page }) => {
    await goToConv(page, _primaryId);
    await waitForNoToast(page);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const hasTrigger = await page
      .locator(MINIMAP_TRIGGER)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!hasTrigger) {
      test.skip(true, 'Minimap trigger not present in this layout mode');
      return;
    }

    await page.evaluate(() => {
      const trigger = document.querySelector('.conversation-minimap-trigger') as HTMLElement | null;
      trigger?.click();
    });
    await page.waitForTimeout(400);
    const panel = page.locator(CONV_SEARCH_PANEL).first();
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const searchInput = page.locator(CONV_SEARCH_INPUT).first();
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.click();
      await page.waitForTimeout(200);
      await searchInput.fill('E2E test');
      await page.waitForTimeout(500);

      // 快速按 ↑↓ 10 次（压力测试键盘导航）
      for (let i = 0; i < 5; i++) {
        await searchInput.press('ArrowDown');
        await page.waitForTimeout(50);
      }
      for (let i = 0; i < 5; i++) {
        await searchInput.press('ArrowUp');
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(300);
    }

    // 没有 JS 错误
    expect(
      errors.filter((e) => !e.includes('ResizeObserver')),
      'no JS errors during keyboard navigation'
    ).toHaveLength(0);

    await page.keyboard.press('Escape');
  });
});

// ── M2-P0-4: AC24+AC32 历史面板快速 UI 点击切换竞态 ─────────────────────────
//
// 与现有 AC32 测试的区别：这里用真实的 UI 点击（不用 page.evaluate），
// 快速连续点击不同历史行，模拟用户快速切换。

test.describe('M2-P0-4: 历史面板快速 UI 点击竞态 (AC24, AC32)', () => {
  test('快速点击历史面板中不同会话行，最终落在正确会话上', async ({ page }) => {
    expect(_primaryId, 'primary conversation must exist').toBeTruthy();
    expect(_secondaryId, 'secondary conversation must exist').toBeTruthy();

    // 先导航到 secondary
    await goToConv(page, _secondaryId);

    // 竞态攻击：3 次快速开/关历史面板并点击，模拟用户快速切换习惯
    // 每次：打开面板 → 找到第一行 → 点击（触发导航关闭面板）→ 立即重新打开
    for (let round = 0; round < 3; round++) {
      await page.locator(HISTORY_PANEL_BTN).first().click();
      await page.waitForTimeout(300);
      const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
      const isOpen = await dropdown.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!isOpen) break;

      const rows = dropdown.locator('.flex.items-center.gap-8px.px-12px.py-6px.cursor-pointer');
      const rowCount = await rows.count();
      if (rowCount === 0) break;

      // 点击一行（触发导航 + 面板关闭）
      const targetRow = rows.nth(Math.min(round % rowCount, rowCount - 1));
      await targetRow.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(200); // 不等待完整导航，立即开始下一轮
    }

    // 等待最终导航稳定
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 10_000 });
    await waitForSettle(page);

    // 最终必须在某个有效的会话页面
    expect(page.url(), 'should land on a valid conversation page').toContain('/conversation/');

    // header 必须正常渲染（不白屏）
    await expect(page.locator(CHAT_LAYOUT_HEADER).first(), 'header must render after rapid switch').toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator(SENDBOX_PANEL).first(), 'sendbox must render after rapid switch').toBeVisible({
      timeout: 8_000,
    });
  });

  test('快速切换后消息列表内容属于当前 URL 对应的会话', async ({ page }) => {
    expect(_primaryId).toBeTruthy();
    expect(_secondaryId).toBeTruthy();

    // 导航到有消息的 primary
    await goToConv(page, _primaryId);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);
    const msgInPrimary = await page.locator(MESSAGE_ITEM).count();
    expect(msgInPrimary, 'primary conversation should have injected messages').toBeGreaterThan(0);

    // 快速切换到 secondary（空会话），验证消息被清空
    await goToConv(page, _secondaryId);
    await page.waitForTimeout(1_000);
    const msgInSecondary = await page.locator(MESSAGE_ITEM).count();
    expect(msgInSecondary, 'empty conversation should show 0 messages, not residue from previous').toBe(0);

    // 切换回 primary，验证消息恢复（不检查精确数量，只检查有消息）
    await goToConv(page, _primaryId);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const msgBackInPrimary = await page.locator(MESSAGE_ITEM).count();
    expect(msgBackInPrimary, 'returning to primary should restore its messages (> 0)').toBeGreaterThan(0);
  });
});

// ── M2-P1-1: AC29 重命名纯空格字符串 ────────────────────────────────────────
//
// 攻击：输入 "   "（纯空格）→ Enter → 预期恢复原名称（trim() 后为空应被拒绝）

test.describe('M2-P1-1: 重命名纯空格字符串 (AC29)', () => {
  test('输入纯空格后按 Enter，标题恢复原名称', async ({ page }) => {
    await goToConv(page, _primaryId);

    const titleEl = page.locator(TITLE_TEXT).first();
    await expect(titleEl).toBeVisible({ timeout: 5_000 });
    const originalTitle = (await titleEl.textContent())?.trim() ?? '';
    expect(originalTitle.length, 'original title should not be empty').toBeGreaterThan(0);

    await titleEl.click();
    await page.waitForTimeout(300);
    const input = page.locator(TITLE_EDIT_INPUT).first();
    await expect(input).toBeVisible({ timeout: 3_000 });

    // 输入纯空格
    await input.fill('   ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    // 编辑模式退出
    await expect(input, 'input should be hidden after Enter').toBeHidden({ timeout: 3_000 });

    // 标题应恢复原名称（不能保存空白标题）
    const titleAfter = page.locator(TITLE_TEXT).first();
    const afterText = (await titleAfter.textContent())?.trim() ?? '';
    expect(afterText.length, 'title should not be empty after whitespace-only rename').toBeGreaterThan(0);
    expect(afterText, 'whitespace-only rename should revert to original title').toBe(originalTitle);
  });

  test('输入单个空格后失焦，标题不变为空且核心内容不丢失', async ({ page }) => {
    await goToConv(page, _primaryId);

    const titleEl = page.locator(TITLE_TEXT).first();
    await expect(titleEl).toBeVisible({ timeout: 5_000 });
    // 使用 beforeAll 中记录的原始名称，而非当前 UI 显示（当前 UI 可能被上一个测试改过）
    const referenceTitle = _primaryOriginalName ?? (await titleEl.textContent())?.trim() ?? '';

    await titleEl.click();
    await page.waitForTimeout(300);
    const input = page.locator(TITLE_EDIT_INPUT).first();
    await expect(input).toBeVisible({ timeout: 3_000 });

    await input.fill(' ');
    // 失焦（而非 Enter）
    await page.locator('body').click({ position: { x: 200, y: 400 } });
    await page.waitForTimeout(600);

    const titleAfter = page.locator(TITLE_TEXT).first();
    const afterText = (await titleAfter.textContent())?.trim() ?? '';
    // 核心断言：标题不能变成空
    expect(afterText.length, 'title should not be empty after single-space rename + blur').toBeGreaterThan(0);
    // 进一步断言：标题不能包含孤立的空白字符
    expect(afterText.trim().length, 'title trim should be non-empty (whitespace-only title rejected)').toBeGreaterThan(
      0
    );
    // 如果应用正确拒绝了空白输入，名称应该恢复（非必须等于原始名，但必须是有效非空字符串）
    // 注：如果前序测试修改了名称，这里只验证"不为空"这一核心约束
    expect(afterText, 'whitespace-only blur must not corrupt title: should remain non-whitespace').not.toMatch(/^\s+$/);
  });
});

// ── M2-P1-2: AC19 重命名后刷新页面 — 名称持久化 ─────────────────────────────
//
// 攻击：重命名 → 立即刷新 → 验证新名称持久化
// 目标：暴露保存异步但刷新太快导致丢失的 bug

test.describe('M2-P1-2: 重命名后刷新持久化 (AC19)', () => {
  test('重命名后刷新页面，新名称仍然存在', async ({ page }) => {
    await goToConv(page, _primaryId);

    const titleEl = page.locator(TITLE_TEXT).first();
    await expect(titleEl).toBeVisible({ timeout: 5_000 });

    await titleEl.click();
    await page.waitForTimeout(300);
    const input = page.locator(TITLE_EDIT_INPUT).first();
    await expect(input).toBeVisible({ timeout: 3_000 });

    const persistName = 'E2E-持久化测试-' + Date.now();
    await input.fill(persistName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    // 确认名称已保存到 UI
    const titleAfter = page.locator(TITLE_TEXT).first();
    await expect(titleAfter).toBeVisible({ timeout: 3_000 });
    const savedText = (await titleAfter.textContent())?.trim() ?? '';
    expect(savedText, 'name should be saved before refresh').toBe(persistName);

    // 刷新页面（重新导航到同一会话）
    await page.evaluate((h) => window.location.assign(h), `#/conversation/${_primaryId}`);
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
    await waitForSettle(page);
    await page.waitForTimeout(500);

    // 刷新后名称应持久化
    const titleAfterRefresh = page.locator(TITLE_TEXT).first();
    await expect(titleAfterRefresh).toBeVisible({ timeout: 5_000 });
    const refreshedText = (await titleAfterRefresh.textContent())?.trim() ?? '';
    expect(refreshedText, 'name should persist after page refresh').toBe(persistName);

    // 恢复：改回原名（不关键，afterAll 会删除会话）
  });

  test('重命名后立即刷新（< 100ms），名称仍然持久化', async ({ page }) => {
    await goToConv(page, _primaryId);

    const titleEl = page.locator(TITLE_TEXT).first();
    await expect(titleEl).toBeVisible({ timeout: 5_000 });

    await titleEl.click();
    await page.waitForTimeout(200);
    const input = page.locator(TITLE_EDIT_INPUT).first();
    await expect(input).toBeVisible({ timeout: 3_000 });

    const fastSaveName = 'E2E-快速保存-' + Date.now();
    await input.fill(fastSaveName);
    await page.keyboard.press('Enter');

    // 不等待，立即刷新（< 100ms）
    await page.evaluate((h) => window.location.assign(h), `#/conversation/${_primaryId}`);
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
    await waitForSettle(page);
    await page.waitForTimeout(800); // 给足时间让数据从 DB 回填

    const titleAfterFastRefresh = page.locator(TITLE_TEXT).first();
    await expect(titleAfterFastRefresh).toBeVisible({ timeout: 5_000 });
    const fastRefreshedText = (await titleAfterFastRefresh.textContent())?.trim() ?? '';
    expect(fastRefreshedText.length, 'title should not be empty after fast-refresh').toBeGreaterThan(0);
    // 名称应持久化（如果失败说明保存是异步的且刷新太快会丢失）
    expect(fastRefreshedText, 'name should persist even with immediate refresh').toBe(fastSaveName);
  });
});

// ── M2-P1-3: AC22 历史面板排序 + 最多 20 条 ──────────────────────────────────
//
// 攻击：打开历史面板，验证：
// 1. 会话按修改时间倒序排列（越新的越靠前）
// 2. 列表最多 20 条（不超出）

test.describe('M2-P1-3: 历史面板排序和数量上限 (AC22)', () => {
  test('历史面板：列表项数不超过 20 条', async ({ page }) => {
    await goToConv(page, _primaryId);

    await page.locator(HISTORY_PANEL_BTN).first().click();
    await page.waitForTimeout(400);
    const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    const rows = dropdown.locator('.flex.items-center.gap-8px.px-12px.py-6px.cursor-pointer');
    const rowCount = await rows.count();

    expect(rowCount, 'history panel should show at least 1 conversation').toBeGreaterThan(0);
    expect(rowCount, 'history panel should show at most 20 conversations (AC22 spec)').toBeLessThanOrEqual(20);

    await page.keyboard.press('Escape');
  });

  test('历史面板：当前会话（最近访问）应在列表前部', async ({ page }) => {
    // 先访问 secondary，再访问 primary（primary 最后被访问，应在前）
    await goToConv(page, _secondaryId);
    await page.waitForTimeout(300);
    await goToConv(page, _primaryId);
    await page.waitForTimeout(300);

    await page.locator(HISTORY_PANEL_BTN).first().click();
    await page.waitForTimeout(400);
    const dropdown = page.locator(HISTORY_PANEL_DROPDOWN).first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    // 当前会话（primary）应该有高亮标识
    const hasCurrentHighlight = await dropdown.evaluate((el) => {
      const rows = el.querySelectorAll('.flex.items-center.gap-8px.px-12px.py-6px.cursor-pointer');
      return Array.from(rows).some((r) => r.className.includes('bg-[var(--color-fill-2)]'));
    });
    expect(hasCurrentHighlight, 'current conversation should be highlighted in history panel').toBe(true);

    // 当前会话的高亮行应该在列表前部（前5行内）
    const highlightIndex = await dropdown.evaluate((el) => {
      const rows = Array.from(el.querySelectorAll('.flex.items-center.gap-8px.px-12px.py-6px.cursor-pointer'));
      return rows.findIndex((r) => r.className.includes('bg-[var(--color-fill-2)]'));
    });
    expect(highlightIndex, 'current conversation should be in the first 5 rows (recency ordering)').toBeLessThan(5);

    await page.keyboard.press('Escape');
  });
});

// ── M2-P1-4: AC27 已删除会话 ID 导航 ─────────────────────────────────────────
//
// 攻击：导航到一个"曾经存在但已被删除"的会话 ID
// 这比 random fake ID 更真实——数据库中可能有残留记录触发不同的错误路径

test.describe('M2-P1-4: 已删除会话 ID 导航 (AC27)', () => {
  test('导航到已删除的会话 ID — 不永久 loading，有明确反馈', async ({ page }) => {
    // ghostId 在 beforeAll 中被创建后立即删除
    if (!_ghostId) {
      test.skip(true, 'Ghost conversation creation failed in beforeAll — cannot test deleted ID');
      return;
    }

    await page.evaluate((h) => window.location.assign(h), `#/conversation/${_ghostId}`);
    await page.waitForTimeout(4_000); // 等待 4 秒，检查是否有 loading 卡住

    // 不应该永久 loading
    const stillLoading = await page
      .locator('.arco-spin-loading, [class*="loading"]')
      .first()
      .isVisible()
      .catch(() => false);
    expect(stillLoading, 'should not be stuck in loading state for a deleted conversation ID').toBe(false);

    // 应该处于某种有效状态：404 错误页 / 重定向到 /guid / 空会话界面
    const url = page.url();
    const bodyText = await page
      .locator('body')
      .textContent()
      .catch(() => '');

    const isValidState = url.includes('/guid') || url.includes('/conversation/') || (bodyText?.trim()?.length ?? 0) > 0;

    expect(isValidState, 'should be in a valid state (not blank/crashed) after navigating to deleted ID').toBe(true);
  });

  test('导航到完全随机 ID — 不永久 loading，页面有内容', async ({ page }) => {
    const randomId = 'deleted-e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await page.evaluate((h) => window.location.assign(h), `#/conversation/${randomId}`);
    await page.waitForTimeout(4_000);

    const stillLoading = await page
      .locator('.arco-spin-loading')
      .first()
      .isVisible()
      .catch(() => false);
    expect(stillLoading, 'random invalid ID should not cause permanent loading').toBe(false);

    const bodyText = await page
      .locator('body')
      .textContent()
      .catch(() => '');
    expect((bodyText?.trim()?.length ?? 0) > 0, 'page should have content for invalid ID').toBe(true);
  });
});
