# G4: Enhanced Capabilities - Technical Design

**Date**: 2026-03-30
**Status**: Design
**Scope**: Workspace awareness, team config, assistant enrichment, cost tracking, progress cards, plan tool, cross-session memory
**Dependencies**: G1 (engine unbind), G2 (isolation/permissions), G3 (UI experience)

---

## 1. Overview

G4 bridges the remaining capability gaps between AionUi's dispatch system and Claude Code's agent orchestration. It adds seven sub-features that fall into three categories:

- **Context injection** (G4.1, G4.2, G4.7): Give the admin agent project awareness, team workflow knowledge, and persistent memory.
- **Configuration enrichment** (G4.3): Align `AcpBackendConfig` with Claude Code's `.claude/agents/*.md` frontmatter.
- **Observability** (G4.4, G4.5, G4.6): Let users see cost, progress, and structured plans.

All changes are additive. No existing API contracts break.

---

## 2. Sub-feature Designs

### G4.1 Workspace Awareness (Project Context Scanner)

**Problem**: Admin and teammates are assigned a workspace but know nothing about the project's tech stack, build tools, test framework, or code conventions.

**Design**:

#### New file: `src/process/task/dispatch/projectContextScanner.ts`

```typescript
/**
 * Scan workspace for project context files and produce a condensed summary
 * suitable for system prompt injection.
 *
 * Scan priority (stops reading after hitting char budget):
 *   1. CLAUDE.md / AGENTS.md        -> project instructions
 *   2. .gemini/                      -> Gemini native config
 *   3. package.json (scripts only)   -> available commands
 *   4. README.md (first 200 lines)  -> project overview
 *   5. tsconfig.json / pyproject.toml -> tech stack signals
 */
export type ProjectContext = {
  /** Condensed text for prompt injection (max ~4000 chars) */
  summary: string;
  /** Raw file paths that were scanned */
  scannedFiles: string[];
  /** Timestamp of last scan */
  scannedAt: number;
};

export async function scanProjectContext(
  workspace: string,
  options?: { maxChars?: number; signal?: AbortSignal }
): Promise<ProjectContext>;
```

Key decisions:
- **Async + cached**: Scan runs once during `createBootstrap()`, result stored in `conversation.extra.projectContext`. Subsequent restarts re-use the cache (TTL = 1 hour). Cache invalidation: user can trigger re-scan via IPC.
- **Budget**: Default 4000 chars. Each file source gets a proportional slice. `CLAUDE.md` gets priority (up to 2000 chars), remainder split among other sources.
- **Non-blocking**: Uses `fs.promises.readFile` with `AbortSignal`. If scanning takes > 5s, returns partial results.
- **Security**: Only reads files within the workspace directory tree (same path traversal guard as `startChildSession`).

#### Modified: `src/process/task/dispatch/dispatchPrompt.ts`

```typescript
export function buildDispatchSystemPrompt(
  dispatcherName: string,
  options?: {
    // ...existing fields...
    /** G4.1: Scanned project context */
    projectContext?: string;
  }
): string;
```

New prompt section appended after `## Workspace`:

```
## Project Context
The following is automatically scanned from your workspace. Use it to make better delegation decisions.

{projectContext}
```

#### Modified: `src/process/task/dispatch/DispatchAgentManager.ts`

In `createBootstrap()`, after workspace is known:

```typescript
// G4.1: Scan project context (non-blocking, cached)
const projectContext = await scanProjectContext(this.workspace, { maxChars: 4000 });
// Store in conversation extra for cache
if (this.conversationRepo) {
  await this.conversationRepo.updateConversation(this.conversation_id, {
    extra: { projectContext: projectContext.summary },
  });
}
```

The `projectContext.summary` is then passed to `buildDispatchSystemPrompt()`.

#### Modified: `src/process/bridge/dispatchBridge.ts`

New IPC channel `dispatch.rescan-project-context`:
- Clears cached `projectContext` from conversation extra.
- Triggers a fresh scan and injects into the running admin agent via system notification.

---

### G4.2 Team Config Loading

**Problem**: `.claude/teams/*.json` files exist in workspace but are not read by the dispatch system. The admin operates without structured workflow guidance.

**Design**:

#### New file: `src/process/task/dispatch/teamConfigLoader.ts`

```typescript
/**
 * Load and parse team config from .claude/teams/{name}.json.
 * Extracts prompt-injectable sections: roles, workflow, grading, quality gates.
 */
export type TeamConfigPromptData = {
  /** Human-readable summary for prompt injection */
  promptSection: string;
  /** Available role names (for admin to reference in start_task) */
  availableRoles: string[];
  /** Task grading rules (S/M/L) if defined */
  taskGrading?: string;
  /** Quality gates (lint, test, type check commands) */
  qualityGates?: string[];
};

export async function loadTeamConfig(
  workspace: string,
  teamName: string
): Promise<TeamConfigPromptData | null>;

export async function listAvailableTeamConfigs(
  workspace: string
): Promise<Array<{ name: string; path: string }>>;
```

The loader:
1. Reads `{workspace}/.claude/teams/{teamName}.json`.
2. Parses JSON. Expected structure (matching Claude Code convention):
   ```json
   {
     "roles": [{ "name": "Architect", "description": "...", "prompt": "..." }],
     "workflow": { "S": "...", "M": "...", "L": "..." },
     "qualityGates": ["bun run lint:fix", "bunx tsc --noEmit"],
     "costLimits": { "maxToolCalls": 50 }
   }
   ```
3. Builds a condensed `promptSection` string (max 3000 chars).
4. Returns `null` if file not found (graceful degradation).

#### Modified: `src/process/task/dispatch/dispatchPrompt.ts`

New option `teamConfig?: string` in `buildDispatchSystemPrompt()`:

```
## Team Configuration
The following team workflow has been loaded. Follow these roles and processes.

{teamConfig}
```

#### Modified: `src/renderer/pages/conversation/dispatch/CreateGroupChatModal.tsx`

Add optional "Team Config" selector:
- On workspace change, call `dispatch.list-team-configs` IPC to enumerate `.claude/teams/*.json`.
- Display as `<Select>` with file names (sans `.json`).
- Pass `teamConfigName` to `createGroupChat` params.

#### Modified: `src/common/adapter/ipcBridge.ts`

New channels:
- `dispatch.list-team-configs`: `{ workspace: string }` -> `{ configs: Array<{ name: string }> }`
- `createGroupChat` params: add `teamConfigName?: string`

#### Modified: `src/process/bridge/dispatchBridge.ts`

- `createGroupChat` handler: if `teamConfigName` is provided, call `loadTeamConfig()`, store result in `conversation.extra.teamConfig`.
- New handler `dispatch.list-team-configs`: calls `listAvailableTeamConfigs()`.

#### Modified: `src/process/task/dispatch/DispatchAgentManager.ts`

In `createBootstrap()`, read `extra.teamConfig` and pass to prompt builder.

---

### G4.3 Assistant Config Enrichment

**Problem**: `AcpBackendConfig` lacks `defaultModel` and `allowedTools` fields that Claude Code's `.claude/agents/*.md` has. The `description` field already exists but `defaultModel` and `allowedTools` do not.

**Design**:

#### Modified: `src/common/types/acpTypes.ts`

```typescript
export interface AcpBackendConfig {
  // ...existing fields...

  /** G4.3: Default model for this assistant. Format: "provider_id::model_name".
   *  When used in dispatch, auto-fills the model parameter of start_task. */
  defaultModel?: string;

  /** G4.3: Tool permission allowlist. If set, child agents using this assistant
   *  config will have their tools restricted to this list.
   *  Omit for unrestricted. Safe tools (Read, Grep, Glob) always allowed. */
  allowedTools?: string[];
}
```

Note: `description` already exists at line 173 of `acpTypes.ts`. No change needed there.

#### Migration strategy

No DB migration needed. Both fields are optional. Existing configs continue to work unchanged. The fields are read lazily:
- `defaultModel`: Read in `dispatchBridge.ts` `createGroupChat` and `addMember` handlers when resolving child model.
- `allowedTools`: Read in `DispatchMcpServer.handleToolCall('start_task')` when the admin references a `member_id`.

#### Modified: `src/process/bridge/dispatchBridge.ts`

In `addMember` handler (G3.6), when looking up agent config:
- If `agent.defaultModel` is set, include it in the system notification to admin.
- If `agent.allowedTools` is set, include it.

In `createGroupChat` handler, when resolving leader agent:
- If `leaderAgent.allowedTools` is set, store in `extra.leaderAllowedTools` (future use: admin tool restrictions).

#### Renderer: Settings assistant edit page

The assistant editor form (`src/renderer/pages/settings/`) should add:
- `defaultModel`: `<Select>` populated from `model.config` providers.
- `allowedTools`: `<Select mode="multiple">` with common tool names.

This is a UI-only change in the settings page; the exact file depends on the current settings page structure.

---

### G4.4 Cost Tracking

**Problem**: Multiple agents consume tokens in parallel, but users have no visibility into cost. Different engines report usage differently.

**Design**:

#### Data source analysis

| Engine | Token data location | Format |
|--------|-------------------|--------|
| Gemini | `finished` event -> `usageMetadata.totalTokenCount` | `{ totalTokenCount, promptTokenCount, candidatesTokenCount }` |
| ACP | `acp_context_usage` event -> `{ used, size }` | Context window usage only, not per-turn tokens |
| Codex | CLI stdout parsing | Varies by provider |

**Unified token reporting**: Each engine's AgentManager already persists token data to `conversation.extra.lastTokenUsage`. We extend this pattern.

#### New file: `src/process/task/dispatch/costTracker.ts`

```typescript
export type SessionCostEntry = {
  sessionId: string;
  displayName: string;
  role: 'admin' | 'child';
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  modelName?: string;
  /** Estimated cost in USD (model-dependent pricing) */
  estimatedCost?: number;
};

export type GroupCostSummary = {
  totalTokens: number;
  totalEstimatedCost: number;
  sessions: SessionCostEntry[];
  updatedAt: number;
};

/**
 * Aggregate cost data for a group chat by reading each session's
 * conversation.extra.lastTokenUsage from the database.
 */
export async function aggregateGroupCost(
  conversationRepo: IConversationRepository,
  parentConversationId: string,
  childInfos: ChildTaskInfo[]
): Promise<GroupCostSummary>;

/**
 * Model-to-pricing lookup. Returns USD per 1K tokens.
 * Rough estimates; user can override via settings.
 */
export function getModelPricing(modelName: string): {
  inputPer1k: number;
  outputPer1k: number;
};
```

#### Modified: `src/common/adapter/ipcBridge.ts`

New channel:
```typescript
dispatch.getGroupCostSummary: bridge.buildProvider<
  IBridgeResponse<GroupCostSummary>,
  { conversationId: string }
>('dispatch.get-group-cost-summary')
```

#### Modified: `src/process/bridge/dispatchBridge.ts`

New handler `dispatch.get-group-cost-summary`:
- Reads parent conversation + all child conversations.
- Calls `aggregateGroupCost()`.
- Returns summary.

#### New file: `src/renderer/pages/conversation/dispatch/components/CostPanel.tsx`

A collapsible panel component showing:
- Total group cost (tokens + estimated USD).
- Per-member breakdown.
- Auto-refreshes every 10s via `useInterval`.

Placed in the `GroupChatView` as a collapsible section below the MemberBar or in a dedicated "Cost" tab.

#### Worker base class enhancement

To unify token reporting across engines, add to `BaseAgentManager`:

```typescript
/** G4.4: Last reported token usage for this session */
protected lastTokenUsage?: { totalTokens: number; inputTokens?: number; outputTokens?: number };

/** Subclasses call this to report token usage */
protected reportTokenUsage(usage: { totalTokens: number; inputTokens?: number; outputTokens?: number }): void {
  this.lastTokenUsage = usage;
  // Persist to conversation.extra.lastTokenUsage
}
```

Gemini worker calls this in the `finished` event handler. ACP worker calls this in the `acp_context_usage` handler. Other engines add their own hooks.

---

### G4.5 Task Progress Cards

**Problem**: Admin sends progress updates as plain text. In a GUI application, these should be visually rich.

**Design**:

#### Admin prompt convention

Add to `buildDispatchSystemPrompt()`:

```
## Progress Reporting Format
When reporting task progress to the user, use this JSON format wrapped in a code block:

\`\`\`progress
{
  "title": "Refactor sidebar grouping",
  "overall": 65,
  "phases": [
    { "name": "Tech Design", "agent": "Architect", "status": "done" },
    { "name": "Implementation", "agent": "Developer", "status": "running", "progress": 40 },
    { "name": "Testing", "agent": "Evaluator", "status": "pending" }
  ]
}
\`\`\`

The UI will render this as a visual progress card. Use it for multi-phase task updates.
```

#### Renderer detection and rendering

#### New file: `src/renderer/pages/conversation/dispatch/components/ProgressCard.tsx`

```typescript
export type ProgressCardData = {
  title: string;
  overall: number; // 0-100
  phases: Array<{
    name: string;
    agent?: string;
    status: 'done' | 'running' | 'pending' | 'failed';
    progress?: number;
  }>;
};

/** Parse a message content string for ```progress blocks */
export function parseProgressBlock(content: string): ProgressCardData | null;

/** Visual card component */
const ProgressCard: React.FC<{ data: ProgressCardData }> = ({ data }) => { ... };
```

#### Modified: `src/renderer/pages/conversation/dispatch/GroupChatTimeline.tsx`

In the message rendering pipeline, before rendering a text message:
1. Call `parseProgressBlock(content)`.
2. If it returns data, render `<ProgressCard>` instead of plain text.
3. Fallback: if JSON parsing fails, render as normal markdown.

No backend changes needed. This is purely a renderer-side feature.

---

### G4.6 `generate_plan` MCP Tool

**Problem**: The admin agent jumps directly to `start_task` without a structured planning phase. This leads to suboptimal task decomposition.

**Design**:

The `generate_plan` tool does NOT create child tasks. It produces a structured plan that the admin can review, adjust, and then execute via `start_task` calls.

#### New tool schema (in both `DispatchMcpServer.ts` and `dispatchMcpServerScript.ts`)

```typescript
{
  name: 'generate_plan',
  description:
    'Generate a structured execution plan before delegating tasks. ' +
    'Does NOT start any tasks. Returns a plan with phases, dependencies, and estimates. ' +
    'Use this for complex multi-step requests before calling start_task.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The high-level task description from the user.',
      },
      constraints: {
        type: 'string',
        description: 'Optional constraints (time, cost, quality priorities).',
      },
    },
    required: ['task'],
  },
}
```

#### Tool handler implementation

Unlike other tools that perform actions, `generate_plan` is a **prompt-driven** tool. The handler:

1. Reads available context: project context, team config, available members.
2. Constructs a meta-prompt asking the admin's own LLM to produce a structured plan.
3. Returns the plan as structured JSON.

```typescript
// In DispatchMcpServer.handleToolCall
case 'generate_plan': {
  const task = String(args.task ?? '');
  const constraints = typeof args.constraints === 'string' ? args.constraints : undefined;

  // Build context for plan generation
  const children = await this.handler.listChildren();
  const contextParts = [
    `Task: ${task}`,
    constraints ? `Constraints: ${constraints}` : '',
    children.length > 0 ? `Active sessions: ${children.map(c => `${c.title}(${c.status})`).join(', ')}` : '',
  ].filter(Boolean);

  // Return as structured prompt - the LLM will fill in the plan
  return {
    instruction: 'Based on the context below, generate a structured execution plan.',
    context: contextParts.join('\n'),
    output_format: {
      phases: [
        {
          title: 'string: phase name',
          description: 'string: what this phase does',
          agent_role: 'string: suggested role (Architect/Developer/Evaluator/etc)',
          dependencies: 'string[]: phase titles this depends on',
          estimated_effort: 'string: S/M/L',
        },
      ],
      parallel_groups: 'number[][]: indices of phases that can run in parallel',
      estimated_total: 'string: overall effort estimate',
    },
  };
}
```

The plan is returned to the admin agent which then presents it to the user. The user can approve, modify, or reject before the admin starts executing with `start_task`.

#### Modified: `src/process/task/dispatch/dispatchPrompt.ts`

Add `generate_plan` to the `## Available Tools` section and update routing heuristics:

```
7. **Complex multi-part request** -> use generate_plan first, then start_task for each phase
```

---

### G4.7 Cross-Session Memory

**Problem**: Agents start fresh every session. They forget user preferences, project decisions, and past mistakes.

**Design**:

#### Memory storage layout

```
{workspace}/.aion/memory/
  MEMORY.md                  <- Index file, auto-loaded each session
  feedback_*.md              <- User feedback memories
  project_*.md               <- Project context memories
  reference_*.md             <- External resource references

~/.aion/memory/              <- Global memories (cross-project)
  MEMORY.md
```

#### New file: `src/process/task/dispatch/memoryManager.ts`

```typescript
export type MemoryEntry = {
  id: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  title: string;
  content: string;
  createdAt: number;
};

/**
 * Load MEMORY.md from memory directory hierarchy.
 * Merges: assistant-specific > workspace > global.
 * Returns concatenated content for prompt injection.
 */
export async function loadMemory(
  workspace: string,
  assistantMemoryDir?: string
): Promise<string>;

/**
 * Save a new memory entry. Creates/updates the markdown file and
 * updates MEMORY.md index.
 */
export async function saveMemory(
  workspace: string,
  entry: MemoryEntry
): Promise<void>;

/**
 * List all memory entries from MEMORY.md index.
 */
export async function listMemories(
  workspace: string
): Promise<MemoryEntry[]>;
```

File I/O strategy:
- All file operations happen in the **main process** (via `memoryManager.ts` called from bridge handlers or `DispatchAgentManager`).
- **Race condition prevention**: Use `fs.promises.writeFile` with `{ flag: 'wx' }` for creates, and a simple file-level mutex (per workspace path) for updates. Since dispatch children do not directly write memory (only the admin does via MCP tool), contention is low.
- Temporary teammates never write memory. Only the admin agent and permanent members have memory write access.

#### New MCP tool: `save_memory`

Added to both `DispatchMcpServer.ts` and `dispatchMcpServerScript.ts`:

```typescript
{
  name: 'save_memory',
  description:
    'Save an important piece of information to persistent memory. ' +
    'Memories persist across sessions and are auto-loaded in future conversations. ' +
    'Use for: user preferences, project decisions, feedback, important references.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['user', 'feedback', 'project', 'reference'],
        description: 'Memory category.',
      },
      title: {
        type: 'string',
        description: 'Short title for this memory entry (used in MEMORY.md index).',
      },
      content: {
        type: 'string',
        description: 'The memory content to save.',
      },
    },
    required: ['type', 'title', 'content'],
  },
}
```

#### Modified: `src/process/task/dispatch/DispatchMcpServer.ts`

Add `save_memory` handler and extend `DispatchToolHandler`:

```typescript
export type DispatchToolHandler = {
  // ...existing...
  saveMemory(entry: { type: string; title: string; content: string }): Promise<string>;
};
```

#### Modified: `src/process/task/dispatch/DispatchAgentManager.ts`

1. In `createBootstrap()`, after scanning project context:
   ```typescript
   // G4.7: Load cross-session memory
   const memoryContent = await loadMemory(this.workspace);
   ```
   Pass `memoryContent` to `buildDispatchSystemPrompt()`.

2. Implement `saveMemory` handler:
   ```typescript
   private async handleSaveMemory(entry: { type: string; title: string; content: string }): Promise<string> {
     await saveMemory(this.workspace, {
       id: uuid(8),
       type: entry.type as MemoryEntry['type'],
       title: entry.title,
       content: entry.content,
       createdAt: Date.now(),
     });
     return `Memory saved: "${entry.title}"`;
   }
   ```

#### Modified: `src/process/task/dispatch/dispatchPrompt.ts`

New option `memory?: string` and corresponding prompt section:

```
## Cross-Session Memory
The following memories from previous sessions are available:

{memory}

You can save new memories using the save_memory tool when you learn something
important about the user, project, or workflow.
```

#### Modified: `src/common/types/acpTypes.ts`

```typescript
export interface AcpBackendConfig {
  // ...existing...
  /** G4.7: Custom memory directory for this assistant. If set, memories are
   *  stored here instead of the workspace default. */
  memoryDir?: string;
}
```

---

## 3. Self-Debate: Objections and Responses

### Objection 1: Project context scanning is too slow for bootstrap

**Concern**: Reading multiple files (CLAUDE.md, package.json, README, tsconfig) during `createBootstrap()` adds latency to group chat creation. If the workspace is on a network drive or large monorepo, this could take seconds.

**Response**: The scan is async with a 5-second timeout and returns partial results. Results are cached in `conversation.extra.projectContext` with a 1-hour TTL, so only the first creation pays the cost. Subsequent restarts read from DB. The scan uses `AbortSignal` for cancellation and `fs.promises.readFile` for non-blocking I/O. In the worst case (all files missing), the scan completes in < 50ms. For typical projects with a CLAUDE.md, it reads one file and returns immediately.

### Objection 2: Token reporting is engine-dependent and cannot be unified

**Concern**: Gemini reports `totalTokenCount` per turn. ACP reports context window usage. Codex may not report at all. A "unified cost tracker" is misleading.

**Response**: We accept this limitation explicitly. `SessionCostEntry.totalTokens` uses whatever the engine provides. For engines that do not report tokens (Codex CLI), the field is 0 and the cost panel shows "N/A". The `estimatedCost` field is optional and only populated when we have both a token count and a known model pricing. The UI clearly labels estimates as approximate. This is the same approach Claude Code uses -- they show what data is available without pretending to have perfect accounting.

### Objection 3: `generate_plan` adds a round-trip before task execution, slowing down simple requests

**Concern**: For simple tasks ("translate this file"), forcing a plan generation step is wasteful. The admin should just `start_task` directly.

**Response**: `generate_plan` is NOT mandatory. The prompt heuristic says "Complex multi-part request -> use generate_plan first". Simple tasks still go directly to `start_task`. The tool is advisory -- the admin decides when to use it. Additionally, the plan is returned to the admin (not the user) as structured data. The admin can decide to skip presenting it and just execute. The routing heuristic in the system prompt makes this clear: rule 5 ("Simple question -> answer directly") and rule 6 ("Complex multi-part -> generate_plan then start_task") coexist.

### Objection 4: Memory file I/O from MCP tool handler could cause race conditions

**Concern**: If two group chats share the same workspace, both admins could call `save_memory` concurrently, corrupting the MEMORY.md file.

**Response**: The `memoryManager.ts` uses a per-workspace file mutex (a simple in-memory `Map<string, Promise<void>>` that serializes writes to the same workspace path). Since all memory operations go through the main process (never from worker processes directly), the mutex is effective. For cross-process safety (multiple Electron windows), we use `fs.writeFile` with atomic rename pattern (`write to .tmp` then `rename`). The MEMORY.md index file is append-only (new entries are appended), so even without perfect locking, the worst case is a duplicate entry, not data loss.

### Objection 5: Team config JSON schema is not standardized

**Concern**: Users might have team config files with arbitrary structures. The loader assumes a specific schema (`roles`, `workflow`, `qualityGates`). What if the JSON does not match?

**Response**: The loader is defensive. It uses optional chaining and type guards on every field. If `roles` is missing, the prompt section simply omits role definitions. If the entire file is malformed JSON, `loadTeamConfig` returns `null` and the admin operates without team guidance (graceful degradation). We document the expected schema but do not enforce it. A future improvement could add JSON Schema validation with helpful error messages.

---

## 4. Acceptance Criteria

### G4.1 Workspace Awareness

- [ ] `scanProjectContext(workspace)` returns a non-empty summary when CLAUDE.md exists in workspace
- [ ] Summary includes extracted scripts from `package.json` when present
- [ ] Summary respects `maxChars` budget (default 4000)
- [ ] Scan completes within 5 seconds or returns partial results
- [ ] Scanned context is cached in `conversation.extra.projectContext`
- [ ] `dispatch.rescan-project-context` IPC clears cache and triggers fresh scan
- [ ] Admin system prompt includes `## Project Context` section when context is available
- [ ] Admin system prompt omits section when workspace has no scannable files

### G4.2 Team Config Loading

- [ ] `listAvailableTeamConfigs(workspace)` returns file names from `.claude/teams/`
- [ ] `loadTeamConfig(workspace, name)` parses valid JSON and extracts roles, workflow, quality gates
- [ ] `loadTeamConfig` returns `null` for missing or malformed files (no crash)
- [ ] CreateGroupChatModal shows team config `<Select>` when workspace has `.claude/teams/*.json`
- [ ] Selected team config is stored in `conversation.extra.teamConfig`
- [ ] Admin system prompt includes `## Team Configuration` section when config is loaded
- [ ] Team config prompt section does not exceed 3000 chars

### G4.3 Assistant Config Enrichment

- [ ] `AcpBackendConfig` type includes `defaultModel?: string` and `allowedTools?: string[]`
- [ ] Existing assistant configs with no new fields continue to work (backward compatible)
- [ ] `addMember` IPC handler reads `defaultModel` and `allowedTools` from agent config
- [ ] Settings assistant editor UI allows editing `defaultModel` and `allowedTools`
- [ ] `tsc --noEmit` passes with the new fields added

### G4.4 Cost Tracking

- [ ] `aggregateGroupCost()` reads token data from parent + all child conversations
- [ ] `CostPanel` renders total tokens and per-member breakdown
- [ ] Cost panel shows "N/A" for engines that do not report token usage
- [ ] `dispatch.get-group-cost-summary` IPC returns `GroupCostSummary`
- [ ] Cost panel auto-refreshes every 10 seconds
- [ ] `getModelPricing()` returns reasonable defaults for Gemini and Claude models

### G4.5 Task Progress Cards

- [ ] `parseProgressBlock()` extracts JSON from ` ```progress ` code blocks
- [ ] `parseProgressBlock()` returns `null` for messages without progress blocks
- [ ] `ProgressCard` renders title, overall progress bar, and phase list
- [ ] Phase statuses render with correct icons: done(check), running(spinner), pending(circle), failed(x)
- [ ] Malformed JSON in progress block falls back to plain text rendering (no crash)

### G4.6 generate_plan Tool

- [ ] `generate_plan` tool schema is registered in both `DispatchMcpServer.ts` and `dispatchMcpServerScript.ts`
- [ ] Tool returns structured plan format with phases, dependencies, and effort estimates
- [ ] Admin system prompt mentions `generate_plan` in routing heuristics
- [ ] Tool call does NOT create any child tasks (read-only)
- [ ] Admin can call `start_task` with or without calling `generate_plan` first

### G4.7 Cross-Session Memory

- [ ] `loadMemory(workspace)` reads MEMORY.md from `{workspace}/.aion/memory/`
- [ ] `loadMemory` merges memories from assistant-specific > workspace > global directories
- [ ] `saveMemory()` creates memory file and updates MEMORY.md index
- [ ] `save_memory` MCP tool is registered and callable by the admin agent
- [ ] Memory content is injected into admin system prompt on bootstrap
- [ ] Temporary teammates cannot call `save_memory` (tool not available to children)
- [ ] Concurrent `saveMemory` calls to the same workspace do not corrupt files
- [ ] `AcpBackendConfig.memoryDir` field is recognized and used when set
- [ ] Memory directory is created automatically if it does not exist

### Cross-Cutting

- [ ] `bunx tsc --noEmit` passes with all changes
- [ ] `bun run lint:fix` produces no new warnings
- [ ] `bun run test` passes (existing tests not broken)
- [ ] No new `any` types introduced
- [ ] All new files use path aliases (`@process/*`, `@renderer/*`, `@/*`)
- [ ] All new IPC channels follow existing naming convention (`dispatch.*`)
- [ ] No directory exceeds 10 direct children
- [ ] New components use `@arco-design/web-react` (no raw HTML interactive elements)
- [ ] New CSS uses UnoCSS utility classes or CSS Modules with semantic tokens

---

## 5. Implementation Order (Dependency Graph)

```
G4.1 Workspace Awareness ─────┐
                               ├──→ G4.7 Cross-Session Memory
G4.2 Team Config Loading ──────┤     (depends on G4.1 for workspace scanning pattern)
                               │
G4.3 Assistant Config ─────────┤──→ (independent, can start anytime)
                               │
G4.4 Cost Tracking ────────────┤──→ (independent, can start anytime)
                               │
G4.5 Progress Cards ───────────┤──→ (independent, renderer-only)
                               │
G4.6 generate_plan Tool ───────┘──→ (depends on G4.2 for team config context)
```

**Recommended execution order**:

1. **Phase 1** (parallel):
   - G4.1 Workspace Awareness -- foundational context injection
   - G4.3 Assistant Config Enrichment -- type changes, no runtime dependency
   - G4.5 Progress Cards -- renderer-only, fully independent

2. **Phase 2** (parallel, after Phase 1):
   - G4.2 Team Config Loading -- uses same scanning pattern as G4.1
   - G4.4 Cost Tracking -- independent but benefits from testing G4.1 patterns

3. **Phase 3** (after Phase 2):
   - G4.6 generate_plan Tool -- benefits from team config context (G4.2)
   - G4.7 Cross-Session Memory -- uses workspace scanning (G4.1), memory dir from config (G4.3)

---

## 6. File Change Summary

| File | Sub-features | Change Type |
|------|-------------|-------------|
| `src/process/task/dispatch/projectContextScanner.ts` | G4.1 | **New** |
| `src/process/task/dispatch/teamConfigLoader.ts` | G4.2 | **New** |
| `src/process/task/dispatch/costTracker.ts` | G4.4 | **New** |
| `src/process/task/dispatch/memoryManager.ts` | G4.7 | **New** |
| `src/process/task/dispatch/dispatchPrompt.ts` | G4.1, G4.2, G4.5, G4.6, G4.7 | Modified |
| `src/process/task/dispatch/DispatchAgentManager.ts` | G4.1, G4.2, G4.7 | Modified |
| `src/process/task/dispatch/DispatchMcpServer.ts` | G4.6, G4.7 | Modified |
| `src/process/task/dispatch/dispatchMcpServerScript.ts` | G4.6, G4.7 | Modified |
| `src/process/bridge/dispatchBridge.ts` | G4.1, G4.2, G4.4 | Modified |
| `src/common/adapter/ipcBridge.ts` | G4.1, G4.2, G4.4 | Modified |
| `src/common/types/acpTypes.ts` | G4.3, G4.7 | Modified |
| `src/renderer/pages/conversation/dispatch/CreateGroupChatModal.tsx` | G4.2 | Modified |
| `src/renderer/pages/conversation/dispatch/components/CostPanel.tsx` | G4.4 | **New** |
| `src/renderer/pages/conversation/dispatch/components/ProgressCard.tsx` | G4.5 | **New** |
| `src/renderer/pages/conversation/dispatch/GroupChatTimeline.tsx` | G4.5 | Modified |
| `src/renderer/pages/conversation/dispatch/GroupChatView.tsx` | G4.4 | Modified |
| `src/process/task/BaseAgentManager.ts` | G4.4 | Modified |

**New files**: 6
**Modified files**: 11
**Total files touched**: 17

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Project context scan too slow on network drives | Low | Med | 5s timeout + partial results + caching |
| Team config JSON schema mismatch | Med | Low | Defensive parsing, graceful degradation |
| Token data inconsistent across engines | High | Low | Show what is available, mark estimates |
| Memory file corruption from concurrent writes | Low | Med | File mutex + atomic rename |
| `generate_plan` ignored by admin agent | Med | Low | Prompt heuristic encourages usage, not mandatory |
| Progress card JSON format not followed by LLM | Med | Low | Fallback to plain text rendering |
