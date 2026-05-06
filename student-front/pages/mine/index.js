Page({
  data: {
    needJoinClass: false,
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
      this.setData({ needJoinClass: false });
      return;
    }
    this.setData({ needJoinClass: wx.getStorageSync("need_join_class") === "1" });
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
      confirmColor: "#111111",
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync("student_token");
        wx.removeStorageSync("need_join_class");
        getApp().globalData.token = "";
        wx.showToast({ title: "已退出", icon: "none" });
      },
    });
  },
});
