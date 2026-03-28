# Phase 3: Save Teammate as Assistant + Parent-Child Visualization

## 1. 目标

Phase 3 在 Phase 2a/2b 完成的 dispatch 多 agent 协作基础上，解决两个核心痛点：

1. **Teammate 复用性**：Orchestrator 在运行时自动创建的临时 teammate（`TemporaryTeammateConfig`）在会话结束后即消失，用户无法复用优秀的 teammate 配置。Phase 3 允许用户将临时 teammate 一键保存为持久化 assistant，实现跨会话复用。

2. **任务关系可见性**：当前 GroupChatTimeline 以平铺的时间线展示所有事件，当子任务数量增多时，用户难以快速理解 dispatcher 与子任务之间的层级关系和整体状态。Phase 3 增加轻量的父子关系可视化，提供全局视角。

### 成功指标

- 用户可以在 3 次点击内将任意临时 teammate 保存为可复用 assistant
- 用户可以在群聊界面一眼看到所有子任务的状态分布和层级关系

## 2. 范围

### In Scope

| 编号  | 功能                       | 类型 |
| ----- | -------------------------- | ---- |
| F-3.1 | Save Teammate as Assistant | 新增 |
| F-3.2 | Parent-Child Task Overview | 新增 |

### Out of Scope

- Single-chat upgrade to dispatch mode — 涉及 conversation type 迁移、agent 热切换，架构风险高，延后至 Phase 4
- Child agent 独立模型选择 — 需要 MCP tool schema 变更和 UI 联动，延后至 Phase 4
- TaskPanel 内用户直接向子 agent 发消息 — 需要重新设计消息路由，延后至 Phase 4
- Seed messages 创建后修改 — 需要 agent 热重启机制，延后至 Phase 4
- 完整的树形拓扑图（如 D3.js 力导向图）— Phase 3 仅做轻量概览面板，不做复杂可视化

---

## 3. 用户故事

### US-3.1: 保存临时 Teammate

> 作为用户，当 Orchestrator 创建了一个表现出色的临时 teammate（如 "Code Review Expert"）后，我希望能将其保存为持久化 assistant，以便在未来的群聊中直接选择它作为 leader agent 或手动引用其配置，而不需要每次都依赖 orchestrator 重新生成。

### US-3.2: 查看任务关系概览

> 作为用户，当群聊中有多个子任务并行运行时，我希望能在一个紧凑的视图中看到 dispatcher 与所有子任务的关系、各任务的当前状态和最近活动时间，以便快速判断整体进度，而不需要在长长的 timeline 中逐个寻找 ChildTaskCard。

---

## 4. 功能需求

### F-3.1: Save Teammate as Assistant

#### 4.1.1 概述

在 ChildTaskCard 和 TaskPanel 中新增 "Save as Assistant" 操作，允许用户将 orchestrator 创建的临时 teammate 配置保存到 `acp.customAgents` 持久化存储中，成为可在 CreateGroupChatModal 的 Leader Agent Selector 中选择的 assistant。

#### 4.1.2 触发入口

**入口 A — ChildTaskCard**:

- 在 ChildTaskCard 的操作区域（"View Details" 按钮旁）新增 "Save" 按钮
- 使用 `@icon-park/react` 的 `Save` 图标
- 仅在以下条件满足时显示：
  - 该子任务有关联的 teammate 配置（`message.avatar` 或 `message.displayName` 非默认值）
  - 该 teammate 尚未被保存（通过检查 `acp.customAgents` 中是否已有同名 assistant）

**入口 B — TaskPanel**:

- 在 TaskPanel 的 Header 区域（状态 Tag 旁）新增 "Save as Assistant" 按钮
- 使用 `Button` 组件，`type='text'`，`size='mini'`
- 同样需要判断 teammate 是否已保存

#### 4.1.3 保存弹窗（SaveTeammateModal）

点击 "Save" 后弹出确认弹窗：

```
┌─────────────────────────────────────┐
│ Save as Assistant                    │
│                                      │
│ Name                                 │
│ [Code Review Expert____] (预填)      │
│                                      │
│ Avatar                               │
│ [🔍] (预填，可编辑 emoji)            │
│                                      │
│ System Prompt                        │
│ [________________________]          │
│ [________________________] (预填)    │
│ [____________] 0/4000               │
│                                      │
│            [Cancel]  [Save]          │
└─────────────────────────────────────┘
```

- **Name**: 预填 teammate 的 `displayName`，可编辑
- **Avatar**: 预填 teammate 的 `avatar` emoji，可编辑（使用 Input，单个 emoji）
- **System Prompt**: 预填 teammate 的 `presetRules`，可编辑，`maxLength=4000`
- **Save 按钮**: 触发保存逻辑

#### 4.1.4 数据流

```
Renderer                          Main Process
   │                                   │
   │  (用户点击 Save)                   │
   │  → SaveTeammateModal 打开         │
   │  → 用户确认/编辑 → 点击 Save      │
   │                                   │
   │  dispatch.saveTeammate({          │
   │    name, avatar, presetRules      │
   │  })                               │
   │ ──────────────────────────────► │
   │                                   │ 1. 读取 acp.customAgents
   │                                   │ 2. 检查重名
   │                                   │ 3. 生成新 ID (uuid)
   │                                   │ 4. 构建 AcpBackendConfig
   │                                   │ 5. 追加并写回 acp.customAgents
   │                                   │
   │  ◄──────────────────────────────  │ { success: true, assistantId }
   │                                   │
   │  Message.success("Saved!")        │
```

#### 4.1.5 IPC 新增

在 `ipcBridge.ts` 的 `dispatch` 命名空间新增：

```typescript
saveTeammate: bridge.buildProvider<
  IBridgeResponse<{ assistantId: string }>,
  {
    name: string;
    avatar?: string;
    presetRules?: string;
  }
>('dispatch.save-teammate'),
```

#### 4.1.6 Main Process 处理（dispatchBridge.ts）

新增 `dispatch.save-teammate` provider handler：

1. 从 `ProcessConfig.get('acp.customAgents')` 读取现有 assistants
2. 检查是否有同名 assistant（`name` 相同）:
   - 如有，返回 `{ success: false, msg: 'Assistant with this name already exists' }`
3. 构建新的 `AcpBackendConfig` 对象:
   ```
   {
     id: uuid(),
     name: params.name,
     avatar: params.avatar,
     context: params.presetRules,  // AcpBackendConfig 使用 'context' 字段
     enabled: true,
     createdAt: Date.now(),
     source: 'dispatch_teammate',  // 标记来源便于后续筛选
   }
   ```
4. 追加到数组并写回 `ProcessConfig.set('acp.customAgents', updated)`
5. 返回 `{ success: true, data: { assistantId: newId } }`

#### 4.1.7 Teammate 配置数据来源

临时 teammate 的配置信息来自以下路径：

- **从 ChildTaskCard**: `message.displayName`、`message.avatar` 可直接获取。`presetRules` 需要从子任务的 conversation extra 中读取。
- **从 TaskPanel**: `childInfo.teammateName`、`childInfo.teammateAvatar` 可直接获取。`presetRules` 同样需要额外查询。

新增 IPC channel 获取完整 teammate 配置：

```typescript
getTeammateConfig: bridge.buildProvider<
  IBridgeResponse<{
    name: string;
    avatar?: string;
    presetRules?: string;
  }>,
  { childSessionId: string }
>('dispatch.get-teammate-config'),
```

在 `dispatchBridge.ts` 中：从 `conversationRepo.getConversation(childSessionId)` 读取 `extra.teammateConfig` 和 `extra.presetRules`。

#### 4.1.8 已保存状态标记

保存成功后，需要在 UI 上标记该 teammate 已保存：

- ChildTaskCard 的 "Save" 按钮变为 "Saved" 灰色文本 + `CheckOne` 图标
- TaskPanel 的 "Save as Assistant" 按钮同样变为已保存状态

判断逻辑：通过 `useIsSavedTeammate(teammateName)` hook 检查 `acp.customAgents` 中是否存在同名 assistant。

#### 4.1.9 组件清单

| 组件/文件                     | 类型 | 说明                                              |
| ----------------------------- | ---- | ------------------------------------------------- |
| `SaveTeammateModal.tsx`       | 新建 | 保存确认弹窗                                      |
| `hooks/useIsSavedTeammate.ts` | 新建 | 检查 teammate 是否已保存                          |
| `ChildTaskCard.tsx`           | 修改 | 新增 Save 按钮                                    |
| `TaskPanel.tsx`               | 修改 | 新增 Save as Assistant 按钮                       |
| `types.ts`                    | 修改 | 新增 `SaveTeammateModalProps` 等类型              |
| `dispatchBridge.ts`           | 修改 | 新增 save-teammate 和 get-teammate-config handler |
| `ipcBridge.ts`                | 修改 | 新增 IPC channel 定义                             |

---

### F-3.2: Parent-Child Task Overview

#### 4.2.1 概述

在 GroupChatView 中新增一个可折叠的 Task Overview 面板，以紧凑的列表形式展示 dispatcher 与所有子任务的关系和状态。该面板不替代现有 Timeline，而是提供补充性的全局视角。

#### 4.2.2 UI 布局

```
┌──────────────────────────────────────────────────────────────┐
│  GroupChatView                                               │
│  ┌─ Task Overview (可折叠) ──────────────────────────────┐  │
│  │  🤖 Dispatcher Name                        [▲ 折叠]   │  │
│  │  ├─ 🔍 Code Reviewer    ● running    12:03           │  │
│  │  ├─ 📝 Doc Writer       ✓ completed  12:01           │  │
│  │  └─ 🧪 Test Engineer    ◌ pending    12:05           │  │
│  │                                                        │  │
│  │  Total: 3 tasks  |  1 running  |  1 completed         │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────┬──────────────────────────┐│
│  │  Timeline (主区域)            │  Task Panel (条件显示)    ││
│  │  ...                          │  ...                      ││
```

#### 4.2.3 组件设计（TaskOverview）

**文件**: `src/renderer/pages/conversation/dispatch/TaskOverview.tsx`

**结构**:

- 顶部 Header：Dispatcher 名称 + 折叠/展开按钮
- 子任务列表：每行显示 avatar + name + 状态指示器 + 最近活动时间
- 底部摘要栏：总任务数 + 各状态计数

**状态指示器**:

- `pending`: `◌` 灰色空心圆
- `running`: `●` 蓝色实心圆 + 脉冲动画
- `completed`/`idle`: `✓` 绿色对勾
- `failed`: `✗` 红色叉
- `cancelled`: `⊘` 灰色禁止符

**交互**:

- 点击子任务行 → 打开对应的 TaskPanel（复用现有 `onViewDetail` 回调）
- 当前被选中的子任务行高亮显示（与 `selectedChildTaskId` 联动）
- 默认展开状态；用户可折叠以节省空间；折叠状态在会话内保持

#### 4.2.4 数据来源

直接复用 `useGroupChatInfo` hook 返回的 `info.children` 数组，无需新增 IPC channel。

```typescript
type TaskOverviewProps = {
  dispatcherName: string;
  dispatcherAvatar?: string;
  children: ChildTaskInfoVO[];
  selectedChildTaskId?: string | null;
  onSelectChild: (childTaskId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};
```

#### 4.2.5 GroupChatView 集成

在 GroupChatView 中，将 TaskOverview 放置在 Timeline 上方：

```tsx
<div className='flex-1 flex flex-col min-h-0 min-w-0'>
  {/* Task Overview (new) */}
  {info?.children && info.children.length > 0 && (
    <TaskOverview
      dispatcherName={dispatcherName}
      dispatcherAvatar={dispatcherAvatar}
      children={info.children}
      selectedChildTaskId={selectedChildTaskId}
      onSelectChild={handleViewDetail}
      collapsed={overviewCollapsed}
      onToggleCollapse={() => setOverviewCollapsed((prev) => !prev)}
    />
  )}
  {/* Existing: Banner + Timeline + SendBox */}
  ...
</div>
```

新增状态：`overviewCollapsed: boolean`（默认 `false`）。

#### 4.2.6 样式规格

- **容器**: `mx-16px mt-8px` 内边距，`rd-8px` 圆角，`border 1px solid var(--color-border)` 边框
- **高度**: 展开时 `max-height: 200px`，内容溢出则滚动；折叠时仅显示 Header 行（约 40px）
- **折叠动画**: CSS transition `max-height 200ms ease`
- **子任务行**: `py-6px px-12px`，hover 背景色 `var(--color-fill-2)`，选中背景色 `rgba(var(--primary-6), 0.08)`
- **脉冲动画**: running 状态的圆点使用 CSS `@keyframes pulse` 实现

**文件**: `TaskOverview.module.css`

#### 4.2.7 自动刷新

TaskOverview 的数据来自 `useGroupChatInfo`，该 hook 已有刷新机制（通过 `refreshInfo` 在 sendMessage 和 cancelChild 后调用）。此外：

- 当有 `running` 或 `pending` 状态的子任务时，TaskOverview 应每 10 秒自动刷新 `info.children`
- 通过在 `useGroupChatInfo` 中增加可选的 `autoRefreshInterval` 参数实现

#### 4.2.8 组件清单

| 组件/文件                   | 类型 | 说明                         |
| --------------------------- | ---- | ---------------------------- |
| `TaskOverview.tsx`          | 新建 | 父子任务概览面板             |
| `TaskOverview.module.css`   | 新建 | 概览面板样式                 |
| `GroupChatView.tsx`         | 修改 | 集成 TaskOverview            |
| `types.ts`                  | 修改 | 新增 `TaskOverviewProps`     |
| `hooks/useGroupChatInfo.ts` | 修改 | 增加可选的 auto-refresh 支持 |

---

## 5. 非功能需求

| 编号  | 要求     | 说明                                                                                                                    |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| NFR-1 | 性能     | TaskOverview 的自动刷新间隔不低于 10 秒，避免频繁 DB 查询                                                               |
| NFR-2 | 响应性   | Save Teammate 操作应在 500ms 内完成（本地 config 文件读写）                                                             |
| NFR-3 | 无障碍   | 所有新增按钮有 `aria-label`，折叠面板有 `aria-expanded`                                                                 |
| NFR-4 | i18n     | 所有用户可见文本走 i18n，覆盖 6 种语言                                                                                  |
| NFR-5 | 测试覆盖 | 新增组件覆盖率 >= 80%，包含 save 流程和 overview 渲染的 Vitest 测试                                                     |
| NFR-6 | 目录规范 | dispatch 目录当前有 9 个直接子项（含 hooks/），新增 2 个组件文件后达 11 个，需将 modals 提取为子目录 `dispatch/modals/` |

---

## 6. 验收标准

### AC-3.1: Save Teammate — 触发入口

- [ ] ChildTaskCard 在满足条件时显示 "Save" 图标按钮
- [ ] TaskPanel Header 在满足条件时显示 "Save as Assistant" 文本按钮
- [ ] teammate 已保存后，按钮变为 "Saved" 灰色禁用状态
- [ ] 默认 Agent（无自定义 teammate 配置的子任务）不显示 Save 按钮

### AC-3.2: Save Teammate — 保存弹窗

- [ ] 弹窗预填 teammate 的 name、avatar、presetRules
- [ ] 用户可编辑所有预填字段
- [ ] Name 为必填项，空值时 Save 按钮禁用
- [ ] presetRules 有 4000 字符限制和计数器
- [ ] Cancel 关闭弹窗不保存

### AC-3.3: Save Teammate — 保存逻辑

- [ ] 保存成功后 assistant 出现在 `acp.customAgents` 配置中
- [ ] 保存成功后 Message.success 提示
- [ ] 同名 assistant 已存在时，提示冲突错误
- [ ] 保存的 assistant 立即可在 CreateGroupChatModal 的 Leader Agent Selector 中选择
- [ ] 保存的 assistant 的 `source` 字段标记为 `'dispatch_teammate'`

### AC-3.4: Task Overview — 展示

- [ ] 当群聊有子任务时，Timeline 上方显示 TaskOverview 面板
- [ ] 无子任务时不显示 TaskOverview
- [ ] 面板显示 dispatcher 名称和所有子任务列表
- [ ] 每个子任务显示 avatar、name、状态指示器、最近活动时间
- [ ] 底部摘要栏显示正确的任务数和状态分布

### AC-3.5: Task Overview — 交互

- [ ] 点击子任务行打开对应的 TaskPanel
- [ ] 当前选中的子任务行有高亮背景
- [ ] 折叠按钮可折叠/展开面板
- [ ] 折叠/展开有平滑 CSS 动画
- [ ] 有 running/pending 子任务时每 10 秒自动刷新

### AC-3.6: 通用

- [ ] 所有新增用户可见文本走 i18n，6 种语言全覆盖
- [ ] 所有 UI 组件使用 `@arco-design/web-react`
- [ ] 所有图标使用 `@icon-park/react`
- [ ] TypeScript strict mode 无报错
- [ ] 新增功能有对应的 Vitest 测试文件，覆盖率 >= 80%
- [ ] dispatch 目录不超过 10 个直接子项

---

## 7. 技术约束

| 编号 | 约束                  | 说明                                                                                                                 |
| ---- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TC-1 | 三进程隔离            | Save teammate 的 config 读写必须在 main process 完成，renderer 通过 IPC bridge 调用                                  |
| TC-2 | ProcessConfig         | main process 内部必须使用 `ProcessConfig`（文件 I/O）而非 `ConfigStorage`（bridge invoke），避免 IPC 死锁            |
| TC-3 | 目录规范              | dispatch 目录直接子项不超过 10 个。当前 9 个（含 hooks/），Phase 3 新增文件需通过子目录组织（如 `dispatch/modals/`） |
| TC-4 | 组件库                | 仅使用 `@arco-design/web-react` 组件和 `@icon-park/react` 图标，不引入第三方可视化库                                 |
| TC-5 | CSS                   | 优先 UnoCSS utility classes；复杂样式使用 CSS Modules；颜色使用语义 token                                            |
| TC-6 | 现有 IPC 兼容         | 不修改现有 IPC channel 的参数/返回值签名，仅新增 channel                                                             |
| TC-7 | AcpBackendConfig 兼容 | 保存的 assistant 必须完全兼容 `AcpBackendConfig` schema，确保在 agent 管理界面和 leader selector 中正常显示          |

---

## 8. 风险评估

| #   | 风险                                                                      | 概率 | 影响 | 缓解方案                                                                                                                                |
| --- | ------------------------------------------------------------------------- | ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | `acp.customAgents` 配置并发写入导致数据丢失                               | 低   | 高   | Main process handler 中使用读-改-写原子操作；由于 Electron 单线程事件循环，IPC handler 天然串行化                                       |
| R-2 | 保存的 assistant 的 presetRules 与 dispatch system prompt 冲突            | 中   | 中   | 与 Phase 2b R-1 相同的缓解策略：核心 dispatch 指令优先级最高。在 save 弹窗中提示用户 "This prompt will be used as leader agent context" |
| R-3 | TaskOverview 自动刷新与 useGroupChatInfo 现有刷新逻辑冲突                 | 低   | 低   | 使用 `setInterval` 独立于现有的事件驱动刷新，通过 `useRef` 管理 timer 避免重复                                                          |
| R-4 | dispatch 目录超过 10 个直接子项                                           | 中   | 低   | 将 SaveTeammateModal 放入 `dispatch/modals/` 子目录；或将 TaskOverview 与 TaskPanel 合并为 `dispatch/panels/`                           |
| R-5 | teammate 的 presetRules 为空（orchestrator 未生成自定义 prompt 的子任务） | 中   | 低   | Save 弹窗中 System Prompt 字段标记为 optional，允许保存空 presetRules 的 assistant                                                      |

---

## Appendix A: i18n Key 清单

命名空间: `dispatch`

```
# F-3.1: Save Teammate
dispatch.teammate.save                → "Save"
dispatch.teammate.saveAsAssistant     → "Save as Assistant"
dispatch.teammate.saved               → "Saved"
dispatch.teammate.saveTitle           → "Save as Assistant"
dispatch.teammate.nameLabel           → "Name"
dispatch.teammate.namePlaceholder     → "Assistant name"
dispatch.teammate.nameRequired        → "Name is required"
dispatch.teammate.avatarLabel         → "Avatar"
dispatch.teammate.avatarPlaceholder   → "Enter an emoji"
dispatch.teammate.promptLabel         → "System Prompt"
dispatch.teammate.promptPlaceholder   → "System prompt for this assistant (optional)"
dispatch.teammate.saveConfirm         → "Save"
dispatch.teammate.saveSuccess         → "Assistant saved successfully"
dispatch.teammate.saveDuplicate       → "An assistant with this name already exists"
dispatch.teammate.saveError           → "Failed to save assistant"

# F-3.2: Task Overview
dispatch.overview.title               → "Task Overview"
dispatch.overview.collapse            → "Collapse"
dispatch.overview.expand              → "Expand"
dispatch.overview.total               → "{count} tasks"
dispatch.overview.running             → "{count} running"
dispatch.overview.completed           → "{count} completed"
dispatch.overview.failed              → "{count} failed"
dispatch.overview.pending             → "{count} pending"
dispatch.overview.lastActivity        → "Last activity {time}"
```

## Appendix B: 文件变更清单

### 新建文件

| 文件                                                                    | 说明                               |
| ----------------------------------------------------------------------- | ---------------------------------- |
| `src/renderer/pages/conversation/dispatch/modals/SaveTeammateModal.tsx` | 保存 teammate 确认弹窗             |
| `src/renderer/pages/conversation/dispatch/hooks/useIsSavedTeammate.ts`  | 检查 teammate 是否已保存的 hook    |
| `src/renderer/pages/conversation/dispatch/TaskOverview.tsx`             | 父子任务概览面板                   |
| `src/renderer/pages/conversation/dispatch/TaskOverview.module.css`      | 概览面板样式（折叠动画、脉冲动画） |

### 修改文件

| 文件                                                                 | 变更内容                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/renderer/pages/conversation/dispatch/ChildTaskCard.tsx`         | 新增 Save 图标按钮 + `onSave` 回调                                      |
| `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`             | 新增 Save as Assistant 按钮                                             |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`         | 集成 TaskOverview + SaveTeammateModal + overviewCollapsed 状态          |
| `src/renderer/pages/conversation/dispatch/types.ts`                  | 新增 `TaskOverviewProps`、`SaveTeammateModalProps` 等类型               |
| `src/renderer/pages/conversation/dispatch/hooks/useGroupChatInfo.ts` | 增加可选 auto-refresh interval                                          |
| `src/common/adapter/ipcBridge.ts`                                    | 新增 `dispatch.save-teammate` 和 `dispatch.get-teammate-config` channel |
| `src/process/bridge/dispatchBridge.ts`                               | 新增 save-teammate 和 get-teammate-config handler                       |
| i18n locale 文件 (6 languages)                                       | 新增上述 i18n key                                                       |

## Appendix C: 候选功能取舍说明

| 候选功能                        | 决策                   | 理由                                                                                                       |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Save teammate as assistant      | **In Scope**           | 实现简单（config CRUD）、用户价值高（复用性是多 agent 协作的核心体验）、风险低                             |
| Parent-child visualization      | **In Scope（轻量版）** | 使用原生列表+CSS 实现，不引入重型可视化库；数据复用现有 hook，无需新 IPC；低风险                           |
| Single-chat upgrade to dispatch | **Out of Scope**       | conversation type 迁移涉及路由切换、agent 热创建、消息格式兼容、DB schema 变更；风险高、依赖多，需单独评估 |
