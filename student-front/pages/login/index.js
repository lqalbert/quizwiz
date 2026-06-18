const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");
const { setNeedJoinClass } = require("../../utils/joinClass.js");
const { ensureOnlineSession } = require("../../utils/onlineSession.js");
const withPageShare = require("../../utils/withPageShare.js");

withPageShare({
  data: {
    _loginInFlight: false,
  },

  onLoad() {
    const token = wx.getStorageSync("student_token") || "";
    if (token) {
      wx.switchTab({ url: "/pages/home/index" });
    }
  },

  async onTapWechatLogin() {
    if (this.data._loginInFlight) return;
    const base = getApiBase();
    if (!base) {
      wx.showToast({ title: "未配置 API 地址，请联系管理员", icon: "none" });
      return;
    }
    this.setData({ _loginInFlight: true });
    try {
      getApp().globalData.apiBase = base;
    } catch (_) {}
    wx.showLoading({ title: "登录中", mask: true });
    try {
      const loginRes = await wx.login();
      const code = loginRes.code;
      if (!code) throw new Error("未取得微信 code");
      const r = await request({
        path: "/api/public/student/wechat-login",
        method: "POST",
        auth: false,
        data: { code },
      });
      const token = r && r.data && r.data.token;
      if (!token) throw new Error("未返回 token");
      wx.setStorageSync("student_token", token);
      getApp().globalData.token = token;
      setNeedJoinClass(Boolean(r.data && r.data.need_join_class));
      void ensureOnlineSession();
      wx.hideLoading();
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: "/pages/home/index" });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || "登录失败，请重试", icon: "none" });
    } finally {
      this.setData({ _loginInFlight: false });
    }
  },
});
