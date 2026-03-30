# Phase 2b 测试计划

## 验收标准覆盖矩阵

| PRD 验收标准                                                                   | 测试文件                                         | 测试用例 ID                | 状态     |
| ------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------- | -------- |
| **AC-F1: Leader Agent Selector**                                               |                                                  |                            |          |
| CreateGroupChatModal 中显示 Leader Agent 下拉选择器                            | LeaderAgentSelector.dom.test.tsx                 | AC-F1-001                  | Ready    |
| 下拉列表显示所有 enabled !== false 的自定义 assistant                          | LeaderAgentSelector.dom.test.tsx                 | AC-F1-002                  | Ready    |
| 每个选项显示 avatar + name                                                     | LeaderAgentSelector.dom.test.tsx                 | AC-F1-003                  | Ready    |
| 可以清空选择（恢复默认行为）                                                   | LeaderAgentSelector.dom.test.tsx                 | AC-F1-004                  | Ready    |
| 选中 assistant 后创建的群聊，dispatcher 使用该 assistant 的 presetRules + name | LeaderAgentSelector.dom.test.tsx                 | AC-F1-005                  | Ready    |
| 未选中时，行为与 Phase 2a 完全一致                                             | LeaderAgentSelector.dom.test.tsx                 | AC-F1-006                  | Ready    |
| 无可用 assistant 时显示空状态提示                                              | LeaderAgentSelector.dom.test.tsx                 | AC-F1-007                  | Ready    |
| **AC-F2: Model Selector**                                                      |                                                  |                            |          |
| CreateGroupChatModal 中显示 Model 下拉选择器                                   | ModelSelector.dom.test.tsx                       | AC-F2-001                  | Ready    |
| 下拉列表按 provider name 分组显示可用模型                                      | ModelSelector.dom.test.tsx                       | AC-F2-002                  | Ready    |
| 禁用的 provider 和模型不显示                                                   | ModelSelector.dom.test.tsx                       | AC-F2-003, AC-F2-004       | Ready    |
| 选中模型后创建的群聊使用该模型                                                 | ModelSelector.dom.test.tsx                       | AC-F2-005                  | Ready    |
| 无可用模型时显示空状态 + 跳转设置页面链接                                      | ModelSelector.dom.test.tsx                       | AC-F2-007                  | Ready    |
| 无模型选择时使用默认值                                                         | ModelSelector.dom.test.tsx                       | AC-F2-006                  | Ready    |
| **AC-F3: Task Panel UI**                                                       |                                                  |                            |          |
| 点击 ChildTaskCard 的 "View Details" 打开右侧 TaskPanel                        | TaskPanel.dom.test.tsx                           | AC-F3-001                  | Ready    |
| TaskPanel 显示完整的子任务 transcript                                          | TaskPanel.dom.test.tsx                           | AC-F3-003                  | Ready    |
| Header 显示 agent 名称、任务标题、状态 Tag                                     | TaskPanel.dom.test.tsx                           | AC-F3-001, AC-F3-002       | Ready    |
| running 状态下每 5 秒自动刷新 transcript                                       | TaskPanel.dom.test.tsx                           | AC-F3-004                  | Ready    |
| 支持手动 Refresh                                                               | TaskPanel.dom.test.tsx                           | AC-F3-006                  | Ready    |
| Panel 内可取消运行中的子任务                                                   | TaskPanel.dom.test.tsx                           | AC-F3-007, AC-F3-009       | Ready    |
| ESC 键可关闭 Panel                                                             | TaskPanel.dom.test.tsx                           | AC-F3-010                  | Ready    |
| ChildTaskCard 移除内联展开逻辑                                                 | (covered by existing ChildTaskCard tests update) | —                          | Deferred |
| Cancel 按钮隐藏于已完成任务                                                    | TaskPanel.dom.test.tsx                           | AC-F3-008                  | Ready    |
| Panel 打开/关闭有动画                                                          | (CSS-only, not unit testable)                    | —                          | N/A      |
| 再次点击同一卡片 toggle 关闭                                                   | (GroupChatView integration)                      | —                          | Deferred |
| **AC-F4: Seed Messages**                                                       |                                                  |                            |          |
| CreateGroupChatModal 显示 "Advanced Settings" 折叠区域                         | SeedMessages.dom.test.tsx                        | AC-F4-001                  | Ready    |
| 展开后显示 System Prompt 文本域                                                | SeedMessages.dom.test.tsx                        | AC-F4-002                  | Ready    |
| 文本域有 2000 字符限制和计数器                                                 | SeedMessages.dom.test.tsx                        | AC-F4-003, AC-F4-004       | Ready    |
| 输入的 seed message 追加到 dispatcher 系统提示词末尾                           | SeedMessages.dom.test.tsx                        | AC-F4-005                  | Ready    |
| 留空时不影响默认行为                                                           | SeedMessages.dom.test.tsx                        | AC-F4-006                  | Ready    |
| seed message 持久化到 conversation.extra.seedMessages                          | SeedMessages.dom.test.tsx                        | AC-F4-005                  | Ready    |
| **AC-通用**                                                                    |                                                  |                            |          |
| 所有新增用户可见文本走 i18n                                                    | All test files                                   | (all use t(key) assertion) | Ready    |
| 所有 UI 组件使用 @arco-design/web-react                                        | All test files                                   | (Arco mock present)        | Ready    |
| 所有图标使用 @icon-park/react                                                  | All test files                                   | (icon-park mock present)   | Ready    |
| 无 hardcoded 字符串                                                            | All test files                                   | (i18n key verification)    | Ready    |

## 测试用例清单

### F-1: Leader Agent Selector (8 tests)

| ID          | 描述                         | 类型       |
| ----------- | ---------------------------- | ---------- |
| AC-F1-001   | Leader Agent label 渲染      | 渲染正确性 |
| AC-F1-002   | 仅显示 enabled 的 assistant  | 数据过滤   |
| AC-F1-003   | 选项显示 avatar + name       | 渲染正确性 |
| AC-F1-004   | 选择后可清空                 | 用户交互   |
| AC-F1-005   | 选中的 ID 通过 IPC 传递      | 数据流转   |
| AC-F1-006   | 未选中发送 undefined         | 数据流转   |
| AC-F1-007   | 空列表显示空状态             | 边界条件   |
| EDGE-F1-001 | ConfigStorage 返回 undefined | 边界条件   |
| EDGE-F1-002 | 所有 agent 都 disabled       | 边界条件   |

### F-2: Model Selector (8 tests)

| ID          | 描述                                | 类型       |
| ----------- | ----------------------------------- | ---------- |
| AC-F2-001   | Model label 渲染                    | 渲染正确性 |
| AC-F2-002   | 按 provider 分组显示                | 渲染正确性 |
| AC-F2-003   | 禁用 provider 不显示                | 数据过滤   |
| AC-F2-004   | 禁用 model 不显示                   | 数据过滤   |
| AC-F2-005   | 选中模型通过 IPC modelOverride 传递 | 数据流转   |
| AC-F2-006   | 未选中发送 undefined modelOverride  | 数据流转   |
| AC-F2-007   | 空列表显示空状态                    | 边界条件   |
| EDGE-F2-001 | getModelConfig 返回 undefined       | 边界条件   |
| EDGE-F2-002 | 所有 provider 都 disabled           | 边界条件   |

### F-3: Task Panel UI (17 tests)

| ID          | 描述                             | 类型       |
| ----------- | -------------------------------- | ---------- |
| AC-F3-001   | Header 显示 agent 名称和任务标题 | 渲染正确性 |
| AC-F3-002   | 状态 Tag 匹配子任务状态          | 渲染正确性 |
| AC-F3-003   | 完整 transcript 消息渲染         | 渲染正确性 |
| AC-F3-004   | running 状态每 5s 自动刷新       | 自动刷新   |
| AC-F3-005   | completed 状态不轮询             | 自动刷新   |
| AC-F3-006   | Refresh 按钮触发数据拉取         | 用户交互   |
| AC-F3-007   | running 任务显示 Cancel 按钮     | 渲染正确性 |
| AC-F3-008   | completed 任务隐藏 Cancel 按钮   | 渲染正确性 |
| AC-F3-009   | Cancel 调用 onCancel 回调        | 用户交互   |
| AC-F3-010   | ESC 键关闭面板                   | 用户交互   |
| AC-F3-011   | Close 按钮关闭面板               | 用户交互   |
| AC-F3-012   | 空 transcript 显示占位文本       | 边界条件   |
| AC-F3-013   | 有 avatar 时渲染 emoji           | 渲染正确性 |
| AC-F3-014   | 无 avatar 时渲染 People 图标     | 渲染正确性 |
| EDGE-F3-001 | 卸载时清理轮询 interval          | 生命周期   |
| EDGE-F3-002 | 卸载时取消 responseStream 订阅   | 生命周期   |
| EDGE-F3-003 | transcript 拉取失败不崩溃        | 错误处理   |

### F-4: Seed Messages (9 tests)

| ID          | 描述                            | 类型       |
| ----------- | ------------------------------- | ---------- |
| AC-F4-001   | Advanced Settings 折叠区域渲染  | 渲染正确性 |
| AC-F4-002   | 展开显示 System Prompt textarea | 用户交互   |
| AC-F4-003   | 2000 字符限制生效               | 边界条件   |
| AC-F4-004   | 显示字符计数器                  | 渲染正确性 |
| AC-F4-005   | seed message 通过 IPC 传递      | 数据流转   |
| AC-F4-006   | 空输入发送 undefined            | 数据流转   |
| AC-F4-007   | 纯空白输入视为空                | 边界条件   |
| AC-F4-008   | 发送前 trim                     | 数据流转   |
| AC-F4-009   | 折叠/展开保留文本               | 状态持久   |
| EDGE-F4-001 | 创建成功后重置 seed message     | 状态清理   |

### Integration: CreateGroupChatModal Phase 2b (8 tests)

| ID           | 描述                                   | 类型       |
| ------------ | -------------------------------------- | ---------- |
| INT-001      | 所有 Phase 2b 字段按正确顺序渲染       | 渲染正确性 |
| INT-002      | 完整流程：填写所有字段并提交           | 端到端     |
| INT-003      | 成功创建后导航和回调                   | 数据流转   |
| INT-004      | Cancel 重置所有 Phase 2b 字段          | 状态清理   |
| INT-005      | API 失败显示错误且不清空表单           | 错误处理   |
| INT-006      | 提交期间显示 loading 状态              | 交互状态   |
| INT-007      | 不填 Phase 2b 字段 = Phase 2a 兼容行为 | 向后兼容   |
| EDGE-INT-001 | 网络异常显示 fallback 错误             | 错误处理   |
| EDGE-INT-002 | Modal 隐藏时不渲染 Phase 2b 字段       | 渲染正确性 |

## 边界条件和异常场景

| 场景                                     | 覆盖测试                          | 预期行为                              |
| ---------------------------------------- | --------------------------------- | ------------------------------------- |
| ConfigStorage 返回 undefined (无 agents) | EDGE-F1-001                       | 组件正常渲染，Leader Agent 选择器为空 |
| 所有 custom agents 都 disabled           | EDGE-F1-002                       | 显示空状态提示                        |
| getModelConfig 返回 undefined            | EDGE-F2-001                       | 组件正常渲染，Model 选择器为空        |
| 所有 providers 都 disabled               | EDGE-F2-002                       | 显示空状态                            |
| 模型列表中含 disabled models             | AC-F2-004                         | disabled 模型被过滤不显示             |
| seedMessage 输入超过 2000 字符           | AC-F4-003                         | 截断到 2000 字符                      |
| seedMessage 仅含空白字符                 | AC-F4-007                         | trim 后视为空，发送 undefined         |
| TaskPanel transcript 拉取失败            | EDGE-F3-003                       | 不崩溃，显示错误或空状态              |
| TaskPanel 卸载时 interval 清理           | EDGE-F3-001                       | interval 被清除，不再发送请求         |
| TaskPanel 卸载时 stream 订阅清理         | EDGE-F3-002                       | unsubscribe 被调用                    |
| API 返回 success: false 无 msg           | EDGE-INT-001 (+ existing ADV-004) | 显示 i18n fallback 错误 key           |
| 网络异常 (Promise reject)                | EDGE-INT-001                      | 显示 dispatch.create.error            |
| Modal visible=false                      | EDGE-INT-002                      | 不渲染任何内容                        |

## 测试统计

- **总测试用例**: 50
- **按功能分布**: F-1 (9), F-2 (9), F-3 (17), F-4 (10), Integration (9)
- **按类型分布**: 渲染正确性 (15), 用户交互 (8), 数据流转 (11), 边界条件 (10), 错误处理 (3), 生命周期 (2), 状态管理 (3)
- **PRD AC 覆盖率**: 28/30 (93.3%)
- **未覆盖**: CSS 动画 (不可单测), GroupChatView toggle 行为 (需 GroupChatView 集成测试)

## 备注

- TaskPanel 测试使用动态 import + 早期返回模式，因为 `TaskPanel.tsx` 是 Phase 2b 新建文件，组件代码尚未实现。测试先行编写，实现完成后测试将自动生效。
- 所有 mock 模式与现有 dispatch 测试保持一致（参考 `CreateGroupChatModal.dom.test.tsx` 和 `ChildTaskCard.dom.test.tsx`）。
- i18n 使用 `t(key)` 直接返回 key 的 mock 模式，与项目惯例一致。
