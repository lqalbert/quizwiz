const { request } = require("../../utils/request.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");

function ensureToken() {
  const token = wx.getStorageSync("student_token");
  if (!token) {
    wx.navigateTo({ url: "/pages/login/index" });
    return false;
  }
  return true;
}

/** 与刷题页一致：data-id 与列表 id 比较须稳定 */
function normalizePositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

Page({
  data: {
    step: "catalog",
    subjects: [],
    subjectId: null,
    units: [],
    unitId: null,
    unitName: "",
    list: [],
    listLoading: false,
    pagination: { total: 0, page: 1, pageSize: 100 },
  },

  onLoad() {
    if (!ensureToken()) return;
    this.bootstrap();
    wx.setNavigationBarTitle({ title: "错题本" });
  },

  onShow() {
    if (!ensureToken()) return;
    const subjects = this.data.subjects || [];
    if (this.data.step === "catalog" && subjects.length === 0) {
      this.bootstrap();
    }
    if (this.data.step === "list" && this.data.subjectId && this.data.unitId) {
      this.loadWrongList(true);
    }
  },

  async bootstrap() {
    try {
      const res = await request({ path: "/api/student/subjects", method: "GET" });
      const raw = res.data || [];
      const subjects = raw
        .map((s) => ({ ...s, id: normalizePositiveInt(s.id) }))
        .filter((s) => s.id > 0);
      let sid = normalizePositiveInt(this.data.subjectId);
      if ((!sid || !subjects.some((s) => s.id === sid)) && subjects.length) {
        sid = subjects[0].id;
      }
      this.setData({ subjects, subjectId: sid || null });
      if (sid) await this.loadKnowledgeUnits(sid);
    } catch (e) {
      if (String(e.message || "").includes("配置 API")) {
        wx.showToast({ title: "请先配置 API 并登录", icon: "none" });
        return;
      }
      if (e.statusCode === 401 || String(e.message || "").includes("登录")) {
        wx.navigateTo({ url: "/pages/login/index" });
        return;
      }
      wx.showToast({ title: e.message || "加载科目失败", icon: "none" });
    }
  },

  async loadKnowledgeUnits(subjectId) {
    const sid = Number(subjectId);
    if (!sid) return;
    try {
      const res = await request({
        path: `/api/student/catalog/knowledge-units?subject_id=${sid}`,
        method: "GET",
      });
      const units = (res.data || [])
        .map((u) => ({ ...u, id: normalizePositiveInt(u.id) }))
        .filter((u) => u.id > 0);
      this.setData({ units });
    } catch (e) {
      wx.showToast({ title: e.message || "加载知识单元失败", icon: "none" });
    }
  },

  onPickSubjectLeft(e) {
    const id = normalizePositiveInt(e.currentTarget.dataset.id);
    if (!id) return;
    this.setData({ subjectId: id, units: [], unitId: null }, () => {
      this.loadKnowledgeUnits(id);
    });
  },

  onPickKnowledgeUnit(e) {
    const unitId = normalizePositiveInt(e.currentTarget.dataset.id);
    const unitName = String(e.currentTarget.dataset.name || "").trim() || "知识单元";
    if (!unitId || !this.data.subjectId) return;
    this.setData({ unitId, unitName, step: "list", list: [] }, () => {
      this.loadWrongList(true);
    });
  },

  backFromList() {
    this.setData({
      step: "catalog",
      unitId: null,
      unitName: "",
      list: [],
      pagination: { total: 0, page: 1, pageSize: 100 },
    });
  },

  async loadWrongList(resetPage) {
    const sid = this.data.subjectId;
    const uid = this.data.unitId;
    if (!sid || !uid) return;
    const page = resetPage ? 1 : this.data.pagination.page;
    const pageSize = 100;
    this.setData({ listLoading: true });
    try {
      const res = await request({
        path: `/api/student/stats/wrong-book?page=${page}&pageSize=${pageSize}&subject_id=${sid}&unit_id=${uid}`,
        method: "GET",
      });
      const list = (res && res.data) || [];
      const pg = (res && res.pagination) || {};
      this.setData({
        list: list.map((row) => ({ ...row, stem: formatStemForDisplay(row.stem) })),
        listLoading: false,
        pagination: {
          total: Number(pg.total || 0),
          page: Number(pg.page || page),
          pageSize: Number(pg.pageSize || pageSize),
        },
      });
    } catch (e) {
      this.setData({ list: [], listLoading: false });
      if (String(e.message || "").includes("配置 API")) {
        wx.showToast({ title: "请先配置 API 并登录", icon: "none" });
        return;
      }
      if (e.statusCode === 401 || String(e.message || "").includes("登录")) {
        wx.navigateTo({ url: "/pages/login/index" });
        return;
      }
      wx.showToast({ title: e.message || "加载失败", icon: "none" });
    }
  },

  onRetryTap(e) {
    const qid = Number(e.currentTarget.dataset.qid);
    if (!Number.isInteger(qid) || qid <= 0) return;
    if (!wx.getStorageSync("student_token")) {
      wx.navigateTo({ url: "/pages/login/index" });
      return;
    }
    try {
      getApp().globalData.pendingPractice = {
        questionIds: [qid],
        feedbackMode: "immediate",
      };
    } catch (_) {}
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  onRemoveWrong(e) {
    const qid = Number(e.currentTarget.dataset.qid);
    if (!Number.isInteger(qid) || qid <= 0) return;
    wx.showModal({
      title: "移出错题本",
      content: "确定不再将此题作为错题展示？",
      success: (r) => {
        if (!r.confirm) return;
        request({
          path: "/api/student/stats/wrong-book/remove",
          method: "POST",
          data: { question_id: qid },
        })
          .then(() => {
            wx.showToast({ title: "已移出", icon: "success" });
            return this.loadWrongList(true);
          })
          .catch((err) => {
            wx.showToast({ title: err.message || "操作失败", icon: "none" });
          });
      },
    });
  },
});
