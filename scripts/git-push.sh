#!/usr/bin/env bash
# 本机执行：提交并推送到 GitHub（默认分支 main）
# 用法：
#   chmod +x scripts/git-push.sh
#   ./scripts/git-push.sh "feat: 说明本次改动"

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${GIT_BRANCH:-main}"
MSG="${1:-chore: sync}"

git add -A

if git diff --cached --quiet; then
  echo "没有需要提交的变更，跳过 commit，直接 push。"
else
  git commit -m "$MSG"
fi

git push origin "$BRANCH"
echo "已推送到 origin/$BRANCH"
