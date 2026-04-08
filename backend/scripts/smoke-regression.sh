#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin001}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
TEMPLATE_PATH="${TEMPLATE_PATH:-/Users/liuqing/projects/QuizWiz/backend/templates/question_import_template.xlsx}"
RUN_ID="$(date +%s)"
TMP_DIR="${TMP_DIR:-/tmp/quizwiz-smoke-${RUN_ID}}"
mkdir -p "${TMP_DIR}"

log() { echo "[smoke] $*"; }
fail() { echo "[smoke][FAIL] $*" >&2; exit 1; }

request() {
  local method="$1" url="$2" body="${3:-}" auth="${4:-0}" out="${5:-${TMP_DIR}/resp.json}"
  local -a args=(-sS -X "$method" "$url" -o "$out" -w "%{http_code}")
  if [[ "$auth" == "1" ]]; then
    args+=(-H "Authorization: Bearer ${TOKEN}")
  fi
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl "${args[@]}"
}

json_get() {
  local file="$1" expr="$2"
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$file','utf8'));const v=(function(o){return $expr})(d);process.stdout.write(v===undefined||v===null?'':String(v));"
}

log "1) Health"
health_code=$(request GET "${BASE_URL}/health" "" 0 "${TMP_DIR}/health.json")
[[ "$health_code" == "200" ]] || fail "health status=$health_code"
grep -q '"ok":true' "${TMP_DIR}/health.json" || fail "health body invalid"

log "2) Login"
login_code=$(request POST "${BASE_URL}/admin/auth/login" "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" 0 "${TMP_DIR}/login.json")
[[ "$login_code" == "200" ]] || fail "login status=$login_code body=$(cat "${TMP_DIR}/login.json")"
TOKEN=$(json_get "${TMP_DIR}/login.json" "o.token")
[[ -n "$TOKEN" ]] || fail "token missing"
ADMIN_ID=$(json_get "${TMP_DIR}/login.json" "o.user && o.user.id")
[[ -n "$ADMIN_ID" ]] || fail "admin id missing"

log "3) Create teacher user"
NEW_USER="teacher${RUN_ID}"
create_user_code=$(request POST "${BASE_URL}/admin/users" "{\"username\":\"${NEW_USER}\",\"password\":\"teacher123\",\"role\":\"teacher\"}" 1 "${TMP_DIR}/create_user.json")
[[ "$create_user_code" == "201" ]] || fail "create user status=$create_user_code body=$(cat "${TMP_DIR}/create_user.json")"
NEW_USER_ID=$(json_get "${TMP_DIR}/create_user.json" "o.id")
[[ -n "$NEW_USER_ID" ]] || fail "new user id missing"

log "4) Duplicate username should fail"
dup_code=$(request POST "${BASE_URL}/admin/users" "{\"username\":\"${NEW_USER}\",\"password\":\"teacher123\",\"role\":\"teacher\"}" 1 "${TMP_DIR}/dup_user.json")
[[ "$dup_code" == "409" ]] || fail "duplicate user expected 409, got $dup_code"

log "5) Invalid username format should fail"
bad_name_code=$(request POST "${BASE_URL}/admin/users" "{\"username\":\"bad_name\",\"password\":\"teacher123\",\"role\":\"teacher\"}" 1 "${TMP_DIR}/bad_name.json")
[[ "$bad_name_code" == "400" ]] || fail "invalid username expected 400, got $bad_name_code"

log "6) Prevent disabling self"
self_disable_code=$(request PATCH "${BASE_URL}/admin/users/${ADMIN_ID}/status" "{\"isActive\":false}" 1 "${TMP_DIR}/self_disable.json")
[[ "$self_disable_code" == "400" ]] || fail "self disable expected 400, got $self_disable_code"

log "7) Date filter validation"
bad_date_code=$(request GET "${BASE_URL}/admin/questions/import/jobs?startDate=2026-13-40" "" 1 "${TMP_DIR}/bad_date.json")
[[ "$bad_date_code" == "400" ]] || fail "bad date expected 400, got $bad_date_code"

log "8) Create question + soft delete(admin)"
q_body=$(cat <<EOF
{"questionType":"single","stem":"冒烟题(run-${RUN_ID})","optionA":"A","optionB":"B","optionC":"C","optionD":"D","answerLetters":"A","analysis":"smoke","knowledgePoints":["回归测试"],"difficulty":1,"chapter":"回归","status":"published"}
EOF
)
create_q_code=$(request POST "${BASE_URL}/admin/questions" "$q_body" 1 "${TMP_DIR}/create_q.json")
[[ "$create_q_code" == "201" ]] || fail "create question expected 201, got $create_q_code body=$(cat "${TMP_DIR}/create_q.json")"
QID=$(json_get "${TMP_DIR}/create_q.json" "o.id")
[[ -n "$QID" ]] || fail "question id missing"
del_q_code=$(request DELETE "${BASE_URL}/admin/questions/${QID}" "" 1 "${TMP_DIR}/del_q.json")
[[ "$del_q_code" == "200" ]] || fail "delete question expected 200, got $del_q_code"

log "9) Import preview should work"
preview_code=$(curl -sS -X POST "${BASE_URL}/admin/questions/import/preview" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${TEMPLATE_PATH}" \
  -o "${TMP_DIR}/preview.json" -w "%{http_code}")
[[ "$preview_code" == "200" ]] || fail "preview expected 200, got $preview_code body=$(cat "${TMP_DIR}/preview.json")"
JOB_ID=$(json_get "${TMP_DIR}/preview.json" "o.jobId")
[[ -n "$JOB_ID" ]] || fail "preview job id missing"

log "10) Import summary endpoint"
sum_code=$(request GET "${BASE_URL}/admin/questions/import/jobs/${JOB_ID}/summary" "" 1 "${TMP_DIR}/summary.json")
[[ "$sum_code" == "200" ]] || fail "summary expected 200, got $sum_code"

log "11) Export CSV endpoint"
csv_code=$(curl -sS -X GET "${BASE_URL}/admin/questions/import/jobs/${JOB_ID}/rows/export?failedOnly=true" \
  -H "Authorization: Bearer ${TOKEN}" \
  -o "${TMP_DIR}/rows.csv" -w "%{http_code}")
[[ "$csv_code" == "200" ]] || fail "export csv expected 200, got $csv_code"
[[ -s "${TMP_DIR}/rows.csv" ]] || fail "export csv empty"

log "All smoke checks passed."
echo "Artifacts saved in ${TMP_DIR}"
