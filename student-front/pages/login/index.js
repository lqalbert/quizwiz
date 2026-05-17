const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");
const { uploadStudentAvatar } = require("../../utils/profile.js");
const { setNeedJoinClass } = require("../../utils/joinClass.js");

Page({
  data: {
    _loginInFlight: false,
  },

  onLoad() {
    const token = wx.getStorageSync("student_token") || "";
    if (token) {
      wx.switchTab({ url: "/pages/home/index" });
    }
  },

  async runWechatTokenExchange(base, nickname, avatarUrl) {
    if (this.data._loginInFlight) return;
    this.setData({ _loginInFlight: true });
    try {
      getApp().globalData.apiBase = base;
    } catch (_) {}
    wx.showLoading({ title: "进入中", mask: true });
    try {
      const loginRes = await wx.login();
      const code = loginRes.code;
      if (!code) throw new Error("未取得微信 code");
      const nick = String(nickname || "").trim().slice(0, 32);
      const av = String(avatarUrl || "").trim().slice(0, 512);
      const r = await request({
        path: "/api/public/student/wechat-login",
        method: "POST",
        auth: false,
        data: {
          code,
          nickname: nick,
          avatarUrl: /^https?:\/\//i.test(av) ? av : "",
        },
      });
      const token = r && r.data && r.data.token;
      if (!token) throw new Error("未返回 token");
      wx.setStorageSync("student_token", token);
      getApp().globalData.token = token;
      if (av && !/^https?:\/\//i.test(av)) {
        try {
          await uploadStudentAvatar(av);
        } catch (uploadErr) {
          console.warn("[QuizWiz] 头像上传失败", uploadErr);
        }
      }
      setNeedJoinClass(Boolean(r.data && r.data.need_join_class));
      wx.hideLoading();
      wx.switchTab({ url: "/pages/home/index" });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || "登录失败，请重试", icon: "none" });
    } finally {
      this.setData({ _loginInFlight: false });
    }
  },

  /**
   * 一键登录：点击后调起微信授权弹窗（确认即可），自动带回昵称/头像，无需手填。
   */
  onTapWechatLogin() {
    if (this.data._loginInFlight) return;
    const base = getApiBase();
    if (!base) {
      wx.showToast({ title: "未配置 API 地址，请联系管理员", icon: "none" });
      return;
    }
    wx.getUserProfile({
      desc: "用于展示你的头像与昵称",
      success: (res) => {
        if (this.data._loginInFlight) return;
        const ui = (res && res.userInfo) || {};
        const nickname = String(ui.nickName || "").trim().slice(0, 32);
        const avatarUrl = String(ui.avatarUrl || "").trim().slice(0, 512);
        this.runWechatTokenExchange(base, nickname, avatarUrl);
      },
      fail: () => {
        if (this.data._loginInFlight) return;
        this.runWechatTokenExchange(base, "", "");
      },
    });
  },
});
