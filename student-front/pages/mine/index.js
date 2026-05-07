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
    needJoinClass: false,
    nameEditVisible: false,
    nameDraft: "",
    menus: [
      { title: "加入班级", extra: "", path: "/pages/login/index" },
      { title: "错题集", extra: "", path: "/pages/record-wrong/index" },
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

  async loadProfile() {
    try {
      const res = await request({ path: "/api/student/profile", method: "GET" });
      const st = (res.data && res.data.student) || {};
      const classes = (res.data && res.data.classes) || [];
      const need = Boolean(res.data && res.data.need_join_class);
      const name = String(st.name || "同学").trim() || "同学";
      wx.setStorageSync("need_join_class", need ? "1" : "0");
      this.setData({
        loggedIn: true,
        displayName: name,
        studentNo: String(st.student_no || "").trim(),
        avatarLetter: firstChar(name),
        classes,
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
          needJoinClass: false,
          nameEditVisible: false,
        });
        wx.showToast({ title: "请重新登录", icon: "none" });
        return;
      }
      wx.showToast({ title: e.message || "加载资料失败", icon: "none" });
    }
  },

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
        data: { name },
      });
      const st = (res.data && res.data.student) || {};
      const newName = String(st.name || name).trim() || name;
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
    const path = e.currentTarget.dataset.path;
    if (path) {
      wx.navigateTo({ url: path });
      return;
    }
    const title = e.currentTarget.dataset.title;
    wx.showToast({ title: `${title} 即将开放`, icon: "none" });
  },

  onPlaceholder(e) {
    const title = e.currentTarget.dataset.title;
    wx.showToast({ title: `${title} 即将开放`, icon: "none" });
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
          displayName: "",
          studentNo: "",
          avatarLetter: "?",
          classes: [],
          needJoinClass: false,
          nameEditVisible: false,
          nameDraft: "",
        });
        wx.showToast({ title: "已退出", icon: "none" });
      },
    });
  },
});
