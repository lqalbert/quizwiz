# QuizWiz 教师端（teacher-admin）

教师管理后台：题库、考试、班级、系统设置等；内置 **Node + Express** API（`server/index.js`）与 **PostgreSQL**。

**推荐本地联调（含 Docker 数据库 + 小程序 `site.local.js`）**：在仓库根目录 **[../README.md](../README.md)** 使用 `npm run setup` 与 `npm run dev`。

## 生产部署

**必读：[deploy/DEPLOY.md](deploy/DEPLOY.md)**（Nginx、`/api` 与 **`/uploads`**、systemd、环境变量、数据库 `init_v3.sql`）。

快速索引：

- 站点与反代：`deploy/nginx-server-www.quizwiz.cn.conf`
- 服务端环境模板：`deploy/env.server.template`
- 前端构建环境模板：`deploy/env.vite-build.template`
- 健康检查：`bash deploy/verify.sh https://你的域名`

## 本地开发

```bash
cp .env.example .env
# 填写 DATABASE_URL 或 PG*、JWT_SECRET、VITE_API_BASE_URL=http://127.0.0.1:3000
npm install
npm run dev:api   # API 默认 :3000
npm run dev       # Vite，/api 与 /uploads 代理见 vite.config.ts
```

构建：

```bash
cp deploy/env.vite-build.template .env.production
# 设置 VITE_API_BASE_URL 为线上教师端访问源（如 https://www.quizwiz.cn）
npm run build
```

## 技术栈

React 19、TypeScript、Vite、Ant Design、Express 5、PostgreSQL。
