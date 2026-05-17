/**
 * 独立执行与 API 进程相同的启动期 schema 迁移（幂等）。
 * 用法（在 teacher-admin 目录）：`npm run db:migrate`
 * 生产可设 QUIZWIZ_RUN_MIGRATIONS_ON_BOOT=0，仅在部署脚本中调用本命令后再启动 API。
 */
import { pool } from './db/pool.js'
import { runBootMigrations } from './migrations/runBootMigrations.js'

try {
  await runBootMigrations()
  console.log('[quizwiz] db:migrate 完成')
} catch (error) {
  console.error('[quizwiz] db:migrate 失败:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
