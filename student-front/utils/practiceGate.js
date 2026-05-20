const { syncNeedJoinClassFromServer, submitJoinByInvite } = require("./joinClass.js");

function hasToken() {
  return Boolean(wx.getStorageSync("student_token"));
}

/** 子页面（错题本、考试等）须登录时调用，不 reLaunch 以免打断浏览栈 */
function requireAuthNavigate() {
  if (hasToken()) return true;
  wx.showModal({
    title: "需要登录",
    content: "该功能需登录后使用。",
    confirmText: "去登录",
    cancelText: "返回",
    success: (res) => {
      if (res.confirm) wx.navigateTo({ url: "/pages/login/index" });
      else {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack();
        else wx.switchTab({ url: "/pages/home/index" });
      }
    },
  });
  return false;
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

/**
 * 刷题前须：已登录 + 已入班（含真实姓名）。
 * @param {object} pageCtx - 页面实例；若提供 setData，可在页内展示入班表单（joinPanel* 字段）
 */
async function ensureReadyForPractice(pageCtx) {
  if (!hasToken()) {
    return promptLogin();
  }
  let needJoin = false;
  let pendingManual = false;
  try {
    const st = await syncNeedJoinClassFromServer();
    needJoin = st.needJoin;
    pendingManual = st.pendingManual;
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
    pendingManual = needJoin && wx.getStorageSync("join_pending_manual") === "1";
  }
  if (!needJoin) {
    if (pageCtx && typeof pageCtx.setData === "function") {
      pageCtx.setData({ joinPanelVisible: false, joinPanelMode: "form" });
    }
    return true;
  }
  if (pageCtx && typeof pageCtx.setData === "function") {
    pageCtx.setData({
      joinPanelVisible: true,
      joinPanelMode: pendingManual ? "pending" : "form",
    });
    return false;
  }
  return new Promise((resolve) => {
    wx.showModal({
      title: "需要加入班级",
      content: "开始刷题前请填写真实姓名与班级邀请码。请前往「刷题」页完成入班信息。",
      confirmText: "知道了",
      showCancel: false,
      success: () => resolve(false),
      fail: () => resolve(false),
    });
  });
}

async function submitJoinOnPage(pageCtx) {
  if (!pageCtx || typeof pageCtx.setData !== "function") return false;
  const invite = String(pageCtx.data.joinInviteInput || "").trim();
  const realName = String(pageCtx.data.joinRealNameInput || "").trim();
  pageCtx.setData({ joinSubmitting: true });
  wx.showLoading({ title: "提交中", mask: true });
  try {
    const result = await submitJoinByInvite({ inviteCode: invite, realName });
    wx.hideLoading();
    if (result.mode === "manual") {
      pageCtx.setData({
        joinPanelMode: "pending",
        joinSubmitting: false,
      });
      wx.showToast({ title: result.message, icon: "none", duration: 2800 });
      return false;
    }
    pageCtx.setData({
      joinPanelVisible: false,
      joinPanelMode: "form",
      joinInviteInput: "",
      joinRealNameInput: "",
      joinSubmitting: false,
    });
    wx.showToast({ title: result.message, icon: "success" });
    return true;
  } catch (err) {
    wx.hideLoading();
    pageCtx.setData({ joinSubmitting: false });
    wx.showToast({ title: (err && err.message) || "加入失败", icon: "none" });
    return false;
  }
}

module.exports = {
  hasToken,
  promptLogin,
  requireAuthNavigate,
  ensureReadyForPractice,
  submitJoinOnPage,
};
