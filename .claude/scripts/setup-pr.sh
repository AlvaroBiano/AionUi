#!/bin/bash
# =============================================================================
# setup-pr.sh — PR 创建工作流
#
# 用法：
#   bash .claude/scripts/setup-pr.sh <type> <scope> <subject> [选项]
#
# 参数：
#   type     提交类型：feat / fix / refactor / chore / docs / test / style / perf
#   scope    影响范围，例如：ui / acp / gemini / team
#   subject  简短描述（英文，不超过 50 字符）
#
# 选项：
#   --branch <name>   指定分支名，默认根据 type/scope/subject 自动生成
#   --draft           创建草稿 PR
#   --no-push         只提交，不推送和创建 PR
#   --pr-title <str>  自定义 PR 标题，默认与提交消息相同
#
# 示例：
#   bash .claude/scripts/setup-pr.sh feat ui "add avatar to messages"
#   bash .claude/scripts/setup-pr.sh fix acp "correct session timeout" --draft
#   bash .claude/scripts/setup-pr.sh chore deps "upgrade vitest to v4" --branch waili/chore/upgrade-vitest
# =============================================================================

set -e

# ── 参数解析 ──────────────────────────────────────────────────────────────────
TYPE="$1"
SCOPE="$2"
SUBJECT="$3"
shift 3 2>/dev/null || true

BRANCH_OVERRIDE=""
DRAFT_FLAG=""
NO_PUSH=false
PR_TITLE_OVERRIDE=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --branch)   BRANCH_OVERRIDE="$2"; shift 2 ;;
    --draft)    DRAFT_FLAG="--draft"; shift ;;
    --no-push)  NO_PUSH=true; shift ;;
    --pr-title) PR_TITLE_OVERRIDE="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

# ── 校验必填参数 ──────────────────────────────────────────────────────────────
VALID_TYPES="feat|fix|refactor|chore|docs|test|style|perf"
if [[ -z "$TYPE" || -z "$SCOPE" || -z "$SUBJECT" ]]; then
  echo "❌ 用法: $0 <type> <scope> <subject> [选项]"
  echo "   type 可选值: $VALID_TYPES"
  exit 1
fi

if ! echo "$TYPE" | grep -qE "^($VALID_TYPES)$"; then
  echo "❌ type 必须是以下之一: $VALID_TYPES"
  exit 1
fi

# ── 确定分支名 ────────────────────────────────────────────────────────────────
GIT_USER=$(git config user.name | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')
if [[ -n "$BRANCH_OVERRIDE" ]]; then
  BRANCH="$BRANCH_OVERRIDE"
else
  SLUG=$(echo "$SUBJECT" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | tr ' ' '-' | cut -c1-30 | sed 's/-$//')
  BRANCH="${GIT_USER}/${TYPE}/${SLUG}"
fi

COMMIT_MSG="${TYPE}(${SCOPE}): ${SUBJECT}"
PR_TITLE="${PR_TITLE_OVERRIDE:-$COMMIT_MSG}"
CURRENT_BRANCH=$(git branch --show-current)

echo "📋 配置："
echo "   分支：$BRANCH"
echo "   提交：$COMMIT_MSG"
echo ""

# ── 切换/创建分支 ─────────────────────────────────────────────────────────────
if [[ "$CURRENT_BRANCH" == "$BRANCH" ]]; then
  echo "✅ 已在目标分支 $BRANCH"
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "🔀 切换到已有分支 $BRANCH"
  git checkout "$BRANCH"
else
  echo "🌿 从 main 创建新分支 $BRANCH"
  git fetch origin main --quiet
  git checkout -b "$BRANCH" origin/main
fi

# ── 质量检查 ──────────────────────────────────────────────────────────────────
echo "🔍 格式化代码..."
bun run format 2>&1

echo "🔍 类型检查..."
if ! bunx tsc --noEmit 2>&1; then
  echo "❌ 类型检查失败，已中止。修复类型错误后重试。"
  exit 1
fi

# ── 暂存并提交所有修改 ────────────────────────────────────────────────────────
echo "📦 暂存修改..."
git add -u

STAGED=$(git diff --cached --name-only)
if [[ -z "$STAGED" ]]; then
  echo "⚠️  没有暂存的修改，跳过提交"
else
  echo "📝 提交：$COMMIT_MSG"
  git commit -m "$COMMIT_MSG"
fi

[[ "$NO_PUSH" == true ]] && echo "✅ 已提交（--no-push，跳过推送和 PR）" && exit 0

# ── 推送分支 ──────────────────────────────────────────────────────────────────
echo "🚀 推送分支 $BRANCH..."
git push -u origin "$BRANCH"

# ── 创建 PR ───────────────────────────────────────────────────────────────────
echo "📬 创建 PR..."
PR_URL=$(gh pr create \
  --title "$PR_TITLE" \
  --body "## Summary

- $SUBJECT

## Test plan

- [ ] 本地测试通过
- [ ] 相关功能未出现回归
" \
  --base main \
  $DRAFT_FLAG)

echo ""
echo "✅ PR 已创建：$PR_URL"
