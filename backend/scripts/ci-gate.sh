#!/usr/bin/env bash
set -euo pipefail

# QuizWiz 最小 CI 门禁脚本
# 目标：在发布前快速阻断明显回归

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin001}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
TEMPLATE_PATH="${TEMPLATE_PATH:-/Users/liuqing/projects/QuizWiz/backend/templates/question_import_template.xlsx}"
WORKDIR="$(cd "$(dirname "$0")/.." && pwd)"

log() { echo "[ci-gate] $*"; }
fail() { echo "[ci-gate][FAIL] $*" >&2; exit 1; }

log "1) Check required SQL files exist"
[[ -f "${WORKDIR}/sql/schema_v1.sql" ]] || fail "missing sql/schema_v1.sql"
[[ -f "${WORKDIR}/sql/schema_v2.sql" ]] || fail "missing sql/schema_v2.sql"
[[ -f "${WORKDIR}/sql/question_reports_v1.sql" ]] || fail "missing sql/question_reports_v1.sql"
[[ -f "${WORKDIR}/sql/question_favorites_v1.sql" ]] || fail "missing sql/question_favorites_v1.sql"

log "2) Health check"
health_code="$(curl -sS -o /tmp/quizwiz-ci-health.json -w "%{http_code}" "${BASE_URL}/health" || true)"
[[ "${health_code}" == "200" ]] || fail "health check failed, status=${health_code}"

log "3) Run smoke regression (core gate)"
cd "${WORKDIR}"
BASE_URL="${BASE_URL}" \
ADMIN_USERNAME="${ADMIN_USERNAME}" \
ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
TEMPLATE_PATH="${TEMPLATE_PATH}" \
bash "${WORKDIR}/scripts/smoke-regression.sh"

log "All CI gates passed."
