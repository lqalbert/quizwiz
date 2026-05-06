/**
 * 小程序与教师端服务器「一处配置」
 *
 * 1. defaultApiBase：与已部署的 teacher-admin API 同源（协议 + 主机名，无末尾 /）。
 *    若线上统一使用「带 www」的域名（如 https://www.example.com），则此处、教师端
 *    VITE_API_BASE_URL、UPLOAD_PUBLIC_BASE、微信公众平台 request/uploadFile 白名单
 *    必须同为该主机名，不可混用裸域与 www，否则跨域或域名校验失败。
 * 2. expectedMiniProgramAppId：须与下面两处完全相同，否则学生微信登录会失败：
 *    - 本项目的 project.config.json → "appid"
 *    - 教师端服务器 .env → WECHAT_MINI_APPID（以及 WECHAT_MINI_SECRET 对应同一小程序）
 */
module.exports = {
  defaultApiBase: "https://www.quizwiz.cn",
  expectedMiniProgramAppId: "wxda81343eb7dbf460",
};
