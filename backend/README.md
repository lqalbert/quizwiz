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
   - 若启用学生端 V2（学科/练习会话/错题本）：执行 `sql/schema_v2.sql`.
   - 若已有 `schema_v2.sql` 老库，需要补“重点复习”字段：执行 `sql/wrong_questions_priority_v1.sql`.
   - 题目收藏：执行 `sql/question_favorites_v1.sql`.
   - 学生题目纠错反馈：执行 `sql/question_reports_v1.sql`.
   - 教师班级学情（班级看板 / 学生时间线 / 班级易错题）：执行 `sql/classes_v1.sql`（依赖 `users`、`wx_students`；练习统计依赖 `sql/schema_v2.sql` 中的会话与答题表）。
   - 若班级表已存在、需补充**邀请码**列（学生凭码加入班级）：执行 `sql/classes_invite_code_v1.sql`。
   - **班级作业闭环**：执行 `sql/class_assignments_v1.sql`（依赖 `classes`、`questions`、`practice_sessions`）。
5. Start server:
   - `npm run dev`

## 2. Authentication

- `POST /admin/auth/login` — body: `{ "username", "password" }`（兼容 `email` 字段），返回 `token`
- 用户名规则：长度 2-20 位，且仅支持汉字、字母、数字（不支持空格和特殊符号）
- `GET /admin/auth/me` — `Authorization: Bearer <token>`
- 除 `GET /health` 与 `/admin/auth/*` 外，**`/admin/questions/*` 均需 Bearer 令牌**
- 配置 `.env`：`JWT_SECRET`、`BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD`（其中 `BOOTSTRAP_ADMIN_EMAIL` 作为“用户名”使用；首次启动自动创建 admin，若用户名已存在则跳过）

### 微信小程序学生登录

- 在 `.env` 配置：`WX_APP_ID`、`WX_APP_SECRET`（微信公众平台 → 开发 → 开发管理 → 开发设置 → AppID / AppSecret）
- 数据库执行 `sql/wx_students_v1.sql`（或已包含该表的完整 `schema_v1.sql`）
- `POST /wx/auth/login` — body：`{ "code" }`（由小程序 `wx.login` 取得），返回 `{ token, user: { id, role: "student" } }`
- `GET /wx/auth/me` — 请求头 `Authorization: Bearer <token>`
- `GET /wx/questions`、`POST /wx/quiz/submit` — 均需同上学生 token（与教师后台共用 `JWT_SECRET`，JWT 内 `role` 为 `student`）

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
- `GET /admin/subjects` (admin only)
- `POST /admin/subjects` (admin only)
- `PATCH /admin/subjects/:id` (admin only)
- `PATCH /admin/subjects/:id/status` (admin only)
- `GET /admin/question-reports` (登录教师/管理员；查询参数 `status`、`page`、`pageSize`、`view=detail|question`；当 `view=question` 时支持 `sortBy=priorityScore|latestReportedAt|reportCount`、`sortOrder=asc|desc`、`highRiskOnly=true|false`，默认按 `priorityScore desc`)
- `GET /admin/question-reports/question-impact/:questionId` (登录教师/管理员；删除前影响面统计：反馈数、练习记录数、收藏数、错题数)
- `GET /admin/question-reports/dashboard` (登录教师/管理员；反馈总量、待处理分布、近7日趋势、学科分布看板)
- `PATCH /admin/question-reports/:id` (body: `status` open/reviewing/closed，可选 `adminNote`)
- `POST /admin/question-reports/batch` (登录教师/管理员；批量处理，`action=setStatus|setNote|markFixNeeded`，其中 `markFixNeeded` 仅 admin)
- `POST /admin/question-reports/:id/mark-fix-needed` (admin only；将题目标记为 `archived`、工单置为 `reviewing`，不删除题目)
- `POST /admin/question-reports/:id/replace-question` (admin only；body: `replacementQuestionId`，将工单替换到新题并关闭工单)
- `POST /admin/question-reports/republish-question` (admin only；body: `questionId`；将 `archived` 题目恢复为 `published`，并关闭该题下所有 `open`/`reviewing` 工单；可选 `adminNote`)
- `POST /admin/question-reports/:id/confirm-delete-question` (admin only；与删除题目接口一致为软删，并关闭工单；body 可选 `adminNote`，未传时使用默认说明)
- `GET /admin/classes` · `POST /admin/classes`（body: `name`）· `GET|PATCH|DELETE /admin/classes/:id`（教师仅能操作本人班级；管理员可看全部）
- `GET /admin/classes/:id/members` · `POST /admin/classes/:id/members`（body: `studentId` 为 `wx_students.id`，可选 `note`）· `DELETE /admin/classes/:id/members/:studentId`
- `GET /admin/classes/:id/dashboard?days=7`（班级练习汇总、按成员 `byStudent`、按日 `daily`）
- `GET /admin/classes/:id/wrong-questions?days=30&limit=20`（班级范围内易错题排行）
- `GET /admin/classes/:id/students/:studentId/timeline?days=30&page&pageSize`（该生在本班的答题时间线）
- `GET|POST|GET|DELETE /admin/classes/:classId/assignments` · `.../assignments/:assignmentId`（教师布置题目清单作业；POST body：`title`、`questionIds[]`、可选 `dueAt`；GET 明细返回每生是否已提交）
- `POST /wx/classes/join` (student token；body: `inviteCode`，与教师端展示的 8 位邀请码一致)
- `GET /wx/classes/mine` (student token；当前学生已加入的班级列表)
- `GET /wx/assignments` (student token；已加入班级的作业列表及是否完成)
- `POST /wx/practice/start` 增加 `mode=assignment` + `assignmentId`（学生做班级作业，会话会带上 `assignment_id`）
- `GET /wx/subjects` (student token required)
- `GET /wx/stats/practice` (student token required；含汇总 `today` / `last7Days` / `all`，以及按学科 `bySubjectToday` / `bySubjectLast7Days` / `bySubjectAll`，每项含 `subjectId`/`subjectName`/`attempted`/`correct`/`sessions`/`accuracy`)
- `GET /wx/favorites` (student token；可选 `subjectId`、`page`、`pageSize`)
- `POST /wx/favorites` (student token；body `{ "questionId" }`)
- `DELETE /wx/favorites/:questionId` (student token)
- `GET /wx/question-reports` (student token；查询本人反馈状态，支持 `status`、`page`、`pageSize`)
- `POST /wx/question-reports` (student token；body: `questionId`, `reasonType`: answer_wrong/stem_error/option_error/typo/other，可选 `detail` 最多 500 字；同一学生同一题若存在未关闭反馈则更新该条并去重；若同题 24h 内反馈学生数达到阈值会自动提级到 `reviewing`)
- `POST /wx/practice/start` (student token required；`mode=wrong` 时可传 `priorityOnly: true`；`mode=favorite` 从收藏抽题；`mode=sequential` 时按题目 `id` 升序抽题；其余模式随机；返回题目带 `isFavorite`)
- `POST /wx/practice/submit` (student token required；`answers[]` 每项可选 `costMs` 毫秒 0–3600000，写入 `practice_answers.cost_ms`；响应含 `totalCostMs`、`timedQuestions`)
- `GET /wx/wrong-questions` (student token required；查询参数 `priorityOnly=true` 仅列出标记为「重点复习」的错题)
- `POST /wx/wrong-questions/:id/mastered` (student token required)
- `POST /wx/wrong-questions/:id/priority` (student token required)
- `GET /wx/practice/sessions` (student token required)
- `GET /wx/practice/sessions/:id` (student token required)

## 4. Excel template

- Standard template file:
  - `templates/question_import_template.xlsx`
- 导入支持 `学科` 列（用于自动关联 `question_subject_rel`）。
- 选项列兼容两种表头：`选项A/选项B/选项C/选项D` 或 `A选项/B选项/C选项/D选项`。

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
 - 最小 CI 门禁建议：`docs/ci-minimal-test-plan.md`
 - 一键门禁脚本：`scripts/ci-gate.sh`
## 8. Lightweight admin pages

- Login: `http://127.0.0.1:3000/admin-ui/login.html`
- Task list page: `http://127.0.0.1:3000/admin-ui/index.html`
- 题目反馈: `http://127.0.0.1:3000/admin-ui/reports.html`
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
