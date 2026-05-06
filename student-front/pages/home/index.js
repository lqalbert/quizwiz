Page({
  data: {
    dateText: "",
    resumeHint: "单选题 · 第 5 / 20 题",
  },

  onLoad() {
    const d = new Date();
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
    const dateText = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    this.setData({ dateText });
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  goQuiz() {
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  goStudy() {
    wx.switchTab({ url: "/pages/study/index" });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  hintWrong() {
    wx.showToast({ title: "即将开放", icon: "none" });
  },
});
