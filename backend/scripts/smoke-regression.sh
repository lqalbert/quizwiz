#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin001}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
TEMPLATE_PATH="${TEMPLATE_PATH:-/Users/liuqing/projects/QuizWiz/backend/templates/question_import_template.xlsx}"
STUDENT_TOKEN="${STUDENT_TOKEN:-}"
CONFIRM_DELETE_REPORT_ID="${CONFIRM_DELETE_REPORT_ID:-}"
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

log "3.1) Teacher login (for permission checks)"
teacher_login_code=$(request POST "${BASE_URL}/admin/auth/login" "{\"username\":\"${NEW_USER}\",\"password\":\"teacher123\"}" 0 "${TMP_DIR}/teacher_login.json")
[[ "$teacher_login_code" == "200" ]] || fail "teacher login status=$teacher_login_code body=$(cat "${TMP_DIR}/teacher_login.json")"
TEACHER_TOKEN=$(json_get "${TMP_DIR}/teacher_login.json" "o.token")
[[ -n "$TEACHER_TOKEN" ]] || fail "teacher token missing"

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
{"questionType":"single","stem":"冒烟题(run-${RUN_ID})","optionA":"A","optionB":"B","optionC":"C","optionD":"D","answerLetters":"A","analysis":"smoke","knowledgePoints":["回归测试"],"difficulty":1,"chapter":"回归","status":"published","subjectName":"英语"}
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

log "12) Confirm-delete endpoint should reject teacher role"
teacher_confirm_code=$(curl -sS -X POST "${BASE_URL}/admin/question-reports/1/confirm-delete-question" \
  -H "Authorization: Bearer ${TEACHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"adminNote":"smoke permission check"}' \
  -o "${TMP_DIR}/teacher_confirm_delete.json" -w "%{http_code}")
[[ "$teacher_confirm_code" == "403" ]] || fail "teacher confirm-delete expected 403, got $teacher_confirm_code body=$(cat "${TMP_DIR}/teacher_confirm_delete.json")"

log "12.1) Question-reports aggregate view should work"
agg_view_code=$(request GET "${BASE_URL}/admin/question-reports?view=question&pageSize=20" "" 1 "${TMP_DIR}/reports_agg.json")
[[ "$agg_view_code" == "200" ]] || fail "question-reports aggregate view expected 200, got $agg_view_code body=$(cat "${TMP_DIR}/reports_agg.json")"

log "12.2) Question-reports aggregate sort by reportCount should work"
agg_sort_code=$(request GET "${BASE_URL}/admin/question-reports?view=question&pageSize=20&sortBy=reportCount&sortOrder=desc" "" 1 "${TMP_DIR}/reports_agg_sort.json")
[[ "$agg_sort_code" == "200" ]] || fail "question-reports aggregate sort expected 200, got $agg_sort_code body=$(cat "${TMP_DIR}/reports_agg_sort.json")"

log "12.3) Question impact endpoint should work"
impact_code=$(request GET "${BASE_URL}/admin/question-reports/question-impact/${QID}" "" 1 "${TMP_DIR}/question_impact.json")
[[ "$impact_code" == "200" ]] || fail "question impact expected 200, got $impact_code body=$(cat "${TMP_DIR}/question_impact.json")"

if [[ -n "${STUDENT_TOKEN}" ]]; then
  log "13) Optional: create question report by student"
  q2_body=$(cat <<EOF
{"questionType":"single","stem":"纠错冒烟题(run-${RUN_ID})","optionA":"A","optionB":"B","optionC":"C","optionD":"D","answerLetters":"A","analysis":"smoke-report","knowledgePoints":["回归测试"],"difficulty":1,"chapter":"回归","status":"published","subjectName":"英语"}
EOF
)
  create_q2_code=$(request POST "${BASE_URL}/admin/questions" "$q2_body" 1 "${TMP_DIR}/create_q2.json")
  [[ "$create_q2_code" == "201" ]] || fail "create report question expected 201, got $create_q2_code body=$(cat "${TMP_DIR}/create_q2.json")"
  REPORT_QID=$(json_get "${TMP_DIR}/create_q2.json" "o.id")
  [[ -n "$REPORT_QID" ]] || fail "report question id missing"

  create_report_code=$(curl -sS -X POST "${BASE_URL}/wx/question-reports" \
    -H "Authorization: Bearer ${STUDENT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":${REPORT_QID},\"reasonType\":\"answer_wrong\",\"detail\":\"smoke report run-${RUN_ID}\"}" \
    -o "${TMP_DIR}/create_report.json" -w "%{http_code}")
  [[ "$create_report_code" == "200" ]] || fail "create report expected 200, got $create_report_code body=$(cat "${TMP_DIR}/create_report.json")"
  REPORT_ID=$(json_get "${TMP_DIR}/create_report.json" "o.id")
  [[ -n "$REPORT_ID" ]] || fail "report id missing"
  MERGED1=$(json_get "${TMP_DIR}/create_report.json" "o.merged")
  [[ "${MERGED1}" == "false" || -z "${MERGED1}" ]] || fail "first report should not be merged"

  create_report2_code=$(curl -sS -X POST "${BASE_URL}/wx/question-reports" \
    -H "Authorization: Bearer ${STUDENT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":${REPORT_QID},\"reasonType\":\"typo\",\"detail\":\"smoke report duplicate run-${RUN_ID}\"}" \
    -o "${TMP_DIR}/create_report2.json" -w "%{http_code}")
  [[ "$create_report2_code" == "200" ]] || fail "second report expected 200, got $create_report2_code body=$(cat "${TMP_DIR}/create_report2.json")"
  REPORT_ID_2=$(json_get "${TMP_DIR}/create_report2.json" "o.id")
  [[ "$REPORT_ID_2" == "$REPORT_ID" ]] || fail "dedupe expected same report id, got ${REPORT_ID_2} != ${REPORT_ID}"
  MERGED2=$(json_get "${TMP_DIR}/create_report2.json" "o.merged")
  [[ "${MERGED2}" == "true" ]] || fail "second report should be merged=true"

  log "14) Optional: admin confirm-delete question via report"
  confirm_del_code=$(request POST "${BASE_URL}/admin/question-reports/${REPORT_ID}/confirm-delete-question" "{\"adminNote\":\"smoke confirm delete run-${RUN_ID}\"}" 1 "${TMP_DIR}/confirm_del.json")
  [[ "$confirm_del_code" == "200" ]] || fail "confirm-delete expected 200, got $confirm_del_code body=$(cat "${TMP_DIR}/confirm_del.json")"
else
  log "13) Skip optional confirm-delete happy path (STUDENT_TOKEN not provided)"
fi

if [[ -n "${CONFIRM_DELETE_REPORT_ID}" ]]; then
  log "15) Optional: run confirm-delete against existing report id=${CONFIRM_DELETE_REPORT_ID}"
  direct_confirm_code=$(request POST "${BASE_URL}/admin/question-reports/${CONFIRM_DELETE_REPORT_ID}/confirm-delete-question" "{\"adminNote\":\"smoke direct confirm-delete run-${RUN_ID}\"}" 1 "${TMP_DIR}/direct_confirm_del.json")
  [[ "$direct_confirm_code" == "200" ]] || fail "direct confirm-delete expected 200, got $direct_confirm_code body=$(cat "${TMP_DIR}/direct_confirm_del.json")"
else
  log "15) Skip direct confirm-delete check (CONFIRM_DELETE_REPORT_ID not provided)"
fi

log "All smoke checks passed."
echo "Artifacts saved in ${TMP_DIR}"
