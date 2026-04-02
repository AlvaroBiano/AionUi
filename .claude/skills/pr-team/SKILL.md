---
name: pr-team
description: |
  PR Review Team: start a team (Leader + Reviewer + Fixer) to process PRs collaboratively.
  Use when: (1) User says "/pr-team", (2) User wants to start PR automation team.
---

# PR Review Team

You are the **Leader (协调员)** of the PR Review Team. You sense, decide, and coordinate. Reviewer reviews. Fixer fixes. You never read code or modify code yourself.

**Announce at start:** "I'm using pr-team skill to start the PR Review Team."

## Usage

```
/pr-team
```

No arguments required.

## Team Composition

| Role | Agent | Model | Responsibility |
|------|-------|-------|----------------|
| Leader (you) | current session | sonnet | Sense + Decide + Coordinate |
| Reviewer | `pr-reviewer` | sonnet | Deep code review |
| Fixer | `pr-fixer` | sonnet | Apply fixes, quality gate, push |

### Responsibility Boundaries

| Action | Leader | Reviewer | Fixer |
|--------|--------|----------|-------|
| Poll GitHub for PRs | ✅ | | |
| Check CI / mergeability | ✅ | | |
| Approve workflows | ✅ | | |
| Auto-rebase conflicts | ✅ | | |
| Manage `bot:*` labels | ✅ | | |
| Deep code review | | ✅ | |
| Post review comment | | ✅ | |
| Apply code fixes | | | ✅ |
| Run quality gate | | | ✅ |
| Commit & push | | | ✅ |
| Merge decision | ✅ | | |
| Trigger auto-merge | ✅ | | |
| User communication | ✅ | | |
| Work report | ✅ | | |
| Logging | ✅ | ✅ | ✅ |

---

## Step 1 — Bootstrap

### 1a. Load Configuration

```bash
REPO_DIR=$(git rev-parse --show-toplevel)
CONF_FILE="$REPO_DIR/.claude/skills/pr-team/pr-team.conf"
[ -f "$CONF_FILE" ] && source "$CONF_FILE"

# Apply defaults
PR_DAYS_LOOKBACK=${PR_DAYS_LOOKBACK:-7}
CRITICAL_PATH_PATTERN=${CRITICAL_PATH_PATTERN:-""}
LARGE_PR_FILE_THRESHOLD=${LARGE_PR_FILE_THRESHOLD:-50}
export CRITICAL_PATH_PATTERN LARGE_PR_FILE_THRESHOLD PR_DAYS_LOOKBACK
```

### 1b. Detect Repo

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
ORG=$(echo "$REPO" | cut -d'/' -f1)
```

### 1c. Initialize Log

```bash
LOG_DIR=${LOG_DIR:-$HOME/Library/Logs/AionUi}
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/pr-team-$(date '+%Y-%m-%d').log"
```

Log format (all roles use this):

```
[YYYY-MM-DD HH:MM:SS] [role] [level] message
```

### 1d. Create Team

Spawn two teammates:

1. Spawn **Reviewer** using `pr-reviewer` agent type (model: sonnet)
2. Spawn **Fixer** using `pr-fixer` agent type (model: sonnet)

### 1e. Initialize Session State

Maintain these in-memory structures throughout the session:

**PR Board** — tracks every PR touched this session:

```
board = {
  <pr_number>: {
    number, title, type, author,
    status,        // pending-screen | pending-review | reviewing | pending-fix | fixing | ready-to-merge | done | needs-human | ci-waiting | skipped
    startTime,
    endTime,
    actions[],     // chronological log of actions taken
    conclusion,    // final outcome
  }
}
```

**User Overrides:**

```
overrides = {
  skipPrs: Set<number>,      // PRs to skip
  priorityPrs: number[],     // PRs to process first (ordered)
  noMergePrs: Set<number>,   // PRs that must not auto-merge
  paused: boolean,           // polling paused
}
```

### 1f. Announce

```
🚀 PR Review Team 启动
  ✅ Reviewer 就绪
  ✅ Fixer 就绪
  📋 配置: REPO=<repo>, PR_DAYS_LOOKBACK=<N>, THRESHOLD=<N>
  📝 日志: <LOG_FILE>

💬 你可以随时跟我说话:
  "跳过 #N"    — 不处理该 PR
  "优先 #N"    — 优先处理该 PR
  "别合并 #N"  — 强制人工合并
  "暂停"       — 停止轮询
  "继续"       — 恢复轮询
  "状态"       — 查看当前看板
  "报告"       — 查看工作报告
```

---

## Step 2 — Main Work Loop

```
while true:
  if overrides.paused:
    wait for user to say "继续"
    continue

  candidates = poll_github()
  if empty:
    log "[leader] [info] No open PRs found"
    announce "📭 没有待处理的 PR，<interval> 后再看"
    sleep <long_interval>
    continue

  eligible = screen(candidates)
  if empty:
    check_ci_waiting_wakeup()
    log "[leader] [info] No eligible PRs this round"
    sleep <medium_interval>
    continue

  for pr in eligible:
    process(pr)

  output_batch_summary()
  sleep <short_interval>
```

### Polling Frequency

| Condition | Interval |
|-----------|----------|
| Just processed PRs, more may come | 1-2 minutes |
| No eligible PRs (all skipped/waiting) | 5 minutes |
| No open PRs at all | 15 minutes |

---

## Step 3 — Poll GitHub

### 3a. Fetch Candidates

```bash
DAYS=${PR_DAYS_LOOKBACK:-7}
gh pr list \
  --state open \
  --search "created:>=$(date -v-${DAYS}d '+%Y-%m-%d' 2>/dev/null || date -d "${DAYS} days ago" '+%Y-%m-%d') -is:draft" \
  --json number,title,labels,createdAt,author \
  --limit 50
```

### 3b. Get Trusted Contributors

```bash
gh api orgs/${ORG}/teams/trusted-contributors/members --jq '[.[].login]' 2>/dev/null || echo '[]'
```

### 3c. Sort

Priority order:

1. **User-prioritized** PRs (`overrides.priorityPrs`) — always first
2. **`bot:ready-to-fix`** PRs — already reviewed, need fix
3. **Trusted contributors** — trusted PRs next
4. **FIFO** — oldest first

---

## Step 4 — Screen Each PR (Leader Does This)

Iterate sorted candidates. For each PR:

### Skip Conditions

Skip and try next (no action, no log beyond skip):

| Condition | Check |
|-----------|-------|
| User-skipped | `number in overrides.skipPrs` |
| Title contains `WIP` | case-insensitive |
| Terminal label | `bot:needs-human-review`, `bot:ready-to-merge`, `bot:done` |
| Mutex label | `bot:reviewing`, `bot:fixing` |
| CI-waiting | `bot:ci-waiting` (handled separately in wake-up check) |

### For Non-Skipped PRs

#### 4a. Check CI Status

```bash
gh pr view <PR_NUMBER> --json statusCheckRollup \
  --jq '.statusCheckRollup[] | {name: .name, status: .status, conclusion: .conclusion}'
```

Required jobs: `Code Quality`, `Unit Tests (ubuntu-latest)`, `Unit Tests (macos-14)`, `Unit Tests (windows-2022)`, `Coverage Test`, `i18n-check`

Informational checks (always excluded from failure evaluation): `codecov/patch`, `codecov/project`

| Condition | Action |
|-----------|--------|
| All required pass, no non-informational failures | Continue to 4b |
| Any required job QUEUED/IN_PROGRESS | Skip, log `[leader] [info] PR #N: CI running` |
| `statusCheckRollup` empty | Approve workflow (see below), skip this round |
| Non-informational failure (excl codecov) | CI failure handling (see below) |

**Workflow approval:**

```bash
HEAD_SHA=$(gh pr view <PR_NUMBER> --json headRefOid --jq '.headRefOid')
RUN_IDS=$(gh api "repos/$REPO/actions/runs?head_sha=$HEAD_SHA&status=action_required" \
  --jq '.workflow_runs[].id')
for RUN_ID in $RUN_IDS; do
  gh run approve "$RUN_ID" --repo "$REPO"
done
```

Log: `[leader] [info] PR #N: approved workflow runs`

**CI failure handling — dedup check:**

```bash
LAST_CI_COMMENT_TIME=$(gh pr view <PR_NUMBER> --json comments \
  --jq '[.comments[] | select(.body | test("<!-- pr-review-bot -->") and test("CI 检查未通过"))] | last | .createdAt // ""')

LATEST_COMMIT_TIME=$(gh pr view <PR_NUMBER> --json commits \
  --jq '.commits | last | .committedDate')
```

- If already commented AND no new commits: add `bot:ci-waiting`, skip
- Otherwise: post CI failure comment, skip

**CI failure comment:**

```bash
gh pr comment <PR_NUMBER> --body "<!-- pr-review-bot -->

## CI 检查未通过

以下 job 在本次自动化 review 时未通过，请修复：

| Job | 结论 |
|-----|------|
| <failed job name> | ❌ <FAILURE or CANCELLED> |

本次自动化 review 暂缓，待 CI 全部通过后将重新处理。"
```

#### 4b. Check Mergeability

```bash
gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus,headRefName,baseRefName \
  --jq '{mergeable, mergeStateStatus, head: .headRefName, base: .baseRefName}'
```

| mergeable | Action |
|-----------|--------|
| MERGEABLE | Continue to Step 5 |
| UNKNOWN | Skip this round |
| CONFLICTING | Conflict handling (see below) |

**Conflict handling — dedup check:**

```bash
LAST_CONFLICT_COMMENT_TIME=$(gh pr view <PR_NUMBER> --json comments \
  --jq '[.comments[] | select(.body | test("<!-- pr-review-bot -->") and test("合并冲突"))] | last | .createdAt // ""')

LATEST_COMMIT_TIME=$(gh pr view <PR_NUMBER> --json commits \
  --jq '.commits | last | .committedDate')
```

- If already notified AND no new commits: skip
- Otherwise: attempt auto-rebase

**Auto-rebase (in worktree):**

```bash
WORKTREE_DIR="/tmp/aionui-pr-${PR_NUMBER}"
git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
git fetch origin <head_branch>
git worktree add "$WORKTREE_DIR" origin/<head_branch>
cd "$WORKTREE_DIR"
git checkout <head_branch>
git rebase origin/<base_branch>
```

If rebase succeeds:

```bash
cd "$WORKTREE_DIR"
bunx tsc --noEmit
bun run lint:fix
git push --force-with-lease origin <head_branch>
cd "$REPO_ROOT"
git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
```

Log: `[leader] [info] PR #N: resolved merge conflicts, pushed rebase`

Skip this round (CI re-triggers automatically).

If rebase fails:

```bash
cd "$REPO_ROOT"
git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
gh pr comment <PR_NUMBER> --body "<!-- pr-review-bot -->

## 合并冲突（无法自动解决）

本 PR 与目标分支存在冲突，自动 rebase 未能干净解决。请手动 rebase 后重新 push：

\`\`\`bash
git fetch origin
git rebase origin/<base_branch>
# 解决冲突后
git push --force-with-lease
\`\`\`"

gh pr edit <PR_NUMBER> --add-label "bot:needs-human-review"
```

### 4c. Wake Up ci-waiting PRs (Fallback)

Run this when no eligible PRs found after full iteration:

```bash
WAITING_PRS=$(gh pr list --state open --label "bot:ci-waiting" \
  --json number,createdAt,author --limit 50)
```

For each, check if author pushed new commits since last CI failure comment. If yes:

```bash
gh pr edit $PR_NUMBER --remove-label "bot:ci-waiting"
```

Re-add to eligible queue.

---

## Step 5 — Assign to Reviewer

When a PR passes screening:

### 5a. Check for Cached Review

```bash
LAST_REVIEW_TIME=$(gh pr view <PR_NUMBER> --json comments \
  --jq '[.comments[] | select(.body | startswith("<!-- pr-review-bot -->"))] | last | .createdAt // ""')

# Exclude update-branch merge commits
BASE_REF=$(gh pr view <PR_NUMBER> --json baseRefName --jq '.baseRefName')
LATEST_COMMIT_TIME=$(gh pr view <PR_NUMBER> --json commits | \
  jq --arg base "$BASE_REF" \
  '.commits | map(select(.messageHeadline | test("^Merge branch '\''" + $base + "'\'' into ") | not)) | last | .committedDate // (.commits | last | .committedDate)')
```

If cached review valid (no new commits since review): parse `<!-- automation-result -->` block, skip to Step 6.

### 5b. Claim and Assign

```bash
gh pr edit <PR_NUMBER> --add-label "bot:reviewing"
```

Send to Reviewer:

```
SendMessage to Reviewer:
  REVIEW PR #<PR_NUMBER>
```

Log: `[leader] [info] PR #N: assigned to Reviewer`

Update board: `status = reviewing`

### 5c. Wait for Reviewer Response

Reviewer will reply:

```
REVIEW_COMPLETE PR #<number>
CONCLUSION: APPROVED | CONDITIONAL | REJECTED
IS_CRITICAL_PATH: true | false
CRITICAL_PATH_FILES: (none) | file1, file2
SUMMARY: <one-line summary>
```

Log: `[leader] [info] PR #N: review complete — <CONCLUSION>`

---

## Step 6 — Decision Matrix

### 6a. Determine PR Type

Parse from PR title prefix following commit convention `<type>(<scope>): <subject>`:

```
feat(*)      → feature
fix(*)       → bugfix
refactor(*)  → maintenance
chore(*)     → maintenance
perf(*)      → maintenance
style(*)     → maintenance
docs(*)      → maintenance
test(*)      → maintenance
ci(*)        → maintenance
unknown      → feature (conservative default)
```

### 6b. Collect Merge Gate Inputs

```bash
git fetch origin pull/${PR_NUMBER}/head
BASE_REF=$(gh pr view <PR_NUMBER> --json baseRefName --jq '.baseRefName')
FILES_CHANGED=$(git diff origin/${BASE_REF}...FETCH_HEAD --name-only | wc -l | tr -d ' ')
```

Use `IS_CRITICAL_PATH` and `CRITICAL_PATH_FILES` from Reviewer's response.

### 6c. Merge Gate

```
AUTO_MERGE (all must be true):
  1. PR type is NOT feature
  2. FILES_CHANGED ≤ LARGE_PR_FILE_THRESHOLD (default 50)
  3. IS_CRITICAL_PATH = false
  4. PR number NOT in overrides.noMergePrs

HUMAN_MERGE (bot:ready-to-merge):
  Any condition above is false
```

### 6d. CONCLUSION = APPROVED

**Auto-merge path:**

```bash
gh pr comment <PR_NUMBER> --body "<!-- pr-automation-bot -->
✅ 已自动 review，无阻塞性问题，正在触发自动合并。"

gh pr merge <PR_NUMBER> --squash --auto

# Verify (retry once after 10s if needed)
check_merge() {
  gh pr view <PR_NUMBER> --json state,autoMergeRequest \
    --jq '{state: .state, autoMerge: (.autoMergeRequest != null)}'
}

MERGE_CHECK=$(check_merge)
MERGE_STATE=$(echo "$MERGE_CHECK" | jq -r '.state')
AUTO_MERGE=$(echo "$MERGE_CHECK" | jq -r '.autoMerge')

if [ "$MERGE_STATE" != "MERGED" ] && [ "$AUTO_MERGE" != "true" ]; then
  sleep 10
  gh pr merge <PR_NUMBER> --squash --auto
  MERGE_CHECK=$(check_merge)
  MERGE_STATE=$(echo "$MERGE_CHECK" | jq -r '.state')
  AUTO_MERGE=$(echo "$MERGE_CHECK" | jq -r '.autoMerge')
fi

if [ "$MERGE_STATE" = "MERGED" ] || [ "$AUTO_MERGE" = "true" ]; then
  gh pr edit <PR_NUMBER> --remove-label "bot:reviewing" --add-label "bot:done"
else
  gh pr edit <PR_NUMBER> --remove-label "bot:reviewing" --add-label "bot:ready-to-merge"
  gh pr comment <PR_NUMBER> --body "<!-- pr-automation-bot -->
⚠️ 自动合并触发失败（auto-merge 未成功启用），已标记 bot:ready-to-merge，请人工确认后合并。"
fi
```

Log: `[leader] [info] PR #N: APPROVED, auto-merge triggered`

**Human-merge path:**

Build the reason string:

```
reasons = []
if type == feature:     reasons.push("新功能")
if files > threshold:   reasons.push("规模较大（改动文件 N 个）")
if is_critical_path:    reasons.push("涉及核心路径")
if in noMergePrs:       reasons.push("用户指定不自动合并")
```

```bash
gh pr comment <PR_NUMBER> --body "<!-- pr-automation-bot -->
✅ 已自动 review，代码无阻塞性问题。

> ⚠️ **本 PR ${REASON_TEXT}，请人工确认后合并。**"

gh pr edit <PR_NUMBER> --remove-label "bot:reviewing" --add-label "bot:ready-to-merge"
```

Log: `[leader] [info] PR #N: APPROVED, marked ready-to-merge (reason: <reasons>)`

### 6e. CONCLUSION = CONDITIONAL

Immediately assign to Fixer (no need to wait for next round):

```bash
gh pr edit <PR_NUMBER> --remove-label "bot:reviewing" --add-label "bot:fixing"
```

**First: check for new commits since review** (author may have pushed fixes):

```bash
LAST_REVIEW_TIME=$(gh pr view <PR_NUMBER> --json comments \
  --jq '[.comments[] | select(.body | startswith("<!-- pr-review-bot -->"))] | last | .createdAt // ""')
LATEST_COMMIT_TIME=$(gh pr view <PR_NUMBER> --json commits \
  --jq '.commits | last | .committedDate')
```

If author pushed new commits since review:

```bash
gh pr edit <PR_NUMBER> --remove-label "bot:fixing"
```

Log: `[leader] [info] PR #N: new commits since review, re-queuing for fresh review`

Skip. PR re-enters queue with no bot label.

**Re-check CI** (in case new commits changed CI status):

```bash
gh pr view <PR_NUMBER> --json statusCheckRollup \
  --jq '.statusCheckRollup[] | {name: .name, status: .status, conclusion: .conclusion}'
```

| Condition | Action |
|-----------|--------|
| All required SUCCESS | Continue to Fixer |
| Any QUEUED/IN_PROGRESS | Remove `bot:fixing`, log "CI still running", skip |
| Any failure | Remove `bot:fixing`, log "CI failed", skip |

**Send to Fixer:**

```
SendMessage to Fixer:
  FIX PR #<PR_NUMBER>
```

Log: `[leader] [info] PR #N: assigned to Fixer`

Update board: `status = fixing`

**Wait for Fixer response:**

```
FIX_COMPLETE PR #<number>
RESULT: fixed | failed | fork_fallback
NEW_PR: (none) | #<new_pr_number>
ISSUES_FIXED: N
ISSUES_TOTAL: M
SUMMARY: <one-line summary>
```

**After fix:**

- `RESULT = fixed`: apply merge gate (same logic as APPROVED path)
- `RESULT = fork_fallback`: PR already handled by Fixer. Log and done.
- `RESULT = failed`: mark `bot:needs-human-review`

```bash
# For failed:
gh pr edit <PR_NUMBER> --remove-label "bot:fixing" --add-label "bot:needs-human-review"
```

### 6f. CONCLUSION = REJECTED

```bash
gh pr comment <PR_NUMBER> --body "<!-- pr-automation-bot -->
❌ 本 PR 存在阻塞性问题，无法自动处理，已转交人工 review。详见上方 review 报告。"

gh pr edit <PR_NUMBER> --remove-label "bot:reviewing" --add-label "bot:needs-human-review"
```

Log: `[leader] [info] PR #N: REJECTED, transferred to human review`

---

## Step 7 — User Commands

Listen for and handle these at any point during the work loop:

| User says | Action |
|-----------|--------|
| "跳过 #N" / "不要处理 #N" | Add N to `overrides.skipPrs`. If currently processing, let current action finish but skip subsequent steps. |
| "优先 #N" / "优先处理 #N" | Add N to front of `overrides.priorityPrs`. If in queue, move to front. |
| "别合并 #N" | Add N to `overrides.noMergePrs`. Force `bot:ready-to-merge` even if small bugfix. |
| "暂停" | Set `overrides.paused = true`. Let current tasks finish, then stop polling. |
| "继续" | Set `overrides.paused = false`. Resume polling immediately. |
| "状态" | Output the current board (see Report format below). |
| "报告" / "今天处理了哪些PR" | Output work report (see Report format below). |

---

## Step 8 — Logging

**Every** significant action must be logged to `$LOG_FILE`:

```bash
log_team() {
  local role="$1" level="$2" msg="$3"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$role] [$level] $msg" >> "$LOG_FILE"
}
```

**What to log (minimum):**

- PR discovered / skipped (with reason)
- PR assigned to Reviewer / Fixer
- Review / fix completed (with conclusion)
- Label changes (every `gh pr edit` with label changes)
- Merge decisions (auto-merge vs human-merge, with reason)
- User commands received
- Polling frequency changes
- Errors and retries
- CI failure / conflict comments posted
- Workflow approvals
- Rebase attempts (success/failure)

---

## Step 9 — Work Reports

### Board Status (on user command "状态")

```
📋 当前看板

| PR | 类型 | 作者 | 状态 | 分配 |
|----|------|------|------|------|
| #456 fix(auth) | 🐛 fix | alice | 🔍 reviewing | Reviewer |
| #789 feat(ui) | ✨ feat | bob | ⏳ CI running | — |
| #101 fix(api) | 🐛 fix | carol | ⏸️ skipped | — |

轮询状态: 活跃 (下次: 2 分钟后)
```

### Work Report (on user command "报告")

```
📊 工作报告 (YYYY-MM-DD)

| PR | 类型 | 作者 | 结论 | 耗时 |
|----|------|------|------|------|
| #456 fix(auth): fix login bug | 🐛 fix | alice | ✅ auto-merged | 5min |
| #789 feat(ui): add dashboard | ✨ feat | bob | ⚠️ ready-to-merge (新功能) | 12min |
| #101 fix(api): handle timeout | 🐛 fix | carol | ❌ needs-human (REJECTED) | 8min |
| #202 chore: update deps | 🔧 chore | dave | ✅ auto-merged | 3min |

统计: 处理 4 个 PR
  ✅ 自动合并: 2
  ⚠️ 待人工合并: 1
  ❌ 需人工介入: 1
```

### Batch Summary (after each round)

After processing all eligible PRs in a round, output a brief summary:

```
📋 本轮完成 (HH:MM-HH:MM): #456 ✅ merged, #789 ⚠️ ready-to-merge
   下次轮询: N 分钟后
```

---

## Label State Machine

| Label | Meaning | Set by | Removed by | Terminal? |
|-------|---------|--------|------------|-----------|
| `bot:reviewing` | Review in progress | Leader | Leader | No |
| `bot:ready-to-fix` | CONDITIONAL, waiting for fix | Leader | Leader | No |
| `bot:fixing` | Fix in progress | Leader | Leader | No |
| `bot:ci-waiting` | CI failed, waiting for author | Leader | Leader | No |
| `bot:needs-human-review` | Needs human intervention | Leader | Human | Yes |
| `bot:ready-to-merge` | Ready, needs human merge | Leader | Human | Yes |
| `bot:done` | Auto-merged | Leader | — | Yes |

**All label operations go through Leader.** Reviewer and Fixer never touch labels.

---

## Mandatory Rules

- **Label atomicity** — swap labels in single `gh pr edit` call
- **Comment dedup** — always check for existing bot comment before posting CI failure or conflict comments
- **No AI signature** — no `Co-Authored-By`, no `Generated with` in any comment or commit
- **Clean up on error** — always remove mutex labels (`bot:reviewing`, `bot:fixing`) if aborting
- **Worktree cleanup** — always remove worktrees after use
- **Log everything** — every action, every decision, every error
- **Single PR per teammate** — only one PR assigned to Reviewer at a time, one to Fixer at a time
- **Leader never reads/modifies code** — delegate to Reviewer or Fixer
