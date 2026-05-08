const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");

function initialStep() {
  const token = wx.getStorageSync("student_token") || "";
  const needJoin = wx.getStorageSync("need_join_class") === "1";
  if (!token) return "login";
  if (needJoin) return "join";
  return "authed";
}

Page({
  data: {
    step: "login",
    apiBaseInput: "",
    nicknameInput: "",
    inviteInput: "",
  },

  onLoad() {
    const apiBase = wx.getStorageSync("api_base") || "";
    this.setData({
      apiBaseInput: apiBase,
      step: initialStep(),
    });
  },

  onShow() {
    const token = wx.getStorageSync("student_token") || "";
    if (!token) {
      this.setData({ step: "login" });
      return;
    }
    request({ path: "/api/student/profile", method: "GET" })
      .then((res) => {
        const need = Boolean(res.data && res.data.need_join_class);
        wx.setStorageSync("need_join_class", need ? "1" : "0");
        const cur = this.data.step;
        if (cur === "join") {
          if (!need) {
            this.setData({ step: "authed" });
          }
          return;
        }
        this.setData({ step: need ? "join" : "authed" });
      })
      .catch((e) => {
        if (e && e.statusCode === 401) {
          wx.removeStorageSync("student_token");
          wx.removeStorageSync("need_join_class");
          try {
            getApp().globalData.token = "";
          } catch (_) {}
          this.setData({ step: "login" });
        }
      });
  },

  goJoinFromAuthed() {
    this.setData({ step: "join", inviteInput: "" });
  },

  onNickInput(e) {
    this.setData({ nicknameInput: e.detail.value });
  },
  onInviteInput(e) {
    this.setData({ inviteInput: e.detail.value });
  },

  goHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  async onWechatLogin() {
    const base = getApiBase();
    if (!base) {
      wx.showToast({ title: "未配置 API 地址，请联系管理员", icon: "none" });
      return;
    }
    try {
      getApp().globalData.apiBase = base;
    } catch (_) {}
    wx.showLoading({ title: "登录中" });
    try {
      const loginRes = await wx.login();
      const code = loginRes.code;
      if (!code) throw new Error("未取得微信 code");
      const res = await request({
        path: "/api/public/student/wechat-login",
        method: "POST",
        auth: false,
        data: {
          code,
          nickname: String(this.data.nicknameInput || "").trim(),
        },
      });
      const token = res && res.data && res.data.token;
      if (!token) throw new Error("未返回 token");
      wx.setStorageSync("student_token", token);
      getApp().globalData.token = token;
      const needJoin = Boolean(res.data && res.data.need_join_class);
      wx.setStorageSync("need_join_class", needJoin ? "1" : "0");
      wx.hideLoading();
      if (needJoin) {
        this.setData({ step: "join", inviteInput: "" });
        return;
      }
      this.setData({ step: "authed" });
      wx.switchTab({ url: "/pages/home/index" });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || "登录失败", icon: "none" });
    }
  },

  async onJoinClass() {
    const invite = String(this.data.inviteInput || "").trim();
    if (!invite) {
      wx.showToast({ title: "请填写邀请码", icon: "none" });
      return;
    }
    wx.showLoading({ title: "提交中" });
    try {
      const res = await request({
        path: "/api/student/join-by-invite",
        method: "POST",
        data: { inviteCode: invite },
      });
      wx.hideLoading();
      const mode = res.data && res.data.mode;
      const msg =
        mode === "manual"
          ? res.data.message || "已提交申请，请等待老师审核"
          : res.data && res.data.already_member
            ? "已在该班级中"
            : "已加入班级";
      wx.setStorageSync("need_join_class", mode === "manual" ? "1" : "0");
      wx.showToast({ title: msg, icon: "none" });
      if (mode !== "manual") {
        setTimeout(() => wx.switchTab({ url: "/pages/home/index" }), 500);
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || "加入失败", icon: "none" });
    }
  },

  onSkipJoin() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
