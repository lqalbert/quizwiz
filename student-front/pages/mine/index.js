const { request } = require("../../utils/request.js");
const { uploadStudentAvatar } = require("../../utils/profile.js");
const { submitJoinByInvite, syncNeedJoinClassFromServer } = require("../../utils/joinClass.js");

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
    joinModalVisible: false,
    joinModalMode: "form",
    joinInviteInput: "",
    joinRealNameInput: "",
    joinSubmitting: false,
    nameEditVisible: false,
    nameDraft: "",
    nickEditVisible: false,
    nickDraft: "",
    menus: [
      { title: "加入班级", action: "join_class" },
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
      });
      return;
    }
    this.loadProfile();
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
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

  async onChooseAvatar(e) {
    if (!this.data.loggedIn) return;
    const path = e.detail && e.detail.avatarUrl;
    if (!path) return;
    wx.showLoading({ title: "上传中", mask: true });
    try {
      const r = await uploadStudentAvatar(path);
      const st = (r.data && r.data.student) || {};
      if (st.id) this.applyStudentHeader(st);
      wx.hideLoading();
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || "上传失败", icon: "none" });
    }
  },

  onTapEditNickname() {
    if (!this.data.loggedIn) return;
    this.setData({
      nickEditVisible: true,
      nickDraft: this.data.wxNickname === "微信用户" ? "" : this.data.wxNickname,
    });
  },

  onNickDraftInput(e) {
    this.setData({ nickDraft: e.detail.value });
  },

  cancelNickEdit() {
    this.setData({ nickEditVisible: false, nickDraft: "" });
  },

  async saveNickEdit() {
    const name = String(this.data.nickDraft || "").trim().slice(0, 32);
    if (!name) {
      wx.showToast({ title: "昵称不能为空", icon: "none" });
      return;
    }
    wx.showLoading({ title: "保存中", mask: true });
    try {
      const res = await request({ path: "/api/student/profile", method: "PATCH", data: { name } });
      const st = (res.data && res.data.student) || {};
      this.applyStudentHeader(st);
      this.setData({ nickEditVisible: false, nickDraft: "" });
      wx.hideLoading();
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "保存失败", icon: "none" });
    }
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
    if (action === "join_class") {
      this.openJoinModal();
      return;
    }
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
        content: "请先登录。加入班级请在本页点击「加入班级」。",
        showCancel: false,
        confirmText: "我知道了",
      });
      return;
    }
    const classes = this.data.classes || [];
    if (!classes.length) {
      wx.showModal({
        title: "退出班级",
        content: "你尚未加入班级。请点击「加入班级」填写真实姓名与邀请码。",
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

  openJoinModal() {
    if (!this.data.loggedIn) {
      wx.showModal({
        title: "需要登录",
        content: "加入班级前请先登录。",
        confirmText: "去登录",
        success: (r) => {
          if (r.confirm) this.goLogin();
        },
      });
      return;
    }
    const pendingManual = this.data.needJoinClass && wx.getStorageSync("join_pending_manual") === "1";
    this.setData({
      joinModalVisible: true,
      joinModalMode: pendingManual ? "pending" : "form",
    });
  },

  onCloseJoinModal() {
    this.setData({ joinModalVisible: false });
  },

  onJoinInviteInput(e) {
    const v = e.detail && e.detail.value != null ? e.detail.value : "";
    this.setData({ joinInviteInput: v });
  },

  onJoinRealNameInput(e) {
    const v = e.detail && e.detail.value != null ? e.detail.value : "";
    this.setData({ joinRealNameInput: v });
  },

  async onSubmitJoinClass() {
    if (this.data.joinSubmitting || this.data.joinModalMode !== "form") return;
    this.setData({ joinSubmitting: true });
    wx.showLoading({ title: "提交中", mask: true });
    try {
      const result = await submitJoinByInvite({
        inviteCode: this.data.joinInviteInput,
        realName: this.data.joinRealNameInput,
      });
      wx.hideLoading();
      if (result.mode === "manual") {
        this.setData({ joinModalMode: "pending", joinSubmitting: false });
        wx.showToast({ title: result.message, icon: "none", duration: 2800 });
        return;
      }
      wx.showToast({ title: result.message, icon: "success" });
      this.setData({
        joinModalVisible: false,
        joinModalMode: "form",
        joinInviteInput: "",
        joinRealNameInput: "",
        joinSubmitting: false,
      });
      await this.loadProfile();
    } catch (err) {
      wx.hideLoading();
      this.setData({ joinSubmitting: false });
      wx.showToast({ title: (err && err.message) || "加入失败", icon: "none" });
    }
  },

  async onRefreshJoinPending() {
    wx.showLoading({ title: "查询中", mask: true });
    try {
      const st = await syncNeedJoinClassFromServer();
      await this.loadProfile();
      wx.hideLoading();
      if (!st.needJoin) {
        this.setData({ joinModalVisible: false, joinModalMode: "form" });
        wx.showToast({ title: "已通过审核", icon: "success" });
        return;
      }
      this.setData({ joinModalMode: st.pendingManual ? "pending" : "form" });
      wx.showToast({ title: "仍在审核中", icon: "none" });
    } catch (_) {
      wx.hideLoading();
    }
  },

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
        });
      },
    });
  },
});
