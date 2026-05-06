# QuizWiz 教师端 + API 生产部署说明

面向「空服务器重装系统」后的完整上线流程。按顺序执行可减少遗漏。**教师端 SPA、Node API、PostgreSQL、本机 `uploads/` 与 Nginx 反代** 任一环节配置错误都会导致部分功能异常。

---

## 1. 架构与端口

| 组件 | 说明 |
|------|------|
| Nginx | 443 对外；静态 `dist/`；`/api/`、`/uploads/` 反代到本机 Node |
| Node (`server/index.js`) | 默认 `API_PORT=3000`（仅本机监听即可） |
| PostgreSQL | 默认 5432，建议仅监听 `127.0.0.1` |
| 上传文件 | 存于 `teacher-admin/uploads/`，经 Nginx `/uploads/` 由同一 Node 进程提供 |

**必须**：Nginx 同时反代 **`/api/`** 与 **`/uploads/`**，且**不要**对 `/api` 做会丢掉查询串的 rewrite（知识单元、科目等接口依赖 query）。

---

## 2. 系统依赖

- Ubuntu 22.04 / 24.04 LTS（或其它带 systemd 的发行版）
- **Node.js 20+**（与 `package.json` 的 engines 建议一致）
- **PostgreSQL 14+**
- **Nginx** + **Certbot**（Let’s Encrypt）

Node 示例（NodeSource）：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 3. 代码放哪一层？（不必再建小写 `quizwiz`）

仓库根目录名已是 **`QuizWiz`** 时，**不要**再人为套一层 `/srv/quizwiz/QuizWiz` 之类，否则路径容易混。推荐在服务器上：

```text
/home/你的SSH用户名/QuizWiz/teacher-admin/
/home/你的SSH用户名/QuizWiz/student-front/
```

即：**家目录 → `QuizWiz` 仓库根 → 子目录 `teacher-admin` / `student-front`**。下文示例用 **`ubuntu`** 用户、路径 **`/home/ubuntu/QuizWiz/teacher-admin`**，请按你的实际登录名替换。

可选：创建上传目录并改属主（在仓库已放到 `~/QuizWiz` 后执行）：

```bash
sudo bash teacher-admin/deploy/first-time-setup.sh
# 或指定路径：INSTALL_ROOT=/home/ubuntu/QuizWiz sudo -E bash teacher-admin/deploy/first-time-setup.sh
```

---

## 4. PostgreSQL 与库表

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE USER quizwiz_app WITH PASSWORD '此处改为强密码';
CREATE DATABASE quizwiz OWNER quizwiz_app;
GRANT ALL PRIVILEGES ON DATABASE quizwiz TO quizwiz_app;
SQL
```

在 **`teacher-admin`** 目录执行初始化（**空库**执行；已有数据请先备份）：

```bash
export DATABASE_URL="postgresql://quizwiz_app:密码@127.0.0.1:5432/quizwiz"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f init_v3.sql
# 可选演示数据
# psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seed_v3.sql
```

首次启动 Node 时会自动跑内置迁移（扩展表结构等）；**仍需**先有上述基线表结构。

---

## 5. 环境变量

### 5.1 运行时（Node）

复制模板并编辑：

```bash
cp deploy/env.server.template /home/ubuntu/QuizWiz/teacher-admin/.env
chmod 600 /home/ubuntu/QuizWiz/teacher-admin/.env
```

至少配置：

- **`JWT_SECRET`**：生产必须为长随机串（勿用仓库默认值）。
- **`DATABASE_URL`** 或 `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`。
- **`UPLOAD_PUBLIC_BASE`**：与浏览器访问域名一致，例如 `https://www.quizwiz.cn`（无末尾 `/`）。与 Nginx 对外域名不一致时，**题目资源 URL 校验、头像外链**会失败。
- **`WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET`**：学生小程序 `code2Session` 需要；不填则学生微信登录不可用。

### 5.2 前端构建（Vite）

生产构建**必须**能解析到 `VITE_API_BASE_URL`，否则打包后 `CAN_USE_API` 为 false，页面无法请求接口。

```bash
cd /home/ubuntu/QuizWiz/teacher-admin
cp deploy/env.vite-build.template .env.production
# 编辑 .env.production ，例如：
# VITE_API_BASE_URL=https://www.quizwiz.cn
```

若教师端与 API **同域**（推荐：均为 `https://www.quizwiz.cn`），此处填该完整源即可。

---

## 6. 安装依赖与构建

```bash
cd /home/ubuntu/QuizWiz/teacher-admin
npm ci
npm run build
```

构建产物在 `dist/`，由 Nginx `root` 指向该目录。

---

## 7. systemd 托管 API

```bash
sudo cp deploy/quizwiz-api.service /etc/systemd/system/
# 若 Node 不在 /usr/bin/node：sudo sed -i 's|ExecStart=.*|ExecStart=/你的路径/node server/index.js|' /etc/systemd/system/quizwiz-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now quizwiz-api
sudo journalctl -u quizwiz-api -f
```

确认监听：

```bash
curl -sS http://127.0.0.1:3000/api/health
```

应含 `"service":"quizwiz-teacher-admin"` 与 `api_revision`。

---

## 8. Nginx + HTTPS

### 8.1 首次申请证书（证书还不存在时）

若 Nginx 配置里已写了 `ssl_certificate /etc/letsencrypt/live/...`，但证书**尚未签发**，会出现 `nginx -t` / `certbot --nginx` 均失败（找不到 `fullchain.pem`）。请**先用仅 HTTP 的配置**：

```bash
cd ~/QuizWiz/teacher-admin
sudo cp deploy/nginx-www.quizwiz.cn.http-only.conf /etc/nginx/sites-available/quizwiz.conf
# 若用户名不是 ubuntu：sudo nano ... 把 root 改成你的 /home/你的用户/QuizWiz/teacher-admin/dist
sudo ln -sf /etc/nginx/sites-available/quizwiz.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d www.quizwiz.cn
```

`certbot` 成功后会自动为站点增加 443 与证书路径；之后再 `sudo nginx -t && sudo systemctl reload nginx`。若需与仓库里完整模板对齐，可参考 **`deploy/nginx-server-www.quizwiz.cn.conf`**（此时证书文件已存在，`nginx -t` 才能通过）。

### 8.2 证书已存在后的维护

1. 将 **`deploy/nginx-server-www.quizwiz.cn.conf`** 合并进站点配置（或整文件放入 `sites-available` 再 `ln -s`）。
2. 将证书路径改为 certbot 实际路径：`sudo certbot certificates`
3. 测试并重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

若你已有站点，可把 **`deploy/nginx-api-location.snippet.conf`** 整段粘进 `server { ... }`，并保证 **`root`** 指向 `.../teacher-admin/dist`。

---

## 9. 部署后校验

```bash
cd /home/ubuntu/QuizWiz/teacher-admin
bash deploy/verify.sh https://www.quizwiz.cn
```

浏览器打开教师端：登录、题库列表、上传资源、系统设置里「知识单元字典」加载与新增、学生相关接口（若已配小程序密钥）。

---

## 10. 微信小程序（学生端，与教师端同一套数据）

> 若你只关心「教师端用域名、小程序拉同一域名下的真实库」，可先读精简清单 **[SAME_DOMAIN_MINIPROGRAM.md](./SAME_DOMAIN_MINIPROGRAM.md)**，再回本文做服务器细节。

以下 **四处** 必须指向同一域名、同一小程序，学生端才会请求到本服务器的教师端数据并完成微信登录：

| 位置 | 配置项 |
|------|--------|
| `student-front/config/site.js` | `defaultApiBase`（API 根，无 `/`） |
| `student-front/project.config.json` | `appid` |
| 服务器 `teacher-admin/.env` | `WECHAT_MINI_APPID`、`WECHAT_MINI_SECRET`（与公众平台该小程序一致） |
| 微信公众平台 → 开发管理 → **服务器域名** | `request`、`uploadFile` 等与 `defaultApiBase` 的 **协议 + 主机** 一致（含是否 `www`） |

若你对外统一使用 **带 `www` 的域名**（例如只开放 `https://www.example.com`），则上表及 **`VITE_API_BASE_URL`、`UPLOAD_PUBLIC_BASE`** 一律写 **`https://www.example.com`**，不要与裸域 `https://example.com` 混用。

教师端构建域名 `VITE_API_BASE_URL`、服务端 `UPLOAD_PUBLIC_BASE` 也应与对外站点一致（见上文）。

修改 `site.js` 或域名白名单后需重新上传小程序；修改服务器 `.env` 后需 `systemctl restart quizwiz-api`。

### 10.1 场景：教师端已用域名上线，小程序要请求「服务器上的真实数据」

目标：浏览器访问 `https://你的域名` 打开教师端；小程序里 `wx.request` 也指向同一域名下的 `/api`，与教师端共用同一数据库与上传目录。

**按顺序做（可对照上表「四处一致」）：**

1. **DNS**  
   将 `www.你的域名.com`（或你选用的主机名）**A 记录**指到服务器公网 IP。

2. **服务器：PostgreSQL + 初始化**  
   按上文 §4 建库并执行 `init_v3.sql`（需要演示账号可再执行 `seed_v3.sql`）。

3. **服务器：Node 环境变量 `.env`**（`/home/ubuntu/QuizWiz/teacher-admin/.env`）  
   - `DATABASE_URL`：连本机或内网 Postgres。  
   - `JWT_SECRET`：强随机串。  
   - **`UPLOAD_PUBLIC_BASE=https://你的域名`**（须与浏览器访问的协议+主机一致，**不要**带路径末尾 `/`）。  
   - **`WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET`**：与微信公众平台里**当前联调的小程序**一致（与 `project.config.json` 的 `appid` 相同）。  
   - **不要**在生产环境设置 `QUIZWIZ_DEV_CORS_ANY=1`（仅本地 `local.dev.env` 使用）。

4. **服务器：Nginx + HTTPS**  
   - 使用 **`deploy/nginx-server-www.quizwiz.cn.conf`** 一类配置：`root` 指向 `teacher-admin/dist`，并反代 **`/api/`** 与 **`/uploads/`** 到 `127.0.0.1:3000`。  
   - 用 certbot 申请证书，`nginx -t` 后 reload。  
   - 确认 **`client_max_body_size`** 足够（与模板中的 100m 一致），否则大文件/导入会失败。

5. **在服务器或 CI 上构建教师端前端**  
   - 复制 **`deploy/env.vite-build.template`** 为 `teacher-admin/.env.production`。  
   - 设置 **`VITE_API_BASE_URL=https://你的域名`**（与浏览器打开教师端的地址同源，一般含 `https://`）。  
   - 执行 `npm ci && npm run build`，将生成的 **`dist/`** 部署到 Nginx 的 `root` 目录。

6. **启动 API**  
   `systemctl enable --now quizwiz-api`（或 PM2），确认 `curl -s https://你的域名/api/health` 返回 `ok:true` 且 `service` 为 `quizwiz-teacher-admin`。

7. **小程序工程（在你开发用的电脑上）**  
   - 编辑 **`student-front/config/site.js`**：`defaultApiBase` 改为 **`https://你的域名`**（与 §10 表格、微信公众平台白名单**完全一致**，含是否 `www`、是否 `https`）。  
   - **`expectedMiniProgramAppId`** 与 **`project.config.json` → `appid`** 一致。  
   - 若本机曾跑过 `npm run dev` 生成了 **`student-front/config/site.local.js`**，联调线上时请**删除或改名**该文件，否则会覆盖 `site.js` 仍指向本机。

8. **微信公众平台**  
   - **开发** → **开发管理** → **开发设置** → **服务器域名**：把 **`request` 合法域名**、**`uploadFile` 合法域名**（等实际用到的项）配置为 **`https://你的域名`**（仅支持 **https**，不支持纯 IP；域名须与 `site.js` 一致）。  
   - 保存后等微信侧生效（常见数分钟级）。

9. **联调方式**  
   - 用微信开发者工具上传**开发版/体验版**即可请求线上域名（需在后台配置体验者）。  
   - 真机预览同样走合法域名，**无需**再勾选「不校验合法域名」（那是连本机 HTTP 时用的）。

10. **验证**  
    - 教师端：域名打开能登录、题库/上传/系统设置正常。  
    - 小程序：登录、首页、练习/记录等能拉数据；若登录失败，核对 **AppSecret**、**服务器域名**、**是否仍存在 `site.local.js`**。

---

## 11. 更新发版（已有环境）

```bash
cd /home/ubuntu/QuizWiz/teacher-admin
git pull
npm ci
npm run build
sudo systemctl restart quizwiz-api
bash deploy/verify.sh https://www.quizwiz.cn
```

---

## 12. 常见故障

| 现象 | 排查 |
|------|------|
| 前端空白或无法登录 | 是否已配置 `.env.production` 中 `VITE_API_BASE_URL` 并重新 `npm run build` |
| 附件/头像裂图 | Nginx 是否反代 `/uploads/`；`UPLOAD_PUBLIC_BASE` 是否与域名一致 |
| 知识单元/科目接口异常 | Nginx 是否改写或丢弃 `/api` 的 **query string** |
| `systemctl` 启动即退出 | `journalctl -u quizwiz-api -n 50`；检查 `DATABASE_URL`、迁移是否失败 |
| 健康检查 200 但非本服务 | 3000 端口是否被其它进程占用 |
| 小程序请求失败 / 不在合法域名列表 | 公众平台是否已配置 **https** 与**完全一致**的主机名；是否误留 `site.local.js` 指向本机 |

---

## 13. 文件索引

| 文件 | 用途 |
|------|------|
| `deploy/nginx-server-www.quizwiz.cn.conf` | 完整站点（含 `/api`、`/uploads`；**需已有证书**） |
| `deploy/nginx-www.quizwiz.cn.http-only.conf` | **首次**仅 80 端口，用于 certbot 签发前避免证书路径错误 |
| `deploy/nginx-api-location.snippet.conf` | 仅反代片段，嵌入已有 server |
| `deploy/quizwiz-api.service` | systemd 单元 |
| `deploy/env.server.template` | 服务端 `.env` 模板 |
| `deploy/env.vite-build.template` | 构建用 `.env.production` 模板 |
| `deploy/first-time-setup.sh` | 新建用户与目录 |
| `deploy/verify.sh` | 健康检查脚本 |
| `init_v3.sql` / `seed_v3.sql` | 数据库初始化与可选种子数据 |
| `../student-front/config/site.js` | 小程序 API 根地址与 AppId 预期（与服务器、公众平台对齐） |
