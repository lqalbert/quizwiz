# QuizWiz 生产部署指南（PM2 + Nginx）

## 1. 目录与依赖

- 建议目录：`/opt/quizwiz/backend`
- 安装 Node.js LTS、MySQL 客户端、Nginx、PM2

```bash
npm i -g pm2
```

## 2. 代码与环境变量

```bash
cd /opt/quizwiz/backend
npm install --omit=dev
cp deploy/.env.production.example .env
```

修改 `.env` 里的数据库与密钥配置（尤其 `JWT_SECRET`）。

## 3. 数据库初始化

```bash
mysql -u <user> -p quizwiz < sql/schema_v1.sql
```

## 4. 启动 PM2

先修改 `deploy/ecosystem.config.cjs` 里的 `cwd` 到真实路径，然后执行：

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

## 5. 配置 Nginx

将 `deploy/nginx.quizwiz.conf` 复制到你的 Nginx 站点配置目录并修改域名：

```bash
sudo cp deploy/nginx.quizwiz.conf /etc/nginx/conf.d/quizwiz.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 6. HTTPS（推荐）

以 certbot 为例：

```bash
sudo certbot --nginx -d quizwiz.example.com
```

## 7. MySQL 备份

赋权：

```bash
chmod +x deploy/backup-mysql.sh
```

测试执行：

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=quizwiz DB_PASSWORD=xxx DB_NAME=quizwiz \
BACKUP_DIR=/var/backups/quizwiz RETAIN_DAYS=7 ./deploy/backup-mysql.sh
```

添加 cron（每天凌晨 3 点）：

```bash
0 3 * * * DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=quizwiz DB_PASSWORD=xxx DB_NAME=quizwiz BACKUP_DIR=/var/backups/quizwiz RETAIN_DAYS=7 /opt/quizwiz/backend/deploy/backup-mysql.sh >> /var/log/quizwiz-backup.log 2>&1
```

## 8. 上线后检查

- `curl http://127.0.0.1:3000/health`
- 打开后台登录页并验证登录
- 执行一次 smoke：
  - `BASE_URL=https://quizwiz.example.com ADMIN_USERNAME=... ADMIN_PASSWORD=... ./scripts/smoke-regression.sh`
