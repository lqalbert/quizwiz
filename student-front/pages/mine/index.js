const { request } = require("../../utils/request.js");

function firstChar(s) {
  const t = String(s || "").trim();
  if (!t) return "?";
  return t.slice(0, 1);
}

Page({
  data: {
    loggedIn: false,
    displayName: "",
    studentNo: "",
    avatarLetter: "?",
    classes: [],
    leavePendingCount: 0,
    needJoinClass: false,
    nameEditVisible: false,
    nameDraft: "",
    menus: [
      { title: "退出班级", action: "leave_hint" },
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
        displayName: "",
        studentNo: "",
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
    wx.reLaunch({ url: "/pages/login/index" });
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
      const display = String(st.display_name || "").trim() || String(st.name || "同学").trim() || "同学";
      wx.setStorageSync("need_join_class", need ? "1" : "0");
      this.setData({
        loggedIn: true,
        displayName: display,
        studentNo: String(st.student_no || "").trim(),
        avatarLetter: firstChar(display),
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
      nameDraft: this.data.displayName,
    });
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
      const newName = String(st.display_name || "").trim() || String(st.name || name).trim() || name;
      wx.hideLoading();
      this.setData({
        displayName: newName,
        avatarLetter: firstChar(newName),
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
    if (action === "leave_hint") {
      if (!this.data.loggedIn) {
        wx.showModal({
          title: "退出班级说明",
          content: "请先登录。加入班级请在登录页完成；退出班级请在下方「我的班级」中操作，需教师审核通过后方可生效；通过后凡曾关联该班的考试答卷会删除（与是否仍在别班无关），个人刷题记录保留。",
          showCancel: false,
          confirmText: "我知道了",
        });
        return;
      }
      wx.showModal({
        title: "退出班级说明",
        content:
          "须由教师审核通过后，你才会从班级中退出；审核通过前你仍在原班级。\n\n退出后，凡曾关联该班的考试，你的答卷会被删除（即使你还在其它班级）；个人刷题（练习）记录会保留。\n\n请在下方「我的班级」中，选择要退出的班级并提交申请。",
        showCancel: false,
        confirmText: "我知道了",
      });
      return;
    }
    const path = e.currentTarget.dataset.path;
    if (path) {
      wx.navigateTo({ url: path });
    }
  },

  onRequestLeaveClass(e) {
    const classId = e.currentTarget.dataset.id;
    if (!classId) return;
    wx.showModal({
      title: "退出班级",
      content:
        "须教师审核通过后方可退出该班级；审核通过前你仍在原班级。\n\n退出后，凡曾关联该班的考试，你的答卷会被删除（即使你还在其它班级）；个人刷题记录会保留。\n\n是否提交退出申请？",
      confirmText: "提交申请",
      cancelText: "取消",
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: "提交中" });
        try {
          await request({
            path: "/api/student/leave-class-request",
            method: "POST",
            data: { class_id: classId },
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
          displayName: "",
          studentNo: "",
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
