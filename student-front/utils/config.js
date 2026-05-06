/**
 * API 根地址（与 teacher-admin Node 服务一致，不要末尾 /）
 * 优先级：app.globalData.apiBase > 本地存储 api_base > config/site.js > 下方兜底
 * 真机连本地 API 时可在调试器 Storage 写入 api_base 覆盖。
 */
let siteDefaults = { defaultApiBase: "", expectedMiniProgramAppId: "" };
try {
  siteDefaults = require("../config/site.local.js");
} catch (_) {
  try {
    siteDefaults = require("../config/site.js");
  } catch (_) {
    /* 使用下方兜底 */
  }
}
const FALLBACK_API_BASE = "https://www.quizwiz.cn";
const DEFAULT_API_BASE = String(siteDefaults.defaultApiBase || "").trim() || FALLBACK_API_BASE;

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

function getExpectedMiniProgramAppId() {
  return String(siteDefaults.expectedMiniProgramAppId || "").trim();
}

module.exports = { getApiBase, getExpectedMiniProgramAppId };
