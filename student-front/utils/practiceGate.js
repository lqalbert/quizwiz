const { syncNeedJoinClassFromServer } = require("./joinClass.js");

function hasToken() {
  return Boolean(wx.getStorageSync("student_token"));
}

/** 浏览各页不拦截；保留兼容旧调用 */
function requireAuthNavigate() {
  return true;
}

/** 未登录：引导去登录页（navigateTo，保留浏览栈） */
function promptLogin() {
  return new Promise((resolve) => {
    wx.showModal({
      title: "需要登录",
      content: "开始刷题前请先登录微信账号。",
      confirmText: "去登录",
      cancelText: "暂不",
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: "/pages/login/index" });
        }
        resolve(false);
      },
      fail: () => resolve(false),
    });
  });
}

/** 已登录未入班：引导至「我的」页加入班级 */
function promptJoinClassOnMine() {
  return new Promise((resolve) => {
    wx.showModal({
      title: "尚未加入班级",
      content: "请先在「我的」页面填写真实姓名与班级邀请码，加入班级后再刷题。",
      confirmText: "去我的",
      cancelText: "稍后",
      success: (res) => {
        if (res.confirm) {
          wx.switchTab({ url: "/pages/mine/index" });
        }
        resolve(false);
      },
      fail: () => resolve(false),
    });
  });
}

/** 刷题前须已登录（入班在「我的」页完成） */
async function ensureReadyForPractice() {
  if (!hasToken()) {
    return promptLogin();
  }
  let needJoin = false;
  try {
    const st = await syncNeedJoinClassFromServer();
    needJoin = st.needJoin;
  } catch (e) {
    if (e && e.statusCode === 401) {
      wx.removeStorageSync("student_token");
      wx.removeStorageSync("need_join_class");
      try {
        getApp().globalData.token = "";
      } catch (_) {}
      return promptLogin();
    }
    needJoin = wx.getStorageSync("need_join_class") === "1";
  }
  if (needJoin) {
    return promptJoinClassOnMine();
  }
  return true;
}

function isNeedJoinClassError(err) {
  return Boolean(err && err.statusCode === 403 && err.apiCode === "NEED_JOIN_CLASS");
}

module.exports = {
  hasToken,
  promptLogin,
  promptJoinClassOnMine,
  requireAuthNavigate,
  ensureReadyForPractice,
  isNeedJoinClassError,
};
