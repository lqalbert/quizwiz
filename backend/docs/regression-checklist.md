# QuizWiz 回归测试清单

每次发布前至少执行一轮，建议按顺序检查。

## A. 环境与启动

- [ ] MySQL 服务正常，`quizwiz` 库可连接
- [ ] 后端启动成功：`npm run dev`
- [ ] 健康检查通过：`GET /health` 返回 `{"ok":true}`

## B. 登录与权限

- [ ] 使用 admin 正常登录
- [ ] 使用错误密码登录失败（401）
- [ ] 退出登录后访问 `/admin-ui/index.html` 会跳转登录页
- [ ] teacher 账号无法访问 admin-only 用户管理接口（403）
- [ ] teacher 账号调用 `POST /admin/question-reports/:id/confirm-delete-question` 被拒绝（403）

## C. 用户管理

- [ ] 创建用户成功（用户名 2-20 位，仅汉字/字母/数字）
- [ ] 重复用户名创建失败（409）
- [ ] 非法用户名创建失败（400）
- [ ] 重置密码成功
- [ ] 启用/禁用用户成功
- [ ] 禁用当前登录管理员被拒绝
- [ ] 禁用最后一个启用 admin 被拒绝
- [ ] 降级最后一个启用 admin 为 teacher 被拒绝

## D. 题库管理

- [ ] 创建题目成功
- [ ] 更新题目成功并版本号递增
- [ ] 按知识点筛选列表可返回数据
- [ ] 删除题目（软删）成功（admin only）

## E. Excel 导入

- [ ] 模板下载成功
- [ ] 预检成功路径可返回 `jobId`
- [ ] 导入成功路径可返回 `successCount > 0`
- [ ] 重复导入返回 `DUPLICATE_QUESTION`
- [ ] 导入任务列表查询可用（含日期筛选）
- [ ] 导入详情行查询可用（含 `failedOnly=true`）
- [ ] 导入汇总接口可用
- [ ] 失败行 CSV 导出可下载并有内容

## F. 审计日志（数据库）

- [ ] 写操作审计有真实 `actor_id` / `actor_role`
- [ ] 读操作审计存在（如 READ_IMPORT_JOBS / READ_QUESTION_LIST）
- [ ] 模板下载审计存在（READ_TEMPLATE_DOWNLOAD）
- [ ] 通过纠错确认删除题目后存在 `DELETE_QUESTION` 审计

建议 SQL：

```sql
SELECT id, actor_id, actor_role, action, object_type, object_id, created_at
FROM audit_logs
ORDER BY id DESC
LIMIT 50;
```

## G. 题目纠错反馈

- [ ] 学生提交纠错成功：`POST /wx/question-reports`
- [ ] 同一学生同一题重复提交时触发去重（返回同一个 `id`，第二次 `merged=true`）
- [ ] 管理端列表可见反馈：`GET /admin/question-reports`
- [ ] 管理端按题聚合视图可用：`GET /admin/question-reports?view=question`
- [ ] 可正常流转状态：`open -> reviewing -> closed`
- [ ] 管理员执行 `confirm-delete-question` 后：题目软删、工单关闭、备注写入

## H. 自动化 smoke

- [ ] 执行 `scripts/smoke-regression.sh` 全部通过
- [ ] 归档脚本输出中的临时目录（包含关键响应与导出文件）
- [ ] 若设置 `STUDENT_TOKEN`，验证“学生提报 -> 管理员确认删除”完整链路
- [ ] 若设置 `CONFIRM_DELETE_REPORT_ID`，验证对既有工单的直接确认删除
