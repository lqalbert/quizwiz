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
    /** 由 /api/student/exams 聚合：参与考试可视化 */
    examOverview: null,
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
      this.loadStudentExams();
    } else {
      this.setData({
        examTasks: [],
        examOverview: null,
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

  buildExamOverview(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) {
      return {
        total: 0,
        submitted: 0,
        ongoing_open: 0,
        upcoming: 0,
        ended_unsub: 0,
        todo_count: 0,
        avg_score_display: "—",
        bar_rows: [],
        recent: [],
      };
    }
    let submitted = 0;
    let ongoing_open = 0;
    let upcoming = 0;
    let ended_unsub = 0;
    let sumScore = 0;
    let scored = 0;
    const submittedForRecent = [];
    for (const e of list) {
      const st = e.submission_status == null || e.submission_status === "" ? 0 : Number(e.submission_status);
      const isSub = st === 2 || st === 3;
      const ph = e.phase;
      if (isSub) {
        submitted += 1;
        if (e.total_score != null && e.total_score !== "") {
          const sc = Number(e.total_score);
          if (!Number.isNaN(sc)) {
            sumScore += sc;
            scored += 1;
          }
        }
        submittedForRecent.push(e);
      } else if (ph === "upcoming") upcoming += 1;
      else if (ph === "ongoing") ongoing_open += 1;
      else if (ph === "ended") ended_unsub += 1;
      else ended_unsub += 1;
    }
    const todo_count = ongoing_open + upcoming;
    const avg_score_display =
      scored > 0 ? `${String(Math.round((sumScore / scored) * 10) / 10)} 分` : "—";
    const segments = [
      { label: "已交卷", val: submitted },
      { label: "待参加(进行中)", val: ongoing_open },
      { label: "未开始", val: upcoming },
      { label: "已结束未交", val: ended_unsub },
    ];
    const maxVal = Math.max(1, ...segments.map((s) => s.val));
    const bar_rows = segments.map((s) => ({
      label: s.label,
      attempts: s.val,
      pct: Math.round((s.val / maxVal) * 100),
    }));
    submittedForRecent.sort((a, b) => {
      const ta = new Date(a.submit_time || 0).getTime();
      const tb = new Date(b.submit_time || 0).getTime();
      return tb - ta;
    });
    const recent = submittedForRecent.slice(0, 5).map((x) => ({
      id: x.id,
      title: x.title || "考试",
      score_text: x.total_score != null && x.total_score !== "" && !Number.isNaN(Number(x.total_score)) ? `${Number(x.total_score)} 分` : "—",
    }));
    return {
      total: list.length,
      submitted,
      ongoing_open,
      upcoming,
      ended_unsub,
      todo_count,
      avg_score_display,
      bar_rows,
      recent,
    };
  },

  async loadStudentExams() {
    if (!wx.getStorageSync("student_token")) {
      this.setData({ examTasks: [], examOverview: null });
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
      const examOverview = this.buildExamOverview(rows);
      this.setData({ examTasks, examOverview });
    } catch (_) {
      this.setData({ examTasks: [], examOverview: null });
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
