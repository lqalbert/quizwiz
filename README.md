# QuizWiz

| 目录 | 说明 |
|------|------|
| `teacher-admin/` | 教师管理端（React + Vite + Node API + PostgreSQL） |
| `student-front/` | 学生微信小程序（与教师端同一套 API / 数据库） |

---

## 本地一键：API + 教师端页面 + 小程序联调

**依赖**：本机已安装 **Docker**、**Node.js 20+**。

```bash
cd QuizWiz
npm run setup          # 首次：安装根目录与 teacher-admin 依赖
npm run dev            # 首次会自动复制 env.local.example → local.dev.env 后退出，请编辑再执行一次
```

第二次起 `npm run dev` 会：

1. 用 **Docker** 启动 PostgreSQL（**主机端口 5433**），首次自动执行 `init_v3.sql` + `seed_v3.sql`
2. 根据 `local.dev.env` 生成 **`student-front/config/site.local.js`**（小程序走本地 API）
3. 同时启动 **Node API**（`:3000`）与 **Vite**（`:5173`）

**教师端**：浏览器打开 **http://127.0.0.1:5173**（演示账号见 `env.local.example` 内说明）。

**小程序**：用微信开发者工具打开 `student-front/`。本地联调请在 **详情 → 本地设置** 勾选 **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**。真机调试时把 `local.dev.env` 里的 **`MINIPROGRAM_DEV_API_BASE`** 改成 `http://你的电脑局域网IP:3000`，保存后再 `npm run dev`。

**重置本地数据库**：`npm run db:reset`（会清空 Docker 卷后重建）。

---

## 生产部署（教师端 + API + 小程序用线上真实数据）

**目标**：教师端用 **`https://www.你的域名`** 管理数据，小程序请求**同一域名**下的 `/api`，与教师端**同一数据库**，联调时展示的就是你在教师端产生的真实数据。

- **清单式说明（四处一致 + 删除 `site.local.js`）**：[teacher-admin/deploy/SAME_DOMAIN_MINIPROGRAM.md](teacher-admin/deploy/SAME_DOMAIN_MINIPROGRAM.md)  
- **服务器逐步操作**：[teacher-admin/deploy/DEPLOY.md](teacher-admin/deploy/DEPLOY.md)（含 **§10、§10.1**）  
- **小程序工程说明**：[student-front/README.md](student-front/README.md)

---

## 手动本地（不用 Docker 时）

见 **[teacher-admin/README.md](teacher-admin/README.md)**。
