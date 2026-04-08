# QuizWiz Backend (MVP)

Node + MySQL backend for question bank management.

## 1. Setup

1. Copy env file:
   - `cp .env.example .env`
2. Update MySQL credentials in `.env`.
3. Install dependencies:
   - `npm install`
4. Initialize schema:
   - Run `sql/schema_v1.sql` in MySQL (新库).
   - 若库已存在、仅补用户表：执行 `sql/auth_users_v1.sql`.
5. Start server:
   - `npm run dev`

## 2. Authentication

- `POST /admin/auth/login` — body: `{ "username", "password" }`（兼容 `email` 字段），返回 `token`
- 用户名规则：长度 2-20 位，且仅支持汉字、字母、数字（不支持空格和特殊符号）
- `GET /admin/auth/me` — `Authorization: Bearer <token>`
- 除 `GET /health` 与 `/admin/auth/*` 外，**`/admin/questions/*` 均需 Bearer 令牌**
- 配置 `.env`：`JWT_SECRET`、`BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD`（其中 `BOOTSTRAP_ADMIN_EMAIL` 作为“用户名”使用；首次启动自动创建 admin，若用户名已存在则跳过）

## 3. Current endpoints

- `GET /health`
- `GET /admin/questions` (supports filters: `questionType`, `status`, `chapter`, `difficulty`, `keyword`, `knowledgePoint`)
- `DELETE /admin/questions/:id` (soft delete, admin only)
- `POST /admin/questions`
- `PUT /admin/questions/:id`
- `POST /admin/questions/import/preview`
- `POST /admin/questions/import`
- `GET /admin/questions/import/jobs`
  - 支持 `startDate=YYYY-MM-DD`、`endDate=YYYY-MM-DD`
- `GET /admin/questions/import/jobs/:id/rows`
  - Supports `failedOnly=true` for quick failed-row filtering
- `GET /admin/questions/import/jobs/:id/rows/export`
  - 导出 CSV（默认 `failedOnly=true`）
- `GET /admin/questions/import/jobs/:id/summary`
- `GET /admin/users` (admin only)
- `POST /admin/users` (admin only)
- `PATCH /admin/users/:id/password` (admin only)
- `PATCH /admin/users/:id/status` (admin only)
- `PATCH /admin/users/:id/role` (admin only)

## 4. Excel template

- Standard template file:
  - `templates/question_import_template.xlsx`

## 5. Remaining tasks

- Add pagination total count and richer list fields (knowledge points).
- Add integration tests for import and duplicate handling.
- 用户安全策略：
  - 不允许禁用当前登录管理员账号
  - 不允许把系统最后一个启用中的管理员禁用

## 6. API test collection

- Script path:
  - `scripts/api-tests.sh`
  - `scripts/smoke-regression.sh`（增强版，带断言，失败即退出）
- Make it executable and run:
  - `chmod +x scripts/api-tests.sh`
  - `./scripts/api-tests.sh`
  - `chmod +x scripts/smoke-regression.sh`
  - `./scripts/smoke-regression.sh`
- Optional env overrides:
  - `BASE_URL=http://127.0.0.1:3000 ./scripts/api-tests.sh`
  - `ADMIN_USERNAME=... ADMIN_PASSWORD=... ./scripts/api-tests.sh`（需与 `.env` 中 bootstrap 或已存在用户一致）
  - `TEMPLATE_PATH=/absolute/path/to/your.xlsx ./scripts/api-tests.sh`
  - `GENERATED_TEMPLATE_PATH=/tmp/custom.xlsx ./scripts/api-tests.sh`
  - `BASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... ./scripts/smoke-regression.sh`

## 7. Regression checklist

- 文件：`docs/regression-checklist.md`
- 建议每次发布前按 checklist 全量回归
## 8. Lightweight admin pages

- Login: `http://127.0.0.1:3000/admin-ui/login.html`
- Task list page: `http://127.0.0.1:3000/admin-ui/index.html`
- User management page (admin): `http://127.0.0.1:3000/admin-ui/users.html`
- Task detail page: `http://127.0.0.1:3000/admin-ui/detail.html?id=<jobId>`
- Task list page supports Excel upload buttons:
  - Preview upload -> `POST /admin/questions/import/preview`
  - Import upload -> `POST /admin/questions/import`
  - Template download (with auth + audit) -> `GET /admin/templates/question-import`

## 9. Production deployment templates

- PM2 config: `deploy/ecosystem.config.cjs`
- Nginx reverse proxy template: `deploy/nginx.quizwiz.conf`
- Production env example: `deploy/.env.production.example`
- MySQL backup script: `deploy/backup-mysql.sh`
- Step-by-step deployment guide: `deploy/deploy-guide.md`
