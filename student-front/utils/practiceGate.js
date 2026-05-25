const { syncNeedJoinClassFromServer, OPEN_JOIN_MODAL_KEY } = require("./joinClass.js");

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

/** 打开入班弹框：当前页有 openJoinModal 则直接弹出，否则切到「我的」并自动打开 */
function openJoinClassModal() {
  const pages = getCurrentPages();
  const page = pages.length ? pages[pages.length - 1] : null;
  if (page && typeof page.openJoinModal === "function") {
    page.openJoinModal();
    return;
  }
  try {
    wx.setStorageSync(OPEN_JOIN_MODAL_KEY, "1");
  } catch (_) {}
  wx.switchTab({ url: "/pages/mine/index" });
}

/** 已登录未入班：引导弹出加入班级弹框 */
function promptJoinClass() {
  return new Promise((resolve) => {
    wx.showModal({
      title: "尚未加入班级",
      content: "请先填写真实姓名与班级邀请码，加入班级后再刷题。",
      confirmText: "加入班级",
      cancelText: "稍后",
      success: (res) => {
        if (res.confirm) openJoinClassModal();
        resolve(false);
      },
      fail: () => resolve(false),
    });
  });
}

/** @deprecated 兼容旧名 */
const promptJoinClassOnMine = promptJoinClass;

/** 刷题前须已登录且已入班 */
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
    return promptJoinClass();
  }
  return true;
}

function isNeedJoinClassError(err) {
  return Boolean(err && err.statusCode === 403 && err.apiCode === "NEED_JOIN_CLASS");
}

module.exports = {
  hasToken,
  promptLogin,
  openJoinClassModal,
  promptJoinClass,
  promptJoinClassOnMine,
  requireAuthNavigate,
  ensureReadyForPractice,
  isNeedJoinClassError,
};
