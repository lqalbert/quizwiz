const { request } = require("../../utils/request.js");
const { redirectIfNeedJoinClass } = require("../../utils/joinGate.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");

function ensureToken() {
  const token = wx.getStorageSync("student_token");
  if (!token) {
    wx.reLaunch({ url: "/pages/login/index" });
    return false;
  }
  return true;
}

function unwrapPayload(root) {
  if (!root || typeof root !== "object") return {};
  const inner = root.data;
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) return inner;
  return root;
}

function nextReviewLabel(row) {
  const d = row && row.next_review_date;
  if (d == null || d === "") return "尽快";
  return String(d);
}

function loadReminderTemplateIds() {
  try {
    let s = null;
    try {
      s = require("../../config/site.local.js");
    } catch (_) {
      s = require("../../config/site.js");
    }
    const arr = s && Array.isArray(s.reviewReminderTemplateIds) ? s.reviewReminderTemplateIds : [];
    return arr.map((x) => String(x || "").trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

Page({
  data: {
    loading: true,
    err: "",
    count: 0,
    questions: [],
  },

  onLoad() {
    if (!ensureToken()) return;
    if (redirectIfNeedJoinClass()) return;
    wx.setNavigationBarTitle({ title: "今日待复习" });
  },

  onShow() {
    if (!ensureToken()) return;
    if (redirectIfNeedJoinClass()) return;
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true, err: "" });
    try {
      const res = await request({ path: "/api/student/stats/review-due-today", method: "GET" });
      const d = unwrapPayload(res);
      const raw = (d && d.questions) || [];
      const count = Number(d && d.count != null ? d.count : raw.length) || 0;
      const questions = raw.map((it) => ({
        ...it,
        stem_display: formatStemForDisplay(it.stem),
        next_label: nextReviewLabel(it),
      }));
      this.setData({ loading: false, count, questions });
    } catch (e) {
      this.setData({
        loading: false,
        err: e.message || "加载失败",
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
      app.globalData.pendingPractice = { questionIds: ids, feedbackMode: "immediate" };
    } catch (_) {}
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  startOne(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    try {
      const app = getApp();
      if (!app.globalData) app.globalData = {};
      app.globalData.pendingPractice = { questionIds: [id], feedbackMode: "immediate" };
    } catch (_) {}
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  requestReviewReminder() {
    const tmplIds = loadReminderTemplateIds();
    if (!tmplIds.length) {
      wx.showToast({
        title: "请在 config/site.js 配置 reviewReminderTemplateIds",
        icon: "none",
        duration: 3200,
      });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds,
      success: (r) => {
        const acc = tmplIds.filter((t) => r[t] === "accept").length;
        if (acc > 0) wx.showToast({ title: "已订阅", icon: "success" });
        else wx.showToast({ title: "未授权则无法推送", icon: "none" });
      },
      fail: () => wx.showToast({ title: "订阅失败", icon: "none" }),
    });
  },
});
