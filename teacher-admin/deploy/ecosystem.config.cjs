/**
 * PM2 配置（无密钥，密钥放在同目录 .env 由 dotenv 加载）
 * 使用：在服务器 cd /srv/quizwiz/teacher-admin 后执行
 *   pm2 delete quizwiz-api 2>/dev/null; pm2 start deploy/ecosystem.config.cjs && pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'quizwiz-api',
      cwd: '/srv/quizwiz/teacher-admin',
      script: 'server/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        API_PORT: '3000',
      },
    },
  ],
}
