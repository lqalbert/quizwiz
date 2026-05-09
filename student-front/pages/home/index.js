const { request } = require("../../utils/request.js");

Page({
  data: {
    dateText: "",
    loggedIn: false,
    statsLoading: false,
    statsError: "",
    period: "day",
    totals: null,
    today_attempts: 0,
    streak_days: 0,
    chart_day: [],
    chart_week: [],
    chart_month: [],
    table_week: [],
    table_month: [],
    chartRows: [],
    timezone_note: "",
    examTasks: [],
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
    const token = wx.getStorageSync("student_token");
    this.setData({ loggedIn: Boolean(token) });
    if (token) {
      this.loadHomeSummary();
      this.loadExamTasks();
    } else {
      this.setData({
        examTasks: [],
        statsLoading: false,
        statsError: "",
        totals: null,
        today_attempts: 0,
        streak_days: 0,
        chart_day: [],
        chart_week: [],
        chart_month: [],
        table_week: [],
        table_month: [],
        chartRows: [],
        timezone_note: "",
      });
    }
  },

  async loadExamTasks() {
    if (!wx.getStorageSync("student_token")) {
      this.setData({ examTasks: [] });
      return;
    }
    try {
      const res = await request({ path: "/api/student/exams", method: "GET" });
      const rows = (res && res.data) || [];
      const examTasks = rows.filter((e) => {
        if (e.phase !== "ongoing") return false;
        const st = e.submission_status == null || e.submission_status === "" ? 0 : Number(e.submission_status);
        return st !== 2 && st !== 3;
      });
      this.setData({ examTasks });
    } catch (_) {
      this.setData({ examTasks: [] });
    }
  },

  goExamTake(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    wx.navigateTo({ url: `/pages/exam-take/index?id=${id}` });
  },

  goExamList() {
    wx.navigateTo({ url: "/pages/exam-list/index" });
  },

  setPeriod(e) {
    const p = String(e.currentTarget.dataset.p || "day");
    if (p === this.data.period) return;
    this.setData({ period: p }, () => this.applyChartRows());
  },

  applyChartRows() {
    const p = this.data.period;
    let rows = [];
    if (p === "week") rows = this.data.chart_week || [];
    else if (p === "month") rows = this.data.chart_month || [];
    else rows = this.data.chart_day || [];
    this.setData({ chartRows: rows });
  },

  async loadHomeSummary() {
    this.setData({ statsLoading: true, statsError: "" });
    try {
      const res = await request({ path: "/api/student/stats/home-summary", method: "GET" });
      const d = (res && res.data) || {};
      const totals = d.totals || {
        questions_touched: 0,
        attempts: 0,
        correct: 0,
        wrong: 0,
        wrong_questions: 0,
        accuracy_pct: 0,
      };
      this.setData(
        {
          totals,
          today_attempts: Number(d.today_attempts || 0),
          streak_days: Number(d.streak_days || 0),
          chart_day: d.chart_day || [],
          chart_week: d.chart_week || [],
          chart_month: d.chart_month || [],
          table_week: d.table_week || [],
          table_month: d.table_month || [],
          timezone_note: String(d.timezone_note || ""),
          statsLoading: false,
        },
        () => this.applyChartRows(),
      );
    } catch (e) {
      this.setData({
        statsLoading: false,
        statsError: e.message || "加载失败",
        totals: null,
        chartRows: [],
      });
    }
  },

  goLogin() {
    wx.reLaunch({ url: "/pages/login/index" });
  },

  goRecordDone() {
    if (!wx.getStorageSync("student_token")) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/record-done/index" });
  },

  goRecordWrong() {
    if (!wx.getStorageSync("student_token")) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/record-wrong/index" });
  },
});
