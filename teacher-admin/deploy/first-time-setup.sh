#!/usr/bin/env bash
# Ubuntu 22.04/24.04 新机首次准备（请 root 或 sudo 执行；按需改域名与路径）
# 用途：系统用户、目录权限、安装说明输出；不自动改 Nginx 以免覆盖你已有站点。

set -euo pipefail

INSTALL_ROOT="${INSTALL_ROOT:-/srv/quizwiz}"
APP_USER="${APP_USER:-quizwiz}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"

echo "==> 安装根目录: $INSTALL_ROOT"
echo "==> 运行用户:   $APP_USER"

if ! id "$APP_USER" &>/dev/null; then
  useradd --system --home "$INSTALL_ROOT" --create-home --shell /usr/sbin/nologin "$APP_USER"
  echo "已创建系统用户 $APP_USER"
else
  echo "用户 $APP_USER 已存在"
fi

mkdir -p "$INSTALL_ROOT/teacher-admin/uploads"
chown -R "$APP_USER:$APP_USER" "$INSTALL_ROOT"

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
echo "  1) 将代码放到 $INSTALL_ROOT/teacher-admin ，在该目录 npm ci && npm run build（构建前准备好 .env.production 中的 VITE_API_BASE_URL）"
echo "  2) 复制 deploy/env.server.template 为 .env 并填写 DATABASE_URL / JWT_SECRET / UPLOAD_PUBLIC_BASE / 小程序密钥等"
echo "  3) 复制 deploy/quizwiz-api.service 到 /etc/systemd/system/ ，确认 ExecStart 与 User 与路径一致后: systemctl enable --now quizwiz-api"
echo "  4) 合并 deploy/nginx-www.quizwiz.cn.conf 到 Nginx，certbot 申请证书后 nginx -t && systemctl reload nginx"
echo "  5) bash deploy/verify.sh https://www.quizwiz.cn"
