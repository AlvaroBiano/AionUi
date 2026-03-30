# G2 Isolation + Permissions — Test Plan

**Date**: 2026-03-30
**Evaluator role**: test_writing
**Covers**: G2.1 worktreeManager · G2.2 permissionPolicy · G2.3 stop_child · G2.4 ask_user

---

## Test Files Written

| File | Sub-system | Cases |
|------|-----------|-------|
| `tests/unit/process/task/dispatch/worktreeManager.test.ts` | G2.1 Git Worktree | 19 |
| `tests/unit/process/task/dispatch/permissionPolicy.test.ts` | G2.2 Permission Policy | 34 |
| `tests/unit/process/task/dispatch/stopChildTool.test.ts` | G2.3 stop_child MCP | 13 |
| `tests/unit/process/task/dispatch/askUserTool.test.ts` | G2.4 ask_user MCP | 14 |

All files live under `tests/unit/` → picked up by the `node` Vitest project.

---

## G2.1 — worktreeManager.test.ts

### Strategy

`child_process.exec` (and its promisified wrapper) is replaced with a `vi.fn()` stub via
`vi.mock('@process/task/dispatch/worktreeManager', ...)`.  The factory re-implements the
module using a controlled `execMock` so every git command can be forced to resolve or reject
independently per test.

### Scenarios

#### `isGitRepo()`
| # | Scenario | Expected |
|---|----------|----------|
| 1 | `git rev-parse` succeeds | returns `true` |
| 2 | `git rev-parse` throws | returns `false` (no throw) |
| 3 | Passes `cwd` matching the supplied directory | correct option forwarded |

#### `createWorktree()`
| # | Scenario | Expected |
|---|----------|----------|
| 4 | Happy path | `branchName` = `aion-wt-{first 8 chars}` |
| 5 | Happy path | `worktreePath` under `.aion-worktrees/` |
| 6 | Happy path | `sessionId` preserved in return value |
| 7 | HEAD resolves to hash | `git worktree add` command contains that hash |
| 8 | `isGitRepo` returns false | throws error containing "is not a git repository" |
| 9 | Non-git workspace | error message includes the workspace path |

#### `cleanupWorktree()`
| # | Scenario | Expected |
|---|----------|----------|
| 10 | Both commands succeed | issues `git worktree remove --force` |
| 11 | Both commands succeed | issues `git branch -D` |
| 12 | `worktree remove` fails (already removed) | does not throw |
| 13 | `branch -D` fails (already deleted) | does not throw |
| 14 | Both commands fail | still resolves (fully idempotent) |

#### `mergeWorktree()`
| # | Scenario | Expected |
|---|----------|----------|
| 15 | Merge succeeds | `success: true` |
| 16 | Merge conflict | `success: false`, `conflictFiles` populated from diff output |
| 17 | Merge conflict | `git merge --abort` is called |
| 18 | Both merge + diff fail | `success: false`, `error` defined |

---

## G2.2 — permissionPolicy.test.ts

### Strategy

Pure functions — no I/O, no mocks needed.  Tests exercise the exported
`classifyToolCall`, `checkPermission`, and `getDangerousDescription` directly.

### Scenarios

#### `classifyToolCall()` — safe tools
| # | Tool | Expected |
|---|------|----------|
| 1–3 | Read, Grep, Glob | `'safe'` |

#### `classifyToolCall()` — normal tools
| # | Tool | Expected |
|---|------|----------|
| 4–6 | Edit, Write, NotebookEdit | `'normal'` |

#### `classifyToolCall()` — Bash dangerous patterns
| # | Command | Expected |
|---|---------|----------|
| 7 | `rm -rf .` | `'dangerous'` |
| 8 | `rm --recursive /tmp` | `'dangerous'` |
| 9 | `git push origin main` | `'dangerous'` |
| 10 | `git push --force` | `'dangerous'` |
| 11 | `git reset --hard HEAD~1` | `'dangerous'` |
| 12 | `git clean -fd` | `'dangerous'` |
| 13 | `curl … \| bash` | `'dangerous'` |
| 14 | `sudo apt-get install vim` | `'dangerous'` |
| 15 | `chmod 777 server.ts` | `'dangerous'` |
| 16 | `npm publish` | `'dangerous'` |
| 17 | `docker rm my-container` | `'dangerous'` |

#### `classifyToolCall()` — Bash safe patterns
| # | Command | Expected |
|---|---------|----------|
| 18 | `ls -la` | `'safe'` |
| 19 | `pwd` | `'safe'` |
| 20 | `git status` | `'safe'` |
| 21 | `git log --oneline` | `'safe'` |
| 22 | `git diff HEAD` | `'safe'` |
| 23 | `bun run test` | `'safe'` |
| 24 | `npm run build` | `'safe'` |
| 25 | `tsc --noEmit` | `'safe'` |

#### `classifyToolCall()` — Bash normal / edge
| # | Scenario | Expected |
|---|----------|----------|
| 26 | Unrecognised bash command | `'normal'` |
| 27 | Empty command string | `'normal'` |
| 28 | Unknown tool name | `'normal'` (default) |
| 29 | Missing command arg | `'normal'` |

#### `checkPermission()` — safe tools
| # | Scenario | Expected |
|---|----------|----------|
| 30 | Read with restricted `allowedTools` | `allowed: true` |
| 31 | Grep with empty `allowedTools` | `allowed: true` |
| 32 | Glob with non-matching `allowedTools` | `allowed: true` |

#### `checkPermission()` — normal tools with allowedTools
| # | Scenario | Expected |
|---|----------|----------|
| 33 | Edit in list | `allowed: true` |
| 34 | Write NOT in list | `allowed: false` |
| 35 | Write denied | `reason` contains "Write" |

#### `checkPermission()` — backward compatibility
| # | Scenario | Expected |
|---|----------|----------|
| 36 | `allowedTools: undefined` | Edit allowed |
| 37 | `allowedTools: []` | Write allowed |

#### `checkPermission()` — dangerous tools
| # | Scenario | Expected |
|---|----------|----------|
| 38 | `rm -rf` + no allowedTools | `allowed: true`, `requiresApproval: true` |
| 39 | `git push` + allowedTools set | `allowed: true`, `requiresApproval: true` |
| 40 | `rm -rf` level check | `level: 'dangerous'` |
| 41 | Safe tool | `requiresApproval` undefined |

#### `checkPermission()` — edge cases
| # | Scenario | Expected |
|---|----------|----------|
| 42 | Unknown tool + no allowedTools | `allowed: true` |
| 43 | Unknown tool + allowedTools set | `allowed: false` |
| 44 | Empty `args` object | no throw |

#### `getDangerousDescription()`
| # | Command | Expected |
|---|---------|----------|
| 45 | `rm -rf /tmp` | `'recursive delete'` |
| 46 | `git push origin main` | `'git push'` |
| 47 | `sudo rm /etc/hosts` | `'sudo command'` |
| 48 | `ls -la` | `undefined` |
| 49 | empty string | `undefined` |

---

## G2.3 — stopChildTool.test.ts

### Strategy

The `DispatchMcpServer` handler logic is extracted into a standalone `handleStopChild`
function for isolation.  `DispatchToolHandler.stopChild` is a `vi.fn()` stub.

### Schema tests
| # | Property | Expected |
|---|----------|----------|
| 1 | `name` | `'stop_child'` |
| 2 | `required` includes `session_id` | true |
| 3 | `session_id` type | `'string'` |
| 4 | `reason` is optional string | not in `required` |
| 5 | `description` non-empty | length > 0 |

### Handler dispatch tests
| # | Scenario | Expected |
|---|----------|----------|
| 6 | Valid `session_id` | `handler.stopChild` called with id + `undefined` reason |
| 7 | With optional `reason` | reason forwarded to `handler.stopChild` |
| 8 | Success | returns `session_id` + `message`, no `isError` |
| 9 | Missing `session_id` | `isError: true`, content matches "session_id is required", no call |
| 10 | Empty string `session_id` | `isError: true` |
| 11 | `stopChild` throws Error | `isError: true`, content contains error message |
| 12 | `stopChild` throws string | `isError: true`, content contains string |

---

## G2.4 — askUserTool.test.ts

### Strategy

Same pattern as G2.3 — `handleAskUser` extracted for isolation.
`DispatchToolHandler.askUser` is a `vi.fn()` stub.

### Schema tests
| # | Property | Expected |
|---|----------|----------|
| 1 | `name` | `'ask_user'` |
| 2 | `required` includes `question` | true |
| 3 | `question` type | `'string'` |
| 4 | `context` optional string | not in `required` |
| 5 | `options` optional array | not in `required` |
| 6 | `options.items` type | `'string'` |
| 7 | `description` non-empty | length > 0 |

### Handler dispatch tests
| # | Scenario | Expected |
|---|----------|----------|
| 8 | Valid question | `handler.askUser` called with question |
| 9 | With `context` | context forwarded |
| 10 | With `options` array | options forwarded |
| 11 | Success | returns `message`, no `isError` |
| 12 | Non-blocking response | message matches /submitted\|relay\|continue/i |
| 13 | Missing `question` | `isError: true`, content matches "question is required", no call |
| 14 | Empty string `question` | `isError: true` |
| 15 | `askUser` throws | `isError: true`, content contains error message |
| 16 | Non-string options items | coerced to strings via `String()` |
| 17 | `options` not an array | treated as `undefined` |

---

## AC Coverage Mapping

| AC | Test file | Test # |
|----|-----------|--------|
| G2.1: isGitRepo detects repo correctly | worktreeManager | 1–3 |
| G2.1: createWorktree generates correct git commands | worktreeManager | 4–9 |
| G2.1: cleanupWorktree idempotent | worktreeManager | 10–14 |
| G2.1: non-git repo graceful degradation (throws) | worktreeManager | 8–9 |
| G2.1: mergeWorktree conflict abort | worktreeManager | 15–18 |
| G2.2: safe/normal/dangerous classification | permissionPolicy | 1–29 |
| G2.2: checkPermission allowedTools enforcement | permissionPolicy | 30–44 |
| G2.2: no hard-blocking (soft enforcement) | permissionPolicy | 38–39 |
| G2.2: backward compat (no allowedTools) | permissionPolicy | 36–37 |
| G2.3: schema shape | stopChildTool | 1–5 |
| G2.3: stopChild called correctly | stopChildTool | 6–8 |
| G2.3: missing session_id error handling | stopChildTool | 9–10 |
| G2.3: handler exceptions surfaced | stopChildTool | 11–12 |
| G2.4: schema shape | askUserTool | 1–7 |
| G2.4: askUser called correctly | askUserTool | 8–11 |
| G2.4: non-blocking return | askUserTool | 12 |
| G2.4: missing question error handling | askUserTool | 13–14 |
| G2.4: handler exceptions surfaced | askUserTool | 15 |
| G2.4: input coercion (options, context) | askUserTool | 16–17 |

---

## Run Command

```bash
bun run test -- tests/unit/process/task/dispatch/
```

[DONE]
