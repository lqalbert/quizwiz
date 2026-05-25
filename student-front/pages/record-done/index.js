const { request } = require("../../utils/request.js");
const { ensureReadyForPractice } = require("../../utils/practiceGate.js");
const joinClassModalBehavior = require("../../behaviors/join-class-modal.js");
const { catalogPaths, catalogUsesStudentApi } = require("../../utils/catalogApi.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");
const { defaultStudentSubjectId } = require("../../utils/defaultSubject.js");

const LIST_PAGE_SIZE = 25;

function normalizePositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

Page({
  behaviors: [joinClassModalBehavior],

  data: {
    step: "catalog",
    subjects: [],
    subjectId: null,
    units: [],
    unitId: null,
    unitName: "",
    list: [],
    listLoading: false,
    listLoadingMore: false,
    hasMore: false,
    pagination: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE },
  },

  onLoad(options) {
    const restore = options && String(options.restore || "") === "1";
    if (restore) {
      let r = null;
      try {
        r = getApp().globalData.recordPageRestore;
        getApp().globalData.recordPageRestore = null;
      } catch (_) {}
      const sid = normalizePositiveInt(r && r.subjectId);
      const uid = normalizePositiveInt(r && r.unitId);
      const unitName = String((r && r.unitName) || "").trim() || "知识单元";
      if (sid && uid) {
        this.setData({
          step: "list",
          subjectId: sid,
          unitId: uid,
          unitName,
          list: [],
          hasMore: false,
          pagination: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE },
        });
        (async () => {
          try {
            await this.bootstrap();
            await this.loadKnowledgeUnits(sid);
            await this.loadDoneList(true);
          } catch (e) {
            wx.showToast({ title: (e && e.message) || "恢复列表失败", icon: "none" });
          }
        })();
        wx.setNavigationBarTitle({ title: "已做题" });
        return;
      }
    }
    this.bootstrap();
    wx.setNavigationBarTitle({ title: "已做题" });
  },

  onShow() {
    const subjects = this.data.subjects || [];
    if (this.data.step === "catalog" && subjects.length === 0) {
      this.bootstrap();
    }
    if (this.data.step === "list" && this.data.subjectId && this.data.unitId) {
      this.loadDoneList(true);
    }
  },

  async bootstrap() {
    try {
      const paths = catalogPaths();
      const res = await request({ path: paths.subjects, method: "GET", auth: catalogUsesStudentApi() });
      const raw = res.data || [];
      const subjects = raw
        .map((s) => ({ ...s, id: normalizePositiveInt(s.id) }))
        .filter((s) => s.id > 0);
      let sid = normalizePositiveInt(this.data.subjectId);
      if ((!sid || !subjects.some((s) => s.id === sid)) && subjects.length) {
        sid = defaultStudentSubjectId(subjects);
      }
      this.setData({ subjects, subjectId: sid || null });
      if (sid) await this.loadKnowledgeUnits(sid);
    } catch (e) {
      if (String(e.message || "").includes("配置 API")) {
        wx.showToast({ title: "请先配置 API 并登录", icon: "none" });
        return;
      }
      if (e.statusCode === 401 || String(e.message || "").includes("登录")) {
        requireAuthNavigate();
        return;
      }
      wx.showToast({ title: e.message || "加载科目失败", icon: "none" });
    }
  },

  async loadKnowledgeUnits(subjectId) {
    const sid = Number(subjectId);
    if (!sid) return;
    try {
      const paths = catalogPaths();
      const res = await request({
        path: paths.knowledgeUnits(sid),
        method: "GET",
        auth: catalogUsesStudentApi(),
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
      this.loadDoneList(true);
    });
  },

  backFromList() {
    this.setData({
      step: "catalog",
      unitId: null,
      unitName: "",
      list: [],
      hasMore: false,
      pagination: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE },
    });
  },

  async loadDoneList(reset) {
    const sid = this.data.subjectId;
    const uid = this.data.unitId;
    if (!sid || !uid) return;
    if (!wx.getStorageSync("student_token")) {
      this.setData({
        list: [],
        listLoading: false,
        listLoadingMore: false,
        hasMore: false,
        pagination: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE },
      });
      return;
    }
    const append = !reset;
    if (append && (this.data.listLoadingMore || !this.data.hasMore)) return;

    const page = append ? this.data.pagination.page + 1 : 1;
    const pageSize = LIST_PAGE_SIZE;

    if (append) {
      this.setData({ listLoadingMore: true });
    } else {
      this.setData({ listLoading: true });
    }

    try {
      const res = await request({
        path: `/api/student/stats/done-questions?page=${page}&pageSize=${pageSize}&subject_id=${sid}&unit_id=${uid}`,
        method: "GET",
      });
      const chunk = (res && res.data) || [];
      const pg = (res && res.pagination) || {};
      const total = Number(pg.total || 0);
      const formatted = chunk.map((row) => ({ ...row, stem: formatStemForDisplay(row.stem) }));
      const list = append ? (this.data.list || []).concat(formatted) : formatted;
      this.setData({
        list,
        listLoading: false,
        listLoadingMore: false,
        pagination: {
          total,
          page: Number(pg.page || page),
          pageSize: Number(pg.pageSize || pageSize),
        },
        hasMore: list.length < total,
      });
    } catch (e) {
      this.setData({ listLoading: false, listLoadingMore: false });
      if (!append) this.setData({ list: [], hasMore: false });
      if (String(e.message || "").includes("配置 API")) {
        wx.showToast({ title: "请先配置 API 并登录", icon: "none" });
        return;
      }
      if (e.statusCode === 401 || String(e.message || "").includes("登录")) {
        requireAuthNavigate();
        return;
      }
      wx.showToast({ title: e.message || "加载失败", icon: "none" });
    }
  },

  onDoneScrollToLower() {
    if (this.data.hasMore && !this.data.listLoadingMore && !this.data.listLoading) {
      this.loadDoneList(false);
    }
  },

  onLoadMoreDone() {
    if (this.data.hasMore && !this.data.listLoadingMore && !this.data.listLoading) {
      this.loadDoneList(false);
    }
  },

  async startPracticeWithMode(questionIds, feedbackMode) {
    const ids = (questionIds || []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    if (!ids.length) return;
    if (!(await ensureReadyForPractice())) return;
    try {
      const app = getApp();
      app.globalData.pendingPractice = {
        questionIds: ids,
        feedbackMode: feedbackMode === "exam" ? "exam" : "immediate",
      };
      app.globalData.practiceReturnPage = {
        type: "record-done",
        subjectId: this.data.subjectId,
        unitId: this.data.unitId,
        unitName: String(this.data.unitName || "").trim(),
      };
    } catch (_) {}
    wx.switchTab({ url: "/pages/quiz/index" });
  },

  onRetryTap(e) {
    const qid = Number(e.currentTarget.dataset.qid);
    if (!Number.isInteger(qid) || qid <= 0) return;
    wx.showActionSheet({
      itemList: ["即时反馈", "考试模式"],
      success: (r) => {
        if (r.tapIndex === 0) this.startPracticeWithMode([qid], "immediate");
        else if (r.tapIndex === 1) this.startPracticeWithMode([qid], "exam");
      },
    });
  },

  async fetchAllDoneQuestionIds() {
    const sid = this.data.subjectId;
    const uid = this.data.unitId;
    const ids = [];
    let page = 1;
    const pageSize = 100;
    for (let guard = 0; guard < 50; guard += 1) {
      const res = await request({
        path: `/api/student/stats/done-questions?page=${page}&pageSize=${pageSize}&subject_id=${sid}&unit_id=${uid}`,
        method: "GET",
      });
      const chunk = (res && res.data) || [];
      const total = Number((res.pagination && res.pagination.total) || 0);
      for (const row of chunk) {
        const id = Number(row.question_id);
        if (Number.isInteger(id) && id > 0) ids.push(id);
      }
      if (ids.length >= total || chunk.length < pageSize) break;
      page += 1;
    }
    return ids;
  },

  onBatchDonePractice() {
    wx.showActionSheet({
      itemList: ["即时反馈", "考试模式"],
      success: async (r) => {
        if (r.tapIndex !== 0 && r.tapIndex !== 1) return;
        const fm = r.tapIndex === 1 ? "exam" : "immediate";
        wx.showLoading({ title: "组卷中…", mask: true });
        try {
          const ids = await this.fetchAllDoneQuestionIds();
          wx.hideLoading();
          if (!ids.length) {
            wx.showToast({ title: "暂无已做题", icon: "none" });
            return;
          }
          this.startPracticeWithMode(ids, fm);
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || "组卷失败", icon: "none" });
        }
      },
    });
  },

  goBrowseQuiz() {
    wx.switchTab({ url: "/pages/quiz/index" });
  },
});
