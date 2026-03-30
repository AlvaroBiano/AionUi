# Phase 4 Technical Design

## 1. Architecture Overview

Phase 4 adds three features to the dispatch multi-agent system:

1. **F-4.1 TaskPanel User-to-Child Messaging** -- Direct user-to-child-agent communication via the existing `conversation.sendMessage` IPC channel, plus a new `dispatch.notify-parent` channel for dispatcher awareness.
2. **F-4.2 Child Agent Model Selection** -- Extends the `start_task` MCP tool schema with an optional `model` parameter, resolved against `ProcessConfig('model.config')` in `DispatchAgentManager`.
3. **F-4.3 Group Chat Settings Panel** -- A new `GroupChatSettingsDrawer` component (Arco `Drawer`) accessible from `GroupChatView` header, backed by a new `dispatch.update-group-chat-settings` IPC channel.

All changes follow the 3-process architecture: UI state in renderer, config persistence in main via IPC bridge, worker agents untouched.

```
                                  ┌──────────────┐
                                  │   Renderer    │
                                  │              │
                                  │ GroupChatView │
                                  │  TaskPanel    │─── conversation.sendMessage ──┐
                                  │  SettingsDrawer│── dispatch.update-settings ──┤
                                  └──────────────┘                               │
                                                                                 ▼
┌────────────┐              ┌──────────────────────────────────────────────────────┐
│   Worker   │◄── fork ─── │                  Main Process                        │
│  (gemini)  │              │  dispatchBridge.ts                                  │
│            │              │    ├─ dispatch.notify-parent (NEW)                  │
│  child     │              │    ├─ dispatch.update-group-chat-settings (NEW)     │
│  agents    │              │  DispatchAgentManager.ts                            │
│            │              │    ├─ startChildSession (model override, NEW)       │
│            │              │    └─ buildDispatchSystemPrompt (model list, NEW)   │
└────────────┘              └──────────────────────────────────────────────────────┘
```

---

## 2. F-4.1: TaskPanel User-to-Child Messaging

### 2.1 Message Flow

```
User types in TaskPanel SendBox
  │
  ├─1─► conversation.sendMessage({ input, msg_id, conversation_id: childTaskId })
  │     (existing IPC -- child agent receives message directly)
  │
  ├─2─► dispatch.notifyParent({ parentConversationId, childSessionId, childName, userMessage })
  │     (NEW IPC -- inserts system notification in parent timeline)
  │
  └─3─► useTaskPanelTranscript.refresh() (immediate re-fetch)
```

**Key insight**: Child tasks are independent conversations (`type: 'gemini'`, `extra.dispatchSessionType: 'dispatch_child'`). The existing `conversation.sendMessage` channel already routes to the correct worker task via `WorkerTaskManager.getOrBuildTask(childTaskId)`. No new message routing is needed.

**Idle child handling**: When a child is in `idle` status, `WorkerTaskManager.getOrBuildTask` will lazily re-fork the worker. The `useTaskPanelTranscript` hook's 5-second polling will pick up the response. If the worker fork fails, the IPC returns an error and the UI shows `Message.error`.

### 2.2 IPC Channels

**New channel: `dispatch.notify-parent`**

```typescript
// ipcBridge.ts - dispatch namespace
notifyParent: bridge.buildProvider<
  IBridgeResponse<void>,
  {
    parentConversationId: string;
    childSessionId: string;
    childName: string;
    userMessage: string;
  }
>('dispatch.notify-parent'),
```

**dispatchBridge.ts handler**:

```typescript
ipcBridge.dispatch.notifyParent.provider(async (params) => {
  // 1. Build system notification GroupChatMessage
  const notification: GroupChatMessage = {
    sourceSessionId: params.childSessionId,
    sourceRole: 'user',
    displayName: 'System',
    content:
      t('dispatch.taskPanel.userDirectMessage', { name: params.childName }) +
      ': "' +
      params.userMessage.slice(0, 200) +
      '"',
    messageType: 'system',
    timestamp: Date.now(),
    childTaskId: params.childSessionId,
  };

  // 2. Persist to parent conversation's message DB
  const msgId = uuid();
  const dbMessage: TMessage = {
    id: msgId,
    type: 'dispatch_event',
    position: 'left',
    conversation_id: params.parentConversationId,
    content: notification,
    createdAt: Date.now(),
  };
  addMessage(params.parentConversationId, dbMessage);

  // 3. Emit to renderer via responseStream
  ipcBridge.geminiConversation.responseStream.emit({
    type: 'dispatch_event',
    conversation_id: params.parentConversationId,
    msg_id: msgId,
    data: notification,
  });

  return { success: true };
});
```

### 2.3 UI Changes

**TaskPanel.tsx** -- Insert a lightweight SendBox between transcript area and actions bar:

```tsx
{
  /* SendBox -- between transcript and actions */
}
{
  canSend && (
    <div className='px-16px py-8px border-t border-t-solid' style={{ borderColor: 'var(--color-border)' }}>
      <Input.TextArea
        placeholder={t('dispatch.taskPanel.sendPlaceholder', { name: childInfo.teammateName || childInfo.title })}
        value={sendValue}
        onChange={setSendValue}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            handleSendToChild();
          }
        }}
        disabled={sendingToChild}
        autoSize={{ minRows: 1, maxRows: 4 }}
        aria-label={t('dispatch.taskPanel.sendPlaceholder', { name: childInfo.teammateName || childInfo.title })}
      />
      <div className='flex justify-end mt-4px'>
        <Button
          type='primary'
          size='small'
          onClick={handleSendToChild}
          loading={sendingToChild}
          disabled={!sendValue.trim()}
        >
          {t('dispatch.taskPanel.sendToChild')}
        </Button>
      </div>
    </div>
  );
}
```

**`canSend` logic**: `childInfo.status === 'running' || childInfo.status === 'idle'`

**`handleSendToChild` implementation** (inside TaskPanel):

```typescript
const handleSendToChild = useCallback(async () => {
  if (!sendValue.trim()) return;
  setSendingToChild(true);
  try {
    await ipcBridge.conversation.sendMessage.invoke({
      input: sendValue,
      msg_id: uuid(),
      conversation_id: childTaskId,
    });
    // Notify parent dispatcher
    await ipcBridge.dispatch.notifyParent.invoke({
      parentConversationId: conversationId,
      childSessionId: childTaskId,
      childName: childInfo.teammateName || childInfo.title,
      userMessage: sendValue,
    });
    setSendValue('');
    refresh(); // immediate transcript refresh
  } catch (err) {
    Message.error(t('dispatch.taskPanel.sendFailed'));
  } finally {
    setSendingToChild(false);
  }
}, [sendValue, childTaskId, conversationId, childInfo, refresh, t]);
```

**TaskPanelProps** -- No change needed. The `conversationId` (parent) is already passed. The `childTaskId` is already available.

### 2.4 Transcript Display of User Messages

The existing `useTaskPanelTranscript` hook fetches messages from `dispatch.getChildTranscript`, which returns `{ role: 'user' | 'assistant', content, timestamp }`. User-sent messages are stored with `position: 'right'` and mapped to `role: 'user'`. No change needed to transcript rendering -- user messages already appear as `[user]`.

---

## 3. F-4.2: Child Agent Model Selection

### 3.1 Tool Schema Extension

**DispatchMcpServer.ts** -- Add `model` property to `start_task` tool schema:

```typescript
// In getToolSchemas() -> start_task -> inputSchema.properties
model: {
  type: 'object',
  description: 'Optional model override for this child agent. Omit to use the default dispatcher model.',
  properties: {
    provider_id: {
      type: 'string',
      description: 'Provider ID from the configured model list',
    },
    model_name: {
      type: 'string',
      description: 'Model name (e.g., "gemini-2.5-pro", "gemini-2.0-flash")',
    },
  },
  required: ['provider_id', 'model_name'],
},
```

**DispatchMcpServer.ts** -- Parse model in `handleToolCall('start_task')`:

```typescript
// After parsing teammate config
if (args.model && typeof args.model === 'object') {
  const m = args.model as Record<string, unknown>;
  params.model = {
    providerId: String(m.provider_id ?? ''),
    modelName: String(m.model_name ?? ''),
  };
}
```

### 3.2 dispatchTypes.ts Extension

```typescript
export type StartChildTaskParams = {
  prompt: string;
  title: string;
  teammate?: TemporaryTeammateConfig;
  /** Phase 4: Optional model override for child agent */
  model?: {
    providerId: string;
    modelName: string;
  };
};
```

### 3.3 Model Resolution in DispatchAgentManager

In `startChildSession()`, after teammate parsing:

```typescript
// Phase 4: Resolve model override
let childModel = this.model; // default: inherit dispatcher model
if (params.model) {
  const providers = ((await ProcessConfig.get('model.config')) || []) as IProvider[];
  const provider = providers.find((p) => p.id === params.model!.providerId);
  if (provider && provider.model.includes(params.model.modelName)) {
    childModel = { ...provider, useModel: params.model.modelName };
    mainLog('[DispatchAgentManager]', `Model override: ${params.model.providerId}::${params.model.modelName}`);
  } else {
    mainWarn(
      '[DispatchAgentManager]',
      `Model override not found: ${params.model.providerId}::${params.model.modelName}, fallback to default`
    );
  }
}
```

Use `childModel` instead of `this.model` when creating the child conversation:

```typescript
const childConversation: TChatConversation = {
  // ...existing fields
  model: childModel,
  extra: {
    // ...existing fields
    /** Phase 4: Record actual model used (for UI display) */
    childModelName: childModel !== this.model ? childModel.useModel : undefined,
  },
};
```

### 3.4 Prompt Injection -- Available Models

In `createBootstrap()`, before calling `buildDispatchSystemPrompt`:

```typescript
// Phase 4: Build available model list for orchestrator prompt
let availableModels: Array<{ providerId: string; models: string[] }> = [];
try {
  const providers = ((await ProcessConfig.get('model.config')) || []) as IProvider[];
  availableModels = providers
    .filter((p) => p.enabled !== false)
    .map((p) => ({
      providerId: p.id,
      models: p.model.filter((m) => p.modelEnabled?.[m] !== false),
    }))
    .filter((p) => p.models.length > 0);
} catch (err) {
  mainWarn('[DispatchAgentManager]', 'Failed to read model config for prompt', err);
}
```

**dispatchPrompt.ts** -- Extend `buildDispatchSystemPrompt`:

```typescript
export function buildDispatchSystemPrompt(
  dispatcherName: string,
  options?: {
    leaderProfile?: string;
    customInstructions?: string;
    availableModels?: Array<{ providerId: string; models: string[] }>;
  }
): string {
  // ...existing prompt...

  if (options?.availableModels && options.availableModels.length > 0) {
    prompt += `
## Available Models for Child Tasks
You can specify an optional "model" parameter in start_task to override the default model.
${options.availableModels.map((p) => `- provider_id: "${p.providerId}", models: [${p.models.map((m) => `"${m}"`).join(', ')}]`).join('\n')}

Guidelines:
- Use stronger/reasoning models for complex analysis, code review, or architecture tasks.
- Use faster/cheaper models for simple translation, formatting, or summarization tasks.
- Omit the model parameter to use the default model (recommended for most tasks).
`;
  }

  return prompt;
}
```

### 3.5 Model Validation

Validation strategy: **graceful fallback**. If `providerId` not found, or `modelName` not in provider's model list, log a warning and use the dispatcher's default model. This ensures child task creation never fails due to model resolution.

### 3.6 UI: Model Label in TaskOverview

**ChildTaskInfoVO** extension:

```typescript
export type ChildTaskInfoVO = {
  // ...existing fields
  /** Model used by this child agent (if different from dispatcher) */
  modelName?: string;
};
```

**dispatchBridge.ts** -- In `getGroupChatInfo` handler, when mapping children:

```typescript
.map((conv: TChatConversation) => {
  const childExtra = conv.extra as {
    dispatchTitle?: string;
    teammateConfig?: { name: string; avatar?: string };
    childModelName?: string; // Phase 4
  };
  return {
    sessionId: conv.id,
    title: childExtra.dispatchTitle || conv.name,
    status: conv.status || 'unknown',
    teammateName: childExtra.teammateConfig?.name,
    teammateAvatar: childExtra.teammateConfig?.avatar,
    createdAt: conv.createTime,
    lastActivityAt: conv.modifyTime,
    modelName: childExtra.childModelName, // Phase 4
  };
})
```

**TaskOverview.tsx** -- Add model tag after status dot:

```tsx
{
  child.modelName && (
    <Tag size='small' color='gray' className='flex-shrink-0 ml-4px text-11px'>
      {child.modelName}
    </Tag>
  );
}
```

---

## 4. F-4.3: Group Chat Settings Panel

### 4.1 Drawer Component

New file: `src/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer.tsx`

**Props type** (add to `types.ts`):

```typescript
export type GroupChatSettingsDrawerProps = {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  /** Current settings pre-filled from conversation extra */
  currentSettings: {
    groupChatName?: string;
    leaderAgentId?: string;
    seedMessages?: string;
  };
  /** Callback after successful save */
  onSaved: () => void;
};
```

**Component structure**:

```tsx
const GroupChatSettingsDrawer: React.FC<GroupChatSettingsDrawerProps> = ({
  visible,
  onClose,
  conversationId,
  currentSettings,
  onSaved,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(currentSettings.groupChatName || '');
  const [leaderAgentId, setLeaderAgentId] = useState(currentSettings.leaderAgentId || '');
  const [seedMessages, setSeedMessages] = useState(currentSettings.seedMessages || '');
  const [saving, setSaving] = useState(false);

  // Fetch available agents for leader selection (same as CreateGroupChatModal)
  const [agents, setAgents] = useState<Array<{ id: string; name: string; avatar?: string }>>([]);
  useEffect(() => {
    if (visible) {
      ipcBridge.acpConversation.getAvailableAgents.invoke().then((res) => {
        if (res.success && res.data) {
          const customAgents = res.data
            .filter((a) => a.customAgentId && a.isPreset)
            .map((a) => ({ id: a.customAgentId!, name: a.name, avatar: a.avatar }));
          setAgents(customAgents);
        }
      });
    }
  }, [visible]);

  // Reset form when drawer opens
  useEffect(() => {
    if (visible) {
      setName(currentSettings.groupChatName || '');
      setLeaderAgentId(currentSettings.leaderAgentId || '');
      setSeedMessages(currentSettings.seedMessages || '');
    }
  }, [visible, currentSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await ipcBridge.dispatch.updateGroupChatSettings.invoke({
        conversationId,
        groupChatName: name || undefined,
        leaderAgentId: leaderAgentId || undefined,
        seedMessages: seedMessages || undefined,
      });
      if (result.success) {
        Message.success(t('dispatch.settings.saveSuccess'));
        onSaved();
        onClose();
      } else {
        Message.error(result.msg || t('dispatch.settings.saveFailed'));
      }
    } catch {
      Message.error(t('dispatch.settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={t('dispatch.settings.title')}
      visible={visible}
      onCancel={onClose}
      width={400}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type='primary' loading={saving} onClick={handleSave}>
            {t('dispatch.settings.save')}
          </Button>
        </div>
      }
    >
      <Form layout='vertical'>
        <Form.Item label={t('dispatch.settings.nameLabel')}>
          <Input value={name} onChange={setName} placeholder={t('dispatch.settings.namePlaceholder')} maxLength={50} />
        </Form.Item>
        <Form.Item label={t('dispatch.settings.leaderAgentLabel')}>
          <Select
            value={leaderAgentId || undefined}
            onChange={setLeaderAgentId}
            placeholder={t('dispatch.settings.leaderAgentPlaceholder')}
            allowClear
          >
            <Select.Option value=''>{t('dispatch.settings.leaderAgentNone')}</Select.Option>
            {agents.map((a) => (
              <Select.Option key={a.id} value={a.id}>
                {a.avatar && <span className='mr-4px'>{a.avatar}</span>}
                {a.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item label={t('dispatch.settings.seedMessagesLabel')}>
          <Input.TextArea
            value={seedMessages}
            onChange={setSeedMessages}
            placeholder={t('dispatch.settings.seedMessagesPlaceholder')}
            autoSize={{ minRows: 4, maxRows: 10 }}
            maxLength={2000}
            showWordLimit
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
};
```

### 4.2 Settings Persistence

**New IPC channel: `dispatch.update-group-chat-settings`**

```typescript
// ipcBridge.ts
updateGroupChatSettings: bridge.buildProvider<
  IBridgeResponse<void>,
  {
    conversationId: string;
    groupChatName?: string;
    leaderAgentId?: string;
    seedMessages?: string;
  }
>('dispatch.update-group-chat-settings'),
```

**dispatchBridge.ts handler**:

```typescript
ipcBridge.dispatch.updateGroupChatSettings.provider(async (params) => {
  mainLog('[DispatchBridge:updateSettings]', 'received', params);
  try {
    const conversation = await conversationService.getConversation(params.conversationId);
    if (!conversation || conversation.type !== 'dispatch') {
      return { success: false, msg: 'Conversation not found or not a dispatch type' };
    }

    const extra = { ...(conversation.extra as Record<string, unknown>) };

    // Update group chat name
    if (params.groupChatName !== undefined) {
      extra.groupChatName = params.groupChatName;
      conversation.name = params.groupChatName || conversation.name;
    }

    // Update leader agent
    if (params.leaderAgentId !== undefined) {
      if (params.leaderAgentId) {
        const customAgents = ((await ProcessConfig.get('acp.customAgents')) || []) as Array<
          Record<string, unknown> & { id: string; name: string; avatar?: string; context?: string }
        >;
        const leader = customAgents.find((a) => a.id === params.leaderAgentId);
        if (leader) {
          extra.leaderAgentId = leader.id;
          extra.leaderPresetRules = leader.context;
          extra.leaderName = leader.name;
          extra.leaderAvatar = leader.avatar;
        } else {
          return { success: false, msg: 'Leader agent not found' };
        }
      } else {
        // Clear leader
        extra.leaderAgentId = undefined;
        extra.leaderPresetRules = undefined;
        extra.leaderName = undefined;
        extra.leaderAvatar = undefined;
      }
    }

    // Update seed messages
    if (params.seedMessages !== undefined) {
      extra.seedMessages = params.seedMessages || undefined;
    }

    // Persist via conversationService.updateConversation
    await conversationService.updateConversation(params.conversationId, {
      name: conversation.name,
      extra,
    });

    // Notify sidebar
    ipcBridge.conversation.listChanged.emit({
      conversationId: params.conversationId,
      action: 'updated',
      source: 'dispatch',
    });

    return { success: true };
  } catch (error) {
    mainWarn('[DispatchBridge:updateSettings]', 'ERROR: ' + String(error));
    return { success: false, msg: String(error) };
  }
});
```

### 4.3 Hot-swap vs Cold-swap

**Decision: Cold-swap (non-hot-swap).**

Leader agent and seed messages changes are NOT hot-swapped into the running orchestrator's system prompt. Instead:

1. Changes are persisted to `conversation.extra` immediately.
2. The orchestrator's system prompt is rebuilt **on the next `sendMessage` call** because `DispatchAgentManager.createBootstrap()` reads from `conversationRepo.getConversation()` every time.

**Verification required**: `createBootstrap()` is called once at construction. The system prompt is passed to the worker at `start()` time and is NOT rebuilt per-message. This means cold-swap alone is insufficient -- we need to add prompt refresh logic.

**Solution**: Add a `refreshSystemPrompt()` method to `DispatchAgentManager`:

```typescript
/**
 * Phase 4: Refresh system prompt from conversation extra.
 * Called by dispatchBridge after settings are updated.
 */
async refreshSystemPrompt(): Promise<void> {
  if (!this.conversationRepo) return;
  try {
    const conv = await this.conversationRepo.getConversation(this.conversation_id);
    if (!conv) return;
    const extra = conv.extra as {
      leaderPresetRules?: string;
      seedMessages?: string;
    };
    const newPrompt = buildDispatchSystemPrompt(this.dispatcherName, {
      leaderProfile: extra.leaderPresetRules,
      customInstructions: extra.seedMessages,
      availableModels: await this.getAvailableModels(),
    });
    // Update the worker's system prompt via config update
    this.updatePresetRules(newPrompt);
  } catch (err) {
    mainWarn('[DispatchAgentManager]', 'refreshSystemPrompt failed', err);
  }
}
```

In `dispatchBridge.ts` update handler, after persisting settings:

```typescript
// Refresh orchestrator prompt if agent is running
const task = _workerTaskManager.getTask(params.conversationId);
if (task && typeof (task as any).refreshSystemPrompt === 'function') {
  await (task as any).refreshSystemPrompt();
}
```

**`updatePresetRules`**: This method needs to be added to `BaseAgentManager` or overridden in `DispatchAgentManager`. It posts a config-update message to the worker that updates the Gemini CLI's system instruction. If the underlying worker does not support hot system prompt update, the fallback is to document that changes take effect on next conversation (user sends a new message).

**Pragmatic approach**: Since Gemini CLI workers read system instructions at session init and cannot hot-reload them, the most reliable path is:

1. Persist the updated settings to DB.
2. When the user next sends a message, `DispatchAgentManager.sendMessage()` prepends a `[System Update]` notice informing the orchestrator of the configuration change.

This avoids worker restart complexity while ensuring the orchestrator is aware of changes.

### 4.4 GroupChatView Integration

In `GroupChatView.tsx`, add settings button to `headerExtra` and drawer state:

```typescript
const [settingsVisible, setSettingsVisible] = useState(false);

const currentSettings = useMemo(() => ({
  groupChatName: (conversation.extra as any).groupChatName,
  leaderAgentId: (conversation.extra as any).leaderAgentId,
  seedMessages: (conversation.extra as any).seedMessages,
}), [conversation.extra]);

const headerExtra = useMemo(() => (
  <div className='flex items-center gap-8px'>
    {activeChildCount > 0 && (
      <Tag color='arcoblue'>{t('dispatch.header.taskCount', { count: activeChildCount })}</Tag>
    )}
    <Button
      type='text'
      size='small'
      icon={<Setting theme='outline' size='16' />}
      onClick={() => setSettingsVisible(true)}
      aria-label={t('dispatch.settings.title')}
    />
  </div>
), [activeChildCount, t]);
```

Add `GroupChatSettingsDrawer` at the bottom of JSX (inside `ChatLayout`):

```tsx
<GroupChatSettingsDrawer
  visible={settingsVisible}
  onClose={() => setSettingsVisible(false)}
  conversationId={conversation.id}
  currentSettings={currentSettings}
  onSaved={() => {
    refreshInfo();
  }}
/>
```

---

## 5. Self-Debate Log

### Debate 1: F-4.1 SendBox Component -- Reuse global `SendBox` vs lightweight `Input.TextArea`

|      | Option A: Reuse `SendBox` from `@/renderer/components/chat/sendbox`                  | Option B: Lightweight `Input.TextArea`              |
| ---- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Pros | Consistent UX, file attachment support, multi-line toggle                            | Simpler, smaller footprint, no unnecessary features |
| Cons | SendBox designed for main chat (file upload, skills inject, etc.), heavy for a panel | Less feature-rich, manual Enter handling            |
| Risk | Overweight component that imports unnecessary dependencies into TaskPanel            | Inconsistent keyboard shortcuts with main chat      |

**Decision: Option B (Input.TextArea)**. The TaskPanel send-to-child use case is a simple text-only message. File attachments and skill injection are not needed. A lightweight `Input.TextArea` with a Send button keeps the component focused. Shift+Enter for newline, Enter to send -- standard behavior.

### Debate 2: F-4.1 Dispatcher Notification -- Inline system message vs separate IPC channel

|      | Option A: Inject via DispatchAgentManager directly                  | Option B: New `dispatch.notify-parent` IPC channel |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------- |
| Pros | No new IPC channel, direct access to emitGroupChatEvent             | Clean separation, renderer controls when to notify |
| Cons | Requires renderer to reach into main process internals              | Extra IPC round-trip                               |
| Risk | Breaking encapsulation if TaskPanel directly accesses agent manager | Slight latency from extra IPC call                 |

**Decision: Option B (new IPC channel)**. The PRD explicitly specifies `dispatch.notify-parent` as a new channel. The renderer should not need to know about `DispatchAgentManager` internals. The IPC round-trip cost (~1-5ms) is negligible.

### Debate 3: F-4.2 Model ID Format -- `providerId::modelName` composite string vs structured object

|      | Option A: Composite string `"provider_id::model_name"` | Option B: Structured object `{ provider_id, model_name }`       |
| ---- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Pros | Simpler for LLM to generate, single string parameter   | Type-safe, no parsing needed                                    |
| Cons | Requires string splitting/parsing, error-prone         | More verbose in tool schema, LLM may generate malformed objects |
| Risk | LLM may generate wrong delimiter or extra spaces       | LLM may omit required fields                                    |

**Decision: Option B (structured object)**. JSON objects are standard MCP tool parameter format. Gemini models handle structured parameters well. The schema validation catches missing fields. No string parsing edge cases.

### Debate 4: F-4.3 System Prompt Update -- Hot-reload worker vs cold-swap on next message

|      | Option A: Hot-reload via worker message                                                    | Option B: Cold-swap, inject [System Update] on next sendMessage                   |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Pros | Immediate effect, true live update                                                         | No worker protocol changes, simple implementation                                 |
| Cons | Gemini CLI worker may not support mid-session system prompt change; needs new IPC protocol | Delayed effect until next message; orchestrator may not fully "absorb" the change |
| Risk | High -- may require Gemini CLI fork or custom protocol                                     | Low -- worst case orchestrator ignores the system update notice                   |

**Decision: Option B (cold-swap with system notification)**. The Gemini CLI worker creates a session with the system instruction at init. There is no documented API to change system instructions mid-session. Implementing hot-reload would require either restarting the worker (disruptive) or patching the Gemini CLI protocol (fragile). Instead, we persist the settings and inject a `[System Update]` notification into the next user message turn. The orchestrator LLM is instructed to follow updated instructions.

### Debate 5: F-4.3 Settings Drawer -- Arco `Drawer` vs custom slide panel

|      | Option A: Arco `Drawer` component                                    | Option B: Custom CSS animated panel        |
| ---- | -------------------------------------------------------------------- | ------------------------------------------ |
| Pros | Built-in a11y (focus trap, aria-modal), animation, mobile responsive | Full design control                        |
| Cons | Limited customization                                                | Manual a11y, more code, harder to maintain |

**Decision: Option A (Arco Drawer)**. Project convention mandates `@arco-design/web-react` components. Arco `Drawer` provides focus trap, keyboard dismissal, and smooth animation out of the box.

---

## 6. File Change List

### New Files

| File                                                                                     | Description                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| `src/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer.tsx`        | Settings Drawer panel (Arco Drawer + Form) |
| `src/renderer/pages/conversation/dispatch/components/GroupChatSettingsDrawer.module.css` | Optional CSS module for any custom styles  |

### Modified Files

| File                                                                   | Changes                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Renderer**                                                           |                                                                                                                    |
| `src/renderer/pages/conversation/dispatch/TaskPanel.tsx`               | Add SendBox (Input.TextArea + Button), `handleSendToChild`, `canSend` logic                                        |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx`           | Add Settings button in `headerExtra`, Drawer state, `GroupChatSettingsDrawer` integration                          |
| `src/renderer/pages/conversation/dispatch/components/TaskOverview.tsx` | Add model name `Tag` display per child task row                                                                    |
| `src/renderer/pages/conversation/dispatch/types.ts`                    | Add `GroupChatSettingsDrawerProps`, `ChildTaskInfoVO.modelName`                                                    |
| **Common**                                                             |                                                                                                                    |
| `src/common/adapter/ipcBridge.ts`                                      | Add `dispatch.notifyParent` and `dispatch.updateGroupChatSettings` channel definitions                             |
| **Main Process**                                                       |                                                                                                                    |
| `src/process/bridge/dispatchBridge.ts`                                 | Add `notify-parent` handler, `update-group-chat-settings` handler; extend `getGroupChatInfo` to return `modelName` |
| `src/process/task/dispatch/dispatchTypes.ts`                           | Add `model` field to `StartChildTaskParams`                                                                        |
| `src/process/task/dispatch/DispatchMcpServer.ts`                       | Add `model` to `start_task` tool schema and `handleToolCall` parsing                                               |
| `src/process/task/dispatch/DispatchAgentManager.ts`                    | Model resolution in `startChildSession`; inject available models into prompt; `refreshSystemPrompt` method         |
| `src/process/task/dispatch/dispatchPrompt.ts`                          | Add `availableModels` option to `buildDispatchSystemPrompt`                                                        |
| `src/process/task/dispatch/dispatchMcpServerScript.ts`                 | Add `model` to `start_task` schema in the MCP script tool definitions                                              |
| **i18n**                                                               |                                                                                                                    |
| `src/common/config/i18n/en-US/*.json`                                  | Add all Phase 4 i18n keys                                                                                          |
| `src/common/config/i18n/zh-CN/*.json`                                  | Chinese translations                                                                                               |
| `src/common/config/i18n/zh-TW/*.json`                                  | Traditional Chinese translations                                                                                   |
| `src/common/config/i18n/ja-JP/*.json`                                  | Japanese translations                                                                                              |
| `src/common/config/i18n/ko-KR/*.json`                                  | Korean translations                                                                                                |
| `src/common/config/i18n/de-DE/*.json` (or 6th locale)                  | German translations                                                                                                |

### Directory Impact Analysis

**`src/renderer/pages/conversation/dispatch/`** -- Currently 10 direct children (7 files + components/ + hooks/ + types.ts). Adding files:

- `GroupChatSettingsDrawer.tsx` goes into `components/` subdirectory (NOT dispatch root).
- Optional `GroupChatSettingsDrawer.module.css` also in `components/`.
- **Result**: dispatch/ stays at 10 direct children. `components/` goes from 3 to 5 (well within 10 limit).

**`src/process/task/dispatch/`** -- Currently 10 direct children. No new files added (all changes modify existing files). Stays at 10.

---

## 7. Migration Notes

### Backward Compatibility

1. **F-4.1**: No data migration. New IPC channels are additive. Existing conversations continue to work -- TaskPanel simply gains an optional SendBox.

2. **F-4.2**: The `model` parameter in `start_task` is optional. Existing orchestrator prompts that do not pass `model` will use the default dispatcher model (existing behavior). The `childModelName` field in conversation extra is new but optional -- old child conversations simply won't have it, and TaskOverview renders nothing for `undefined`.

3. **F-4.3**: The `updateGroupChatSettings` IPC channel is new. Existing conversations already have `groupChatName`, `leaderAgentId`, `leaderPresetRules`, `seedMessages` in their extra (set at creation time). The Settings Drawer reads these existing fields. No schema migration needed.

### Rollback Strategy

All three features are purely additive:

- New IPC channels are only called by new UI code.
- New `model` parameter is optional in tool schema.
- New `GroupChatSettingsDrawer` component is lazily loaded from GroupChatView.

Reverting the Phase 4 commit removes all three features cleanly with no data corruption risk.

### Testing Priorities

1. **F-4.1 Critical Path**: Send message to running child -> child responds -> transcript updates -> parent timeline shows system notification.
2. **F-4.1 Edge Case**: Send message to idle child (worker exited) -> getOrBuildTask re-forks -> message delivered.
3. **F-4.2 Critical Path**: Orchestrator creates child with model override -> child uses correct model -> TaskOverview shows model tag.
4. **F-4.2 Fallback**: Invalid provider_id -> fallback to default model, no crash.
5. **F-4.3 Critical Path**: Open drawer -> modify settings -> save -> settings persisted -> next orchestrator message uses new leader/seed.
6. **F-4.3 Edge Case**: Leader agent deleted from assistants -> drawer shows warning, save rejected.
