#!/bin/bash
# 在 Claude Code 执行 git commit 前自动运行格式化和类型检查
# 如果类型检查失败，阻止提交

# 从 stdin 读取工具输入（JSON 格式）
INPUT=$(cat)
CMD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('command',''))" 2>/dev/null)

# 只在执行 git commit 时触发
if ! echo "$CMD" | grep -qE 'git\s+commit'; then
  exit 0
fi

echo "⏳ 提交前检查中..." >&2

# 1. 自动格式化（静默运行，只报错）
if ! bun run format 2>&1; then
  echo "❌ 格式化失败" >&2
  exit 1
fi

# 2. TypeScript 类型检查（有错误则阻止提交）
echo "🔍 类型检查..." >&2
if ! bunx tsc --noEmit 2>&1; then
  echo "" >&2
  echo "❌ 类型检查失败，提交已阻止。修复以上类型错误后重试。" >&2
  exit 1
fi

echo "✅ 检查通过" >&2
exit 0
