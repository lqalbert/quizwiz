# QuizWiz 最小可用集成测试清单（CI 门禁）

本清单用于发布前快速阻断关键回归，优先覆盖“题目纠错反馈”主链路。

## 1. 目标

- 保证核心接口可用（登录、题库、导入、反馈）
- 保证关键权限不被破坏（teacher 不可确认删题）
- 保证反馈新能力不回归（去重、聚合、排序、影响面）

## 2. 最小门禁项（必须通过）

- [ ] `GET /health` 返回 200
- [ ] 管理员登录成功
- [ ] 创建/软删题目成功
- [ ] 导入预检成功
- [ ] 反馈聚合视图可用（`view=question`）
- [ ] 聚合排序可用（`sortBy=reportCount`）
- [ ] 影响面接口可用（`/admin/question-reports/question-impact/:questionId`）
- [ ] teacher 调用 `confirm-delete-question` 返回 403

## 3. 可选增强项（建议）

- [ ] 学生提报纠错成功
- [ ] 同学生同题二次提报命中去重（同 `id`，`merged=true`）
- [ ] 管理员确认删题后：题目软删 + 工单关闭

> 说明：以上可选项依赖 `STUDENT_TOKEN`，建议在预发环境开启。

## 4. 一键命令（本地/CI 通用）

在后端目录执行：

```bash
cd /Users/liuqing/projects/QuizWiz/backend
bash scripts/ci-gate.sh
```

服务器结构若为 `/opt/quizwiz/backend/backend`：

```bash
cd /opt/quizwiz/backend/backend
bash scripts/ci-gate.sh
```

## 5. 常用环境变量

- `BASE_URL`：服务地址，默认 `http://127.0.0.1:3000`
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：后台账号
- `TEMPLATE_PATH`：导入模板绝对路径
- `STUDENT_TOKEN`：开启可选完整链路时使用

示例：

```bash
cd /opt/quizwiz/backend/backend
BASE_URL="http://127.0.0.1:3000" \
ADMIN_USERNAME="admin001" \
ADMIN_PASSWORD="changeme" \
bash scripts/ci-gate.sh
```

## 6. 失败排查建议

- 健康检查失败：先确认服务进程与端口
- 登录失败：核对管理员账号与密码
- 导入失败：核对模板路径、数据库导入相关表
- 反馈相关失败：确认执行过 `sql/question_reports_v1.sql`、`sql/schema_v2.sql`、`sql/question_favorites_v1.sql`
