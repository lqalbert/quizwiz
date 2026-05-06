/**
 * 本地一键：加载 local.dev.env → Docker PG → 写入小程序 site.local.js → API + Vite
 */
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import dotenv from 'dotenv'
import concurrently from 'concurrently'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const envPath = join(root, 'local.dev.env')
const examplePath = join(root, 'env.local.example')

process.chdir(root)

if (!existsSync(join(root, 'node_modules', 'concurrently'))) {
  console.error('[QuizWiz] 请先在仓库根目录执行: npm install')
  process.exit(1)
}

if (!existsSync(envPath)) {
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath)
  }
  console.error(
    '\n[QuizWiz] 已在仓库根目录创建 local.dev.env（由 env.local.example 复制）。\n' +
      '请编辑 WECHAT_MINI_APPID / WECHAT_MINI_SECRET；真机联调把 MINIPROGRAM_DEV_API_BASE 改为电脑局域网 IP。\n' +
      '保存后再次执行: npm run dev\n',
  )
  process.exit(1)
}

dotenv.config({ path: envPath })

function writeMiniSiteLocal() {
  const base = String(process.env.MINIPROGRAM_DEV_API_BASE || `http://127.0.0.1:${process.env.API_PORT || 3000}`)
    .trim()
    .replace(/\/$/, '')
  const appId = String(process.env.WECHAT_MINI_APPID || '').trim()
  const dir = join(root, 'student-front', 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const body = `/**
 * 由 npm run dev 根据仓库根目录 local.dev.env 自动生成（勿提交）
 */
module.exports = {
  defaultApiBase: ${JSON.stringify(base)},
  expectedMiniProgramAppId: ${JSON.stringify(appId)},
};
`
  writeFileSync(join(dir, 'site.local.js'), body, 'utf8')
  console.log(`[QuizWiz] 已写入 student-front/config/site.local.js → API ${base}`)
  if (!appId) {
    console.warn('[QuizWiz] 提示: WECHAT_MINI_APPID 为空时，学生微信登录不可用。')
  }
}

function dockerUp() {
  console.log('[QuizWiz] 启动 PostgreSQL (docker compose)...')
  execSync('docker compose -f docker-compose.dev.yml up -d', { stdio: 'inherit', cwd: root })
}

async function waitForDb() {
  const max = 60
  for (let i = 0; i < max; i += 1) {
    try {
      execSync('docker compose -f docker-compose.dev.yml exec -T db pg_isready -U quizwiz', {
        stdio: 'ignore',
        cwd: root,
      })
      console.log('[QuizWiz] 数据库已就绪')
      return
    } catch {
      /* retry */
    }
    if (i === 0) console.log('[QuizWiz] 等待 PostgreSQL 就绪...')
    await delay(500)
  }
  throw new Error('PostgreSQL 在超时时间内未就绪，请检查 Docker 与 docker-compose.dev.yml')
}

writeMiniSiteLocal()
dockerUp()
await waitForDb()
await delay(2000)

const ta = join(root, 'teacher-admin')
if (!existsSync(join(ta, 'node_modules'))) {
  console.error('[QuizWiz] 未找到 teacher-admin/node_modules，请先执行: npm run setup')
  process.exit(1)
}

const envForChild = { ...process.env }

console.log('[QuizWiz] 启动 API (dev:api) 与 Vite (dev)，Ctrl+C 结束。\n')

const { result } = concurrently(
  [
    { command: 'npm run dev:api', name: 'api', cwd: ta, env: envForChild },
    { command: 'npm run dev', name: 'vite', cwd: ta, env: envForChild },
  ],
  {
    prefixColors: 'cyan,magenta',
    killOthers: ['failure'],
    restartTries: 0,
  },
)

await result
