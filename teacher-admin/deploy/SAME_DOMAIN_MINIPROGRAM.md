# 教师端域名访问 + 小程序展示同一套真实数据

你要的效果：**浏览器打开 `https://www.你的域名` 管理题库**；**小程序里 `wx.request` 也请求 `https://www.你的域名/api/...`**，两边读写**同一 PostgreSQL**，教师在网页里新增/修改的数据，小程序联调时立刻能看到。

---

## 达成条件（四处一致）

| 序号 | 位置 | 必须一致的内容 |
|------|------|------------------|
| 1 | 浏览器打开教师端 | `https://www.你的域名`（示例：`https://www.quizwiz.cn`） |
| 2 | 服务器 `teacher-admin/.env` | `UPLOAD_PUBLIC_BASE=https://www.你的域名`；`WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET` 与小程序一致 |
| 3 | 构建教师端时的 `.env.production` | `VITE_API_BASE_URL=https://www.你的域名` |
| 4 | `student-front/config/site.js` | `defaultApiBase: "https://www.你的域名"` |
| 5 | `student-front/project.config.json` | `appid` 与服务器 `WECHAT_MINI_APPID` 相同 |
| 6 | 微信公众平台 → 服务器域名 | `request`、`uploadFile` 等合法域名为 **`https://www.你的域名`**（与上表主机名完全一致，含 `www`、含 `https`） |

---

## 联调前多检查一项

若你本机曾运行仓库根目录的 **`npm run dev`**，可能生成 **`student-front/config/site.local.js`**（指向本机 API）。  
联调**线上真实数据**前请 **删除或改名** `site.local.js`，否则小程序仍会请求本机，看不到服务器上的数据。

---

## 部署与详细步骤

服务器 Nginx、HTTPS、systemd、数据库初始化、发版命令等，见 **[DEPLOY.md](./DEPLOY.md)**，尤其 **§10** 与 **§10.1**。

联调时上传小程序 **开发版或体验版** 即可；公众平台需添加体验成员。无需在开发者工具勾选「不校验合法域名」（那是访问本机 HTTP 时用的）。
