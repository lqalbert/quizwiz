/** 未入班 403：标记本地并回到首页入班层，勿跳转登录页（避免与登录页互跳） */
function redirectToJoinHomeIfNeeded() {
  try {
    wx.setStorageSync("need_join_class", "1");
  } catch (_) {}
  const pages = getCurrentPages();
  const cur = pages.length ? pages[pages.length - 1] : null;
  const route = cur && String(cur.route || cur.__route__ || "");
  if (route === "pages/home/index") return;
  wx.switchTab({ url: "/pages/home/index" });
}

module.exports = { redirectToJoinHomeIfNeeded };
