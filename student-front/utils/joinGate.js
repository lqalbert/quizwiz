/** 已登录但未入班：强制回到登录页完成入班，避免各页重复判断 */
function redirectIfNeedJoinClass() {
  const token = wx.getStorageSync("student_token") || "";
  if (!token) return false;
  if (wx.getStorageSync("need_join_class") !== "1") return false;
  wx.reLaunch({ url: "/pages/login/index" });
  return true;
}

module.exports = { redirectIfNeedJoinClass };
