const { request } = require("../../utils/request.js");
const { redirectIfNeedJoinClass } = require("../../utils/joinGate.js");
const { formatBeijingRange } = require("../../utils/beijingTime.js");

Page({
  data: {
    loading: true,
    err: "",
    exams: [],
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    if (redirectIfNeedJoinClass()) return;
    this.loadExams();
  },

  async loadExams() {
    if (!wx.getStorageSync("student_token")) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ loading: true, err: "" });
    try {
      const res = await request({ path: "/api/student/exams", method: "GET" });
      const raw = (res && res.data) || [];
      const exams = raw.map((item) => {
        let phaseLabel = "未开始";
        if (item.phase === "ongoing") phaseLabel = "进行中";
        else if (item.phase === "ended") phaseLabel = "已结束";
        return {
          ...item,
          phaseLabel,
          timeRange: formatBeijingRange(item.start_time, item.end_time),
        };
      });
      this.setData({ exams, loading: false });
    } catch (e) {
      this.setData({ loading: false, err: e.message || "加载失败" });
    }
  },

  openExam(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    const item = (this.data.exams || []).find((x) => Number(x.id) === id);
    if (item && item.phase === "upcoming") {
      wx.showToast({ title: "考试尚未开始", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/exam-take/index?id=${id}` });
  },
});
