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

## 本地 / 体验版调试

推荐在仓库根目录使用 **`npm run dev`**（见根目录 `README.md`），会自动生成 **`config/site.local.js`**。

也可在开发者工具 **Storage** 写入 `api_base` 临时覆盖 API 根（优先级最高）。
