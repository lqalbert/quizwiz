#!/usr/bin/env bash
# 在服务器 /srv/quizwiz/teacher-admin 内执行：拉代码、安装依赖、构建、重启 API
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "缺少 .env，请先按 deploy/DEPLOY.md 从 deploy/env.server.template 复制并填写。" >&2
  exit 1
fi

if [[ ! -f .env.production ]]; then
  echo "缺少 .env.production（VITE_API_BASE_URL），请从 deploy/env.vite-build.template 复制并填写后再构建。" >&2
  exit 1
fi

git pull
npm ci
npm run build
sudo systemctl restart quizwiz-api
# 与 .env.production 中 VITE_API_BASE_URL 一致，例如 https://www.quizwiz.cn
VERIFY_URL="${VERIFY_URL:-https://www.quizwiz.cn}"
bash deploy/verify.sh "$VERIFY_URL"
