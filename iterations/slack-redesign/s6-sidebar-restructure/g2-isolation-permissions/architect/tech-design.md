# G2: Isolation + Permissions + Core Tool Completion - Tech Design

**Date**: 2026-03-30
**Status**: Design
**Depends on**: G1 Engine Unbind (complete)
**Scope**: Backend logic only (no UI changes; UI is G3)

---

## Overview

G2 enables parallel agents to safely work on the same project. Four sub-tasks:

| Sub-task | Summary |
|----------|---------|
| G2.1 | Git Worktree isolation for parallel file editing |
| G2.2 | Permission policy with tool classification and soft enforcement |
| G2.3 | `stop_child` MCP tool for admin to terminate stuck tasks |
| G2.4 | `ask_user` MCP tool for child agents to escalate questions |

---

## G2.1 Git Worktree Isolation

### New File: `src/process/task/dispatch/worktreeManager.ts`

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const execAsync = promisify(exec);

type WorktreeInfo = {
  worktreePath: string;
  branchName: string;
  sessionId: string;
  createdAt: number;
};

type MergeResult = {
  success: boolean;
  branchName: string;
  conflictFiles?: string[];
  error?: string;
};

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: dirPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git worktree for a child session.
 * Branch name: aion-wt-{sessionId-prefix}
 * Location: {mainWorkspace}/.aion-worktrees/{branchName}/
 *
 * Returns WorktreeInfo or throws if the workspace is not a git repo.
 */
export async function createWorktree(
  mainWorkspace: string,
  sessionId: string,
): Promise<WorktreeInfo> {
  if (!(await isGitRepo(mainWorkspace))) {
    throw new Error(
      `Cannot create worktree: "${mainWorkspace}" is not a git repository. ` +
      'Worktree isolation requires a git repo. The child will use the shared workspace instead.',
    );
  }

  const branchName = `aion-wt-${sessionId.slice(0, 8)}`;
  const worktreeDir = path.join(mainWorkspace, '.aion-worktrees');
  const worktreePath = path.join(worktreeDir, branchName);

  // Ensure parent dir exists
  await fs.promises.mkdir(worktreeDir, { recursive: true });

  // Get current branch/HEAD to base from
  const { stdout: headRef } = await execAsync('git rev-parse HEAD', { cwd: mainWorkspace });
  const baseCommit = headRef.trim();

  // Create worktree with new branch from current HEAD
  await execAsync(
    `git worktree add "${worktreePath}" -b "${branchName}" ${baseCommit}`,
    { cwd: mainWorkspace },
  );

  return {
    worktreePath,
    branchName,
    sessionId,
    createdAt: Date.now(),
  };
}

/**
 * Merge a worktree branch back into the current branch of the main workspace.
 * Does NOT delete the worktree (call cleanupWorktree separately).
 */
export async function mergeWorktree(
  mainWorkspace: string,
  branchName: string,
): Promise<MergeResult> {
  try {
    await execAsync(`git merge "${branchName}" --no-edit`, { cwd: mainWorkspace });
    return { success: true, branchName };
  } catch (err) {
    // Check for merge conflicts
    try {
      const { stdout } = await execAsync('git diff --name-only --diff-filter=U', {
        cwd: mainWorkspace,
      });
      const conflictFiles = stdout.trim().split('\n').filter(Boolean);
      // Abort the failed merge
      await execAsync('git merge --abort', { cwd: mainWorkspace });
      return {
        success: false,
        branchName,
        conflictFiles,
        error: `Merge conflict in ${conflictFiles.length} file(s). Merge aborted.`,
      };
    } catch {
      return {
        success: false,
        branchName,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Remove a worktree and delete its branch.
 * Safe to call even if already removed.
 */
export async function cleanupWorktree(
  mainWorkspace: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  try {
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: mainWorkspace,
    });
  } catch {
    // Already removed or path invalid; not an error
  }

  try {
    await execAsync(`git branch -D "${branchName}"`, { cwd: mainWorkspace });
  } catch {
    // Branch already deleted; not an error
  }
}
```

### Modified Files

**`dispatchTypes.ts`** -- extend `ChildTaskInfo` and `StartChildTaskParams`:

```typescript
// Add to ChildTaskInfo:
export type ChildTaskInfo = {
  // ...existing fields
  /** Worktree path if isolation='worktree' was used */
  worktreePath?: string;
  /** Worktree branch name for merge/cleanup */
  worktreeBranch?: string;
};
```

**`DispatchAgentManager.ts`** -- `startChildSession()`:

Replace the G1 stub warning with actual worktree creation:

```typescript
// In startChildSession(), replace the G1 isolation warning block:

let childWorkspace = /* ...existing workspace resolution... */;
let worktreePath: string | undefined;
let worktreeBranch: string | undefined;

if (params.isolation === 'worktree') {
  try {
    const wtInfo = await createWorktree(childWorkspace, childId);
    childWorkspace = wtInfo.worktreePath;  // child works in the worktree
    worktreePath = wtInfo.worktreePath;
    worktreeBranch = wtInfo.branchName;
    mainLog('[DispatchAgentManager]', `Created worktree: ${wtInfo.worktreePath}`);
  } catch (err) {
    // Graceful degradation: not a git repo or git error
    mainWarn('[DispatchAgentManager]', `Worktree creation failed, using shared workspace`, err);
  }
}

// Store worktree info in child conversation extra:
const childConversation = {
  // ...existing fields
  extra: {
    // ...existing extra fields
    worktreePath,
    worktreeBranch,
  },
};

// Store in tracker:
const childInfo: ChildTaskInfo = {
  // ...existing fields
  worktreePath,
  worktreeBranch,
};
```

**`DispatchResourceGuard.ts`** -- `cascadeKill()`:

```typescript
// Import worktree cleanup
import { cleanupWorktree } from './worktreeManager';

// In cascadeKill(), after killing each child:
async cascadeKill(parentId: string, parentWorkspace?: string): Promise<void> {
  const children = this.tracker.getChildren(parentId);
  for (const child of children) {
    mainLog('[DispatchResourceGuard]', `Cascade killing child: ${child.sessionId}`);
    this.taskManager.kill(child.sessionId);

    // Cleanup worktree if present
    if (child.worktreePath && child.worktreeBranch && parentWorkspace) {
      try {
        await cleanupWorktree(parentWorkspace, child.worktreePath, child.worktreeBranch);
        mainLog('[DispatchResourceGuard]', `Cleaned up worktree: ${child.worktreePath}`);
      } catch (err) {
        mainWarn('[DispatchResourceGuard]', `Failed to cleanup worktree: ${child.worktreePath}`, err);
      }
    }
  }
  this.tracker.removeParent(parentId);
  this.taskManager.kill(parentId);
}
```

### Worktree Lifecycle

```
start_task(isolation='worktree')
  |
  v
isGitRepo(workspace)?
  |-- NO --> graceful degradation, use shared workspace
  |-- YES --> git worktree add .aion-worktrees/aion-wt-{id} -b aion-wt-{id}
                |
                v
            child works in worktree path
                |
                v
            task completes
                |
                v
            admin reads transcript
                |
                v
            admin decides to merge? --> mergeWorktree(mainWorkspace, branch)
                |                           |-- success --> cleanupWorktree()
                |                           |-- conflict --> notify admin, abort merge
                v
            cascadeKill / stop_child --> cleanupWorktree()
```

### `.gitignore` Consideration

The `.aion-worktrees/` directory should be added to the project's `.gitignore`. The `createWorktree` function should check for this and add it if missing (or document it as a recommendation).

---

## G2.2 Permission Policy

### New File: `src/process/task/dispatch/permissionPolicy.ts`

```typescript
type ToolPermissionLevel = 'safe' | 'normal' | 'dangerous';

type PermissionCheckResult = {
  level: ToolPermissionLevel;
  allowed: boolean;
  /** If not allowed, the reason */
  reason?: string;
  /** If dangerous, requires user approval */
  requiresApproval?: boolean;
};

type PermissionViolation = {
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  level: ToolPermissionLevel;
  timestamp: number;
  action: 'logged' | 'notified_admin';
};

/**
 * Tool classification: which built-in tools are safe, normal, or dangerous.
 */
const TOOL_CLASSIFICATION: Record<string, ToolPermissionLevel> = {
  Read: 'safe',
  Grep: 'safe',
  Glob: 'safe',
  Bash: 'dangerous', // further classified by command content
  Edit: 'normal',
  Write: 'normal',
  NotebookEdit: 'normal',
};

/**
 * Dangerous bash command patterns.
 * These always require user approval regardless of allowedTools.
 */
const DANGEROUS_BASH_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\b/, description: 'recursive delete' },
  { pattern: /\bgit\s+push\b/, description: 'git push' },
  { pattern: /\bgit\s+push\s+--force\b/, description: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard\b/, description: 'hard reset' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f\b/, description: 'git clean' },
  { pattern: /\bcurl\b.*\|\s*(bash|sh)\b/, description: 'pipe to shell' },
  { pattern: /\bsudo\b/, description: 'sudo command' },
  { pattern: /\bchmod\s+777\b/, description: 'world-writable permissions' },
  { pattern: /\bnpm\s+publish\b/, description: 'npm publish' },
  { pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/, description: 'docker destructive' },
];

/**
 * Safe bash command patterns.
 * These are reclassified from 'dangerous' to 'safe' for Bash tool calls.
 */
const SAFE_BASH_PATTERNS: RegExp[] = [
  /^\s*(ls|pwd|cat|head|tail|wc|echo|date|which|type|file)\b/,
  /^\s*git\s+(status|log|diff|show|branch|tag)\b/,
  /^\s*(bun|npm|npx|bunx)\s+(run|test|exec)\b/,
  /^\s*tsc\s+--noEmit\b/,
];

/**
 * Classify a tool call by permission level.
 */
export function classifyToolCall(
  toolName: string,
  args: Record<string, unknown>,
): ToolPermissionLevel {
  const baseLevel = TOOL_CLASSIFICATION[toolName] ?? 'normal';

  if (toolName === 'Bash') {
    const cmd = String(args.command ?? '');

    // Check dangerous patterns first
    for (const { pattern } of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(cmd)) return 'dangerous';
    }

    // Check safe patterns
    for (const safePattern of SAFE_BASH_PATTERNS) {
      if (safePattern.test(cmd)) return 'safe';
    }

    return 'normal'; // default bash commands are normal, not dangerous
  }

  return baseLevel;
}

/**
 * Check whether a tool call is permitted for a given child session.
 *
 * This is SOFT ENFORCEMENT:
 * - safe tools: always allowed
 * - normal tools: allowed if in allowedTools list (or if allowedTools is not set)
 * - dangerous tools: logged + admin notified, NOT hard-blocked
 *
 * Returns the check result with violation info if applicable.
 */
export function checkPermission(
  toolName: string,
  args: Record<string, unknown>,
  allowedTools: string[] | undefined,
): PermissionCheckResult {
  const level = classifyToolCall(toolName, args);

  // Safe tools always pass
  if (level === 'safe') {
    return { level, allowed: true };
  }

  // If no allowedTools configured, soft-allow everything (backward compat)
  if (!allowedTools || allowedTools.length === 0) {
    if (level === 'dangerous') {
      return { level, allowed: true, requiresApproval: true };
    }
    return { level, allowed: true };
  }

  // Normal tools: check allowedTools list
  if (level === 'normal') {
    const isInList = allowedTools.includes(toolName);
    if (!isInList) {
      return {
        level,
        allowed: false,
        reason: `Tool "${toolName}" is not in the allowed tools list for this session.`,
      };
    }
    return { level, allowed: true };
  }

  // Dangerous tools: always flag for approval
  return {
    level,
    allowed: true, // soft enforcement: don't block, but flag
    requiresApproval: true,
  };
}

/**
 * Get the description of why a bash command is classified as dangerous.
 */
export function getDangerousDescription(command: string): string | undefined {
  for (const { pattern, description } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) return description;
  }
  return undefined;
}
```

### Integration Point: `DispatchAgentManager.ts`

The permission check is a **monitoring layer**, not a blocking interceptor. G2 does not intercept the actual tool call execution in the child worker (that would require modifying the agent worker internals, which is out of scope). Instead:

1. **`start_task` stores `allowedTools`** in child conversation extra.
2. **Child worker reports tool calls** back via the existing message stream.
3. **`DispatchAgentManager.init()` listener** checks reported tool calls against the policy.
4. **Violations are logged and the admin is notified** via `DispatchNotifier`.

```typescript
// In DispatchAgentManager, add to startChildSession():
// Store allowedTools in child conversation extra
const childConversation = {
  // ...existing
  extra: {
    // ...existing
    allowedTools: params.allowedTools,
  },
};
```

```typescript
// New method in DispatchAgentManager:
/**
 * Monitor child tool calls for permission violations.
 * Called when child task reports a tool_call event.
 * SOFT enforcement: log + notify admin, do not block.
 */
private handleChildToolCallReport(
  childId: string,
  toolName: string,
  args: Record<string, unknown>,
): void {
  const childInfo = this.tracker.getChildInfo(childId);
  if (!childInfo) return;

  // Retrieve allowedTools from child conversation extra (cached or from tracker)
  const allowedTools = childInfo.allowedTools;
  const result = checkPermission(toolName, args, allowedTools);

  if (!result.allowed) {
    mainWarn('[DispatchAgentManager]',
      `Permission violation: child=${childId} tool=${toolName} reason=${result.reason}`);
    // Notify admin via DispatchNotifier
    void this.notifier.handleChildCompletion(childId, 'completed');
    // Note: In practice, we'd add a new notification type for violations.
    // For now, log it.
  }

  if (result.requiresApproval) {
    mainWarn('[DispatchAgentManager]',
      `Dangerous tool call: child=${childId} tool=${toolName} -- requires user approval`);
    // Emit a group chat event for the admin to relay to user
    this.emitGroupChatEvent({
      sourceSessionId: childId,
      sourceRole: 'child',
      displayName: childInfo.teammateName ?? 'Agent',
      content: `Dangerous operation detected: ${toolName}(${JSON.stringify(args).slice(0, 200)})`,
      messageType: 'system',
      timestamp: Date.now(),
      childTaskId: childId,
    });
  }
}
```

### Modified `dispatchTypes.ts`

```typescript
// Add to StartChildTaskParams:
export type StartChildTaskParams = {
  // ...existing fields
  /** Tool allowlist for permission policy. Omit = all tools allowed. */
  allowedTools?: string[];
};

// Add to ChildTaskInfo:
export type ChildTaskInfo = {
  // ...existing fields
  /** Allowed tools for this child (permission policy) */
  allowedTools?: string[];
};
```

### Modified MCP Tool Schema (`start_task`)

Add `allowed_tools` property to both `DispatchMcpServer.getToolSchemas()` and `dispatchMcpServerScript.ts`:

```typescript
// In start_task inputSchema.properties:
allowed_tools: {
  type: 'array',
  items: { type: 'string' },
  description:
    'Optional allowlist of tool names this child can use (e.g., ["Read", "Edit", "Bash"]). ' +
    'Omit to allow all tools. Safe tools (Read, Grep, Glob) are always allowed.',
},
```

### Permission Data Flow

```
Admin calls start_task(allowedTools: ['Read', 'Edit', 'Bash'])
  |
  v
DispatchAgentManager.startChildSession()
  --> stores allowedTools in ChildTaskInfo + conversation.extra
  |
  v
Child worker executes tool calls normally (no blocking)
  |
  v
Child worker reports tool_call events via message stream
  |
  v
DispatchAgentManager monitors via handleChildToolCallReport()
  |
  v
classifyToolCall() + checkPermission()
  |-- safe --> pass silently
  |-- normal, in list --> pass silently
  |-- normal, NOT in list --> log violation, notify admin
  |-- dangerous --> log, emit group chat event for user awareness
```

---

## G2.3 `stop_child` Tool

### MCP Tool Schema

Added to both `DispatchMcpServer.getToolSchemas()` and `dispatchMcpServerScript.ts`:

```typescript
{
  name: 'stop_child',
  description:
    'Stop a running child task and clean up its resources (including worktree if any). ' +
    'The child process is killed immediately. Use read_transcript to see partial results.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: 'The session_id of the child task to stop.',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for stopping (logged and included in notification).',
      },
    },
    required: ['session_id'],
  },
}
```

### Implementation

**`DispatchMcpServer.ts`** -- add case in `handleToolCall()`:

```typescript
case 'stop_child': {
  const sessionId = String(args.session_id ?? '');
  const reason = typeof args.reason === 'string' ? args.reason : undefined;

  if (!sessionId) {
    return { content: 'session_id is required', isError: true };
  }

  try {
    const result = await this.handler.stopChild(sessionId, reason);
    return {
      session_id: sessionId,
      message: result,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { content: `Failed to stop child: ${errMsg}`, isError: true };
  }
}
```

**`DispatchToolHandler`** -- add method:

```typescript
export type DispatchToolHandler = {
  // ...existing methods
  stopChild(sessionId: string, reason?: string): Promise<string>;
};
```

**`DispatchAgentManager.ts`** -- implement `stopChild()`:

```typescript
/**
 * G2.3: Stop a running child task.
 * Kills the worker, cleans up worktree if present, updates tracker.
 */
private async stopChild(sessionId: string, reason?: string): Promise<string> {
  if (!this.taskManager) throw new Error('Dependencies not set');

  const childInfo = this.tracker.getChildInfo(sessionId);
  if (!childInfo) {
    throw new Error(`Session "${sessionId}" not found. Use list_sessions to see available sessions.`);
  }

  if (childInfo.status === 'cancelled' || childInfo.status === 'finished') {
    return `Session "${childInfo.title}" is already ${childInfo.status}.`;
  }

  const displayName = childInfo.teammateName ?? 'Agent';

  // 1. Kill worker
  this.taskManager.kill(sessionId);

  // 2. Cleanup worktree if present
  if (childInfo.worktreePath && childInfo.worktreeBranch) {
    try {
      await cleanupWorktree(this.workspace, childInfo.worktreePath, childInfo.worktreeBranch);
      mainLog('[DispatchAgentManager]', `Cleaned up worktree for stopped child: ${sessionId}`);
    } catch (err) {
      mainWarn('[DispatchAgentManager]', `Failed to cleanup worktree on stop: ${sessionId}`, err);
    }
  }

  // 3. Update tracker
  this.tracker.updateChildStatus(sessionId, 'cancelled');

  // 4. Emit UI event
  this.emitGroupChatEvent({
    sourceSessionId: sessionId,
    sourceRole: 'child',
    displayName,
    content: reason ? `Stopped: ${reason}` : 'Stopped by admin',
    messageType: 'task_cancelled',
    timestamp: Date.now(),
    childTaskId: sessionId,
  });

  const reasonSuffix = reason ? ` Reason: ${reason}` : '';
  return `Stopped "${childInfo.title}" (${sessionId}).${reasonSuffix} Use read_transcript to see partial results.`;
}
```

Wire it in the constructor's `toolHandler`:

```typescript
const toolHandler: DispatchToolHandler = {
  // ...existing handlers
  stopChild: this.stopChild.bind(this),
};
```

### Difference from existing `cancelChild()`

The existing `cancelChild()` is triggered by the **user** via `dispatchBridge` (UI cancel button). The new `stopChild()` is triggered by the **admin agent** via MCP tool call. They share similar logic but have different callers. To avoid duplication, refactor the core logic into a shared private method `_terminateChild()` that both call.

---

## G2.4 `ask_user` Tool

### MCP Tool Schema

```typescript
{
  name: 'ask_user',
  description:
    'Ask the user a question when you cannot make a decision autonomously. ' +
    'The question is relayed to the group chat via the admin. ' +
    'Returns the user response when available, or a timeout message. ' +
    'Use sparingly -- only for critical decisions that require human judgment.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user. Be specific and provide context.',
      },
      context: {
        type: 'string',
        description: 'Optional additional context about why you need this answer.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of suggested answers for the user to choose from.',
      },
    },
    required: ['question'],
  },
}
```

### Implementation Flow

`ask_user` is a **child agent tool**, not an admin tool. It's available to child sessions via the dispatch MCP server. The flow:

```
Child agent calls ask_user(question: "Should I use CSS modules or UnoCSS?")
  |
  v
dispatchMcpServerScript forwards to main process via IPC
  |
  v
DispatchMcpServer.handleToolCall('ask_user')
  |
  v
DispatchAgentManager.handleAskUser(childId, question)
  |
  v
DispatchNotifier emits notification to admin session:
  "[Child: Developer] asks: Should I use CSS modules or UnoCSS?"
  |
  v
Admin relays to group chat (admin's natural response behavior)
  |
  v
User answers in group chat
  |
  v
Admin calls send_message(childId, userAnswer)
  |
  v
Child receives answer and continues
```

**Key design decision**: `ask_user` does NOT block waiting for a user response synchronously. Instead:

1. It sends the question as a notification to the admin.
2. It returns immediately with: `"Question submitted to admin. Continue with your best judgment, or wait for a response via send_message."`
3. The admin/user can answer asynchronously via `send_message`.

This avoids deadlock (child waiting for user, user not online) and keeps the system non-blocking.

### Implementation in `DispatchMcpServer.ts`

```typescript
case 'ask_user': {
  const question = String(args.question ?? '');
  const context = typeof args.context === 'string' ? args.context : undefined;
  const options = Array.isArray(args.options)
    ? args.options.map(String)
    : undefined;

  if (!question) {
    return { content: 'question is required', isError: true };
  }

  try {
    const result = await this.handler.askUser({
      question,
      context,
      options,
    });
    return { message: result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { content: `Failed to ask user: ${errMsg}`, isError: true };
  }
}
```

### Implementation in `DispatchAgentManager.ts`

```typescript
/**
 * G2.4: Handle ask_user from a child agent.
 * Relays the question to the admin via DispatchNotifier.
 * Non-blocking: returns immediately, admin answers asynchronously.
 */
private async handleAskUser(params: {
  question: string;
  context?: string;
  options?: string[];
}): Promise<string> {
  // Find which child session is asking (from MCP server context)
  // Note: The MCP server runs per-dispatcher, and tool_call forwarding
  // includes the child session context. We need to thread the childId through.

  // Emit as a group chat event for admin awareness
  const optionsText = params.options
    ? `\nSuggested answers: ${params.options.join(', ')}`
    : '';
  const contextText = params.context ? `\nContext: ${params.context}` : '';

  this.emitGroupChatEvent({
    sourceSessionId: this.conversation_id,
    sourceRole: 'child',
    displayName: 'Child Agent',
    content: `Question for user: ${params.question}${contextText}${optionsText}`,
    messageType: 'system',
    timestamp: Date.now(),
  });

  // Inject as notification to admin
  if (this.notifier) {
    const notification: PendingNotification = {
      childSessionId: `ask_user_${Date.now()}`,
      childTitle: 'User Question',
      result: 'completed',
      message: `[Child Agent asks]: ${params.question}${contextText}${optionsText}\nPlease relay this to the user and send the answer back via send_message.`,
      timestamp: Date.now(),
    };
    // Use hot notification path if admin is running
    const parentTask = this.taskManager?.getTask(this.conversation_id);
    if (parentTask?.status === 'running') {
      await parentTask.sendMessage({
        input: `[System Notification] ${notification.message}`,
        msg_id: uuid(),
        isSystemNotification: true,
      });
    }
    // If admin is cold, queue it
  }

  return (
    'Question submitted to admin for user relay. ' +
    'Continue with your best judgment. ' +
    'If the user responds, it will arrive via a follow-up message.'
  );
}
```

### `ask_user` for child sessions specifically

Since the MCP server is attached to the **admin** session (not child sessions), `ask_user` is actually available to the admin. For child sessions to use it, we need either:

**Option A**: Add `ask_user` to the child's available MCP tools by giving each child its own dispatch MCP server instance. This is complex.

**Option B** (chosen): The admin instructs children to "report back if you have questions" in the task prompt. When a child finishes with a question, the admin picks it up from `read_transcript` and relays. This requires no new MCP plumbing for children.

**Option B+** (hybrid, recommended for G2): Add `ask_user` as an admin-only tool that the admin can use proactively. The admin reads a child's transcript, sees a question, and calls `ask_user` to relay it to the group chat. This keeps the MCP architecture simple while providing the escalation path.

For true child-level `ask_user`, defer to a future iteration where children have their own MCP server instance.

### Updated `DispatchToolHandler` type

```typescript
export type DispatchToolHandler = {
  parentSessionId: string;
  startChildSession(params: StartChildTaskParams): Promise<string>;
  readTranscript(options: ReadTranscriptOptions): Promise<TranscriptResult>;
  listChildren(): Promise<ChildTaskInfo[]>;
  sendMessageToChild(params: SendMessageToChildParams): Promise<string>;
  listSessions(params: ListSessionsParams): Promise<string>;
  // G2 additions:
  stopChild(sessionId: string, reason?: string): Promise<string>;
  askUser(params: { question: string; context?: string; options?: string[] }): Promise<string>;
};
```

---

## File Change Summary

### New Files

| File | Purpose |
|------|---------|
| `src/process/task/dispatch/worktreeManager.ts` | Git worktree create/merge/cleanup operations |
| `src/process/task/dispatch/permissionPolicy.ts` | Tool classification + permission checking (soft enforcement) |

### Modified Files

| File | Changes |
|------|---------|
| `src/process/task/dispatch/dispatchTypes.ts` | Add `worktreePath`, `worktreeBranch`, `allowedTools` to `ChildTaskInfo`; add `allowedTools` to `StartChildTaskParams` |
| `src/process/task/dispatch/DispatchAgentManager.ts` | Implement worktree creation in `startChildSession()`; add `stopChild()`; add `handleAskUser()`; add `handleChildToolCallReport()`; wire new tools in constructor; refactor `cancelChild()` to share logic with `stopChild()` |
| `src/process/task/dispatch/DispatchMcpServer.ts` | Add `stop_child` and `ask_user` cases in `handleToolCall()`; update `DispatchToolHandler` type; add schemas to `getToolSchemas()` |
| `src/process/task/dispatch/dispatchMcpServerScript.ts` | Add `stop_child` and `ask_user` to `TOOL_SCHEMAS` array |
| `src/process/task/dispatch/DispatchResourceGuard.ts` | Make `cascadeKill()` async; add worktree cleanup during cascade kill |
| `src/process/task/dispatch/DispatchNotifier.ts` | Add `ask_user` notification type support; add new `PendingNotification.result` value `'ask_user'` |

---

## Self-Debate

### Objection 1: Soft enforcement is useless -- if you don't block, why bother?

**Argument**: Permission policy as soft enforcement (log + notify) without actually blocking tool calls is security theater. A runaway child agent will happily `rm -rf /` while the admin gets a notification 2 seconds later.

**Response**: Hard blocking requires intercepting tool calls inside the child worker process, which means modifying `BaseAgentManager` or the worker's tool execution pipeline. This is a deep, cross-cutting change that affects ALL agent types (gemini, acp, codex), not just dispatch children. The risk of regression is high and the change scope expands beyond G2.

Soft enforcement is the right **first step** because:
1. It establishes the classification infrastructure and data model.
2. In practice, children run with `yoloMode: true` anyway -- there is NO existing approval flow for child tool calls.
3. The admin is instructed (via system prompt) to set appropriate `allowedTools` per role, and the LLM generally respects its constraints.
4. Hard blocking can be added as a follow-up (G4) by adding a tool-call hook in the worker pipeline.
5. The notification gives the admin actionable information to `stop_child` before damage compounds.

### Objection 2: `ask_user` as admin-only tool defeats the purpose

**Argument**: The whole point of `ask_user` is for child agents to escalate. Making it admin-only means the child can't actually call it -- the admin has to notice the question in `read_transcript` and manually relay it. This adds latency and depends on the admin being attentive.

**Response**: True, this is a compromise. The ideal solution is giving each child its own MCP server instance with `ask_user`, but that requires:
1. Spawning an additional MCP server process per child (resource cost).
2. Modifying the child agent startup to include dispatch MCP tools alongside its own tools.
3. Handling the routing of `ask_user` from child MCP server back to the parent's notification system.

This is architecturally feasible but doubles the scope of G2.4. The chosen approach (admin-only `ask_user` + admin prompt instruction to monitor children) works for the common case:
- Admin polls children via `read_transcript` on completion notifications.
- If a child is stuck, it finishes with "I need clarification on X" in its output.
- Admin sees this and uses `ask_user` to relay.

For truly interactive child escalation, we can add per-child MCP in G4 once the infrastructure is proven.

### Objection 3: Worktree merge conflicts will cause chaos

**Argument**: When multiple children modify overlapping files in separate worktrees, `mergeWorktree()` will fail with conflicts. The admin agent cannot resolve git merge conflicts -- it's an LLM, not a developer. This will leave the workspace in a broken state.

**Response**: The design explicitly handles this:
1. `mergeWorktree()` runs `--abort` on conflict and returns a `MergeResult` with `conflictFiles`.
2. The admin sees which files conflict and can make informed decisions:
   - Ask one child to rebase on the other's changes.
   - Manually merge by starting a new "merge resolver" child task.
   - Skip the merge and keep changes in the worktree branch for manual review.
3. The merge is NOT automatic -- the admin explicitly decides when/whether to merge.
4. `cleanupWorktree()` is always safe -- it removes the worktree and branch without merging.

The worst case is "changes stay in a branch that needs manual merging," which is exactly how human developers handle parallel work. The key improvement is that parallel work is POSSIBLE at all, versus the current state where two children writing to the same workspace create race conditions with no recovery path.

---

## Acceptance Criteria

### G2.1 Git Worktree Isolation

- [ ] `start_task` with `isolation: 'worktree'` creates a git worktree under `{workspace}/.aion-worktrees/`
- [ ] Child agent's working directory is set to the worktree path (not the main workspace)
- [ ] Child conversation `extra.worktreePath` stores the worktree path (for future UI use)
- [ ] `cascadeKill` cleans up all worktrees associated with killed children
- [ ] Non-git-repo workspace gracefully degrades: child uses shared workspace, warning logged
- [ ] `mergeWorktree()` succeeds for non-conflicting changes
- [ ] `mergeWorktree()` aborts and reports conflict files when merge fails
- [ ] `cleanupWorktree()` is idempotent (safe to call on already-removed worktrees)

### G2.2 Permission Policy

- [ ] `permissionPolicy.ts` correctly classifies: Read/Grep/Glob as safe; Edit/Write as normal; Bash(rm -rf) as dangerous
- [ ] `start_task` accepts `allowed_tools` parameter in MCP schema
- [ ] `allowedTools` is stored in child's `ChildTaskInfo` and conversation `extra`
- [ ] Dangerous tool calls emit a group chat event visible in the admin session
- [ ] Permission violations are logged via `mainWarn` with session ID and tool name
- [ ] No tool calls are hard-blocked (soft enforcement only)
- [ ] When `allowedTools` is omitted, all tools are permitted (backward compatibility)

### G2.3 `stop_child` Tool

- [ ] `stop_child` MCP tool is available to the admin agent
- [ ] Calling `stop_child(session_id)` kills the child worker process
- [ ] If the stopped child had a worktree, the worktree is cleaned up
- [ ] Child status transitions to `'cancelled'` in the tracker
- [ ] A `task_cancelled` group chat event is emitted
- [ ] Stopping an already-cancelled/finished session returns a message (not an error)
- [ ] `stop_child` schema appears in both `DispatchMcpServer.getToolSchemas()` and `dispatchMcpServerScript.ts`

### G2.4 `ask_user` Tool

- [ ] `ask_user` MCP tool is available to the admin agent
- [ ] Calling `ask_user(question)` emits a `system` group chat event with the question
- [ ] If admin is running (hot), question is injected as a system notification
- [ ] `ask_user` returns immediately (non-blocking) with instructions to continue
- [ ] Optional `options` array is included in the notification text
- [ ] `ask_user` schema appears in both `DispatchMcpServer.getToolSchemas()` and `dispatchMcpServerScript.ts`

### Cross-cutting

- [ ] `bun run format` passes with 0 errors
- [ ] `bun run lint:fix` passes with 0 new errors (pre-existing warnings acceptable)
- [ ] `bunx tsc --noEmit` introduces 0 new type errors
- [ ] All new files follow project conventions: license header, path aliases, no `any`, JSDoc on public functions
- [ ] Existing dispatch tests (if any) still pass
- [ ] No UI/renderer changes (G2 is backend-only)

[DONE]
