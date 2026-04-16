#!/bin/bash
# =============================================================================
# check-ci.sh — CI 状态检查与失败日志拉取
#
# 用法：
#   bash .claude/scripts/check-ci.sh [选项]
#
# 选项：
#   --branch <name>   查看指定分支（默认：当前分支）
#   --limit <n>       显示最近 N 条运行记录（默认：5）
#   --logs            自动拉取最新失败运行的详细日志
#   --watch           持续轮询，直到最新运行完成（每 15 秒刷新一次）
#
# 示例：
#   bash .claude/scripts/check-ci.sh
#   bash .claude/scripts/check-ci.sh --logs
#   bash .claude/scripts/check-ci.sh --branch main --limit 10
#   bash .claude/scripts/check-ci.sh --watch
# =============================================================================

set -e

# ── 参数解析 ──────────────────────────────────────────────────────────────────
BRANCH=$(git branch --show-current)
LIMIT=5
SHOW_LOGS=false
WATCH=false

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --limit)  LIMIT="$2"; shift 2 ;;
    --logs)   SHOW_LOGS=true; shift ;;
    --watch)  WATCH=true; shift ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

# ── 获取并显示 CI 运行列表 ────────────────────────────────────────────────────
show_runs() {
  echo "📊 分支 [$BRANCH] 最近 $LIMIT 次 CI 运行："
  echo ""
  gh run list \
    --branch "$BRANCH" \
    --limit "$LIMIT" \
    --json databaseId,status,conclusion,name,headBranch,createdAt,url \
    --jq '.[] | "\(.status | ascii_upcase) \(.conclusion // "running") | \(.name) | \(.createdAt[:16]) | \(.url)"' \
    2>/dev/null | while IFS='|' read -r status name time url; do
      # 根据状态添加 emoji
      case "$(echo "$status" | xargs)" in
        *success*)  ICON="✅" ;;
        *failure*)  ICON="❌" ;;
        *"IN_PROGRESS"*) ICON="⏳" ;;
        *cancelled*) ICON="🚫" ;;
        *)          ICON="❓" ;;
      esac
      printf "  %s  %-45s  %s\n" "$ICON" "$(echo "$name" | xargs)" "$(echo "$time" | xargs)"
    done
}

# ── 拉取失败日志 ──────────────────────────────────────────────────────────────
fetch_failed_logs() {
  echo ""
  echo "🔍 获取最新失败运行的日志..."

  # 找到最新的失败运行 ID
  FAILED_ID=$(gh run list \
    --branch "$BRANCH" \
    --limit 10 \
    --json databaseId,conclusion \
    --jq '[.[] | select(.conclusion == "failure")] | first | .databaseId' \
    2>/dev/null)

  if [[ -z "$FAILED_ID" || "$FAILED_ID" == "null" ]]; then
    echo "✅ 没有找到失败的运行记录"
    return
  fi

  echo "📋 运行 ID: $FAILED_ID"
  echo ""

  # 拉取失败步骤的日志（过滤掉 ANSI 色彩码）
  gh run view "$FAILED_ID" --log-failed 2>/dev/null \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | grep -v "^$" \
    | tail -80

  echo ""
  echo "🔗 查看完整日志：$(gh run view "$FAILED_ID" --json url --jq .url 2>/dev/null)"
}

# ── 轮询模式 ──────────────────────────────────────────────────────────────────
if [[ "$WATCH" == true ]]; then
  echo "👀 监控模式：每 15 秒刷新一次，Ctrl+C 退出"
  echo ""
  while true; do
    clear
    show_runs

    # 检查是否有进行中的运行
    IN_PROGRESS=$(gh run list \
      --branch "$BRANCH" \
      --limit 3 \
      --json status \
      --jq '[.[] | select(.status == "in_progress")] | length' \
      2>/dev/null)

    if [[ "$IN_PROGRESS" == "0" ]]; then
      echo ""
      echo "✅ 所有运行已完成"
      [[ "$SHOW_LOGS" == true ]] && fetch_failed_logs
      break
    fi

    echo ""
    echo "⏳ 有 $IN_PROGRESS 个运行进行中，15 秒后刷新..."
    sleep 15
  done
else
  show_runs
  [[ "$SHOW_LOGS" == true ]] && fetch_failed_logs
fi
