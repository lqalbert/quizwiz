const { request } = require("../../utils/request.js");
const { enrichRecordRowsWithOptions } = require("../../utils/recordListFormat.js");
const { formatBeijingCalendarDate, formatBeijingDateTime, beijingCalendarDateKey } = require("../../utils/beijingTime.js");
const { refreshHomeSummaryIfOpen } = require("../../utils/refreshHomeSummary.js");
const withPageShare = require("../../utils/withPageShare.js");

const LIST_PAGE_SIZE = 20;

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

function mapReviewRow(row, source) {
  const it = source || row;
  return {
    ...row,
    stem_display: row.stem,
    next_label: nextReviewLabel(it),
    last_wrong_label: lastWrongLabel(it),
    next_review_date_display: formatBeijingCalendarDate(it.next_review_date),
  };
}

withPageShare({
  data: {
    loading: true,
    listLoadingMore: false,
    err: "",
    needLogin: false,
    count: 0,
    questions: [],
    hasMore: false,
    pagination: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE },
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: "今日待复习" });
  },

  onShow() {
    this.loadList(true);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.listLoadingMore && !this.data.loading) {
      this.loadList(false);
    }
  },

  /** @param {boolean} reset true 重新拉第 1 页 */
  async loadList(reset, e) {
    const fromTap = Boolean(e && (e.type === "tap" || e.currentTarget));
    if (!wx.getStorageSync("student_token")) {
      if (fromTap && this.data.needLogin) {
        wx.navigateTo({ url: "/pages/login/index" });
        return;
      }
      this.setData({
        loading: false,
        listLoadingMore: false,
        err: "登录后查看待复习错题",
        needLogin: true,
        count: 0,
        questions: [],
        hasMore: false,
        pagination: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE },
      });
      return;
    }

    const append = reset === false;
    if (append && (this.data.listLoadingMore || !this.data.hasMore || this.data.loading)) return;

    const page = append ? this.data.pagination.page + 1 : 1;
    const pageSize = LIST_PAGE_SIZE;

    if (append) {
      this.setData({ listLoadingMore: true, err: "", needLogin: false });
    } else {
      this.setData({ loading: true, err: "", needLogin: false });
    }

    try {
      const res = await request({
        path: `/api/student/stats/review-due-today?page=${page}&pageSize=${pageSize}`,
        method: "GET",
      });
      const d = unwrapPayload(res);
      const raw = (d && d.questions) || [];
      const pg = (d && d.pagination) || {};
      const total = Number(pg.total != null ? pg.total : d && d.count != null ? d.count : raw.length) || 0;
      const count = Number(d && d.count != null ? d.count : total) || 0;
      const enriched = await enrichRecordRowsWithOptions(raw);
      const rawById = new Map(raw.map((r) => [Number(r.question_id), r]));
      const chunk = enriched.map((row) => mapReviewRow(row, rawById.get(Number(row.question_id))));
      const questions = append ? (this.data.questions || []).concat(chunk) : chunk;
      this.setData({
        loading: false,
        listLoadingMore: false,
        count,
        questions,
        pagination: {
          total,
          page: Number(pg.page || page),
          pageSize: Number(pg.pageSize || pageSize),
        },
        hasMore: questions.length < total,
      });
      if (!append) {
        try {
          refreshHomeSummaryIfOpen();
        } catch (_) {}
      }
    } catch (err) {
      const unauthorized = err && err.statusCode === 401;
      this.setData({
        loading: false,
        listLoadingMore: false,
        err: unauthorized ? "登录后查看待复习错题" : err.message || "加载失败",
        needLogin: Boolean(unauthorized),
        count: append ? this.data.count : 0,
        questions: append ? this.data.questions : [],
        hasMore: append ? this.data.hasMore : false,
      });
    }
  },

  collectIds() {
    return (this.data.questions || [])
      .map((x) => Number(x.question_id))
      .filter((n) => Number.isInteger(n) && n > 0);
  },

  async fetchAllReviewQuestionIds() {
    const ids = [];
    let page = 1;
    const pageSize = 100;
    for (let guard = 0; guard < 50; guard += 1) {
      const res = await request({
        path: `/api/student/stats/review-due-today?page=${page}&pageSize=${pageSize}`,
        method: "GET",
      });
      const d = unwrapPayload(res);
      const chunk = (d && d.questions) || [];
      const total = Number((d.pagination && d.pagination.total) || d.count || 0);
      for (const row of chunk) {
        const id = Number(row.question_id);
        if (Number.isInteger(id) && id > 0) ids.push(id);
      }
      if (ids.length >= total || chunk.length < pageSize) break;
      page += 1;
    }
    return ids;
  },

  startReviewAll() {
    void (async () => {
      wx.showLoading({ title: "组卷中…", mask: true });
      try {
        const ids = await this.fetchAllReviewQuestionIds();
        wx.hideLoading();
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
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: err.message || "组卷失败", icon: "none" });
      }
    })();
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
