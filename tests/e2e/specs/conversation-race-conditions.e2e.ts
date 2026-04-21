/**
 * conversation-race-conditions.e2e.ts
 *
 * 架构风险驱动的 E2E 攻击测试
 *
 * 来源：ARCH-RISK-ANALYSIS（架构师代码审查）
 *
 *  R1 (P0) useWorkspaceEvents — 全局 IPC 流不过滤 conversation_id
 *           场景：同 workspace 多会话切换时 workspace 文件树稳定性
 *
 *  R2 (P1) useMessageLstCache — DB 加载无取消机制
 *           场景：快速 A→B→C→D 四连跳后消息列表不串台
 *
 *  R5 (P1) useAcpMessage/useGeminiMessage 状态重置时间窗口
 *           场景：切换后 running/stop 状态正确归零
 *
 *  R7 (P3) ConversationTabsContext — 快速关闭多 tab 时活跃 tab 正确
 *
 * 数据构造：
 *   - 4 个会话（conv_a/b/c/d），conv_a 注入 30 条消息，其余 0 条
 *   - beforeAll 通过 IPC 构建，afterAll 清理
 *   - 全部名称含 "(race-conditions)" 标识
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
  SENDBOX_STOP_BTN,
  WORKSPACE_RIGHT_PANEL,
  invokeBridge,
} from '../helpers';

// ── Selectors ──────────────────────────────────────────────────────────────────

const WORKSPACE_FILE_TREE = '.workspace-tree, .workspace-panel-tree, [class*="fileTree"], [class*="workspace-tree"]';
const WORKSPACE_LOADING = '[class*="workspace"][class*="loading"], .workspace-panel .arco-spin-loading';
// NOTE: R7 tab selectors intentionally omitted — ConversationTabs renders with
// UnoCSS utility classes only (no semantic class / data-testid), and is only
// present for workspace-mode sessions. R7 tests are explicitly skipped below
// until a workspace-session fixture is added that makes the tab bar renderable.

// ── Data construction ──────────────────────────────────────────────────────────

let _convA: string | null = null; // 30 messages
let _convB: string | null = null; // 0 messages
let _convC: string | null = null; // 0 messages
let _convD: string | null = null; // 0 messages

test.beforeAll(async ({ page }) => {
  await goToGuid(page);
  await waitForSettle(page);

  type TConv = { id: string; [k: string]: unknown };
  const base = {
    type: 'acp' as const,
    model: { id: 'builtin-claude', useModel: 'claude-3-5-haiku-20241022' },
    extra: { backend: 'claude', agentName: 'claude' },
  };

  const createConv = async (name: string): Promise<string | null> => {
    try {
      const c = await invokeBridge<TConv>(page, 'create-conversation', { ...base, name });
      return c?.id ?? null;
    } catch (e) {
      console.warn(`[race] beforeAll create "${name}" failed:`, e);
      return null;
    }
  };

  _convA = await createConv('E2E Race A — 30msg (race-conditions)');
  if (_convA) {
    try {
      await invokeBridge(page, 'conversation.inject-test-messages', {
        conversation_id: _convA,
        count: 30,
      });
    } catch (e) {
      console.warn('[race] inject-test-messages failed:', e);
    }
  }
  _convB = await createConv('E2E Race B — empty (race-conditions)');
  _convC = await createConv('E2E Race C — empty (race-conditions)');
  _convD = await createConv('E2E Race D — empty (race-conditions)');
});

test.afterAll(async ({ page }) => {
  const ids = [_convA, _convB, _convC, _convD].filter(Boolean) as string[];
  await Promise.allSettled(ids.map((id) => invokeBridge(page, 'remove-conversation', { id })));
  _convA = null;
  _convB = null;
  _convC = null;
  _convD = null;
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function navTo(page: import('@playwright/test').Page, id: string | null, settle = true): Promise<void> {
  if (!id) throw new Error('navTo: id is null — beforeAll may have failed');
  await page.evaluate((h) => window.location.assign(h), `#/conversation/${id}`);
  await page.waitForFunction(() => window.location.hash.includes('/conversation/'), { timeout: 8_000 });
  if (settle) await waitForSettle(page);
}

// ── R1: workspace 刷新不过滤 conversation_id ──────────────────────────────────
//
// 架构风险：useWorkspaceEvents 的 handleAcpResponse/handleGeminiResponse 订阅全局流，
// 无 conversation_id 过滤，任何 tool_call 都会 throttledRefresh()。
// 黑盒测试角度：切换会话后 workspace 面板不应持续闪烁/重置。

test.describe('R1: workspace 面板在会话切换后保持稳定 (useWorkspaceEvents)', () => {
  test('切换到无 workspace 会话后，workspace 面板不显示', async ({ page }) => {
    // 先去 conv_a（有消息），再切换到 conv_b（无消息），验证 workspace 面板状态
    await navTo(page, _convA);
    await page.waitForTimeout(500);

    // 切换到 conv_b
    await navTo(page, _convB);
    await page.waitForTimeout(800);

    // workspace loading spinner 不应卡住：等待 spinner 消失（给最多 6s）
    // 若 6s 后仍有 spinner，说明 workspace 刷新死循环——这是 R1 风险表现
    await page
      .waitForFunction(
        () => !document.querySelector('[class*="workspace"][class*="loading"], .workspace-panel .arco-spin-loading'),
        { timeout: 6_000 }
      )
      .catch(() => {
        // 超时说明 loading 卡住了
      });
    const stillLoading = await page
      .locator(WORKSPACE_LOADING)
      .first()
      .isVisible()
      .catch(() => false);
    expect(stillLoading, 'R1: workspace should not be stuck loading after conversation switch (>6s means loop)').toBe(
      false
    );

    // sendbox 和 header 应正常渲染
    await expect(page.locator(CHAT_LAYOUT_HEADER).first(), 'R1: header should render after switch').toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator(SENDBOX_PANEL).first(), 'R1: sendbox should render after switch').toBeVisible({
      timeout: 8_000,
    });
  });

  test('3 次连续会话切换后 workspace 区域不出现 JS 错误', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navTo(page, _convA);
    await page.waitForTimeout(300);
    await navTo(page, _convB);
    await page.waitForTimeout(200);
    await navTo(page, _convA);
    await page.waitForTimeout(300);
    await navTo(page, _convC);
    await page.waitForTimeout(500);

    // 没有 JS 错误
    const relevantErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection')
    );
    expect(relevantErrors, 'R1: no JS errors during rapid workspace switching').toHaveLength(0);

    // workspace 面板（如果存在）应稳定；如不存在则验证它确实不应出现（空会话）
    const wsPanel = page.locator(WORKSPACE_RIGHT_PANEL).first();
    const wsPanelPresent = await wsPanel.isVisible({ timeout: 1_000 }).catch(() => false);
    if (wsPanelPresent) {
      // 等待 1 秒后再检查，验证不是周期性重置（闪烁）
      await page.waitForTimeout(1_000);
      const wsStillVisible = await wsPanel.isVisible().catch(() => false);
      expect(wsStillVisible, 'R1: workspace panel should not disappear 1s after switch').toBe(true);
    } else {
      // conv_c 是空会话，workspace 面板不应出现——这是正确行为，不是 bug
      const wsPanelAttached = (await wsPanel.isAttached) ? (await wsPanel.count()) > 0 : false;
      // 只要没有 JS 错误（上面已验证），空会话无 workspace 面板是合理的
      expect(relevantErrors, 'R1: no JS errors even when workspace panel is absent').toHaveLength(0);
    }
  });
});

// ── R2: DB 加载无取消机制 — 消息列表不串台 ────────────────────────────────────
//
// 架构风险：快速切换 A→B→C→D 时，A 的 DB 查询可能在 D 已渲染后才返回
// 并通过 update() 写入，导致 D 的消息列表混入 A 的消息。

test.describe('R2: 快速多会话切换后消息列表不串台 (useMessageLstCache)', () => {
  test('A→B→C→D 四连跳后，D 显示 0 条消息（不残留 A 的 30 条）', async ({ page }) => {
    expect(_convA, 'convA must exist').toBeTruthy();
    expect(_convB, 'convB must exist').toBeTruthy();
    expect(_convC, 'convC must exist').toBeTruthy();
    expect(_convD, 'convD must exist').toBeTruthy();

    // 确认 A 有消息
    await navTo(page, _convA);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    const msgInA = await page.locator(MESSAGE_ITEM).count();
    expect(msgInA, 'R2: conv_a should have injected messages').toBeGreaterThan(0);

    // 快速连跳：不等待每次 settle（制造竞态）
    await page.evaluate((h) => window.location.assign(h), `#/conversation/${_convB}`);
    await page.waitForTimeout(100);
    await page.evaluate((h) => window.location.assign(h), `#/conversation/${_convC}`);
    await page.waitForTimeout(100);
    await page.evaluate((h) => window.location.assign(h), `#/conversation/${_convD}`);

    // 等待 D 稳定（把 convD ID 作为参数传入，避免浏览器端无法访问模块变量）
    const convDId = _convD;
    await page.waitForFunction((id) => window.location.hash.includes(`/conversation/${id}`), convDId, {
      timeout: 8_000,
    });
    await page.waitForTimeout(2_000); // 比 DB 查询慢的场景足够等待

    // D 是空会话，消息列表应为 0
    const msgInD = await page.locator(MESSAGE_ITEM).count();
    expect(msgInD, 'R2: conv_d (empty) should have 0 messages — no leak from conv_a DB query').toBe(0);
  });

  test('A→B 切换后，B 显示 0 条消息（conv_a 的流式 update 不写入 B）', async ({ page }) => {
    // 先去 A（有消息）
    await navTo(page, _convA);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);

    // 立即跳 B（不等待 A settle）
    await page.evaluate((h) => window.location.assign(h), `#/conversation/${_convB}`);
    await page.waitForFunction((id) => window.location.hash.includes(`/conversation/${id}`), _convB, {
      timeout: 8_000,
    });
    await waitForSettle(page);
    await page.waitForTimeout(1_000);

    const msgInB = await page.locator(MESSAGE_ITEM).count();
    expect(msgInB, 'R2: conv_b (empty) should have 0 messages after fast switch from conv_a').toBe(0);
  });

  test('来回切换 A↔B 5 次后，消息数量稳定（无累积/重复）', async ({ page }) => {
    // 先进入 conv_a 并等待完全稳定，再切一次来稳定 DB 状态后记录基准消息数
    await navTo(page, _convA);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    // 等待 3 秒让 DB 加载 + 合并完全稳定（DB 保存有 2s debounce）
    await page.waitForTimeout(3_000);
    // 做一次预热切换，让 DB 与内存状态完全对齐（排除首次加载时的流式消息残留）
    await navTo(page, _convB);
    await page.waitForTimeout(500);
    await navTo(page, _convA);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const baseCount = await page.locator(MESSAGE_ITEM).count();
    expect(baseCount, 'R2: conv_a must have messages on first visit').toBeGreaterThan(0);

    // 来回切换 4 次，每次回到 conv_a 后只等 150ms（竞态窗口：DB query 返回但 cancelled 未检查）
    // 验证标准：修复前（无 cancelled flag）→ FAIL (count 14→16)；修复后（有 cancelled flag）→ PASS
    // 此时间窗口已通过"修复前 FAIL / 修复后 PASS"双向验证（2026-04-17）
    for (let i = 0; i < 4; i++) {
      await navTo(page, _convB);
      await page.waitForTimeout(150);
      await navTo(page, _convA);
      await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(150);
      const count = await page.locator(MESSAGE_ITEM).count();
      expect(
        count,
        `R2: conv_a message count should be stable on round ${i + 1} (base=${baseCount}, now=${count}) — stale DB update() must not run after navigate-away`
      ).toBe(baseCount);
    }
  });
});

// ── R5: running/stop 状态切换后正确归零 ───────────────────────────────────────
//
// 架构风险：useAcpMessage 重置 running=false，但调用 conversation.get 之前有时间窗口。
// 黑盒测试：切换到空会话后，stop 按钮不应出现（因为新会话没有 running 状态）。

test.describe('R5: running 状态在会话切换后正确归零 (useAcpMessage)', () => {
  test('从有消息会话切换到空会话后，stop 按钮不存在', async ({ page }) => {
    await navTo(page, _convA);
    await page.waitForSelector(MESSAGE_ITEM, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);

    // 切换到空会话
    await navTo(page, _convB);
    await waitForSettle(page);
    await page.waitForTimeout(1_000); // 给 conversation.get hydration 足够时间

    // stop 按钮不应显示（B 没有 running 状态）
    const stopVisible = await page
      .locator(SENDBOX_STOP_BTN)
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    expect(stopVisible, 'R5: stop button should NOT be visible on idle empty conversation').toBe(false);
  });

  test('来回切换 3 次后，最终在空会话时 stop 按钮不出现', async ({ page }) => {
    // A → B → A → B → C
    for (const [id, shouldHaveStop] of [
      [_convA, false], // A: 没有 running（注入的是静态消息）
      [_convB, false], // B: 空会话
      [_convA, false],
      [_convB, false],
      [_convC, false], // C: 空会话
    ] as [string | null, boolean][]) {
      await navTo(page, id);
      await waitForSettle(page);
      await page.waitForTimeout(800);

      const stopVisible = await page
        .locator(SENDBOX_STOP_BTN)
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      expect(stopVisible, `R5: stop button state incorrect on conv "${id}"`).toBe(shouldHaveStop);
    }
  });

  test('快速切换后 sendbox 输入框可用（running 状态不卡住）', async ({ page }) => {
    // 快速连跳（把 ID 先存本地变量，避免 waitForFunction 闭包无法访问模块变量）
    const convCId = _convC;
    await navTo(page, _convA, false);
    await navTo(page, _convB, false);
    await navTo(page, _convC, false);
    await page.waitForFunction((id) => window.location.hash.includes(`/conversation/${id}`), convCId, {
      timeout: 8_000,
    });
    await waitForSettle(page);
    await page.waitForTimeout(1_000);

    // sendbox 应可用（textarea 不应被 disable）
    const textarea = page.locator(`${SENDBOX_PANEL} textarea, ${SENDBOX_PANEL} [contenteditable]`).first();
    await expect(textarea, 'R5: sendbox textarea should be visible after fast switch').toBeVisible({ timeout: 5_000 });
    const isDisabled = await textarea.isDisabled().catch(() => false);
    expect(isDisabled, 'R5: sendbox textarea should not be disabled after fast switch (running not stuck)').toBe(false);
  });
});

// ── R7: tab 快速关闭时活跃 tab 正确 ───────────────────────────────────────────
//
// 架构风险：ConversationTabsContext 的 closeTab 依赖 activeTabId 闭包，
// React batched update 可能导致关闭多个 tab 时切换到错误的 tab。
//
// 注意：tab 功能是可选的（并非所有模式都有 tab 栏），如果不存在则跳过。

// R7 tests require a workspace-mode session so that ConversationTabs renders.
// ConversationTabs uses UnoCSS utility classes only (no semantic class/testid),
// and the close button is an @icon-park/react <Close> icon — not Arco Tabs.
// Until a workspace fixture is added here, these tests are legitimately skipped.
// TODO: re-enable when workspace-panel.e2e.ts fixture strategy is shared here.
test.describe('R7: 快速关闭多 tab 后活跃 tab 正确 (ConversationTabsContext)', () => {
  test('快速关闭非活跃 tab 后当前 tab 不变', async ({ page: _page }) => {
    test.skip(
      true,
      'R7: ConversationTabs only renders in workspace-mode sessions. ' +
        'Selector discovery requires a workspace fixture. ' +
        'TODO: add workspace-session beforeAll and confirm tab DOM structure via CDP screenshot.'
    );
  });

  test('关闭当前 tab 后跳转到有效会话', async ({ page: _page }) => {
    test.skip(true, 'R7: same as above — needs workspace-mode session fixture.');
  });
});
