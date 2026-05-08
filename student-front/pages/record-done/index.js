const { request } = require("../../utils/request.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");

Page({
  data: {
    list: [],
    loading: true,
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const res = await request({
        path: "/api/student/stats/done-questions?page=1&pageSize=100",
        method: "GET",
      });
      const list = (res && res.data) || [];
      this.setData({
        list: list.map((row) => ({ ...row, stem: formatStemForDisplay(row.stem) })),
        loading: false,
      });
    } catch (e) {
      this.setData({ list: [], loading: false });
      if (String(e.message || "").includes("配置 API")) {
        wx.showToast({ title: "请先配置 API 并登录", icon: "none" });
        return;
      }
      if (e.statusCode === 401 || String(e.message || "").includes("登录")) {
        wx.navigateTo({ url: "/pages/login/index" });
        return;
      }
      wx.showToast({ title: e.message || "加载失败", icon: "none" });
    }
  },
});
