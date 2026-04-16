#!/bin/bash
# =============================================================================
# sync-locales.sh — 多语言版本文件同步检查与辅助更新
#
# 此脚本有两种用途：
#   1. 【检查模式】扫描某个文件或目录，找出所有相关语言版本并列出差异
#   2. 【同步模式】将一个语言版本的内容结构同步到其他语言版本（仅结构，不替换翻译）
#
# 用法：
#   bash .claude/scripts/sync-locales.sh check <文件或目录>
#   bash .claude/scripts/sync-locales.sh list-missing <i18n模块名>
#   bash .claude/scripts/sync-locales.sh readme-status
#
# 子命令：
#   check <path>           检查指定文件的所有语言版本是否存在，并对比修改时间
#   list-missing <module>  列出指定 i18n 模块在各语言中缺少的 key
#   readme-status          检查 docs/readme/ 下所有多语言 README 的同步状态
#
# 示例：
#   bash .claude/scripts/sync-locales.sh check docs/readme/readme_ch.md
#   bash .claude/scripts/sync-locales.sh list-missing common
#   bash .claude/scripts/sync-locales.sh readme-status
# =============================================================================

set -e

# 所有支持的 i18n 语言代码
ALL_LOCALES=(en-US zh-CN zh-TW ja-JP ko-KR ru-RU tr-TR uk-UA)
# 所有 README 语言文件（相对 docs/readme/）
README_FILES=(readme_ch.md readme_tw.md readme_jp.md readme_ko.md readme_es.md readme_pt.md readme_tr.md)
LOCALES_DIR="src/renderer/services/i18n/locales"

# ── 颜色输出 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✅${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠️ ${NC} $1"; }
err()  { echo -e "  ${RED}❌${NC} $1"; }

# ── 子命令：check ─────────────────────────────────────────────────────────────
cmd_check() {
  local TARGET="$1"
  if [[ -z "$TARGET" ]]; then
    echo "❌ 用法: $0 check <文件路径>"
    exit 1
  fi

  echo "🔍 检查文件的多语言版本：$TARGET"
  echo ""

  # 判断是 i18n locale JSON 还是 README 文件
  if echo "$TARGET" | grep -q "$LOCALES_DIR"; then
    # i18n locale 文件
    MODULE=$(basename "$TARGET" .json)
    echo "📦 模块：$MODULE"
    echo ""
    for LOCALE in "${ALL_LOCALES[@]}"; do
      FILE="$LOCALES_DIR/$LOCALE/$MODULE.json"
      if [[ -f "$FILE" ]]; then
        MTIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$FILE" 2>/dev/null || stat -c "%y" "$FILE" 2>/dev/null | cut -c1-16)
        KEY_COUNT=$(python3 -c "import json; d=json.load(open('$FILE')); print(len(d))" 2>/dev/null || echo "?")
        ok "$LOCALE ($KEY_COUNT keys) — 修改于 $MTIME"
      else
        err "$LOCALE — 文件不存在：$FILE"
      fi
    done
  else
    # 普通文件，直接列出同目录的相关文件
    DIR=$(dirname "$TARGET")
    BASE=$(basename "$TARGET")
    echo "📁 目录：$DIR"
    echo ""
    ls -la "$DIR" | grep -v "^total" | tail -n +2 | while read -r LINE; do
      FILE=$(echo "$LINE" | awk '{print $NF}')
      MTIME=$(echo "$LINE" | awk '{print $6, $7}')
      [[ "$FILE" == "$BASE" ]] && MARKER=" ← 当前" || MARKER=""
      echo "   $FILE  ($MTIME)$MARKER"
    done
  fi
}

# ── 子命令：list-missing ──────────────────────────────────────────────────────
cmd_list_missing() {
  local MODULE="$1"
  if [[ -z "$MODULE" ]]; then
    echo "❌ 用法: $0 list-missing <模块名>"
    echo "   可用模块: $(ls $LOCALES_DIR/en-US/ | sed 's/.json//' | tr '\n' ' ')"
    exit 1
  fi

  REF_FILE="$LOCALES_DIR/en-US/$MODULE.json"
  if [[ ! -f "$REF_FILE" ]]; then
    echo "❌ 参考文件不存在：$REF_FILE"
    exit 1
  fi

  echo "🔍 检查模块 [$MODULE] 在各语言中的缺失 key（以 en-US 为基准）"
  echo ""

  # 获取 en-US 的所有 key
  REF_KEYS=$(python3 -c "
import json
def flatten(d, prefix=''):
    result = []
    for k, v in d.items():
        full_key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            result.extend(flatten(v, full_key))
        else:
            result.append(full_key)
    return result
print('\n'.join(flatten(json.load(open('$REF_FILE')))))
" 2>/dev/null)

  REF_COUNT=$(echo "$REF_KEYS" | wc -l | xargs)
  echo "  en-US: $REF_COUNT keys（基准）"

  for LOCALE in "${ALL_LOCALES[@]}"; do
    [[ "$LOCALE" == "en-US" ]] && continue
    FILE="$LOCALES_DIR/$LOCALE/$MODULE.json"
    if [[ ! -f "$FILE" ]]; then
      err "$LOCALE — 文件不存在"
      continue
    fi

    MISSING=$(python3 -c "
import json
def flatten(d, prefix=''):
    result = []
    for k, v in d.items():
        full_key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            result.extend(flatten(v, full_key))
        else:
            result.append(full_key)
    return result
ref = set(flatten(json.load(open('$REF_FILE'))))
loc = set(flatten(json.load(open('$FILE'))))
missing = ref - loc
for k in sorted(missing):
    print(k)
" 2>/dev/null)

    MISSING_COUNT=$(echo "$MISSING" | grep -c . || echo 0)
    if [[ "$MISSING_COUNT" -eq 0 ]]; then
      ok "$LOCALE — 完整"
    else
      warn "$LOCALE — 缺少 $MISSING_COUNT 个 key："
      echo "$MISSING" | head -10 | while read -r KEY; do
        echo "       • $KEY"
      done
      [[ "$MISSING_COUNT" -gt 10 ]] && echo "       ... 还有 $((MISSING_COUNT - 10)) 个"
    fi
  done
}

# ── 子命令：readme-status ─────────────────────────────────────────────────────
cmd_readme_status() {
  echo "📖 docs/readme/ 多语言 README 同步状态"
  echo ""

  # 检查主 README（英文版通常在根目录）
  MAIN_README="README.md"
  if [[ -f "$MAIN_README" ]]; then
    MAIN_MTIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$MAIN_README" 2>/dev/null || stat -c "%y" "$MAIN_README" 2>/dev/null | cut -c1-16)
    MAIN_LINES=$(wc -l < "$MAIN_README" | xargs)
    echo "  📄 主 README.md ($MAIN_LINES 行，修改于 $MAIN_MTIME)"
  fi
  echo ""

  for FILE in "${README_FILES[@]}"; do
    FULL_PATH="docs/readme/$FILE"
    if [[ -f "$FULL_PATH" ]]; then
      MTIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$FULL_PATH" 2>/dev/null || stat -c "%y" "$FULL_PATH" 2>/dev/null | cut -c1-16)
      LINES=$(wc -l < "$FULL_PATH" | xargs)
      ok "$FILE ($LINES 行，修改于 $MTIME)"
    else
      err "$FILE — 文件不存在"
    fi
  done

  echo ""
  echo "💡 如需更新某个语言版本，参考主 README 的结构修改对应文件。"
  echo "   更新后运行: git diff docs/readme/ 确认改动范围"
}

# ── 主入口 ────────────────────────────────────────────────────────────────────
SUBCMD="$1"
shift 2>/dev/null || true

case "$SUBCMD" in
  check)         cmd_check "$@" ;;
  list-missing)  cmd_list_missing "$@" ;;
  readme-status) cmd_readme_status ;;
  *)
    echo "用法: $0 <子命令> [参数]"
    echo ""
    echo "子命令："
    echo "  check <文件>          检查该文件的所有语言版本"
    echo "  list-missing <模块>   列出各语言缺少的 i18n key"
    echo "  readme-status         查看多语言 README 同步状态"
    exit 1
    ;;
esac
