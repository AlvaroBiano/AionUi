# Phase 2a — Orchestrator Auto-Start + Enhanced CreateGroupChatModal

## Overview

Phase 2a adds the core multi-agent dispatch system to AionUi, replicating Claude Code's dispatch_system. The Orchestrator Agent is the central coordinator that receives user messages and delegates tasks to child Gemini agents via MCP tools.

## Goals

1. Enable users to create dispatch (group chat) conversations
2. Auto-start the Orchestrator Agent on group chat creation (no cold-start on first message)
3. Provide workspace directory selection during creation
4. Real-time timeline view of orchestrator + child agent activity

## Enhanced CreateGroupChatModal

### Sections

1. **Name** — Optional conversation name (defaults to "Group Chat")
2. **Leader Agent Selector** — Choose which agent acts as orchestrator leader _(deferred to Phase 2b)_
3. **Workspace Directory Picker** — Browse and select working directory for child agents
4. **Model Selector** — Choose which model/provider to use _(deferred to Phase 2b)_

### Behavior

- Name field: text input with allowClear, Enter key triggers creation
- Workspace: read-only Input with Tooltip showing full path + FolderOpen browse button
- On create: invokes `ipcBridge.dispatch.createGroupChat` with name + workspace
- On success: navigates to `/conversation/{id}`, emits `chat.history.refresh`, calls `onCreated`

## Orchestrator Behavior

### Startup

- Eager startup via `_workerTaskManager.getOrBuildTask(id)` immediately after conversation creation
- Non-fatal: if warm-start fails, agent will be lazily started on first `sendMessage`

### Model Resolution

- Read `gemini.defaultModel` from ProcessConfig (file I/O, not IPC bridge — avoids deadlock)
- `gemini.defaultModel` only stores `{ id, useModel }` reference
- Must look up full provider config (apiKey, baseUrl, platform) from `model.config` (IProvider[])
- Construct `TProviderWithModel` with full provider details

### MCP Tools

The Orchestrator exposes these tools to the underlying Gemini agent:

1. **create_task** — Fork a new child Gemini agent with a specific task description
2. **send_message** — Send a follow-up message to an existing child session
3. **cancel_child** — Cancel a running child task

### Child Agent Lifecycle

- Child conversations use `type='gemini'` (not 'dispatch') with `extra.dispatchSessionType='dispatch_child'`
- Parent-child relationship tracked via `extra.parentSessionId`
- Status transitions: pending → running → idle/finished/failed/cancelled

## Database Changes

- Migration v18: Add 'dispatch' to conversations type CHECK constraint
- Extend status CHECK: add 'idle', 'failed', 'cancelled' to match AgentStatus type
- Table recreation pattern (SQLite can't ALTER CHECK constraints)

## IPC Channels

| Channel                       | Direction       | Purpose                                  |
| ----------------------------- | --------------- | ---------------------------------------- |
| `dispatch.createGroupChat`    | renderer → main | Create dispatch conversation             |
| `dispatch.getGroupChatInfo`   | renderer → main | Get dispatcher info + children list      |
| `dispatch.cancelChildTask`    | renderer → main | Cancel a child task                      |
| `dispatch.getChildTranscript` | renderer → main | Get child session messages               |
| `conversation.responseStream` | main → renderer | Real-time dispatch_event + text messages |

## Renderer Components

| Component            | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| CreateGroupChatModal | Creation dialog with name + workspace                          |
| GroupChatView        | Main container: timeline + input + info panel                  |
| GroupChatTimeline    | Scrollable message list with auto-scroll                       |
| ChildTaskCard        | Status card for child tasks (pending/running/completed/failed) |

## Hooks

| Hook                 | Purpose                                       |
| -------------------- | --------------------------------------------- |
| useGroupChatMessages | Subscribe to responseStream + load DB history |
| useGroupChatInfo     | Fetch dispatcher info + children list         |
| useChildTaskDetail   | Load child task transcript with timeout       |

## Acceptance Criteria

### AC-1: Conversation Creation

- [ ] User can create dispatch conversation with optional name and workspace
- [ ] Conversation appears in sidebar under dispatch group
- [ ] DB row has type='dispatch' with correct model and extra fields

### AC-2: Orchestrator Startup

- [ ] Orchestrator agent starts eagerly on creation (no cold-start penalty)
- [ ] If warm-start fails, agent starts lazily on first message
- [ ] Full provider config (apiKey, baseUrl) is resolved correctly

### AC-3: Message Flow

- [ ] User messages appear in timeline (right-aligned)
- [ ] Orchestrator responses appear in timeline (left-aligned)
- [ ] Child task events (started/progress/completed/failed) show as status cards
- [ ] Messages persist to DB and reload on revisit

### AC-4: Child Task Management

- [ ] Orchestrator can create child tasks via MCP create_task tool
- [ ] Child task status updates appear in real-time
- [ ] User can cancel running child tasks

### AC-5: Code Quality

- [ ] All dispatch i18n keys present in 6 locales
- [ ] No hardcoded strings in renderer
- [ ] Migration v18 handles up/down correctly
- [ ] Status CHECK constraint includes all AgentStatus values

## Deferred to Phase 2b

- Leader Agent selector (currently uses default Gemini agent)
- Model selector (currently uses gemini.defaultModel)
- Seed Messages / system prompt customization
- Full Task Panel UI with transcript viewer
- Save teammate as reusable assistant
- Parent-child visualization tree
- Single-chat upgrade to dispatch mode
