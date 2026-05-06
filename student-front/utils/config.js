/**
 * API 根地址（与 teacher-admin Node 服务一致，不要末尾 /）
 * 优先级：app.globalData.apiBase > 本地存储 api_base > 本默认值
 * 真机/体验版一般只用默认值即可；开发者工具连本地时可在调试器 Storage 写入 api_base 覆盖。
 */
/** 须与微信公众平台「服务器域名」request 列表完全一致（含是否带 www） */
const DEFAULT_API_BASE = "https://www.quizwiz.cn";

function getApiBase() {
  try {
    const app = getApp();
    const g = app && app.globalData && app.globalData.apiBase;
    if (g && String(g).trim()) return String(g).trim().replace(/\/$/, "");
  } catch (_) {
    /* getApp 在首屏前可能不可用 */
  }
  const fromStorage = wx.getStorageSync("api_base");
  if (fromStorage && String(fromStorage).trim()) return String(fromStorage).trim().replace(/\/$/, "");
  return String(DEFAULT_API_BASE || "").replace(/\/$/, "");
}

module.exports = { getApiBase };
