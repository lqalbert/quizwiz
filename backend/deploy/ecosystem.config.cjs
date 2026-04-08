module.exports = {
  apps: [
    {
      name: 'quizwiz-backend',
      cwd: '/opt/quizwiz/backend',
      script: 'src/server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/quizwiz/backend-error.log',
      out_file: '/var/log/quizwiz/backend-out.log',
      time: true,
    },
  ],
};
