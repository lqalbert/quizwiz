#!/usr/bin/env bash
# 在服务器上执行：拉代码、装依赖、重启 PM2
# 用法：
#   chmod +x git-pull-server.sh
#   # 默认目录 /opt/quizwiz/backend/backend
#   ./git-pull-server.sh
#   # 或指定目录与分支
#   REPO_DIR=/opt/quizwiz/backend/backend GIT_BRANCH=main PM2_NAME=quizwiz-backend ./git-pull-server.sh

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/quizwiz/backend/backend}"
GIT_BRANCH="${GIT_BRANCH:-main}"
PM2_NAME="${PM2_NAME:-quizwiz-backend}"

cd "$REPO_DIR"

echo ">>> cd $REPO_DIR"
echo ">>> git pull origin $GIT_BRANCH"
git pull origin "$GIT_BRANCH"

echo ">>> npm install"
npm install

echo ">>> pm2 restart $PM2_NAME --update-env"
pm2 restart "$PM2_NAME" --update-env

echo ">>> pm2 status"
pm2 status

echo "完成。建议执行: pm2 logs $PM2_NAME --lines 50"
