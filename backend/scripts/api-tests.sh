#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
TEMPLATE_PATH="${TEMPLATE_PATH:-/Users/liuqing/projects/QuizWiz/backend/templates/question_import_template.xlsx}"
RUN_ID="$(date +%s)"
GENERATED_TEMPLATE_PATH="${GENERATED_TEMPLATE_PATH:-/tmp/quizwiz_import_${RUN_ID}.xlsx}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin001}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"

echo "== 1) Health check =="
curl -sS "${BASE_URL}/health"
echo -e "\n"

echo "== 2) Login =="
LOGIN_RES="$(curl -sS -X POST "${BASE_URL}/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")"
echo "${LOGIN_RES}"
echo -e "\n"
TOKEN="$(printf '%s' "${LOGIN_RES}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
if [[ -z "${TOKEN}" ]]; then
  echo "Login failed: set ADMIN_USERNAME / ADMIN_PASSWORD to match .env bootstrap user." >&2
  exit 1
fi

echo "== 3) Create question =="
CREATE_RES="$(curl -sS -X POST "${BASE_URL}/admin/questions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "questionType": "single",
    "stem": "HTTP 默认端口是（run-'${RUN_ID}'）？",
    "optionA": "80",
    "optionB": "443",
    "optionC": "3306",
    "optionD": "6379",
    "answerLetters": "A",
    "analysis": "HTTP 默认端口为 80，HTTPS 为 443。",
    "knowledgePoints": ["网络基础","HTTP"],
    "difficulty": 1,
    "chapter": "网络协议",
    "status": "published"
  }')"
echo "${CREATE_RES}"
echo -e "\n"

QUESTION_ID="$(echo "${CREATE_RES}" | sed -n 's/.*"id":[ ]*\([0-9]*\).*/\1/p')"
if [[ -z "${QUESTION_ID}" ]]; then
  echo "Create failed or id not found; stop." >&2
  exit 1
fi
echo "Created question id: ${QUESTION_ID}"
echo

echo "== 4) Update question =="
curl -sS -X PUT "${BASE_URL}/admin/questions/${QUESTION_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "questionType": "single",
    "stem": "HTTPS 默认端口是（run-'${RUN_ID}'）？",
    "optionA": "80",
    "optionB": "443",
    "optionC": "3306",
    "optionD": "6379",
    "answerLetters": "B",
    "analysis": "HTTPS 默认端口为 443。",
    "knowledgePoints": ["网络基础","HTTPS"],
    "difficulty": 1,
    "chapter": "网络协议",
    "status": "published"
  }'
echo -e "\n"

echo "== 5) List questions (all) =="
curl -sS "${BASE_URL}/admin/questions?page=1&pageSize=10" \
  -H "Authorization: Bearer ${TOKEN}"
echo -e "\n"

echo "== 6) List questions (by knowledgePoint) =="
curl -sS "${BASE_URL}/admin/questions?knowledgePoint=HTTPS" \
  -H "Authorization: Bearer ${TOKEN}"
echo -e "\n"

echo "== 7) Soft delete question =="
curl -sS -X DELETE "${BASE_URL}/admin/questions/${QUESTION_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
echo -e "\n"

echo "== 8) Generate unique Excel template for success case =="
RUN_ID="${RUN_ID}" GENERATED_TEMPLATE_PATH="${GENERATED_TEMPLATE_PATH}" node -e "
import xlsx from 'xlsx';
const runId = process.env.RUN_ID;
const output = process.env.GENERATED_TEMPLATE_PATH;
const headers = ['题型','题干','选项A','选项B','选项C','选项D','答案','解析','知识点','难度','章节','状态'];
const row = [
  'single',
  '唯一导入测试题（run-' + runId + '）',
  '选项A',
  '选项B',
  '选项C',
  '选项D',
  'A',
  '用于验证预检与导入成功路径',
  '接口测试,导入测试',
  2,
  '测试章节',
  'published'
];
const ws = xlsx.utils.aoa_to_sheet([headers, row]);
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, '题库模板');
xlsx.writeFile(wb, output);
console.log(output);
"
echo -e "\n"

echo "== 9) Excel preview (expected success) =="
curl -sS -X POST "${BASE_URL}/admin/questions/import/preview" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${GENERATED_TEMPLATE_PATH}"
echo -e "\n"

echo "== 10) Excel import (expected success) =="
curl -sS -X POST "${BASE_URL}/admin/questions/import" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${GENERATED_TEMPLATE_PATH}"
echo -e "\n"

echo "== 11) Excel import using default template (may duplicate) =="
LAST_IMPORT_RES="$(curl -sS -X POST "${BASE_URL}/admin/questions/import" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${TEMPLATE_PATH}"
)"
echo "${LAST_IMPORT_RES}"
echo -e "\n"

LAST_JOB_ID="$(echo "${LAST_IMPORT_RES}" | sed -n 's/.*"jobId":[ ]*\([0-9]*\).*/\1/p')"
if [[ -n "${LAST_JOB_ID}" ]]; then
  echo "== 12) List import jobs =="
  curl -sS "${BASE_URL}/admin/questions/import/jobs?page=1&pageSize=5" \
    -H "Authorization: Bearer ${TOKEN}"
  echo -e "\n"

  echo "== 13) Query import job rows =="
  curl -sS "${BASE_URL}/admin/questions/import/jobs/${LAST_JOB_ID}/rows?page=1&pageSize=20" \
    -H "Authorization: Bearer ${TOKEN}"
  echo -e "\n"

  echo "== 14) Query import job rows (failedOnly=true) =="
  curl -sS "${BASE_URL}/admin/questions/import/jobs/${LAST_JOB_ID}/rows?page=1&pageSize=20&failedOnly=true" \
    -H "Authorization: Bearer ${TOKEN}"
  echo -e "\n"

  echo "== 15) Query import job summary =="
  curl -sS "${BASE_URL}/admin/questions/import/jobs/${LAST_JOB_ID}/summary" \
    -H "Authorization: Bearer ${TOKEN}"
  echo -e "\n"
fi
echo -e "\n"

echo "All API checks executed."
