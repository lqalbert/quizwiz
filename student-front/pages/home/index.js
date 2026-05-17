const { request } = require("../../utils/request.js");
const { redirectIfNeedJoinClass } = require("../../utils/joinGate.js");
const { submitJoinByInvite, syncNeedJoinClassFromServer } = require("../../utils/joinClass.js");
const { buildTodaySnapshot } = require("../../utils/dailyMission.js");
const { beijingCalendarDateKey } = require("../../utils/beijingTime.js");
const { sortExamsNewestFirst } = require("../../utils/examSort.js");

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
    /** 首次进入首页：非弹窗引导卡片 */
    homeGuideVisible: false,
    /** 今日收获：连续打卡与今日统计（由 home-summary 接口统计） */
    todaySnapshot: null,
    checkinStreak: 0,
    /** 未入班：首页全屏入班引导（form=填表 pending=已提交待审核） */
    joinGateVisible: false,
    joinGateMode: "form",
    joinInviteInput: "",
    joinRealNameInput: "",
    joinSubmitting: false,
  },

  onLoad() {
    this.setData({ dateText: beijingCalendarDateKey(new Date()) });
    if (!wx.getStorageSync("student_token")) {
      wx.reLaunch({ url: "/pages/login/index" });
    }
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (redirectIfNeedJoinClass()) return;
    const token = wx.getStorageSync("student_token");
    this.setData({ loggedIn: Boolean(token) });
    if (token) {
      void (async () => {
        const gate = await this.refreshJoinGate();
        if (!gate.needJoin) {
          this.loadHomeSummary();
          this.loadStudentExams();
        }
        this.updateHomeGuideVisibility();
      })();
    } else {
      this.setData({
        joinGateVisible: false,
        joinGateMode: "form",
        joinInviteInput: "",
        joinRealNameInput: "",
      });
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
        homeGuideVisible: false,
        todaySnapshot: null,
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
      const rows = sortExamsNewestFirst((res && res.data) || []);
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
      const today = practice_periods && practice_periods.today;
      const checkinStreak = Math.max(0, Number(d.checkin_streak) || 0);
      const todaySnapshot = today
        ? buildTodaySnapshot({
            dateText: this.data.dateText,
            todayPeriod: today,
            checkinStreak,
          })
        : null;
      this.setData(
        {
          totals,
          practice_periods,
          checkinStreak,
          statsLoading: false,
          todaySnapshot,
        },
        () => {
          this.applyPracticeTab();
          this.tryRemindReviewDueIfNeeded();
          this.updateHomeGuideVisibility();
        },
      );
    } catch (e) {
      this.setData({
        statsLoading: false,
        statsError: e.message || "加载失败",
        totals: null,
        practice_periods: null,
        practicePanel: {},
        todaySnapshot: null,
      });
    }
  },

  refreshTodaySnapshotOnly() {
    const pp = this.data.practice_periods;
    const today = pp && pp.today;
    if (!today) return;
    const todaySnapshot = buildTodaySnapshot({
      dateText: this.data.dateText,
      todayPeriod: today,
      checkinStreak: this.data.checkinStreak,
    });
    this.setData({ todaySnapshot });
  },

  goLogin() {
    wx.reLaunch({ url: "/pages/login/index" });
  },

  noop() {},

  async refreshJoinGate() {
    if (!wx.getStorageSync("student_token")) {
      this.setData({ joinGateVisible: false, joinGateMode: "form" });
      return { needJoin: false, pendingManual: false };
    }
    try {
      const { needJoin, pendingManual } = await syncNeedJoinClassFromServer();
      this.setData({
        joinGateVisible: needJoin,
        joinGateMode: pendingManual ? "pending" : "form",
      });
      return { needJoin, pendingManual };
    } catch (e) {
      if (e && e.statusCode === 401) {
        wx.removeStorageSync("student_token");
        wx.removeStorageSync("need_join_class");
        try {
          getApp().globalData.token = "";
        } catch (_) {}
        this.setData({ loggedIn: false, joinGateVisible: false });
        wx.reLaunch({ url: "/pages/login/index" });
        return { needJoin: false, pendingManual: false };
      }
      const need = wx.getStorageSync("need_join_class") === "1";
      const pendingManual = need && wx.getStorageSync("join_pending_manual") === "1";
      this.setData({
        joinGateVisible: need,
        joinGateMode: pendingManual ? "pending" : "form",
      });
      return { needJoin: need, pendingManual };
    }
  },

  onJoinInviteInput(e) {
    this.setData({ joinInviteInput: e.detail.value });
  },

  onJoinRealNameInput(e) {
    this.setData({ joinRealNameInput: e.detail.value });
  },

  async onSubmitJoinClass() {
    if (this.data.joinSubmitting || this.data.joinGateMode !== "form") return;
    const invite = String(this.data.joinInviteInput || "").trim();
    const realName = String(this.data.joinRealNameInput || "").trim();
    this.setData({ joinSubmitting: true });
    wx.showLoading({ title: "提交中", mask: true });
    try {
      const result = await submitJoinByInvite({ inviteCode: invite, realName });
      wx.hideLoading();
      if (result.mode === "manual") {
        this.setData({ joinGateMode: "pending", joinSubmitting: false });
        wx.showToast({ title: result.message, icon: "none", duration: 2800 });
        return;
      }
      wx.showToast({ title: result.message, icon: "success" });
      this.setData({
        joinGateVisible: false,
        joinGateMode: "form",
        joinInviteInput: "",
        joinRealNameInput: "",
        joinSubmitting: false,
      });
      this.loadHomeSummary();
      this.loadStudentExams();
    } catch (err) {
      wx.hideLoading();
      this.setData({ joinSubmitting: false });
      wx.showToast({ title: (err && err.message) || "加入失败", icon: "none" });
    }
  },

  async onRefreshJoinPending() {
    wx.showLoading({ title: "查询中", mask: true });
    try {
      await this.refreshJoinGate();
      wx.hideLoading();
      if (!this.data.joinGateVisible) {
        wx.showToast({ title: "已通过审核，可以开始学习", icon: "success" });
        this.loadHomeSummary();
        this.loadStudentExams();
        return;
      }
      if (this.data.joinGateMode === "pending") {
        wx.showToast({ title: "仍在审核中，请稍后再试", icon: "none" });
      }
    } catch (_) {
      wx.hideLoading();
    }
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

  /** 今日收获卡片：待复习 → 待复习列表 */
  goReviewToday() {
    if (!wx.getStorageSync("student_token")) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/review-today/index" });
  },

  /** 「今日」Tab：错题数 = 待复习口径，进入待复习列表；其它 Tab 仍进完整错题本 */
  goWrongOrReviewToday() {
    if (!wx.getStorageSync("student_token")) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    if (this.data.practiceTab === "today") {
      wx.navigateTo({ url: "/pages/review-today/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/record-wrong/index" });
  },

  updateHomeGuideVisibility() {
    if (!wx.getStorageSync("student_token")) {
      this.setData({ homeGuideVisible: false });
      return;
    }
    let seen = false;
    try {
      seen = Boolean(wx.getStorageSync("ux_guide_home_v1"));
    } catch (_) {}
    this.setData({ homeGuideVisible: !seen });
  },

  dismissHomeGuide() {
    try {
      wx.setStorageSync("ux_guide_home_v1", "1");
    } catch (_) {}
    this.setData({ homeGuideVisible: false });
  },

  tryRemindReviewDueIfNeeded() {
    if (this.data.practiceTab !== "today") return;
    const n = Number(this.data.practicePanel.wrong_count || 0);
    if (n <= 0) return;
    const key = `review_due_tip_${this.data.dateText}`;
    if (wx.getStorageSync(key)) return;
    wx.setStorageSync(key, 1);
    wx.showModal({
      title: "今日待复习",
      content: `有 ${n} 道错题已到复习日，是否进入待复习列表？`,
      confirmText: "去复习",
      cancelText: "稍后",
      success: (res) => {
        if (res.confirm) wx.navigateTo({ url: "/pages/review-today/index" });
      },
    });
  },
});
