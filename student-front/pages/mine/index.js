const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");

function firstChar(s) {
  const t = String(s || "").trim();
  if (!t) return "?";
  return t.slice(0, 1);
}

Page({
  data: {
    /** 设为 true 可显示「其他」区块（通知、关于） */
    mineShowOther: false,
    loggedIn: false,
    /** 老师端展示用：优先真实姓名 */
    realDisplayName: "",
    /** 顶部展示：微信昵称 */
    wxNickname: "",
    wxAvatarUrl: "",
    showWxProfileHint: false,
    avatarLetter: "?",
    classes: [],
    leavePendingCount: 0,
    needJoinClass: false,
    nameEditVisible: false,
    nameDraft: "",
    /** 微信头像昵称填写（替代已回收的 getUserProfile 真实资料） */
    wxProfileVisible: false,
    profileNickDraft: "",
    profileAvatarUploading: false,
    menus: [
      { title: "退出班级", action: "leave_class" },
      { title: "错题本", extra: "", path: "/pages/record-wrong/index" },
      { title: "已做题", extra: "", path: "/pages/record-done/index" },
    ],
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    const token = wx.getStorageSync("student_token");
    if (!token) {
      this.setData({
        loggedIn: false,
        realDisplayName: "",
        wxNickname: "",
        wxAvatarUrl: "",
        showWxProfileHint: false,
        avatarLetter: "?",
        classes: [],
        leavePendingCount: 0,
        needJoinClass: false,
        nameEditVisible: false,
        nameDraft: "",
        wxProfileVisible: false,
        profileNickDraft: "",
        profileAvatarUploading: false,
      });
      return;
    }
    this.loadProfile();
  },

  goLogin() {
    wx.reLaunch({ url: "/pages/login/index" });
  },

  applyStudentHeader(st) {
    const realDisp =
      String(st.display_name || "").trim() || String(st.name || "同学").trim() || "同学";
    const wxNick = String(st.wx_nickname || st.name || "").trim() || "微信用户";
    const wxAva = String(st.wx_avatar_url || "").trim();
    this.setData({
      realDisplayName: realDisp,
      wxNickname: wxNick,
      wxAvatarUrl: wxAva,
      showWxProfileHint: !wxAva || wxNick === "微信用户",
      avatarLetter: firstChar(wxNick),
    });
  },

  async loadProfile() {
    try {
      const res = await request({ path: "/api/student/profile", method: "GET" });
      const st = (res.data && res.data.student) || {};
      const classesRaw = (res.data && res.data.classes) || [];
      const pendingLeave = (res.data && res.data.pending_leave_requests) || [];
      const classes = classesRaw.map((c) => ({
        ...c,
        leave_pending: pendingLeave.some((p) => Number(p.class_id) === Number(c.id)),
      }));
      const need = Boolean(res.data && res.data.need_join_class);
      wx.setStorageSync("need_join_class", need ? "1" : "0");
      this.applyStudentHeader(st);
      this.setData({
        loggedIn: true,
        classes,
        leavePendingCount: pendingLeave.length,
        needJoinClass: need,
      });
    } catch (e) {
      if (e && e.statusCode === 401) {
        wx.removeStorageSync("student_token");
        wx.removeStorageSync("need_join_class");
        try {
          getApp().globalData.token = "";
        } catch (_) {}
        this.setData({
          loggedIn: false,
          realDisplayName: "",
          wxNickname: "",
          wxAvatarUrl: "",
          showWxProfileHint: false,
          classes: [],
          leavePendingCount: 0,
          needJoinClass: false,
          nameEditVisible: false,
          wxProfileVisible: false,
          profileNickDraft: "",
          profileAvatarUploading: false,
        });
        wx.showToast({ title: "请重新登录", icon: "none" });
        return;
      }
      wx.showToast({ title: e.message || "加载资料失败", icon: "none" });
    }
  },

  noop() {},

  onTapEditName() {
    if (!this.data.loggedIn) return;
    this.setData({
      nameEditVisible: true,
      nameDraft: this.data.realDisplayName,
    });
  },

  onTapSyncWechatProfile() {
    if (!this.data.loggedIn) return;
    const nick = String(this.data.wxNickname || "").trim();
    this.setData({
      wxProfileVisible: true,
      profileNickDraft: nick === "微信用户" ? "" : nick,
      profileAvatarUploading: false,
    });
  },

  cancelWxProfile() {
    this.setData({ wxProfileVisible: false, profileNickDraft: "", profileAvatarUploading: false });
  },

  onProfileNickInput(e) {
    this.setData({ profileNickDraft: e.detail.value });
  },

  onWxChooseAvatar(e) {
    const fp = e.detail && e.detail.avatarUrl ? String(e.detail.avatarUrl).trim() : "";
    if (!fp) {
      wx.showToast({ title: "未选择头像", icon: "none" });
      return;
    }
    const base = getApiBase().replace(/\/$/, "");
    const token = wx.getStorageSync("student_token") || "";
    if (!base || !token) {
      wx.showToast({ title: "登录已失效，请重新登录", icon: "none" });
      return;
    }
    this.setData({ profileAvatarUploading: true });
    wx.uploadFile({
      url: `${base}/api/student/profile/avatar-upload`,
      filePath: fp,
      name: "file",
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        this.setData({ profileAvatarUploading: false });
        let body = {};
        try {
          body = JSON.parse(res.data || "{}");
        } catch (_) {
          body = {};
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = (body && body.message) || `上传失败(${res.statusCode})`;
          wx.showToast({ title: String(msg).slice(0, 40), icon: "none" });
          return;
        }
        const st = body.data && body.data.student;
        if (!st) {
          wx.showToast({ title: "上传响应异常", icon: "none" });
          return;
        }
        this.applyStudentHeader(st);
        wx.showToast({ title: "头像已更新", icon: "success" });
      },
      fail: (err) => {
        this.setData({ profileAvatarUploading: false });
        const em = (err && err.errMsg) || "上传失败";
        wx.showToast({ title: String(em).slice(0, 40), icon: "none" });
      },
    });
  },

  async confirmWxProfile() {
    if (!this.data.loggedIn) return;
    const nick = String(this.data.profileNickDraft || "").trim().slice(0, 64);
    if (nick) {
      wx.showLoading({ title: "保存中", mask: true });
      try {
        const r = await request({ path: "/api/student/profile", method: "PATCH", data: { name: nick } });
        const st = (r.data && r.data.student) || {};
        this.applyStudentHeader(st);
        wx.hideLoading();
        wx.showToast({ title: "已保存", icon: "success" });
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: (e && e.message) || "保存失败", icon: "none" });
        return;
      }
    }
    this.setData({ wxProfileVisible: false, profileNickDraft: "" });
  },

  onNameDraftInput(e) {
    this.setData({ nameDraft: e.detail.value });
  },

  cancelNameEdit() {
    this.setData({ nameEditVisible: false, nameDraft: "" });
  },

  async saveNameEdit() {
    const name = String(this.data.nameDraft || "").trim();
    if (!name) {
      wx.showToast({ title: "姓名不能为空", icon: "none" });
      return;
    }
    wx.showLoading({ title: "保存中" });
    try {
      const res = await request({
        path: "/api/student/profile",
        method: "PATCH",
        data: { realName: name },
      });
      const st = (res.data && res.data.student) || {};
      wx.hideLoading();
      this.applyStudentHeader(st);
      this.setData({
        nameEditVisible: false,
        nameDraft: "",
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "保存失败", icon: "none" });
    }
  },

  onMenu(e) {
    const action = e.currentTarget.dataset.action;
    if (action === "leave_class") {
      this.openLeaveClassFromMenu();
      return;
    }
    const path = e.currentTarget.dataset.path;
    if (path) {
      wx.navigateTo({ url: path });
    }
  },

  openLeaveClassFromMenu() {
    if (!this.data.loggedIn) {
      wx.showModal({
        title: "退出班级",
        content:
          "请先登录。加入班级请在登录页完成；退出班级须教师审核通过后方可生效；通过后凡曾关联该班的考试答卷会删除（与是否仍在别班无关），个人刷题记录保留。",
        showCancel: false,
        confirmText: "我知道了",
      });
      return;
    }
    const classes = this.data.classes || [];
    if (!classes.length) {
      wx.showModal({
        title: "退出班级",
        content: "你尚未加入班级。入班请在登录页完成。",
        showCancel: false,
        confirmText: "我知道了",
      });
      return;
    }
    if (classes.length === 1) {
      this.promptLeaveClassConfirm(classes[0]);
      return;
    }
    this.showLeaveClassActionSheet(classes, 0);
  },

  showLeaveClassActionSheet(classes, offset) {
    const PAGE = 5;
    const page = classes.slice(offset, offset + PAGE);
    const more = offset + PAGE < classes.length;
    const itemList = page.map((c) => {
      const n = String(c.name || "").trim() || "未命名班级";
      return c.leave_pending ? `${n}（审核中）` : n;
    });
    if (more) itemList.push("下一页…");
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const idx = res.tapIndex;
        if (more && idx === itemList.length - 1) {
          this.showLeaveClassActionSheet(classes, offset + PAGE);
          return;
        }
        const cls = page[idx];
        if (!cls) return;
        this.promptLeaveClassConfirm(cls);
      },
      fail: (err) => {
        const msg = err && err.errMsg ? String(err.errMsg) : "";
        if (msg.includes("cancel")) return;
        wx.showToast({ title: msg || "无法打开选择", icon: "none" });
      },
    });
  },

  promptLeaveClassConfirm(cls) {
    if (!cls || !cls.id) return;
    if (cls.leave_pending) {
      wx.showToast({ title: "该班级退出申请已在审核中", icon: "none" });
      return;
    }
    wx.showModal({
      title: "退出班级",
      content: `班级「${String(cls.name || "").trim() || "未命名"}」\n\n须教师审核通过后方可退出；审核通过前你仍在原班级。\n\n退出后，凡曾关联该班的考试，你的答卷会被删除（即使你还在其它班级）；个人刷题记录会保留。\n\n是否提交退出申请？`,
      confirmText: "提交申请",
      cancelText: "取消",
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: "提交中" });
        try {
          await request({
            path: "/api/student/leave-class-request",
            method: "POST",
            data: { class_id: cls.id },
          });
          wx.hideLoading();
          wx.showToast({ title: "已提交，请等待教师审核", icon: "none" });
          await this.loadProfile();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: (err && err.message) || "提交失败", icon: "none" });
        }
      },
    });
  },

  onPlaceholder() {},

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出吗？",
      confirmColor: "#007aff",
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync("student_token");
        wx.removeStorageSync("need_join_class");
        getApp().globalData.token = "";
        this.setData({
          loggedIn: false,
          realDisplayName: "",
          wxNickname: "",
          wxAvatarUrl: "",
          showWxProfileHint: false,
          avatarLetter: "?",
          classes: [],
          leavePendingCount: 0,
          needJoinClass: false,
          nameEditVisible: false,
          nameDraft: "",
          wxProfileVisible: false,
          profileNickDraft: "",
          profileAvatarUploading: false,
        });
      },
    });
  },
});
