# QA 技术决策记录

记录 QA sprint 中的关键技术选择和背后的原因，避免重复踩坑。

---

## D-001 · IPC 数据注入替代真实 AI 调用

**日期**：2026-04-17  
**决策**：E2E 测试中所有依赖 AI 返回特定消息类型（thinking、tool_call、plan 等）的测试，统一用 `invokeBridge('conversation.inject-test-messages', { withAiTypes: true })` 注入伪造消息，不依赖真实 AI 后端。

**原因**：

- 真实 AI 调用有网络延迟、不确定性、费用成本
- CI 沙盒环境无 API Key
- 注入数据让测试完全可控、可重复

**影响文件**：

- `src/common/adapter/ipcBridge.ts` — 参数类型扩展
- `src/process/bridge/conversationBridge.ts` — 注入 6 种 AI 消息类型
- `tests/e2e/specs/conversation-core.e2e.ts` — `_aiConversationId` 使用此数据

---

## D-002 · `tool_group` 消息不直接渲染，需用 `.message-item.tool_summary`

**日期**：2026-04-17  
**决策**：断言 tool call 消息时，selector 用 `.message-item.tool_summary`，而非 `.message-item.tool_group`。

**原因**：

- `MessageList.tsx` 将连续的 `tool_group` 消息合并为虚拟的 `tool_summary` 条目渲染
- 直接查找 `.message-item.tool_group` 永远找不到

**参考代码**：`src/renderer/pages/conversation/MessageList.tsx` lines 100, 415

---

## D-003 · 异步加载组件用 `waitForSelector(state:'attached')` 而非 `isVisible`

**日期**：2026-04-17  
**决策**：对有加载状态的组件（如 CronJobManager），用 `page.waitForSelector(selector, { state: 'attached', timeout })` + `expect(el).toBeAttached()`，不用 `isVisible({ timeout })`。

**原因**：

- `CronJobManager` 在 IPC 响应前返回 `null`，组件根本不在 DOM 里
- `isVisible` 会在 timeout 内一直等"可见"，但组件不存在时直接返回 false
- `state: 'attached'` 等待元素出现在 DOM，比 `isVisible` 更宽松但足够

---

## D-004 · Workspace 面板默认折叠，需 CustomEvent 展开

**日期**：2026-04-17  
**决策**：workspace-panel E2E 测试统一调用 `ensureWorkspacePanelExpanded()`，内部 dispatch `new CustomEvent('aionui-workspace-toggle')`。

**原因**：

- `useWorkspaceCollapse` hook 默认返回 `rightSiderCollapsed = true`
- 仅当 workspace 有文件时触发 `WORKSPACE_HAS_FILES_EVENT` 自动展开
- 测试中 workspace 可能为空（empty state 测试），不能依赖自动展开

**参考代码**：`src/renderer/hooks/useWorkspaceCollapse.ts`

---

## D-005 · Workspace 面板双会话策略

**日期**：2026-04-17  
**决策**：`workspace-panel.e2e.ts` 的 `beforeAll` 创建两个测试会话：

- `_testConversationId`：`extra.workspace = <tmpdir>`（有文件树）
- `_noWorkspaceConvId`：无 `extra.workspace`（空状态）

**原因**：

- 空状态测试（AC2）和文件树测试（AC4b、AC6）需要不同的前置条件
- 单会话无法同时覆盖两种状态

---

## D-006 · 刷新按钮是 `<span>` 不是 `<button>`

**日期**：2026-04-17  
**决策**：Workspace 刷新按钮 selector 用 `.workspace-toolbar-icon-btn`（`<span>`），不能用 `button.workspace-toolbar-icon-btn`。

**原因**：

- WorkspaceToolbar 使用 icon-park `<IconRefresh>` 包在 `<span>` 上，不是语义化 `<button>`
- Playwright 的 `locator('button.xxx')` 会找不到

---

## D-007 · 选择器优先级策略

**日期**：2026-04-17  
**优先级**（高→低）：

1. `data-testid`（最稳定，但组件不一定有）
2. 语义化 CSS class（如 `.message-item.thinking`、`.workspace-toolbar-icon-btn`）
3. 文字内容（如 `button:has-text("添加到聊天")`，适合 i18n 双语场景写 `,` 分隔）
4. Arco Design 内部 class（如 `.arco-modal`、`.arco-tree-node`）——能用但重构风险高
5. 标签+位置（如 `.arco-tabs-header-title`）——最后手段

---

## D-008 · E2E 构造第二个 Custom Agent 的可行路径

**日期**：2026-04-17  
**背景**：`guid-page.e2e.ts` 有 15 处 skip 依赖"第二个 agent"或"preset assistant"。沙盒只有 1 个 builtin agent，无 IPC channel 直接创建。

**已验证可行（dev-2 预研，2026-04-17）**：

ConfigStorage 不挂 window，但底层走 bridge 协议，可通过以下 IPC channels 操作：

- 读：`agent.config.storage.get`（参数：key string）
- 写：`agent.config.storage.set`（参数：`{ key, data: value }`）
- 刷新：`acp.refresh-custom-agents`（无参数）

**封装 helper（推荐加入 `tests/e2e/helpers/bridge.ts`）**：

```typescript
export async function setConfigStorage(page: Page, key: string, value: unknown): Promise<void> {
  await invokeBridge(page, 'agent.config.storage.set', { key, data: value });
}
```

**beforeAll 样板**：

```typescript
const AGENT_ID = `e2e-custom-${Date.now()}`;
test.beforeAll(async ({ page }) => {
  await goToGuid(page);
  await waitForSettle(page);
  const existing =
    (await invokeBridge<unknown[]>(page, 'agent.config.storage.get', 'acp.customAgents').catch(() => [])) ?? [];
  await setConfigStorage(page, 'acp.customAgents', [
    ...(existing as object[]),
    { id: AGENT_ID, name: 'E2E Test Agent', enabled: true, backend: 'custom' },
  ]);
  await invokeBridge(page, 'acp.refresh-custom-agents');
  await page.reload(); // SWR 需要 reload 才能感知变更
  await waitForSettle(page);
});
test.afterAll(async ({ page }) => {
  const agents = ((await invokeBridge<unknown[]>(page, 'agent.config.storage.get', 'acp.customAgents').catch(
    () => []
  )) ?? []) as Array<{ id: string }>;
  await setConfigStorage(
    page,
    'acp.customAgents',
    agents.filter((a) => a.id !== AGENT_ID)
  );
  await invokeBridge(page, 'acp.refresh-custom-agents');
});
```

**AcpBackendConfig 最小字段**：`{ id: string, name: string, enabled: true, backend: 'custom' }`

**Preset Assistant**：静态硬编码（`ASSISTANT_PRESETS`），E2E 直接用已有内置 preset，无需构造。

**风险**：`agent.config.storage.*` channel 名基于 @office-ai/platform 内部规则，升级可能 break。

---

## D-009 · R2 测试 baseCount 采集稳定性 — 预热切换策略

**日期**：2026-04-17  
**问题**：`conversation-race-conditions.e2e.ts` R2 测试中，首次进入 conv_a 记录的 `baseCount` 可能包含尚未持久化的流式内存消息（DB 有 ~2s debounce），导致切换回来后 DB 重载值（较小）被误判为"消息减少"。

**修复**（dev-2，commit 0d249e6bd）：记录 `baseCount` 前加一次预热切换 A→B→A，等 DB debounce 完成后再采集稳定基准值。

**原则**：E2E 测试采集"基准值"时，必须确保数据已持久化到 DB，不能依赖内存中的临时状态。凡涉及消息数量对比的测试，均需 `waitForSettle()` 或预热切换。

---

## D-010 · 对话行右键菜单代替 hover+3-dot

**日期**：2026-04-17  
**决策**：Module 3 E2E 中触发对话行操作菜单，统一用 `page.click('#c-{conversationId}', { button: 'right' })`，不依赖 hover 后 3-dot 按钮显现。

**原因**：

- 3-dot 按钮是纯 UnoCSS utility class 拼接的 `<span>`（`hidden group-hover:flex`），无 `data-testid` 也无语义 class
- Playwright hover 后 CSS `group-hover:flex` transition 不稳定，有时未触发
- ConversationRow 每行有稳定 `id="c-{conversation.id}"`，右键点击直接弹出相同的 Arco dropdown，无需依赖 CSS 状态

**参考代码**：`src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx` — `onContextMenu` 和 `id={`c-${conversation.id}`}`

---

## D-011 · ⚠️ 置顶功能：需求与实现不一致（已修正）

**日期**：2026-04-17（修正：2026-04-17 深夜）  
**原决策（已废弃）**：测试置顶用 `conversation.extra.pinned`，忽略 `dm-pinned-agent-keys`。  
**修正后**：需求 AC10a 明确要求置顶后对话出现在 `PinnedSiderSection`，状态持久化到 `localStorage` key `dm-pinned-agent-keys`。这是 **Agent 级别置顶**，不是会话级别置顶。

**两套置顶系统对比**：

|            | 需求设计（Agent 置顶）                 | 代码实现（会话置顶）                            |
| ---------- | -------------------------------------- | ----------------------------------------------- |
| **组件**   | `PinnedSiderSection`                   | `WorkspaceGroupedHistory` 内部 pinned section   |
| **存储**   | `dm-pinned-agent-keys`（localStorage） | `conversation.extra.pinned`（DB）               |
| **粒度**   | 整个 Agent（群聊/单聊 agent）          | 单条对话                                        |
| **渲染行** | `SiderRow`（agent 联系人行，正确头像） | `ConversationRow`（对话行，用户表示不符合设计） |

**发现问题**：

- 当前代码中三点菜单的「置顶」调用 `useConversationActions.handleTogglePin`，写入 `conversation.extra.pinned = true`
- 这触发的是会话级置顶（WorkspaceGroupedHistory），不是需求要求的 Agent 级置顶（PinnedSiderSection）
- 用户明确表示：「我们顶置的是群聊和单聊 agent，而不是会话」
- **可能是一个 bug**：三点菜单「置顶」的行为与需求 AC10a 描述不符

**E2E 测试方案**：AC10/AC10a/AC10b 已改为测试 Agent 级置顶——通过 `AgentContactRow` 三点菜单执行置顶，验证 `PinnedSiderSection` 渲染 + `dm-pinned-agent-keys` localStorage 持久化。`afterAll` 需同时清理 `dm-pinned-agent-keys`。

---

## D-012 · 测试数据必须清理 + agentKey 必须正确

**日期**：2026-04-17  
**决策**：E2E 测试操作真实数据库，所有 `beforeAll` 创建的测试数据必须在 `afterAll` 彻底清理。创建会话时必须传入 `ACP_BACKENDS_ALL` 中已存在的 `agentKey`。

**原因（血泪教训）**：

- qa-blackbox agent 创建了 agentKey 为空或自定义值的测试会话，`buildAgentGroupedHistory` 无法匹配 agent 元数据，侧边栏出现头像破损、分组名异常的幽灵行
- agent 还通过 `update-conversation` 将测试会话设为 `extra.pinned = true`，直接改变了用户侧边栏的置顶区域布局
- 测试结束后未清理，残留数据持续污染用户的真实应用 UI

**规则**：

1. `create-conversation` 时 `agentKey` 必须是 `'claude'`、`'gemini'` 等已知值
2. 测试 pin 功能后必须 unpin + remove
3. `afterAll` 清理顺序：unpin → remove-conversation
4. 侧边栏 4 种对话行组件不可混淆（详见 team.json sidebar_dom_rule）

---

## D-013 · 侧边栏 4 种对话行组件及其区别

**日期**：2026-04-17  
**决策**：写 Module 3 E2E 前必须明确区分侧边栏中 4 种不同的对话行组件。

| 组件                   | 位置                                | 菜单操作                                     | DOM 特征                                                       |
| ---------------------- | ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| **ConversationRow**    | 置顶会话区域（`extra.pinned=true`） | 置顶/重命名/导出/删除（完整 Arco Dropdown）  | `id="c-{conversationId}"`, class `conversation-item`           |
| **AgentContactRow**    | 私信区域（每个 agent 一行）         | 置顶 agent / 移除 agent（简化菜单）          | SiderRow level=2, class `pl-48px`                              |
| **ChatHistory**        | 聊天页面顶栏历史面板下拉            | hover 编辑图标（inline）+ 删除（Popconfirm） | `[data-history-dropdown="true"]` 内, `id="c-{conversationId}"` |
| **PinnedSiderSection** | 侧边栏最顶部的「置顶」区域          | 仅「取消置顶」                               | SiderRow level=2, `dm-pinned-agent-keys` localStorage          |

**原因**：qa-blackbox 曾混淆 ConversationRow 和 AgentContactRow，错误地以为 pin 会话后能在 AgentContactRow 区域找到带 rename/delete 菜单的行。实际上 ConversationRow 只出现在置顶会话区域。

---

## D-014 · 视觉回归测试必须在 fixture 层固定 viewport

**日期**：2026-04-20  
**决策**：所有 E2E 视觉回归截图测试必须使用固定 viewport 尺寸，在 `tests/e2e/fixtures.ts` 的 page fixture 中统一设置 `page.setViewportSize({ width: 1176, height: 685 })`，而不是由每个测试单独处理。

**原因**：

- Electron 窗口在不同启动之间高度会有 ~6px 波动（macOS 窗口装饰差异）
- Playwright `toHaveScreenshot` 在截图尺寸不同时直接判定失败，`maxDiffPixels` / `maxDiffPixelRatio` 无法容忍尺寸差异
- 未固定 viewport 导致快照更新后下次运行又失败，反复循环 6 轮才定位根因

**规则**：

1. fixture 层统一固定 viewport → 所有截图基线尺寸一致
2. 新增视觉测试时无需单独加 `setViewportSize`
3. 截图尺寸不匹配时，首先检查 viewport 是否被正确固定
