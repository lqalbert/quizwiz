# 学生微信小程序（student-front）

与 **教师端 Node API 同一数据库与接口**；统一在 **`config/site.js`** 配置默认 API 根地址与预期 AppId。

**教师端已用域名上线、小程序要拉线上真实数据**（与网页里改的数据一致）：按 **[../teacher-admin/deploy/SAME_DOMAIN_MINIPROGRAM.md](../teacher-admin/deploy/SAME_DOMAIN_MINIPROGRAM.md)** 核对四处一致，并删除本机联调产生的 **`config/site.local.js`**（若有）。

## 发布前检查（与服务器一并核对）

1. 教师端已按 [../teacher-admin/deploy/DEPLOY.md](../teacher-admin/deploy/DEPLOY.md) 部署，`GET /api/health` 正常。
2. 编辑 **`config/site.js`**：`defaultApiBase`、`expectedMiniProgramAppId`。
3. **`project.config.json`** 中的 **`appid`** 与 `site.js` 里 `expectedMiniProgramAppId` **相同**。
4. 服务器 **`WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET`** 与同一小程序在公众平台上的密钥一致。
5. 微信公众平台 → **服务器域名**：`request` / `uploadFile` 等与 `defaultApiBase` 的协议和主机一致。

启动时若当前运行的 AppId 与 `site.js` 不一致，控制台会给出警告。

## 登录与入班流程（备案合规）

1. **浏览**：未登录也可打开首页、刷题目录（科目/知识单元）、学习 Tab 说明页；不会强制跳转登录页。
2. **开始刷题**：在刷题 Tab 选择练习方式并组卷时，须先登录；若未入班，会在刷题页填写**真实姓名 + 班级邀请码**（老师端按真实姓名展示）。
3. **登录页**：点击「确认登录」，在微信弹窗中点「允许」即可；登录后返回原页面（若从子页进入）。
4. **首页**：已登录但未入班时，首页展示非遮挡的入班卡片（不阻止浏览）；考试、统计、资料等仍须入班后使用。

公开浏览接口（无需 token）：`GET /api/public/catalog/subjects`、`knowledge-units`、`unit-detail`。

## 本地 / 体验版调试

推荐在仓库根目录使用 **`npm run dev`**（见根目录 `README.md`），会自动生成 **`config/site.local.js`**。

也可在开发者工具 **Storage** 写入 `api_base` 临时覆盖 API 根（优先级最高）。
