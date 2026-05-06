#!/usr/bin/env bash
# 可选：为「仓库放在 ~/QuizWiz」准备上传目录权限（在 teacher-admin 所在机器上执行即可）
# 不必再套一层小写 quizwiz：推荐路径为 家目录/QuizWiz/teacher-admin、家目录/QuizWiz/student-front
# 若用 sudo，会以 SUDO_USER 的家目录为准；自定义路径：INSTALL_ROOT=/你的路径/QuizWiz bash ...

set -euo pipefail

TARGET_USER="${SUDO_USER:-$USER}"
HOME_DIR="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
INSTALL_ROOT="${INSTALL_ROOT:-$HOME_DIR/QuizWiz}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"

echo "==> 目标用户: $TARGET_USER"
echo "==> 项目根目录（仓库 QuizWiz 放这里）: $INSTALL_ROOT"

mkdir -p "$INSTALL_ROOT/teacher-admin/uploads"
chown -R "$TARGET_USER:$TARGET_USER" "$INSTALL_ROOT"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "未找到可执行 Node: $NODE_BIN"
  echo "请安装 Node 20+ LTS，例如:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

echo "Node: $($NODE_BIN -v)"
echo
echo "后续步骤摘要:"
echo "  1) 将整份 QuizWiz 仓库放到 $INSTALL_ROOT（即 $INSTALL_ROOT/teacher-admin、$INSTALL_ROOT/student-front 等）"
echo "  2) cd $INSTALL_ROOT/teacher-admin && npm ci && npm run build（先配置 .env 与 .env.production）"
echo "  3) systemd / Nginx 中的路径改为 $INSTALL_ROOT/teacher-admin（见 deploy/quizwiz-api.service 与 nginx 配置里的 root）"
echo "  4) bash deploy/verify.sh https://你的域名"
