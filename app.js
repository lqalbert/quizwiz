// app.js
App({
  globalData: {
    // 生产：与 DNS（A → 服务器 IP）及 Nginx HTTPS 一致；小程序后台「request 合法域名」填 www.quizwiz.cn
    // 本地调试可改为 http://127.0.0.1:3000 并在开发者工具勾选不校验合法域名
    apiBaseUrl: 'https://www.quizwiz.cn',
  },
  onLaunch() {},
});
