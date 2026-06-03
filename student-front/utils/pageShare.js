const { APP_NAME } = require("./brand.js");

const DEFAULT_SHARE_PATH = "/pages/home/index";

const SHARE_TITLE_BY_ROUTE = {
  "pages/home/index": `${APP_NAME} · 每日刷题`,
  "pages/quiz/index": `${APP_NAME} · 一起来刷题`,
  "pages/study/index": `${APP_NAME} · 学习资料`,
  "pages/mine/index": APP_NAME,
  "pages/login/index": `欢迎使用${APP_NAME}`,
};

function currentPageContext() {
  const pages = getCurrentPages();
  const page = pages.length ? pages[pages.length - 1] : null;
  if (!page) {
    return { route: "pages/home/index", query: "", path: DEFAULT_SHARE_PATH };
  }
  const route = page.route || "pages/home/index";
  const options = page.options || {};
  const pairs = Object.keys(options)
    .filter((k) => options[k] != null && options[k] !== "")
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(options[k]))}`);
  const query = pairs.join("&");
  const path = `/${route}${query ? `?${query}` : ""}`;
  return { route, query, path };
}

function resolveShareTitle(page) {
  const custom = page && page.data && page.data.shareTitle;
  if (custom) return String(custom);
  const { route } = currentPageContext();
  return SHARE_TITLE_BY_ROUTE[route] || APP_NAME;
}

/** 开启右上角「转发给朋友」；朋友圈菜单在支持时再追加 */
function enableShareMenu() {
  wx.showShareMenu({
    menus: ["shareAppMessage"],
    success() {
      console.info("[pageShare] 已开启：转发给朋友");
    },
    fail(err) {
      console.warn("[pageShare] 转发给朋友 开启失败", err);
    },
  });
  wx.showShareMenu({
    menus: ["shareAppMessage", "shareTimeline"],
    success() {
      console.info("[pageShare] 已开启：分享到朋友圈");
    },
    fail(err) {
      console.warn("[pageShare] 分享到朋友圈 未开启（账号/基础库可能不支持）", err);
    },
  });
}

function buildAppMessage(page) {
  const { path } = currentPageContext();
  return {
    title: resolveShareTitle(page),
    path,
  };
}

function buildTimeline(page) {
  const { query } = currentPageContext();
  return {
    title: resolveShareTitle(page),
    query,
  };
}

module.exports = {
  enableShareMenu,
  buildAppMessage,
  buildTimeline,
};
