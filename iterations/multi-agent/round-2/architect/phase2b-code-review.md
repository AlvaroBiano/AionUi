# Phase 2b Code Review

## 总体评价

Phase 2b 的实现整体质量较高，与技术设计文档高度一致。四个功能（Leader Agent Selector、Model Selector、TaskPanel、Seed Messages）均已落地，数据流方向正确，Main 进程正确使用了 ProcessConfig 而非 ConfigStorage，Renderer 侧使用了 arco-design 组件库，i18n 6 语言 key 结构完整且一致。类型定义清晰，没有引入 `any`。主要问题集中在几处 `as` 类型断言、TaskPanel 动画实现未完成、以及一处潜在的 re-render 性能问题。总体而言接近可合并状态，修复 MUST-FIX 项后即可。

## MUST-FIX（必须修复才能合并）

1. **[useTaskPanelTranscript.ts:33] `as` 类型断言绕过类型检查** — `response.data.status as UseTaskPanelTranscriptResult['status']` 是 `string` 到联合类型的不安全断言。IPC 返回的 `status` 类型是 `string`（见 ipcBridge.ts L945），如果后端返回了意外值（如 `'unknown'`），这里会静默通过。修复建议：在 `types.ts` 中新增一个 `isValidChildStatus` type guard 函数，或在赋值前做 `includes` 校验并 fallback 到 `'pending'`。

2. **[useTaskPanelTranscript.ts:69] `msg.data as GroupChatMessageData` 不安全断言** — `IResponseMessage.data` 的类型是 `unknown`，直接 `as GroupChatMessageData` 跳过了运行时校验。如果其他类型的 `dispatch_event` 消息不含 `childTaskId` 字段，后续 `data.childTaskId !== childSessionId` 比较会静默通过（undefined !== string = true），不会出 bug，但代码意图不清晰。修复建议：至少加一个 `if (!data || typeof data !== 'object')` 的 guard，或使用 `satisfies` 做编译期辅助检查。

3. **[TaskPanel.module.css:7-16] panelEnter/panelExit 动画未生效** — `.panel` 默认已有 `transform: translateX(0)`，`.panelEnter` 也是 `transform: translateX(0)`，实际上滑入动画永远不会触发。`.panelExit` 虽然定义了 `translateX(100%)` 但组件中从未使用该 class（TaskPanel 要么 mounted 要么 unmounted，没有退出过渡）。技术设计明确要求"入口动画：CSS transform translateX(100%) -> translateX(0)"。修复建议：(a) 初始状态 `.panel` 设为 `transform: translateX(100%)`，通过 JS 在 mount 后下一帧添加 `.panelEnter` 触发动画（使用 `requestAnimationFrame` 或 `useEffect` + state）；或 (b) 使用 CSS `@keyframes slideIn` 动画；或 (c) 如果放弃动画则删除无效的 `.panelEnter`/`.panelExit` class 避免死代码。

4. **[dispatchBridge.ts:86-92] Leader agent 类型定义缺少完整的 AcpBackendConfig 字段** — `ProcessConfig.get('acp.customAgents')` 被断言为 `Array<{ id: string; name: string; avatar?: string; context?: string; enabled?: boolean }>`，但 `AcpBackendConfig` 还有 `prompts`、`promptsI18n` 等字段。虽然当前只使用了列出的字段，但这个内联类型断言与真实类型不同步，未来如果 `context` 字段改名为 `presetRules` 不会有编译器提醒。修复建议：导入 `AcpBackendConfig` 类型并使用 `as AcpBackendConfig[]`，或至少加注释标注这是 partial 类型投影。

## SHOULD-FIX（建议修复）

1. **[TaskPanel.tsx:52] auto-scroll 依赖项不精确** — `useEffect` 依赖 `[transcript.length]`，如果 transcript 长度不变但内容更新（例如最后一条消息的 content 被修改），不会触发滚动。建议改为依赖 `[transcript]` 或 `[transcript.length, transcript[transcript.length - 1]?.timestamp]`。

2. **[TaskPanel.tsx:55-63] ESC 键全局监听可能与 Modal 冲突** — TaskPanel 的 ESC 监听绑定在 `document` 上，如果用户在 TaskPanel 打开时触发了 Cancel 确认 Modal（L67），按 ESC 会同时关闭 Modal 和 TaskPanel。建议在 handleKeyDown 中检查 `document.querySelector('.arco-modal-wrapper')` 是否存在，或改用 `stopPropagation` 策略。

3. **[CreateGroupChatModal.tsx:35-38] ConfigStorage.get 缺少错误处理** — `ConfigStorage.get('acp.customAgents')` 的 Promise 没有 `.catch()` 处理。如果存储读取失败，Promise rejection 会被 `void` 忽略但不会给用户任何反馈。建议加 `.catch(() => setCustomAgents([]))` 或至少 `console.warn`。

4. **[CreateGroupChatModal.tsx:186-188] 健康状态颜色使用了 `rgb(var(...))` 而非语义 token** — `rgb(var(--success-6))` 和 `rgb(var(--danger-6))` 是正确的 Arco 变量用法，但 `var(--color-text-4)` 用于 unknown 状态的点颜色与其他两个风格不一致。这不是错误，但建议统一为 `rgb(var(--gray-6))` 或类似 token。

5. **[ChildTaskCard.tsx:67] `conversationId` prop 未使用** — `ChildTaskCardProps` 中定义了 `conversationId` 但组件函数签名中未解构使用它（只用于 cancel，而 cancel 通过 `onCancel` 回调已经在 GroupChatView 中绑定了 conversationId）。这是一个无用 prop，会导致困惑。建议从 `ChildTaskCardProps` 中移除或在函数签名中用 `_conversationId` 标注。

6. **[useChildTaskDetail.ts] 未被删除或标记 deprecated** — 技术设计 Section 5.4 明确说"移除 useChildTaskDetail hook 的使用"。ChildTaskCard 确实不再导入它，但 hook 文件本身仍然存在且 `TranscriptMessage` 类型定义与 `types.ts` 中的重复。建议至少在文件顶部加 `@deprecated` 注释，或直接删除（如果确认无其他引用）。

7. **[dispatchBridge.ts:56-59] modelOverride fallback 缺少日志** — 当 `params.modelOverride.providerId` 对应的 provider 找不到时，fallback 到只包含 `id + useModel` 的不完整 `TProviderWithModel`（缺少 apiKey、baseUrl 等）。这会导致后续 worker 初始化失败，但错误信息不明确。建议在 `!overrideProvider` 时 `mainWarn` 一条日志。

## NICE-TO-HAVE（可选优化）

1. **[TaskPanel.tsx:127] transcript 列表使用 index 作为 key** — `key={index}` 在 transcript 内容追加时不会导致错误渲染，但如果后续支持 offset 分页加载（prepend 历史消息），index key 会导致 React 重新创建所有 DOM 节点。建议使用 `msg.timestamp` 或 `msg.role + '-' + msg.timestamp` 作为 key。

2. **[GroupChatView.tsx:40-43] activeChildCount 可从 messages 推导** — `useMemo` 依赖 `info?.children`，而 `info` 来自另一个 hook 的异步请求。初次渲染时 `info` 为 undefined，activeChildCount 为 0，这是正确的。但如果要更实时地反映状态，可以考虑从 `messages` 中推导（通过最新的 task_started/task_completed 事件）。这是 Phase 3 的范畴。

3. **[dispatchPrompt.ts] 核心 prompt 可提取为常量** — 当前 `buildDispatchSystemPrompt` 每次调用都会构建完整字符串。虽然只在 bootstrap 时调用一次，但将核心 prompt 部分提取为模块级常量可以提高可读性。

4. **[dispatch 目录] 已有 9 个直接子项** — 等于限制 10 的边界。Phase 3 如果需要新增文件，需要提前拆分子目录（如技术设计 R-6 所述）。

## DESIGN_ISSUE 评审

**[DESIGN_ISSUE: AcpBackendConfig field name]**

技术设计中提到 Leader Agent 使用 `presetRules` 字段，但实际 `AcpBackendConfig` 接口中的字段名是 `context`（见 `acpTypes.ts:259`）。Developer 在 `dispatchBridge.ts:96` 中正确使用了 `leaderAgent.context` 来读取值，并将其存储为 `leaderPresetRules`（conversation.extra 中的快照字段名）。这个处理是正确的——快照字段名 `leaderPresetRules` 描述的是其语义用途（作为 preset rules 注入），而源字段名 `context` 是 AcpBackendConfig 的通用字段名。

但 Developer 没有在代码中留下明确的 `[DESIGN_ISSUE]` 注释标注这个差异。建议在 `dispatchBridge.ts:96` 旁加一行注释说明字段映射关系：

```typescript
// AcpBackendConfig uses 'context' field; stored as 'leaderPresetRules' in dispatch extra
leaderPresetRules = leaderAgent.context;
```

这样后续维护者不会困惑于设计文档说 `presetRules` 而代码读 `context`。

## 结论

**需要修改** — 修复 4 个 MUST-FIX 项后即可合并。SHOULD-FIX 项建议一并处理以提高代码质量。
