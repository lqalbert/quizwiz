# 空服务器 → 教师端域名 + 小程序同一套真实数据（一页命令）

**前置条件**

1. 云主机 **Ubuntu 22.04/24.04**，你已 **SSH 登录**（示例用户 `ubuntu`）。
2. 域名 **`www.你的域名.com`** 的 **A 记录** 指向本机公网 IP（小程序与教师端统一用 **带 www** 时最省事）。
3. 安全组 / 防火墙放行 **80、443**。
4. 本仓库已推到 Git，服务器可 `git clone`（把下面 **`GIT_URL`** 换成你的地址）。

下列命令在服务器上**从上到下依次执行**；带 **`sudo`** 的需有 sudo 权限。

---

## 0. 变量（整页只用改这里）

在 SSH 里先执行（**改成你的值**）：

```bash
export GIT_URL="https://github.com/lqalbert/QuizWiz.git"
export DOMAIN="www.quizwiz.cn"
export APEX="quizwiz.cn"
export CERT_EMAIL="648546375@qq.com"
export DB_PASS="lq878368"
export JWT_SECRET="$(openssl rand -base64 32)"
export WECHAT_APPID="wxda81343eb7dbf460"
export WECHAT_SECRET="e6cba8dac9a5389d0b43506107af8007"
```

---

## 1. 系统软件

```bash
sudo apt update
sudo apt install -y git curl nginx postgresql postgresql-contrib certbot python3-certbot-nginx rsync
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

---

## 2. PostgreSQL 库与用户

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER quizwiz_app WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER quizwiz_app WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE quizwiz OWNER quizwiz_app;" 2>/dev/null || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE quizwiz TO quizwiz_app;"
```

---

## 3. 拉代码

```bash
cd ~
rm -rf QuizWiz
git clone "$GIT_URL" QuizWiz
cd ~/QuizWiz/teacher-admin
```

---

## 4. 初始化表结构（空库首次；已有数据会报错，勿重复执行）

```bash
export DATABASE_URL="postgresql://quizwiz_app:${DB_PASS}@127.0.0.1:5432/quizwiz"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f init_v3.sql
# 需要演示账号（四个手机号见 seed_v3.sql，统一密码 123456）再执行：
# psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seed_v3.sql
```

---

## 5. 服务端 `.env`（Node）

**`DATABASE_URL` 里密码若含 `@ : / ,` 等须做 URL 编码**；为省事建议 **`DB_PASS` 只用字母数字**。

```bash
cd ~/QuizWiz/teacher-admin
UPLOAD="https://${DOMAIN}"
cat > .env <<EOF
API_PORT=3000
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}
DATABASE_URL=postgresql://quizwiz_app:${DB_PASS}@127.0.0.1:5432/quizwiz
UPLOAD_PUBLIC_BASE=${UPLOAD}
WECHAT_MINI_APPID=${WECHAT_APPID}
WECHAT_MINI_SECRET=${WECHAT_SECRET}
EOF
chmod 600 .env
```

---

## 6. 构建教师端前端

```bash
cd ~/QuizWiz/teacher-admin
cat > .env.production <<EOF
VITE_API_BASE_URL=https://${DOMAIN}
EOF
npm ci
npm run build
```

---

## 7. 静态文件放到 Nginx 可读目录（避免 `www-data` 进不了家目录）

```bash
sudo mkdir -p /var/www/quizwiz
sudo rsync -a --delete ~/QuizWiz/teacher-admin/dist/ /var/www/quizwiz/dist/
sudo chown -R www-data:www-data /var/www/quizwiz
```

---

## 8. Nginx：先仅 80（无证书），再 certbot 签 HTTPS

```bash
sudo tee /etc/nginx/sites-available/quizwiz.conf <<NGINX
# HTTP：裸域跳 www
server {
    listen 80;
    listen [::]:80;
    server_name ${APEX};
    return 301 https://${DOMAIN}\$request_uri;
}

# HTTP：正式站点（certbot 会改成 443 或追加 ssl）
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    root /var/www/quizwiz/dist;
    index index.html;
    client_max_body_size 100m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/quizwiz.conf /etc/nginx/sites-enabled/quizwiz.conf
sudo nginx -t && sudo systemctl reload nginx
```

**申请证书（非交互需邮箱已同意条款）：**

```bash
sudo certbot --nginx -d "${DOMAIN}" -d "${APEX}" \
  --non-interactive --agree-tos -m "${CERT_EMAIL}" --redirect
sudo nginx -t && sudo systemctl reload nginx
```

若 **`APEX` 未做 DNS**，去掉 `-d "${APEX}"` 只签 `DOMAIN`。

**证书签发后**：若 `https://${APEX}` 仍 500，在 `quizwiz.conf` 里为 **`APEX` 增加 443 `return 301 https://${DOMAIN}$request_uri;`**（证书须含裸域，上面 certbot 已含两域则路径一般为 `/etc/letsencrypt/live/${DOMAIN}/` 或 `live` 下第一个名，以 `sudo certbot certificates` 为准）。

---

## 9. systemd 跑 API

```bash
sudo tee /etc/systemd/system/quizwiz-api.service <<'UNIT'
[Unit]
Description=QuizWiz teacher-admin API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/QuizWiz/teacher-admin
Environment=NODE_ENV=production
EnvironmentFile=/home/ubuntu/QuizWiz/teacher-admin/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

# 若 SSH 用户不是 ubuntu，请编辑：
# sudo sed -i "s|/home/ubuntu|/home/$(whoami)|g" /etc/systemd/system/quizwiz-api.service

sudo systemctl daemon-reload
sudo systemctl enable --now quizwiz-api
curl -sS http://127.0.0.1:3000/api/health
curl -sS -o /dev/null -w "auth/me HTTP %{http_code}\n" http://127.0.0.1:3000/api/auth/me
```

---

## 10. 联调验证

```bash
curl -sS "https://${DOMAIN}/api/health"
cd ~/QuizWiz/teacher-admin && bash deploy/verify.sh "https://${DOMAIN}"
```

浏览器打开 **`https://${DOMAIN}`** 登录教师端。

---

## 11. 小程序与教师端同一套线上数据

在**你开发用的电脑**上（仓库里改，再 push；小程序用开发者工具上传）：

| 项 | 值 |
|----|-----|
| `student-front/config/site.js` | `defaultApiBase` 填 `https://` + 与上文 **`DOMAIN` 完全相同**（例如 `https://www.quizwiz.cn`） |
| `expectedMiniProgramAppId` | 与 `project.config.json` 的 `appid` 一致 |
| 服务器 `.env` | 已设 `WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET` |
| 微信公众平台 | **request / uploadFile** 合法域名为 **`https://${DOMAIN}`**（须 https，与上完全一致） |
| 删除本机联调文件 | 删除 **`student-front/config/site.local.js`**（若有），避免仍打本机 |

---

## 12. 以后只更新代码

```bash
cd ~/QuizWiz && git pull
cd ~/QuizWiz/teacher-admin
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/quizwiz/dist/
sudo chown -R www-data:www-data /var/www/quizwiz/dist
sudo systemctl restart quizwiz-api
```

---

**说明**：仓库内 **`deploy/nginx-server-www.quizwiz.cn.conf`** 等为参考模板；**空机一键**以本文 **`tee` 生成的 `quizwiz.conf` + 变量**为准。若某步报错，把**该步完整终端输出**复制出来再排查即可。
