const { request } = require("../../utils/request.js");
const { redirectIfNeedJoinClass } = require("../../utils/joinGate.js");

/** 兼容接口体为 { data: {...} } 或直接为业务对象两种形态 */
function unwrapStudentPayload(root) {
  if (!root || typeof root !== "object") return {};
  const inner = root.data;
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) return inner;
  return root;
}

Page({
  data: {
    dateText: "",
    loggedIn: false,
    statsLoading: false,
    statsError: "",
    totals: null,
    practiceTabList: [
      { key: "today", label: "今日" },
      { key: "week", label: "本周" },
      { key: "month", label: "本月" },
      { key: "all", label: "全部" },
    ],
    practiceTab: "today",
    practice_periods: null,
    practicePanel: {},
    examTasks: [],
    examOverview: null,
    examListError: "",
    examListLoading: false,
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
    if (redirectIfNeedJoinClass()) return;
    const token = wx.getStorageSync("student_token");
    this.setData({ loggedIn: Boolean(token) });
    if (token) {
      this.loadHomeSummary();
      this.loadStudentExams();
    } else {
      this.setData({
        examTasks: [],
        examOverview: null,
        examListError: "",
        examListLoading: false,
        statsLoading: false,
        statsError: "",
        totals: null,
        practice_periods: null,
        practicePanel: {},
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
      };
    }
    let submitted = 0;
    let ongoing_open = 0;
    let upcoming = 0;
    let ended_unsub = 0;
    let sumScore = 0;
    let scored = 0;
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
      } else if (ph === "upcoming") upcoming += 1;
      else if (ph === "ongoing") ongoing_open += 1;
      else if (ph === "ended") ended_unsub += 1;
      else ended_unsub += 1;
    }
    const todo_count = ongoing_open + upcoming;
    const avg_score_display =
      scored > 0 ? `${String(Math.round((sumScore / scored) * 10) / 10)} 分` : "—";
    return {
      total: list.length,
      submitted,
      ongoing_open,
      upcoming,
      ended_unsub,
      todo_count,
      avg_score_display,
    };
  },

  async loadStudentExams() {
    if (!wx.getStorageSync("student_token")) {
      this.setData({ examTasks: [], examOverview: null, examListError: "", examListLoading: false });
      return;
    }
    this.setData({ examListError: "", examListLoading: true });
    try {
      const res = await request({ path: "/api/student/exams", method: "GET" });
      const rows = (res && res.data) || [];
      const examTasks = rows.filter((e) => {
        if (e.phase !== "ongoing") return false;
        const st = e.submission_status == null || e.submission_status === "" ? 0 : Number(e.submission_status);
        return st !== 2 && st !== 3;
      });
      const examOverview = this.buildExamOverview(rows);
      this.setData({ examTasks, examOverview, examListLoading: false });
    } catch (e) {
      this.setData({
        examTasks: [],
        examOverview: null,
        examListLoading: false,
        examListError: e.message || "考试列表加载失败",
      });
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

  goQuiz() {
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  goPracticeClassRank() {
    const period = this.data.practiceTab || "today";
    wx.navigateTo({ url: `/pages/practice-rank/index?period=${encodeURIComponent(period)}` });
  },

  buildPracticePanelFromPeriod(p) {
    if (!p) {
      return {
        practice_questions: 0,
        wrong_count: 0,
        accuracy_pct: 0,
        rank_main: "—",
        rank_sub: "",
      };
    }
    const inClass = Boolean(p.in_class);
    let rank_main = "—";
    let rank_sub = "";
    if (!inClass) {
      rank_sub = "加入班级后参与排名";
    } else if (!p.had_practice) {
      rank_sub = `同班 ${p.class_peers} 人 · 本周期未练`;
    } else if (p.class_rank != null && p.rank_in_denominator > 0) {
      rank_main = `第 ${p.class_rank}`;
      rank_sub = `共 ${p.rank_in_denominator} 人有作答`;
    } else {
      rank_sub = "暂无排名";
    }
    return {
      practice_questions: Number(p.practice_questions || 0),
      wrong_count: Number(p.wrong_count || 0),
      accuracy_pct: Number(p.accuracy_pct || 0),
      rank_main,
      rank_sub,
    };
  },

  applyPracticeTab() {
    const key = this.data.practiceTab || "today";
    const p = this.data.practice_periods && this.data.practice_periods[key];
    this.setData({ practicePanel: this.buildPracticePanelFromPeriod(p) });
  },

  onPracticeTab(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ practiceTab: key });
    this.applyPracticeTab();
  },

  async loadHomeSummary() {
    this.setData({ statsLoading: true, statsError: "" });
    try {
      const res = await request({ path: "/api/student/stats/home-summary", method: "GET" });
      const d = unwrapStudentPayload(res);
      const totals = d.totals || null;
      const practice_periods = d.practice_periods != null ? d.practice_periods : null;
      this.setData({
        totals,
        practice_periods,
        statsLoading: false,
      });
      this.applyPracticeTab();
    } catch (e) {
      this.setData({
        statsLoading: false,
        statsError: e.message || "加载失败",
        totals: null,
        practice_periods: null,
        practicePanel: {},
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
