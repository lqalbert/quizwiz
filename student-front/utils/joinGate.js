/** 已登录但未入班：回到首页展示入班表单（不在登录页拦截） */
function redirectIfNeedJoinClass() {
  const token = wx.getStorageSync("student_token") || "";
  if (!token) return false;
  if (wx.getStorageSync("need_join_class") !== "1") return false;
  const pages = getCurrentPages();
  const cur = pages[pages.length - 1];
  const route = cur && (cur.route || cur.__route__ || "");
  if (route === "pages/home/index") return false;
  wx.switchTab({ url: "/pages/home/index" });
  return true;
}

module.exports = { redirectIfNeedJoinClass };
