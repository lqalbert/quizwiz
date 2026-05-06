const { getApiBase } = require("./utils/config.js");

App({
  globalData: {
    userInfo: null,
    token: "",
    /** 由 utils/config.js 的 DEFAULT_API_BASE 与本地存储合并得到 */
    apiBase: "",
  },

  onLaunch() {
    const token = wx.getStorageSync("student_token") || "";
    this.globalData.token = token;
    const base = getApiBase();
    if (base) this.globalData.apiBase = base;
  },
});
