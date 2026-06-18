const { request } = require("../../utils/request.js");
const { formatBeijingRange } = require("../../utils/beijingTime.js");
const { sortExamsNewestFirst } = require("../../utils/examSort.js");
const withPageShare = require("../../utils/withPageShare.js");
const { ensureOnlineSession } = require("../../utils/onlineSession.js");

withPageShare({
  data: {
    loading: true,
    err: "",
    needLoginHint: false,
    needJoinHint: false,
    exams: [],
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    if (wx.getStorageSync("student_token")) void ensureOnlineSession();
    this.loadExams();
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  async loadExams() {
    if (!wx.getStorageSync("student_token")) {
      this.setData({
        loading: false,
        err: "登录后查看班级考试；当前可浏览本页",
        needLoginHint: true,
        needJoinHint: false,
        exams: [],
      });
      return;
    }
    this.setData({ loading: true, err: "", needLoginHint: false, needJoinHint: false });
    try {
      const res = await request({ path: "/api/student/exams", method: "GET" });
      const raw = sortExamsNewestFirst((res && res.data) || []);
      if (raw.length === 0 && wx.getStorageSync("need_join_class") === "1") {
        this.setData({
          exams: [],
          loading: false,
          err: "未加入班级暂无数据",
          needJoinHint: true,
        });
        return;
      }
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
