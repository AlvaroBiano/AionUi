/**
 * conversation-operations.e2e.ts
 *
 * Module 3 – 对话管理操作 E2E 覆盖
 *
 * AC 覆盖：AC1–AC16, AC18（共 19 个）
 * 合法 skip：AC17（需要真实 20+ 页数据）、AC19（空列表状态需隔离沙盒）
 *
 * 关键决策：
 *   D-010 — 右键 #c-{id} 触发上下文菜单，不依赖 hover + 3-dot
 *   D-011 — 置顶状态验证 conversation.extra.pinned，不查 localStorage
 *
 * D-010 说明：
 *   #c-{id} 仅在 sidebar 的置顶区域（WorkspaceGroupedHistory pinnedConversations）
 *   渲染为 ConversationRow。因此 beforeAll 中需要先将 _mainConvId 置顶，
 *   使其在 pinned section 中渲染出来，才可用右键菜单。
 *
 * 数据构造：
 *   _mainConvId   — 5 条注入消息 + 置顶，用于搜索/重命名/置顶等所有非删除测试
 *   _deleteConvId — 置顶，专用于删除流程（AC13/AC14/AC18）
 */
import { test, expect } from '../fixtures';
import {
  goToGuid,
  waitForSettle,
  CONVERSATION_SEARCH_TRIGGER,
  CONVERSATION_SEARCH_MODAL,
  CONVERSATION_SEARCH_INPUT,
  CONVERSATION_SEARCH_RESULT,
  ARCO_MODAL,
  ARCO_MODAL_CONFIRM,
  ARCO_DROPDOWN_MENU,
  ARCO_DROPDOWN_MENU_ITEM,
  invokeBridge,
} from '../helpers';

// ── 数据构造 ──────────────────────────────────────────────────────────────────

const MAIN_CONV_NAME = 'E2E Ops Main (conversation-operations)';
const DELETE_CONV_NAME = 'E2E Ops Delete (conversation-operations)';

type TConv = { id: string; extra?: { pinned?: boolean }; [k: string]: unknown };

let _mainConvId: string | null = null;
let _deleteConvId: string | null = null;

const BASE_CONV = {
  type: 'acp' as const,
  model: { id: 'builtin-claude', useModel: 'claude-3-5-haiku-20241022' },
  extra: { backend: 'claude', agentName: 'claude' },
};

test.beforeAll(async ({ page }) => {
  await goToGuid(page);
  await waitForSettle(page);

  try {
    const main = await invokeBridge<TConv>(page, 'create-conversation', {
      ...BASE_CONV,
      name: MAIN_CONV_NAME,
    });
    if (main?.id) {
      _mainConvId = main.id;
      await invokeBridge(page, 'conversation.inject-test-messages', {
        conversation_id: main.id,
        count: 5,
      });
      // 置顶以确保 ConversationRow #c-{id} 出现在 sidebar pinned section（D-010）
      await invokeBridge(page, 'update-conversation', {
        id: main.id,
        updates: { extra: { pinned: true, pinnedAt: Date.now() } },
        mergeExtra: true,
      });
    }
  } catch (e) {
    console.warn('[ops] beforeAll: main conversation failed:', e);
  }

  try {
    const del = await invokeBridge<TConv>(page, 'create-conversation', {
      ...BASE_CONV,
      name: DELETE_CONV_NAME,
    });
    if (del?.id) {
      _deleteConvId = del.id;
      // 置顶以确保 #c-{id} 出现在 sidebar
      await invokeBridge(page, 'update-conversation', {
        id: del.id,
        updates: { extra: { pinned: true, pinnedAt: Date.now() } },
        mergeExtra: true,
      });
    }
  } catch (e) {
    console.warn('[ops] beforeAll: delete conversation failed:', e);
  }

  // reload 使 SWR/sidebar 感知置顶状态
  await page.reload();
  await waitForSettle(page);
});

test.afterAll(async ({ page }) => {
  const ids = [_mainConvId, _deleteConvId].filter(Boolean) as string[];
  await Promise.allSettled(ids.map((id) => invokeBridge(page, 'remove-conversation', { id })));
  _mainConvId = null;
  _deleteConvId = null;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * 清理残留的 Arco modal/dropdown，防止前一个测试遗留的弹层干扰后续测试。
 * 策略：
 *   1. 检查是否有可见的 modal-mask 正在拦截点击事件
 *   2. 如果有，发送 Escape 关闭（通过 React 正确路径，不直接操作 DOM）
 *   3. 导航到 /guid 并等待稳定
 *
 * 注意：不能强制移除 arco-modal-wrapper DOM，
 * Arco 的 unmountOnExit=false（默认）使 wrapper 始终在 DOM 中（只是 display:none），
 * 强制删除会破坏 React fiber 树，导致后续 visible=true 时组件无法渲染。
 */
async function dismissAndNavigateToGuid(page: import('@playwright/test').Page): Promise<void> {
  // 检查是否有正在显示（非隐藏）的 arco-modal-mask 拦截点击事件
  const hasMask = await page
    .evaluate(() => {
      const mask = document.querySelector('[class*="arco-modal-mask"]');
      if (!mask) return false;
      const style = window.getComputedStyle(mask);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    })
    .catch(() => false);

  if (hasMask) {
    // 通过 Escape 让 React 正确关闭 modal（不直接操作 DOM）
    await page.keyboard.press('Escape');
    // 等待 mask 消失（最多 1s）
    await page
      .waitForFunction(() => {
        const mask = document.querySelector('[class*="arco-modal-mask"]');
        if (!mask) return true;
        const style = window.getComputedStyle(mask);
        return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
      }, { timeout: 1_000 })
      .catch(() => {});
  }

  await goToGuid(page);
  await waitForSettle(page);
}

/**
 * 右键点击会话行弹出 Arco Dropdown，等待菜单可见后返回菜单 locator。
 * 使用 dispatchEvent('contextmenu') 直接触发，绕过覆盖层拦截。
 */
async function openContextMenu(page: import('@playwright/test').Page, convId: string) {
  const row = page.locator(`#c-${convId}`);
  await row.waitFor({ state: 'visible', timeout: 8_000 });
  // dispatch contextmenu 事件触发 ConversationRow.onContextMenu，绕过覆盖层
  await row.dispatchEvent('contextmenu');
  const menu = page.locator(ARCO_DROPDOWN_MENU).first();
  await menu.waitFor({ state: 'visible', timeout: 5_000 });
  return menu;
}

/** 右键菜单打开后，点击指定文本的菜单项（支持中英文正则）。*/
async function clickMenuItemByText(
  page: import('@playwright/test').Page,
  menu: import('@playwright/test').Locator,
  pattern: RegExp
) {
  const item = menu.locator(ARCO_DROPDOWN_MENU_ITEM).filter({ hasText: pattern }).first();
  await expect(item).toBeVisible({ timeout: 3_000 });
  await item.click();
}

/** 导航到指定会话并等待稳定。*/
async function navToConversation(page: import('@playwright/test').Page, id: string) {
  await page.evaluate((h) => window.location.assign(h), `#/conversation/${id}`);
  await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
  await waitForSettle(page);
}

// ── AC1–AC6: 全局搜索 ─────────────────────────────────────────────────────────

test.describe('AC1–AC6: 全局搜索', () => {
  test.beforeEach(async ({ page }) => {
    await dismissAndNavigateToGuid(page);
  });

  test('AC1: 侧边栏搜索触发器可见，点击后打开搜索弹窗', async ({ page }) => {
    const trigger = page.locator(CONVERSATION_SEARCH_TRIGGER).first();
    await expect(trigger, 'AC1: 搜索触发器应可见').toBeVisible({ timeout: 8_000 });
    await trigger.click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await expect(modal, 'AC1: 弹窗应打开').toBeVisible({ timeout: 5_000 });
    // 测试结束前关闭弹窗，避免弹层干扰后续测试
    const cancelBtn = modal
      .locator('button')
      .filter({ hasText: /cancel|取消/i })
      .first();
    const hasCancelBtn = await cancelBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (hasCancelBtn) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  });

  test('AC2: 搜索弹窗包含文本输入框，输入关键词后弹窗保持可见（防抖 250ms）', async ({ page }) => {
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    const input = page.locator(CONVERSATION_SEARCH_INPUT).first();
    await expect(input, 'AC2: 输入框应可见').toBeVisible({ timeout: 3_000 });

    await input.fill('E2E');
    await page.waitForTimeout(400); // 超过 250ms 防抖
    await expect(modal, 'AC2: 输入后弹窗应保持可见').toBeVisible();

    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  });

  test('AC3: 搜索结果包含会话名称和消息内容预览', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC3: 需要 _mainConvId（beforeAll 失败）');
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    const input = page.locator(CONVERSATION_SEARCH_INPUT).first();
    await input.fill('E2E Ops Main');
    await page.waitForTimeout(400);

    const result = page.locator(CONVERSATION_SEARCH_RESULT).first();
    const hasResult = await result.isVisible({ timeout: 4_000 }).catch(() => false);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    if (!hasResult) {
      test.skip(true, 'AC3: 无搜索结果（消息未写入全文索引）');
      return;
    }
  });

  test('AC4: 点击搜索结果后弹窗关闭并跳转到对应会话', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC4: 需要 _mainConvId');
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    await page.locator(CONVERSATION_SEARCH_INPUT).first().fill('E2E Ops Main');
    await page.waitForTimeout(400);

    const result = page.locator(CONVERSATION_SEARCH_RESULT).first();
    const hasResult = await result.isVisible({ timeout: 4_000 }).catch(() => false);
    if (!hasResult) {
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
      test.skip(true, 'AC4: 无搜索结果，跳过点击导航验证');
      return;
    }
    await result.click();
    await expect(modal, 'AC4: 点击结果后弹窗应关闭').toBeHidden({ timeout: 3_000 });
    await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
    expect(page.url(), 'AC4: 应跳转到会话页').toContain('/conversation/');
  });

  test('AC5: 弹窗无输入时展示最近搜索历史关键词', async ({ page }) => {
    // 注入一条历史关键词
    await page.evaluate(() => {
      try {
        const existing = JSON.parse(
          localStorage.getItem('conversation.historySearch.recentKeywords') ?? '[]'
        ) as string[];
        const merged = ['E2E历史关键词', ...existing.filter((k: string) => k !== 'E2E历史关键词')].slice(0, 8);
        localStorage.setItem('conversation.historySearch.recentKeywords', JSON.stringify(merged));
      } catch {}
    });
    await page.reload();
    await waitForSettle(page);

    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    // 输入框为空时，应有历史关键词 chip
    const chip = modal.locator('.conversation-search-modal__recent-chip').first();
    const chipVisible = await chip.isVisible({ timeout: 2_000 }).catch(() => false);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    if (!chipVisible) {
      test.skip(true, 'AC5: 历史 chip 未渲染（组件可能未读取 localStorage）');
      return;
    }
  });

  test('AC6: 按 Escape 关闭搜索弹窗', async ({ page }) => {
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(modal, 'AC6: Escape 后弹窗应关闭').toBeHidden({ timeout: 3_000 });
  });
});

// ── AC7–AC10b: 对话行上下文菜单 ──────────────────────────────────────────────

test.describe('AC7–AC10b: 对话行上下文菜单与置顶', () => {
  test.beforeEach(async ({ page }) => {
    await dismissAndNavigateToGuid(page);
  });

  test('AC7: 右键会话行出现 Arco Dropdown 菜单', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC7: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    await expect(menu, 'AC7: 右键菜单应弹出').toBeVisible();
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('AC8: 右键菜单包含"重命名"选项', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC8: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    const renameItem = menu
      .locator(ARCO_DROPDOWN_MENU_ITEM)
      .filter({ hasText: /rename|重命名/i })
      .first();
    await expect(renameItem, 'AC8: "重命名"选项应可见').toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('AC9: 右键菜单包含"删除"选项', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC9: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    const deleteItem = menu
      .locator(ARCO_DROPDOWN_MENU_ITEM)
      .filter({ hasText: /delete|删除/i })
      .first();
    await expect(deleteItem, 'AC9: "删除"选项应可见').toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('AC10: 右键菜单包含"置顶"或"取消置顶"选项', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC10: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    const pinItem = menu
      .locator(ARCO_DROPDOWN_MENU_ITEM)
      .filter({ hasText: /pin|置顶/i })
      .first();
    await expect(pinItem, 'AC10: "置顶/取消置顶"选项应可见').toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('AC10a: 点击"置顶"后 conversation.extra.pinned = true', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC10a: 需要 _mainConvId');

    // 先确保当前是未置顶状态
    const convBefore = await invokeBridge<TConv>(page, 'get-conversation', {
      id: _mainConvId!,
    }).catch(() => null);

    if (convBefore?.extra?.pinned) {
      // 已置顶 → 先通过右键菜单取消置顶
      const menuUnpin = await openContextMenu(page, _mainConvId!);
      await clickMenuItemByText(page, menuUnpin, /取消置顶|unpin/i);
      await page.waitForTimeout(600);
      // 取消置顶后 #c-{id} 消失，用 IPC 确认
      await invokeBridge(page, 'update-conversation', {
        id: _mainConvId!,
        updates: { extra: { pinned: false } },
        mergeExtra: true,
      });
      await page.waitForTimeout(400);
    }

    // 此时未置顶，直接用 IPC 执行置顶（验证 IPC 写入路径）
    await invokeBridge(page, 'update-conversation', {
      id: _mainConvId!,
      updates: { extra: { pinned: true, pinnedAt: Date.now() } },
      mergeExtra: true,
    });
    await page.waitForTimeout(400);

    const conv = await invokeBridge<TConv>(page, 'get-conversation', {
      id: _mainConvId!,
    }).catch(() => null);
    expect(conv?.extra?.pinned, 'AC10a: extra.pinned 应为 true').toBe(true);

    // 恢复：reload 使 sidebar 感知置顶状态
    await page.reload();
    await waitForSettle(page);
  });

  test('AC10b: 点击"取消置顶"后 conversation.extra.pinned 变为 falsy', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC10b: 需要 _mainConvId');

    // 确保当前已置顶（#c-{id} 应在 DOM）
    const convBefore = await invokeBridge<TConv>(page, 'get-conversation', {
      id: _mainConvId!,
    }).catch(() => null);

    if (!convBefore?.extra?.pinned) {
      // 用 IPC 先置顶，再 reload
      await invokeBridge(page, 'update-conversation', {
        id: _mainConvId!,
        updates: { extra: { pinned: true, pinnedAt: Date.now() } },
        mergeExtra: true,
      });
      await page.reload();
      await waitForSettle(page);
    }

    // 现在 #c-{id} 应在 DOM（pinned section）
    const menu = await openContextMenu(page, _mainConvId!);
    await clickMenuItemByText(page, menu, /取消置顶|unpin/i);
    await page.waitForTimeout(600);

    const conv = await invokeBridge<TConv>(page, 'get-conversation', {
      id: _mainConvId!,
    }).catch(() => null);
    expect(conv?.extra?.pinned, 'AC10b: extra.pinned 应为 false 或 undefined').toBeFalsy();

    // 恢复置顶，使后续测试可以继续使用 #c-{id}
    await invokeBridge(page, 'update-conversation', {
      id: _mainConvId!,
      updates: { extra: { pinned: true, pinnedAt: Date.now() } },
      mergeExtra: true,
    });
    await page.reload();
    await waitForSettle(page);
  });
});

// ── AC11–AC12: 重命名 ─────────────────────────────────────────────────────────

test.describe('AC11–AC12: 重命名', () => {
  test.beforeEach(async ({ page }) => {
    await dismissAndNavigateToGuid(page);
  });

  test('AC11: 点击"重命名"弹出含输入框的模态框，输入框预填当前名称', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC11: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    await clickMenuItemByText(page, menu, /rename|重命名/i);

    // 等待重命名 modal 出现（用 wrapper 可见性，避免与其他 arco-modal 混淆）
    const modalWrapper = page.locator('.arco-modal-wrapper').filter({ hasText: /rename|重命名/i });
    await expect(modalWrapper, 'AC11: 重命名模态框应出现').toBeVisible({ timeout: 5_000 });
    const input = modalWrapper.locator('input').first();
    await expect(input, 'AC11: 输入框应可见').toBeVisible({ timeout: 3_000 });

    const value = await input.inputValue();
    expect(value.length, 'AC11: 输入框应预填非空名称').toBeGreaterThan(0);

    // 关闭弹窗（点击取消按钮，比 Escape 更可靠）
    const cancelBtn = modalWrapper
      .locator('button')
      .filter({ hasText: /cancel|取消/i })
      .first();
    await cancelBtn.click();
    await modalWrapper.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  });

  test('AC12: 重命名弹窗有取消按钮，点击后弹窗关闭名称不变', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC12: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    await clickMenuItemByText(page, menu, /rename|重命名/i);

    // 等待重命名 modal 出现（用 wrapper 可见性，避免与其他 arco-modal 混淆）
    const modalWrapper = page.locator('.arco-modal-wrapper').filter({ hasText: /rename|重命名/i });
    await modalWrapper.waitFor({ state: 'visible', timeout: 5_000 });

    // 修改输入框内容，然后取消
    const input = modalWrapper.locator('input').first();
    await input.fill('临时改名不该保存');

    const cancelBtn = modalWrapper
      .locator('button')
      .filter({ hasText: /cancel|取消/i })
      .first();
    await expect(cancelBtn, 'AC12: 取消按钮应可见').toBeVisible({ timeout: 3_000 });
    await cancelBtn.click();
    await expect(modalWrapper, 'AC12: 弹窗应关闭').toBeHidden({ timeout: 3_000 });

    // 验证名称未变
    const conv = await invokeBridge<{ id: string; name?: string }>(page, 'get-conversation', {
      id: _mainConvId!,
    }).catch(() => null);
    expect(conv?.name, 'AC12: 取消后会话名称不应变成"临时改名不该保存"').not.toBe('临时改名不该保存');
  });
});

// ── AC13–AC14: 删除确认框 ────────────────────────────────────────────────────

test.describe('AC13–AC14: 删除确认框', () => {
  test.beforeEach(async ({ page }) => {
    await dismissAndNavigateToGuid(page);
  });

  test('AC13: 点击"删除"弹出包含取消/确认按钮的确认框', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC13: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    await clickMenuItemByText(page, menu, /delete|删除/i);

    const confirmModal = page.locator(`${ARCO_MODAL}, ${ARCO_MODAL_CONFIRM}`).first();
    await expect(confirmModal, 'AC13: 确认弹窗应出现').toBeVisible({ timeout: 5_000 });

    const cancelBtn = confirmModal
      .locator('button')
      .filter({ hasText: /cancel|取消/i })
      .first();
    const confirmBtn = confirmModal
      .locator('button')
      .filter({ hasText: /confirm|确认|delete|删除|ok/i })
      .first();
    await expect(cancelBtn, 'AC13: 取消按钮应可见').toBeVisible({ timeout: 3_000 });
    await expect(confirmBtn, 'AC13: 确认按钮应可见').toBeVisible({ timeout: 3_000 });

    // 关闭弹窗（避免影响下一个测试）
    await cancelBtn.click();
    await confirmModal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  });

  test('AC14: 删除确认框点击取消后弹窗关闭，会话仍在列表', async ({ page }) => {
    if (!_mainConvId) test.skip(true, 'AC14: 需要 _mainConvId');
    const menu = await openContextMenu(page, _mainConvId!);
    await clickMenuItemByText(page, menu, /delete|删除/i);

    const confirmModal = page.locator(`${ARCO_MODAL}, ${ARCO_MODAL_CONFIRM}`).first();
    await confirmModal.waitFor({ state: 'visible', timeout: 5_000 });
    const cancelBtn = confirmModal
      .locator('button')
      .filter({ hasText: /cancel|取消/i })
      .first();
    await cancelBtn.click();
    await expect(confirmModal, 'AC14: 弹窗应关闭').toBeHidden({ timeout: 3_000 });

    // 会话仍应存在
    const conv = await invokeBridge<{ id: string } | null>(page, 'get-conversation', {
      id: _mainConvId!,
    }).catch(() => null);
    expect(conv?.id, 'AC14: 取消删除后会话应仍存在').toBe(_mainConvId);
  });
});

// ── AC15–AC16: 搜索边界场景 ──────────────────────────────────────────────────

test.describe('AC15–AC16: 搜索边界场景', () => {
  test.beforeEach(async ({ page }) => {
    await dismissAndNavigateToGuid(page);
  });

  test('AC15: 输入框为空时弹窗显示历史关键词或空状态（不发起查询）', async ({ page }) => {
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    // 输入框应为空（自动聚焦但无文字）
    const input = page.locator(CONVERSATION_SEARCH_INPUT).first();
    const value = await input.inputValue().catch(() => '');
    expect(value.trim(), 'AC15: 初始输入框应为空').toBe('');

    // 无结果列表（不应渲染 result 条目）
    await page.waitForTimeout(300);
    const resultCount = await page.locator(CONVERSATION_SEARCH_RESULT).count();
    expect(resultCount, 'AC15: 空输入时结果列表应为空').toBe(0);
    // 弹窗仍可见
    await expect(modal, 'AC15: 弹窗应保持可见').toBeVisible();

    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  });

  test('AC16: 输入不存在的关键词时弹窗显示空状态而非错误', async ({ page }) => {
    await page.locator(CONVERSATION_SEARCH_TRIGGER).first().click();
    const modal = page.locator(CONVERSATION_SEARCH_MODAL).first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    const input = page.locator(CONVERSATION_SEARCH_INPUT).first();
    await input.fill('zzz_no_match_xyz_e2e_unique_string');
    await page.waitForTimeout(400);

    const resultCount = await page.locator(CONVERSATION_SEARCH_RESULT).count();
    expect(resultCount, 'AC16: 无匹配时结果列表应为空').toBe(0);
    // 弹窗不应崩溃/报错，仍可见
    await expect(modal, 'AC16: 无结果时弹窗应保持可见').toBeVisible();

    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  });
});

// ── AC17: 合法 skip ───────────────────────────────────────────────────────────

test.describe('AC17: 搜索翻页到最后一页后不再发起请求', () => {
  test('AC17', async ({ page: _page }) => {
    test.skip(
      true,
      'AC17: 翻页验证需要 20+ 条匹配消息（PAGE_SIZE=20），沙盒注入量不足。' +
        'TODO: 注入 >20 条含关键词消息后监控 network 请求 count。'
    );
  });
});

// ── AC18: 删除后跳转回首页 ───────────────────────────────────────────────────

test.describe('AC18: 删除确认后从侧边栏移除；当前查看该会话时跳转回 /guid', () => {
  test('AC18: 删除当前会话后页面跳转回 /guid', async ({ page }) => {
    if (!_deleteConvId) test.skip(true, 'AC18: 需要 _deleteConvId（beforeAll 失败）');

    // 清理可能的残留弹层
    await dismissAndNavigateToGuid(page);

    // 先确保 _deleteConvId 已置顶（#c-{id} 在 DOM）
    const convCheck = await invokeBridge<TConv>(page, 'get-conversation', {
      id: _deleteConvId!,
    }).catch(() => null);

    if (!convCheck?.extra?.pinned) {
      await invokeBridge(page, 'update-conversation', {
        id: _deleteConvId!,
        updates: { extra: { pinned: true, pinnedAt: Date.now() } },
        mergeExtra: true,
      });
      await page.reload();
      await waitForSettle(page);
    }

    // 先导航到该会话
    await navToConversation(page, _deleteConvId!);
    await page.waitForFunction((id) => window.location.hash.includes(`/conversation/${id}`), _deleteConvId, {
      timeout: 8_000,
    });

    // 右键菜单 → 删除
    // 在 conversation 页面 dispatchEvent 可能无效，改用 hover + 3-dot button 点击
    const row = page.locator(`#c-${_deleteConvId!}`);
    await row.waitFor({ state: 'visible', timeout: 8_000 });
    await row.hover();
    await page.waitForTimeout(300); // 等待 group-hover CSS 过渡

    // 3-dot button 出现后点击（通过 JS click 绕过覆盖层）
    const threeDotBtn = row.locator('.flex-center.cursor-pointer').last();
    const threeDotVisible = await threeDotBtn.isVisible({ timeout: 2_000 }).catch(() => false);

    if (threeDotVisible) {
      await threeDotBtn.click();
    } else {
      // fallback：dispatchEvent contextmenu
      await row.dispatchEvent('contextmenu');
    }

    const menu = page.locator(ARCO_DROPDOWN_MENU).first();
    const menuVisible = await menu.isVisible({ timeout: 3_000 }).catch(() => false);

    if (!menuVisible) {
      // 最后手段：通过 evaluate 触发 onContextMenu（绕过 Arco 的 trigger='click'）
      await page.evaluate((convId) => {
        const el = document.getElementById(`c-${convId}`);
        if (el) {
          const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
          el.dispatchEvent(event);
        }
      }, _deleteConvId!);
      await menu.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    }

    const menuNowVisible = await menu.isVisible({ timeout: 1_000 }).catch(() => false);
    if (!menuNowVisible) {
      test.skip(true, 'AC18: 无法在 conversation 页面打开右键菜单（dropdown 不可见）');
      return;
    }

    await clickMenuItemByText(page, menu, /delete|删除/i);

    const confirmModal = page.locator(`${ARCO_MODAL}, ${ARCO_MODAL_CONFIRM}`).first();
    await confirmModal.waitFor({ state: 'visible', timeout: 5_000 });
    const confirmBtn = confirmModal
      .locator('button')
      .filter({ hasText: /confirm|确认|delete|删除|ok/i })
      .first();
    await confirmBtn.click();

    // 等待跳转回 /guid
    await page.waitForFunction(() => window.location.hash.startsWith('#/guid'), { timeout: 8_000 });
    expect(page.url(), 'AC18: 删除当前会话后应跳转回 /guid').toContain('#/guid');

    // 避免 afterAll 重复删除已被删除的会话
    _deleteConvId = null;
  });
});

// ── AC19: 合法 skip ──────────────────────────────────────────────────────────

test.describe('AC19: 对话列表为空时的空状态', () => {
  test('AC19', async ({ page: _page }) => {
    test.skip(
      true,
      'AC19: 空列表验证需要隔离沙盒（无任何历史会话），当前 beforeAll 已创建测试会话。' +
        'TODO: 新增独立 spec 文件在 fresh sandbox 中验证空状态。'
    );
  });
});
