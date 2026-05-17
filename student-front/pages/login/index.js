const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");
const { uploadStudentAvatar } = require("../../utils/profile.js");

/** 无 token：进入欢迎页（点按钮授权登录）；有 token 需入班：入班表单；否则已就绪 */
function initialStep() {
  const token = wx.getStorageSync("student_token") || "";
  if (!token) return "boot";
  if (wx.getStorageSync("need_join_class") === "1") return "join";
  return "authed";
}

Page({
  data: {
    step: "boot",
    inviteInput: "",
    realNameInput: "",
    /** 防止重复提交登录 */
    _loginInFlight: false,
    /** chooseAvatar 本地临时路径（登录成功后上传） */
    pendingAvatarPath: "",
    /** 微信昵称输入（input type=nickname） */
    pendingNickname: "",
  },

  onLoad() {
    const step = initialStep();
    if (step === "authed") {
      wx.switchTab({ url: "/pages/home/index" });
      return;
    }
    this.setData({ step });
    if (step === "join") {
      try {
        wx.setNavigationBarTitle({ title: "加入班级" });
      } catch (_) {}
    }
  },

  onShow() {
    const token = wx.getStorageSync("student_token") || "";
    const s = this.data.step;
    if (!token) {
      if (s === "boot") return;
      this.setData({ step: "boot" });
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
            wx.switchTab({ url: "/pages/home/index" });
          }
          return;
        }
        if (need) {
          this.setData({ step: "join", inviteInput: "", realNameInput: "" });
          try {
            wx.setNavigationBarTitle({ title: "加入班级" });
          } catch (_) {}
        } else if (cur !== "authed") {
          wx.switchTab({ url: "/pages/home/index" });
        }
      })
      .catch((e) => {
        if (e && e.statusCode === 401) {
          wx.removeStorageSync("student_token");
          wx.removeStorageSync("need_join_class");
          try {
            getApp().globalData.token = "";
          } catch (_) {}
          this.setData({ step: "boot", inviteInput: "", realNameInput: "" });
        }
      });
  },

  goJoinFromAuthed() {
    this.setData({ step: "join", inviteInput: "", realNameInput: "" });
    try {
      wx.setNavigationBarTitle({ title: "加入班级" });
    } catch (_) {}
  },

  onInviteInput(e) {
    this.setData({ inviteInput: e.detail.value });
  },
  onRealNameInput(e) {
    this.setData({ realNameInput: e.detail.value });
  },

  goHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  onChooseAvatar(e) {
    const path = e.detail && e.detail.avatarUrl;
    if (path) this.setData({ pendingAvatarPath: path });
  },

  onNicknameInput(e) {
    this.setData({ pendingNickname: String((e.detail && e.detail.value) || "").trim().slice(0, 32) });
  },

  onNicknameBlur(e) {
    this.setData({ pendingNickname: String((e.detail && e.detail.value) || "").trim().slice(0, 32) });
  },

  /**
   * 用 wx.login 的 code 换后端 token；昵称可选；头像在登录后通过 upload 持久化。
   */
  async runWechatTokenExchange(base, nickname) {
    if (this.data._loginInFlight) return;
    this.setData({ _loginInFlight: true, step: "boot" });
    try {
      wx.setNavigationBarTitle({ title: "欢迎使用" });
    } catch (_) {}
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
        data: {
          code,
          nickname: String(nickname || "").trim().slice(0, 32),
        },
      });
      const token = r && r.data && r.data.token;
      if (!token) throw new Error("未返回 token");
      wx.setStorageSync("student_token", token);
      getApp().globalData.token = token;
      const avatarPath = String(this.data.pendingAvatarPath || "").trim();
      if (avatarPath) {
        try {
          await uploadStudentAvatar(avatarPath);
        } catch (uploadErr) {
          console.warn("[QuizWiz] 头像上传失败", uploadErr);
          wx.showToast({ title: "头像上传失败，可在「我的」重试", icon: "none", duration: 2500 });
        }
      }
      const needJoin = Boolean(r.data && r.data.need_join_class);
      wx.setStorageSync("need_join_class", needJoin ? "1" : "0");
      wx.hideLoading();
      if (needJoin) {
        this.setData({ step: "join", inviteInput: "", realNameInput: "" });
        try {
          wx.setNavigationBarTitle({ title: "加入班级" });
        } catch (_) {}
        return;
      }
      this.setData({ step: "authed" });
      wx.switchTab({ url: "/pages/home/index" });
    } catch (err) {
      wx.hideLoading();
      this.setData({ step: "boot" });
      try {
        wx.setNavigationBarTitle({ title: "欢迎使用" });
      } catch (_) {}
      wx.showToast({ title: (err && err.message) || "登录失败，请重试", icon: "none" });
    } finally {
      this.setData({ _loginInFlight: false });
    }
  },

  /** 微信登录：code 换 token；头像/昵称来自 chooseAvatar 与 nickname 输入框（勿用已废弃的 getUserProfile） */
  onTapWechatLogin() {
    if (this.data._loginInFlight) return;
    const base = getApiBase();
    if (!base) {
      this.setData({ step: "boot" });
      wx.showToast({ title: "未配置 API 地址，请联系管理员", icon: "none" });
      return;
    }
    const nickname = String(this.data.pendingNickname || "").trim().slice(0, 32);
    this.runWechatTokenExchange(base, nickname);
  },

  async onJoinClass() {
    const invite = String(this.data.inviteInput || "").trim();
    const realName = String(this.data.realNameInput || "").trim();
    if (!realName) {
      wx.showToast({ title: "请填写真实姓名", icon: "none" });
      return;
    }
    if (realName.length > 64) {
      wx.showToast({ title: "真实姓名不超过64字", icon: "none" });
      return;
    }
    if (!invite) {
      wx.showToast({ title: "请填写邀请码", icon: "none" });
      return;
    }
    wx.showLoading({ title: "提交中", mask: true });
    try {
      const res = await request({
        path: "/api/student/join-by-invite",
        method: "POST",
        data: { inviteCode: invite, realName },
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
});
