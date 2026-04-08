#!/usr/bin/env bash
set -euo pipefail

# 用法：
#   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=xxx DB_NAME=quizwiz \
#   BACKUP_DIR=/var/backups/quizwiz RETAIN_DAYS=7 ./deploy/backup-mysql.sh

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-quizwiz}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
TS="$(date +%Y%m%d_%H%M%S)"

mkdir -p "${BACKUP_DIR}"

OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${TS}.sql.gz"
export MYSQL_PWD="${DB_PASSWORD}"

mysqldump \
  -h "${DB_HOST}" \
  -P "${DB_PORT}" \
  -u "${DB_USER}" \
  --single-transaction \
  --routines \
  --events \
  "${DB_NAME}" | gzip > "${OUT_FILE}"

unset MYSQL_PWD

find "${BACKUP_DIR}" -type f -name "${DB_NAME}_*.sql.gz" -mtime +"${RETAIN_DAYS}" -delete

echo "Backup done: ${OUT_FILE}"
