Page({
  data: {
    dateText: "",
    resumeHint: "选择科目、知识点与练习方式后开始",
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
    if (!wx.getStorageSync("student_token")) {
      wx.navigateTo({ url: "/pages/login/index" });
      return;
    }
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  goStudy() {
    wx.switchTab({ url: "/pages/study/index" });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  hintWrong() {
    if (!wx.getStorageSync("student_token")) {
      wx.navigateTo({ url: "/pages/login/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/record-wrong/index" });
  },
});
