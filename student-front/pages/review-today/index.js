const { request } = require("../../utils/request.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");
const { formatBeijingCalendarDate, formatBeijingDateTime, beijingCalendarDateKey } = require("../../utils/beijingTime.js");

function unwrapPayload(root) {
  if (!root || typeof root !== "object") return {};
  const inner = root.data;
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) return inner;
  return root;
}

function nextReviewLabel(row) {
  const d = row && row.next_review_date;
  if (d == null || d === "") return "尽快";
  const dateStr = formatBeijingCalendarDate(d);
  if (!dateStr) return "尽快";
  const today = beijingCalendarDateKey();
  if (dateStr <= today) return `今日 · ${dateStr}`;
  return dateStr;
}

function lastWrongLabel(row) {
  const t = row && row.updated_at;
  if (t == null || t === "") return "";
  const s = formatBeijingDateTime(t, false);
  return s ? `最近做错 ${s}` : "";
}

Page({
  data: {
    loading: true,
    err: "",
    needLogin: false,
    count: 0,
    questions: [],
    /** 北京日历「今天」，与接口统计口径一致 */
    beijingToday: "",
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: "今日待复习" });
    this.setData({ beijingToday: beijingCalendarDateKey() });
  },

  onShow() {
    this.loadList();
  },

  async loadList(e) {
    const fromTap = Boolean(e && (e.type === "tap" || e.currentTarget));
    if (!wx.getStorageSync("student_token")) {
      if (fromTap && this.data.needLogin) {
        wx.navigateTo({ url: "/pages/login/index" });
        return;
      }
      this.setData({
        loading: false,
        err: "登录后查看待复习错题",
        needLogin: true,
        count: 0,
        questions: [],
      });
      return;
    }
    this.setData({ loading: true, err: "", needLogin: false });
    try {
      const res = await request({ path: "/api/student/stats/review-due-today", method: "GET" });
      const d = unwrapPayload(res);
      const raw = (d && d.questions) || [];
      const count = Number(d && d.count != null ? d.count : raw.length) || 0;
      const questions = raw.map((it) => ({
        ...it,
        stem_display: formatStemForDisplay(it.stem),
        next_label: nextReviewLabel(it),
        last_wrong_label: lastWrongLabel(it),
        next_review_date_display: formatBeijingCalendarDate(it.next_review_date),
      }));
      this.setData({ loading: false, count, questions });
    } catch (e) {
      const unauthorized = e && e.statusCode === 401;
      this.setData({
        loading: false,
        err: unauthorized ? "登录后查看待复习错题" : e.message || "加载失败",
        needLogin: Boolean(unauthorized),
        count: 0,
        questions: [],
      });
    }
  },

  collectIds() {
    return (this.data.questions || [])
      .map((x) => Number(x.question_id))
      .filter((n) => Number.isInteger(n) && n > 0);
  },

  startReviewAll() {
    const ids = this.collectIds();
    if (!ids.length) {
      wx.showToast({ title: "暂无题目", icon: "none" });
      return;
    }
    try {
      const app = getApp();
      if (!app.globalData) app.globalData = {};
      app.globalData.pendingPractice = {
        questionIds: ids,
        feedbackMode: "immediate",
        sessionOrigin: "review_today",
      };
      app.globalData.practiceReturnPage = { type: "review_today" };
    } catch (_) {}
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  startOne(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    try {
      const app = getApp();
      if (!app.globalData) app.globalData = {};
      app.globalData.pendingPractice = {
        questionIds: [id],
        feedbackMode: "immediate",
        sessionOrigin: "review_today",
      };
      app.globalData.practiceReturnPage = { type: "review_today" };
    } catch (_) {}
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  goBrowseQuiz() {
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  goWrongBook() {
    wx.navigateTo({ url: "/pages/record-wrong/index" });
  },
});
