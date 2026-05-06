#!/usr/bin/env bash
# 部署后自检：健康检查 + 可选 API 契约版本
set -euo pipefail
HOST="${1:-http://127.0.0.1:${API_PORT:-3000}}"
URL="${HOST%/}/api/health"
echo "GET $URL"
body="$(curl -fsS "$URL")"
echo "$body"
if ! echo "$body" | grep -q '"service"[[:space:]]*:[[:space:]]*"quizwiz-teacher-admin"'; then
  echo "错误: 响应中未找到 service=quizwiz-teacher-admin（可能反代到错误端口或非本服务）" >&2
  exit 1
fi
if ! echo "$body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "错误: 健康检查未返回 ok:true" >&2
  exit 1
fi
echo "OK: 健康检查通过"
