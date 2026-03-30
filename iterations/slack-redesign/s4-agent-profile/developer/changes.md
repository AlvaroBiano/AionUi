# S4: Agent Profile + DM Navigation — Developer Changes

## Status: [DONE]

## Files Created

### 1. `src/renderer/pages/agent/types.ts`

Type definitions for the AgentProfile page:

- `AgentProfileData` — resolved profile data (identity, conversations, agentLogo, workspaces)
- `AgentProfilePageParams`, `AgentProfileHeaderProps`, `AgentConfigSectionProps`, `AgentConversationListProps`

### 2. `src/renderer/pages/agent/hooks/useAgentProfile.ts`

Hook resolving profile data from existing context (no new IPC):

- Uses `useAgentRegistry()` for identity lookup
- Uses `useConversationHistoryContext()` for conversation filtering
- Filters conversations by `resolveAgentId(c) === agentId`, sorts by `modifyTime` desc
- Collects unique workspace paths from conversation extras
- Returns `null` if agent not found in registry

### 3. `src/renderer/pages/agent/components/AgentProfileHeader.tsx`

Header component:

- Avatar: emoji → logo img → letter fallback (same priority as AgentDMGroup)
- Agent name as `h2`
- `<Tag>` badges: Permanent/Temporary (green/gray) and source badge (Preset/Custom/CLI Agent/Dispatch Teammate)
- "Start new conversation" `<Button type="primary">` navigates to `/guid` with `state.prefillAgentId`
- Back button with `<Left>` icon

### 4. `src/renderer/pages/agent/components/AgentConfigSection.tsx`

Config section:

- Shows backend type, description, and workspace paths using `<Descriptions>` from arco-design
- "Edit config" button visible only for `employeeType === 'permanent'` agents
- `custom:*` agents → `/settings/agent`, others → `/settings/assistants`

### 5. `src/renderer/pages/agent/components/AgentConversationList.tsx`

Conversation list:

- Empty state via `<Empty>` from arco-design when no conversations
- Each row: title, workspace label (basename), relative time, generating badge
- Click navigates to `/conversation/:id`
- Inline `formatRelativeTime()` utility (minutes → hours → days → date)

### 6. `src/renderer/pages/agent/index.tsx`

Page entry point:

- Reads `:agentId` from `useParams()`, decodes via `decodeURIComponent`
- Shows `<Empty>` with "Agent not found" if `useAgentProfile()` returns null
- Single-column centered layout (max-width 720px, auto margins, 32px gap between sections)
- Scrollable via `overflow-y-auto`

## Files Modified

### 7. `src/renderer/components/layout/Router.tsx`

- Added `const AgentProfile = React.lazy(() => import('@renderer/pages/agent'));`
- Added `<Route path='/agent/:agentId' element={withRouteFallback(AgentProfile)} />` inside `ProtectedLayout`

### 8. `src/renderer/pages/conversation/GroupedHistory/AgentDMGroup.tsx`

- Added `useNavigate` import from `react-router-dom`
- Added `handleAvatarClick` callback: stops propagation + navigates to `/agent/${encodeURIComponent(group.agentId)}`
- Avatar `<span>` in the non-collapsed header row now has `onClick={handleAvatarClick}` and `cursor-pointer`
- Expand/collapse toggle behavior unchanged (propagation stopped on avatar click)

### 9. `src/renderer/pages/conversation/dispatch/types.ts`

- Added `agentId?: string` to `GroupChatMemberVO` (S4: agent registry ID for profile navigation)
- Added `onNavigateToProfile?: (agentId: string) => void` to `MemberCardProps`

### 10. `src/renderer/pages/conversation/dispatch/components/MemberCard.tsx`

- Destructures `onNavigateToProfile` from props
- Member name `<span>` gets `onClick` handler: stops propagation, calls `onNavigateToProfile(member.agentId)` if both `member.agentId` and `onNavigateToProfile` are present
- If `agentId` is absent, name click is a no-op (no navigation)
- Adds `cursor-pointer hover:text-primary` styling only when navigation is available

### 11. `src/renderer/pages/conversation/dispatch/components/GroupMemberSider.tsx`

- Added `useNavigate` import and `useCallback` import
- Added `handleNavigateToProfile` callback: navigates to `/agent/${encodeURIComponent(agentId)}`
- Passes `onNavigateToProfile={handleNavigateToProfile}` to each `<MemberCard>`

## i18n Keys Added (all 6 locales)

Module: `agent`, namespace: `profile`

| Key                               | en-US                  |
| --------------------------------- | ---------------------- |
| `agent.profile.title`             | Agent Profile          |
| `agent.profile.back`              | Back                   |
| `agent.profile.startConversation` | Start new conversation |
| `agent.profile.editConfig`        | Edit configuration     |
| `agent.profile.configuration`     | Configuration          |
| `agent.profile.conversations`     | Conversations          |
| `agent.profile.noConversations`   | No conversations yet   |
| `agent.profile.notFound`          | Agent not found        |
| `agent.profile.permanent`         | Permanent              |
| `agent.profile.temporary`         | Temporary              |
| `agent.profile.backendType`       | Backend                |
| `agent.profile.description`       | Description            |
| `agent.profile.workspaces`        | Workspaces             |
| `agent.profile.sourcePreset`      | Preset                 |
| `agent.profile.sourceCustom`      | Custom                 |
| `agent.profile.sourceCli`         | CLI Agent              |
| `agent.profile.sourceDispatch`    | Dispatch Teammate      |

All 6 locales: `en-US`, `zh-CN`, `zh-TW`, `ja-JP`, `ko-KR`, `tr-TR`

## Verification

- `bun run format` — passed (all files formatted)
- `bun run lint:fix` — passed (0 errors; 1258 pre-existing warnings, none from new code)
- `bunx tsc --noEmit` — no errors in new/modified files (pre-existing errors in `conversationBridge.ts` and `DispatchAgentManager.ts` unrelated to S4)
- `bun run i18n:types` — types regenerated (unchanged = all keys already registered)
- `node scripts/check-i18n.js` — passed (warnings are pre-existing `settings.weixin.*` keys)
