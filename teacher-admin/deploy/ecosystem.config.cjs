/**
 * PM2 配置（无密钥，密钥放在同目录 .env 由 dotenv 加载）
 * 使用：在服务器 cd ~/QuizWiz/teacher-admin 后执行（路径请与 cwd 一致）
 *   pm2 delete quizwiz-api 2>/dev/null; pm2 start deploy/ecosystem.config.cjs && pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'quizwiz-api',
      cwd: '/home/ubuntu/QuizWiz/teacher-admin',
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
