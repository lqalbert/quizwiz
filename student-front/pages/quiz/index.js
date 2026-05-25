const { request } = require("../../utils/request.js");
const { catalogPaths, catalogUsesStudentApi } = require("../../utils/catalogApi.js");
const { ensureReadyForPractice, isNeedJoinClassError, promptJoinClass } = require("../../utils/practiceGate.js");
const joinClassModalBehavior = require("../../behaviors/join-class-modal.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");
const { defaultStudentSubjectId } = require("../../utils/defaultSubject.js");
const { clearPracticeDraft, savePracticeDraft, loadPracticeDraft, OPEN_RESUME_DRAFT_KEY } = require("../../utils/practiceDraft.js");
const { showPostSessionDailyFeedback } = require("../../utils/dailyFeedback.js");
const { refreshHomeSummaryIfOpen } = require("../../utils/refreshHomeSummary.js");

/** API 的 id 可能是字符串；点击 data-id 会变成 number，必须与列表 id 类型一致，否则选中态 `===` 失效 */
function normalizePositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function syncNavTitle() {
  wx.setNavigationBarTitle({ title: "" });
}

Page({
  behaviors: [joinClassModalBehavior],

  data: {
    step: "catalog",
    loading: false,
    subjects: [],
    subjectId: null,
    units: [],
    unitId: null,
    unitName: "",
    unitTags: [],
    subsectionRows: [],
    selectedSectionTagIds: [],
    selectedSectionTagNames: [],
    topicQuestionCount: 0,
    selectedTags: [],
    practiceModule: "",
    sectionTag: "",
    mockRows: [],
    feedbackMode: "",
    questionIds: [],
    currentIndex: 0,
    currentQuestion: null,
    selectedAnswer: "",
    multiSelected: [],
    textAnswer: "",
    submitted: false,
    checkResult: null,
    examAnswers: {},
    examResults: [],
    playBtnLabel: "提交",
    playBtnDisabled: true,
    playProgress: 0,
    seqProgressHint: "",
    seqJumpOpen: false,
    seqJumpInput: "",
    /** review_today | wrong_book | '' — 用于本轮结束小结 */
    sessionOrigin: "",
    sessionRight: 0,
    sessionWrong: 0,
    playLoadError: "",
    catalogLoadError: "",
    catalogLoaded: false,
    wrapUpRight: 0,
    wrapUpWrong: 0,
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    try {
      const app = getApp();
      const pending = app && app.globalData && app.globalData.pendingPractice;
      if (pending && Array.isArray(pending.questionIds) && pending.questionIds.length > 0) {
        const origin = pending.sessionOrigin ? String(pending.sessionOrigin) : "";
        app.globalData.pendingPractice = null;
        const fm = pending.feedbackMode === "exam" ? "exam" : "immediate";
        this.startFromWrongBook(pending.questionIds, fm, origin);
        return;
      }
    } catch (_) {}
    try {
      if (wx.getStorageSync(OPEN_RESUME_DRAFT_KEY) === "1") {
        wx.removeStorageSync(OPEN_RESUME_DRAFT_KEY);
        void this.resumePracticeDraft();
        return;
      }
    } catch (_) {}
    const subjects = this.data.subjects || [];
    const atWizardEntry = this.data.step === "catalog";
    if (atWizardEntry && subjects.length === 0) {
      this.bootstrap();
    }
    if (this.data.step === "subsections") {
      this.refreshSubsectionRows();
    }
    syncNavTitle();
    /** 从子页返回刷题 Tab 时补存（离开子页时未走 onTabItemTap） */
    this.savePracticeDraftIfPlaying();
  },

  /** 底部切到其他 Tab 时落盘草稿 */
  onTabItemTap(item) {
    const p = String((item && item.pagePath) || "").replace(/^\//, "");
    if (p === "pages/quiz/index") return;
    this.savePracticeDraftIfPlaying();
  },

  savePracticeDraftIfPlaying() {
    const d = this.data;
    if (d.step !== "play" || !d.questionIds || !d.questionIds.length) return;
    if (d.currentIndex >= d.questionIds.length) return;
    savePracticeDraft({
      questionIds: d.questionIds,
      currentIndex: d.currentIndex,
      feedbackMode: d.feedbackMode,
      practiceModule: d.practiceModule,
      sessionOrigin: d.sessionOrigin || "",
      examAnswers: d.examAnswers || {},
      subjectId: d.subjectId || null,
      unitId: d.unitId || null,
      unitName: d.unitName || "",
      sessionRight: d.sessionRight || 0,
      sessionWrong: d.sessionWrong || 0,
    });
  },

  onLoad() {
    this.bootstrap();
    syncNavTitle();
  },

  async bootstrap() {
    this.setData({ catalogLoadError: "", catalogLoaded: false });
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
      this.setData({ subjects, subjectId: sid || null, catalogLoaded: true, catalogLoadError: "" });
      if (sid) await this.loadKnowledgeUnits(sid);
    } catch (e) {
      const msg = e.message || "加载科目失败";
      this.setData({ catalogLoaded: true, catalogLoadError: msg, subjects: [], subjectId: null, units: [] });
      wx.showToast({ title: msg, icon: "none" });
    }
  },

  retryCatalogBootstrap() {
    this.bootstrap();
  },

  async resumePracticeDraft() {
    if (!(await ensureReadyForPractice())) return;
    const draft = loadPracticeDraft();
    if (!draft) return;
    clearPracticeDraft();
    this.setData(
      {
        step: "play",
        questionIds: draft.questionIds,
        currentIndex: Number(draft.currentIndex) || 0,
        feedbackMode: draft.feedbackMode === "exam" ? "exam" : "immediate",
        practiceModule: String(draft.practiceModule || ""),
        sessionOrigin: draft.sessionOrigin === "review_today" || draft.sessionOrigin === "wrong_book" ? draft.sessionOrigin : "",
        examAnswers: draft.examAnswers && typeof draft.examAnswers === "object" ? draft.examAnswers : {},
        subjectId: draft.subjectId != null ? normalizePositiveInt(draft.subjectId) : null,
        unitId: draft.unitId != null ? normalizePositiveInt(draft.unitId) : null,
        unitName: String(draft.unitName || ""),
        sessionRight: Number(draft.sessionRight) || 0,
        sessionWrong: Number(draft.sessionWrong) || 0,
        submitted: false,
        checkResult: null,
        selectedAnswer: "",
        multiSelected: [],
        textAnswer: "",
        currentQuestion: null,
        playLoadError: "",
        seqJumpOpen: false,
        seqJumpInput: "",
      },
      () => {
        syncNavTitle();
        this.loadCurrentQuestion();
      },
    );
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

  async startFromWrongBook(questionIds, feedbackMode, sessionOrigin = "") {
    if (!(await ensureReadyForPractice())) return;
    const ids = (questionIds || []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    if (!ids.length) return;
    const origin =
      sessionOrigin === "review_today" || sessionOrigin === "wrong_book" ? sessionOrigin : "";
    wx.showLoading({ title: "加载中" });
    clearPracticeDraft();
    request({
      path: "/api/student/practice/build",
      method: "POST",
      data: {
        question_ids: ids,
        limit: Math.min(100, Math.max(ids.length, 1)),
      },
    })
      .then((res) => {
        const out = (res.data && res.data.question_ids) || [];
        if (!out.length) throw new Error("无法加载题目");
        wx.hideLoading();
        this.setData(
          {
            step: "play",
            questionIds: out,
            currentIndex: 0,
            feedbackMode: feedbackMode || "immediate",
            practiceModule: "wrong_retry",
            sessionOrigin: origin,
            sessionRight: 0,
            sessionWrong: 0,
            playLoadError: "",
            subjectId: null,
            units: [],
            unitId: null,
            unitName: "",
            unitTags: [],
            subsectionRows: [],
            selectedSectionTagIds: [],
            selectedSectionTagNames: [],
            selectedTags: [],
            sectionTag: "",
            mockRows: [],
            examAnswers: {},
            examResults: [],
            submitted: false,
            checkResult: null,
            selectedAnswer: "",
            multiSelected: [],
            textAnswer: "",
            seqJumpOpen: false,
            seqJumpInput: "",
          },
          () => {
            syncNavTitle();
            this.loadCurrentQuestion();
          },
        );
      })
      .catch((e) => {
        wx.hideLoading();
        if (isNeedJoinClassError(e)) {
          void promptJoinClass();
          return;
        }
        wx.showModal({
          title: "无法开始练习",
          content: e.message || "请检查网络后重试",
          confirmText: "重试",
          cancelText: "取消",
          success: (r) => {
            if (r.confirm) this.startFromWrongBook(ids, feedbackMode, origin);
          },
        });
      });
  },

  onPickSubjectLeft(e) {
    const id = normalizePositiveInt(e.currentTarget.dataset.id);
    if (!id) return;
    this.setData({ subjectId: id, units: [], unitId: null }, () => {
      this.loadKnowledgeUnits(id);
    });
  },

  seqStorageKeyUnitHint(subjectId, unitId) {
    return `quiz_seq_${subjectId}_${unitId}_unit_hint`;
  },

  seqStorageKeyUnitPos(subjectId, unitId) {
    return `quiz_seq_pos_${subjectId}_${unitId}_unit`;
  },

  seqStorageKeyTagPos(subjectId, unitId, tagId) {
    return `quiz_seq_pos_${subjectId}_${unitId}_tag_${tagId}`;
  },

  seqHintForUnit(subjectId, unitId) {
    const key = this.seqStorageKeyUnitHint(subjectId, unitId);
    const v = wx.getStorageSync(key);
    if (v) return String(v);
    return "从第一题开始依次练习";
  },

  subsectionProgressText(subjectId, unitId, tag) {
    const tid = tag && tag.id;
    const total = Number((tag && tag.question_count) || 0);
    const pos = Number(wx.getStorageSync(this.seqStorageKeyTagPos(subjectId, unitId, tid))) || 1;
    const safeTotal = total > 0 ? total : 0;
    return safeTotal ? `已刷至${pos}/${safeTotal}题` : "暂无题目";
  },

  refreshSubsectionRows() {
    const sid = this.data.subjectId;
    const uid = this.data.unitId;
    const tags = (this.data.unitTags || []).filter(
      (t) => Math.max(0, Number(t.question_count) || 0) > 0,
    );
    if (!sid || !uid) return;
    const subsectionRows = tags.map((t) => ({
      id: normalizePositiveInt(t.id),
      name: t.name,
      question_count: t.question_count,
      progressText: this.subsectionProgressText(sid, uid, t),
    }));
    this.setData({ subsectionRows });
  },

  async onPickKnowledgeUnit(e) {
    const id = normalizePositiveInt(e.currentTarget.dataset.id);
    const name = String(e.currentTarget.dataset.name || "");
    const sid = this.data.subjectId;
    if (!id || !sid) return;
    wx.showLoading({ title: "加载中" });
    try {
      const paths = catalogPaths();
      const res = await request({
        path: paths.unitDetail(id),
        method: "GET",
        auth: catalogUsesStudentApi(),
      });
      const d = res.data || {};
      const unit = d.unit || {};
      const tags = (d.tags || []).map((t) => ({
        ...t,
        id: normalizePositiveInt(t.id),
        question_count: Number(t.question_count) || 0,
      }));
      const count = Number(d.unit_question_count || 0);
      const seqHint = this.seqHintForUnit(sid, id);
      this.setData(
        {
          unitId: id,
          unitName: unit.name || name,
          unitTags: tags,
          topicQuestionCount: count,
          seqProgressHint: seqHint,
          selectedTags: [],
          sectionTag: "",
          selectedSectionTagIds: [],
          selectedSectionTagNames: [],
          step: "practice_style",
        },
        () => {
          wx.hideLoading();
          syncNavTitle();
        },
      );
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
    }
  },

  backFromPracticeStyle() {
    this.setData(
      {
        step: "catalog",
        practiceModule: "",
        feedbackMode: "",
        unitId: null,
        unitName: "",
        unitTags: [],
        subsectionRows: [],
        selectedSectionTagIds: [],
        selectedSectionTagNames: [],
      },
      () => {
        syncNavTitle();
      },
    );
  },

  backFromSubsections() {
    this.setData(
      {
        step: "practice_style",
        selectedSectionTagIds: [],
        selectedSectionTagNames: [],
      },
      () => syncNavTitle(),
    );
  },

  openFeedbackThenBuild(module) {
    this.setData({ practiceModule: module });
    if (module === "section") {
      const names = this.data.selectedSectionTagNames || [];
      this.setData({ sectionTag: names[0] || "" });
    }
    wx.showActionSheet({
      itemList: ["及时反馈（逐题判分）", "考试模式（最后交卷）"],
      success: (r) => {
        if (r.tapIndex === 0) this.setData({ feedbackMode: "immediate" }, () => this.buildAndStart());
        else if (r.tapIndex === 1) this.setData({ feedbackMode: "exam" }, () => this.buildAndStart());
      },
    });
  },

  onStyleCardLongExam(e) {
    const m = String(e.currentTarget.dataset.m || "");
    if (!m || m === "mock" || m === "section") return;
    const uid = this.data.unitId;
    if (!uid) return;
    this.setData({ practiceModule: m, feedbackMode: "exam" });
    this.buildAndStart();
  },

  onStyleCardTap(e) {
    const m = String(e.currentTarget.dataset.m || "");
    const uid = this.data.unitId;
    if (!uid) {
      wx.showToast({ title: "请先选择知识单元", icon: "none" });
      return;
    }
    if (m === "section") {
      const tags = (this.data.unitTags || []).filter(
        (t) => Math.max(0, Number(t.question_count) || 0) > 0,
      );
      if (!tags.length) {
        wx.showToast({ title: "该单元各知识点暂无题目", icon: "none" });
        return;
      }
      this.refreshSubsectionRows();
      this.setData({ step: "subsections", selectedSectionTagIds: [], selectedSectionTagNames: [] }, () =>
        syncNavTitle(),
      );
      return;
    }
    if (m === "mock") {
      const tags = (this.data.unitTags || []).filter(
        (t) => Math.max(0, Number(t.question_count) || 0) > 0,
      );
      if (!tags.length) {
        wx.showToast({ title: "该单元各知识点暂无题目，无法模拟练习", icon: "none" });
        return;
      }
      const mockRows = tags.map((t) => {
        const bank = Math.max(0, Number(t.question_count) || 0);
        const maxCount = Math.min(50, bank);
        return {
          name: t.name,
          displayLabel: t.name,
          bankCount: bank,
          maxCount,
          countInput: "",
          countPlaceholder: `填 0～${maxCount}，0 表示不抽`,
        };
      });
      this.setData({ practiceModule: "mock", mockRows, step: "mock" }, () => syncNavTitle());
      return;
    }
    this.openFeedbackThenBuild(m);
  },

  onToggleSectionTag(e) {
    const id = normalizePositiveInt(e.currentTarget.dataset.id);
    const name = String(e.currentTarget.dataset.name || "").trim();
    if (!id || !name) return;
    const ids = (this.data.selectedSectionTagIds || []).slice();
    const names = (this.data.selectedSectionTagNames || []).slice();
    const idx = ids.findIndex((x) => Number(x) === id);
    if (idx >= 0) {
      ids.splice(idx, 1);
      names.splice(idx, 1);
    } else {
      ids.push(id);
      names.push(name);
    }
    this.setData({ selectedSectionTagIds: ids, selectedSectionTagNames: names });
  },

  startSectionPracticeNow() {
    const names = this.data.selectedSectionTagNames || [];
    if (!names.length) {
      wx.showToast({ title: "请至少勾选一个知识小节", icon: "none" });
      return;
    }
    this.setData({ sectionTag: names[0] || "" });
    this.openFeedbackThenBuild("section");
  },

  onMockCountInput(e) {
    const name = String(e.currentTarget.dataset.name || "");
    const maxCount = Math.max(0, Number(e.currentTarget.dataset.max) || 0);
    let raw = String(e.detail.value ?? "");
    if (raw === "") {
      this._patchMockRow(name, { countInput: "" });
      return;
    }
    const digits = raw.replace(/\D/g, "");
    if (digits === "") {
      this._patchMockRow(name, { countInput: "" });
      return;
    }
    let n = parseInt(digits, 10) || 0;
    if (maxCount > 0 && n > maxCount) n = maxCount;
    this._patchMockRow(name, { countInput: String(n) });
  },

  onMockCountBlur(e) {
    const name = String(e.currentTarget.dataset.name || "");
    const maxCount = Math.max(0, Number(e.currentTarget.dataset.max) || 0);
    const row = (this.data.mockRows || []).find((r) => r.name === name);
    if (!row) return;
    const raw = String(row.countInput ?? "").trim();
    if (raw === "") return;
    let n = parseInt(raw, 10);
    if (Number.isNaN(n)) n = 0;
    n = Math.min(Math.max(0, n), maxCount > 0 ? maxCount : 0);
    this._patchMockRow(name, { countInput: String(n) });
  },

  _patchMockRow(name, patch) {
    const mockRows = (this.data.mockRows || []).map((row) =>
      row.name === name ? { ...row, ...patch } : row,
    );
    this.setData({ mockRows });
  },

  fromMockNext() {
    wx.showActionSheet({
      itemList: ["及时反馈（逐题判分）", "考试模式（最后交卷）"],
      success: (r) => {
        if (r.tapIndex === 0) this.setData({ feedbackMode: "immediate" }, () => this.buildAndStart());
        else if (r.tapIndex === 1) this.setData({ feedbackMode: "exam" }, () => this.buildAndStart());
      },
    });
  },

  backFromMock() {
    this.setData({ step: "practice_style", mockRows: [] }, () => syncNavTitle());
  },

  async buildAndStart() {
    if (!(await ensureReadyForPractice())) return;
    const subjectId = Number(this.data.subjectId);
    const unitId = normalizePositiveInt(this.data.unitId);
    const practiceModule = this.data.practiceModule;
    const tag_names = this.data.selectedTags || [];
    const needUnit = practiceModule === "sequential" || practiceModule === "random" || practiceModule === "section" || practiceModule === "mock";
    if (!Number.isFinite(subjectId) || subjectId <= 0) {
      wx.showToast({ title: "缺少科目，请到刷题首页重选科目", icon: "none" });
      return;
    }
    if (needUnit && !unitId) {
      wx.showToast({ title: "缺少知识单元，请先选择单元后再开始", icon: "none" });
      return;
    }
    const body = {
      subject_id: subjectId,
      practice_module: practiceModule,
      limit: 30,
    };
    if (tag_names.length) body.tag_names = tag_names;
    if (unitId) body.unit_id = unitId;
    if (practiceModule === "section") {
      const secNames = this.data.selectedSectionTagNames || [];
      if (secNames.length) {
        body.section_tags = secNames;
        // 旧版服务端只校验 section_tag，不传会报「须传 section_tag」；新服务端以 section_tags 为准
        body.section_tag = secNames[0];
      } else if (this.data.sectionTag) {
        body.section_tag = this.data.sectionTag;
      }
    }
    if (practiceModule === "mock") {
      const rows = this.data.mockRows || [];
      const alloc = [];
      for (const row of rows) {
        const maxC = Math.max(0, Number(row.maxCount) || 0);
        let n = parseInt(String(row.countInput || "0"), 10) || 0;
        if (Number.isNaN(n)) n = 0;
        n = Math.min(Math.max(0, n), maxC);
        if (n > 0) alloc.push({ tag_name: row.name, count: n });
      }
      body.mock_allocation = alloc;
      if (body.mock_allocation.length === 0) {
        wx.showToast({ title: "请至少在一个知识点填写大于 0 的抽题数", icon: "none" });
        return;
      }
    }
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.practiceReturnPage = null;
    } catch (_) {}

    wx.showLoading({ title: "组卷中" });
    try {
      const res = await request({ path: "/api/student/practice/build", method: "POST", data: body });
      const ids = (res.data && res.data.question_ids) || [];
      if (!ids.length) throw new Error("没有题目");
      clearPracticeDraft();
      this.setData(
        {
          questionIds: ids,
          currentIndex: 0,
          examAnswers: {},
          step: "play",
          submitted: false,
          checkResult: null,
          seqJumpOpen: false,
          seqJumpInput: "",
          sessionOrigin: "",
          sessionRight: 0,
          sessionWrong: 0,
          playLoadError: "",
        },
        () => {
          wx.hideLoading();
          syncNavTitle();
          this.loadCurrentQuestion();
        },
      );
    } catch (e) {
      wx.hideLoading();
      if (isNeedJoinClassError(e)) {
        void promptJoinClass();
        return;
      }
      wx.showModal({
        title: "组卷失败",
        content: e.message || "请检查网络后重试",
        confirmText: "重试",
        cancelText: "取消",
        success: (r) => {
          if (r.confirm) this.buildAndStart();
        },
      });
    }
  },

  onWrapUpDone() {
    const round = (Number(this.data.wrapUpRight) || 0) + (Number(this.data.wrapUpWrong) || 0);
    void (async () => {
      await showPostSessionDailyFeedback(round);
      this.restartWizard();
    })();
  },

  async onExamResultDone() {
    const n = (this.data.examResults || []).length;
    await showPostSessionDailyFeedback(n);
    this.restartWizard();
  },

  applyCatalogReset(reloadCatalog = true) {
    const sid = this.data.subjectId;
    this.setData({
      step: "catalog",
      units: [],
      unitId: null,
      unitName: "",
      unitTags: [],
      subsectionRows: [],
      selectedSectionTagIds: [],
      selectedSectionTagNames: [],
      topicQuestionCount: 0,
      selectedTags: [],
      practiceModule: "",
      sectionTag: "",
      mockRows: [],
      feedbackMode: "",
      questionIds: [],
      currentIndex: 0,
      currentQuestion: null,
      examResults: [],
      submitted: false,
      checkResult: null,
      seqJumpOpen: false,
      seqJumpInput: "",
      sessionOrigin: "",
      sessionRight: 0,
      sessionWrong: 0,
      playLoadError: "",
      wrapUpRight: 0,
      wrapUpWrong: 0,
    });
    syncNavTitle();
    if (!reloadCatalog) return;
    if (sid) {
      this.loadKnowledgeUnits(sid);
    } else {
      this.bootstrap();
    }
  },

  /** 从待复习/错题本等子页进入练习后，返回时先跳转再重置，避免先闪目录页再跳转 */
  leavePracticeToPage(url) {
    const targetRoute = String(url || "")
      .replace(/^\//, "")
      .replace(/\?.*$/, "");
    const pages = getCurrentPages();
    const targetIdx = pages.findIndex((p) => String((p && p.route) || "") === targetRoute);
    if (targetIdx >= 0 && targetIdx < pages.length - 1) {
      wx.navigateBack({
        delta: pages.length - 1 - targetIdx,
        success: () => this.applyCatalogReset(true),
        fail: () => this.openPracticeReturnPage(url),
      });
      return;
    }
    this.openPracticeReturnPage(url);
  },

  openPracticeReturnPage(url) {
    wx.navigateTo({
      url,
      success: () => this.applyCatalogReset(true),
      fail: () => {
        this.applyCatalogReset(true);
        wx.showToast({ title: "无法打开上一页", icon: "none" });
      },
    });
  },

  restartWizard() {
    clearPracticeDraft();
    let returnTarget = null;
    try {
      const app = getApp();
      const pr = app && app.globalData && app.globalData.practiceReturnPage;
      if (pr && (pr.type === "record-done" || pr.type === "record-wrong" || pr.type === "review_today")) {
        returnTarget = pr;
        app.globalData.practiceReturnPage = null;
      }
    } catch (_) {}

    if (returnTarget && returnTarget.type === "review_today") {
      this.leavePracticeToPage("/pages/review-today/index");
      return;
    }

    if (returnTarget) {
      try {
        getApp().globalData.recordPageRestore = {
          subjectId: normalizePositiveInt(returnTarget.subjectId),
          unitId: normalizePositiveInt(returnTarget.unitId),
          unitName: String(returnTarget.unitName || "").trim(),
        };
      } catch (_) {}
      const path =
        returnTarget.type === "record-done"
          ? "/pages/record-done/index?restore=1"
          : "/pages/record-wrong/index?restore=1";
      this.leavePracticeToPage(path);
      return;
    }

    this.applyCatalogReset(true);
  },

  retryLoadQuestion() {
    this.setData({ playLoadError: "" }, () => this.loadCurrentQuestion());
  },

  async loadCurrentQuestion() {
    const ids = this.data.questionIds || [];
    const idx = this.data.currentIndex;
    if (idx >= ids.length) {
      this.restartWizard();
      return;
    }
    const id = ids[idx];
    const feedbackMode = this.data.feedbackMode;
    this.setData({ loading: true, playLoadError: "" });
    try {
      const res = await request({ path: `/api/student/questions/${id}`, method: "GET" });
      const raw = res.data || {};
      const currentQuestion = {
        ...raw,
        stem: formatStemForDisplay(raw.stem),
      };
      const total = ids.length;
      const playProgress = total > 0 ? Math.round(((idx + 1) / total) * 100) : 0;

      let selectedAnswer = "";
      let multiSelected = [];
      let textAnswer = "";
      if (feedbackMode === "exam") {
        const saved = this.data.examAnswers[String(id)];
        if (saved !== undefined && saved !== null) {
          const ua = String(saved);
          const qt = Number(raw.question_type);
          if (qt === 2) {
            multiSelected = ua ? ua.split(",").map((s) => String(s).trim()).filter(Boolean) : [];
          } else if (qt === 4 || qt === 5) {
            textAnswer = ua;
          } else {
            selectedAnswer = ua;
          }
        }
      }

      this.setData(
        {
          currentQuestion,
          loading: false,
          selectedAnswer,
          multiSelected,
          textAnswer,
          submitted: false,
          checkResult: null,
          playProgress,
        },
        () => this.syncPlayButton(),
      );
    } catch (e) {
      this.setData({ loading: false, currentQuestion: null, playLoadError: e.message || "加载失败" });
    }
  },

  submitCheckNow() {
    const ids = this.data.questionIds || [];
    const idx = this.data.currentIndex;
    const qid = ids[idx];
    wx.showLoading({ title: "判题" });
    request({
      path: `/api/student/questions/${qid}/check`,
      method: "POST",
      data: { user_answer: this.getUserAnswer() },
    })
      .then((res) => {
        wx.hideLoading();
        const cr = res.data || {};
        const origin = this.data.sessionOrigin;
        let sr = Number(this.data.sessionRight) || 0;
        let sw = Number(this.data.sessionWrong) || 0;
        if (origin === "review_today" || origin === "wrong_book") {
          if (cr.correct) sr += 1;
          else sw += 1;
        }
        if (origin === "review_today") {
          try {
            refreshHomeSummaryIfOpen();
          } catch (_) {}
        }
        this.setData({ submitted: true, checkResult: cr, sessionRight: sr, sessionWrong: sw }, () => this.syncPlayButton());
      })
      .catch((e) => {
        wx.hideLoading();
        wx.showModal({
          title: "提交失败",
          content: e.message || "请检查网络后重试",
          confirmText: "重试",
          cancelText: "取消",
          success: (r) => {
            if (r.confirm) this.submitCheckNow();
          },
        });
      });
  },

  getUserAnswer() {
    const q = this.data.currentQuestion;
    if (!q) return "";
    const t = Number(q.question_type);
    if (t === 2) {
      return (this.data.multiSelected || []).slice().sort().join(",");
    }
    if (t === 4 || t === 5) return String(this.data.textAnswer || "").trim();
    return String(this.data.selectedAnswer || "").trim();
  },

  syncPlayButton() {
    const mode = this.data.feedbackMode;
    const ids = this.data.questionIds || [];
    const idx = this.data.currentIndex;
    const last = idx >= ids.length - 1;
    const ua = this.getUserAnswer();
    const qt = Number(this.data.currentQuestion && this.data.currentQuestion.question_type);
    const hasAnsFinal = qt === 2 ? this.data.multiSelected.length > 0 : Boolean(ua);

    if (mode === "exam") {
      this.setData({
        playBtnLabel: last ? "交卷" : "下一题",
        playBtnDisabled: false,
      });
      return;
    }
    if (!this.data.submitted) {
      this.setData({
        playBtnLabel: "提交",
        playBtnDisabled: !hasAnsFinal,
      });
    } else {
      this.setData({
        playBtnLabel: last ? "结束" : "下一题",
        playBtnDisabled: false,
      });
    }
  },

  onPickSingle(e) {
    if (this.data.feedbackMode === "immediate" && this.data.submitted) return;
    const k = String(e.currentTarget.dataset.k || "");
    this.setData({ selectedAnswer: k }, () => this.syncPlayButton());
  },

  onToggleMulti(e) {
    if (this.data.feedbackMode === "immediate" && this.data.submitted) return;
    const k = String(e.currentTarget.dataset.k || "");
    const arr = (this.data.multiSelected || []).slice();
    const i = arr.indexOf(k);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(k);
    this.setData({ multiSelected: arr }, () => this.syncPlayButton());
  },

  onPickJudge(e) {
    if (this.data.feedbackMode === "immediate" && this.data.submitted) return;
    const v = String(e.currentTarget.dataset.v || "");
    this.setData({ selectedAnswer: v }, () => this.syncPlayButton());
  },

  onTextAnswer(e) {
    this.setData({ textAnswer: e.detail.value }, () => this.syncPlayButton());
  },

  bumpSeqProgressHint() {
    const pm = this.data.practiceModule;
    if (pm !== "sequential" && pm !== "section") return;
    const sid = this.data.subjectId;
    const uid = this.data.unitId;
    if (!sid || !uid) return;
    const done = this.data.currentIndex + 1;
    const hintText = `已刷至${done}题`;
    if (pm === "sequential") {
      wx.setStorageSync(this.seqStorageKeyUnitHint(sid, uid), hintText);
      wx.setStorageSync(this.seqStorageKeyUnitPos(sid, uid), done);
      this.setData({ seqProgressHint: hintText });
      return;
    }
    if (pm === "section") {
      const tags = this.data.unitTags || [];
      const names = (this.data.selectedSectionTagNames || []).length
        ? this.data.selectedSectionTagNames
        : this.data.sectionTag
          ? [this.data.sectionTag]
          : [];
      for (const nm of names) {
        const tagRow = tags.find((t) => String(t.name) === String(nm));
        const tid = tagRow && tagRow.id;
        if (tid) {
          wx.setStorageSync(this.seqStorageKeyTagPos(sid, uid, tid), done);
        }
      }
    }
  },

  onExamPrev() {
    if (this.data.feedbackMode !== "exam") return;
    const idx = this.data.currentIndex;
    if (idx <= 0) return;
    const ids = this.data.questionIds || [];
    const qid = ids[idx];
    const ua = this.getUserAnswer();
    const examAnswers = { ...this.data.examAnswers, [String(qid)]: ua };
    this.setData({ examAnswers, currentIndex: idx - 1 }, () => this.loadCurrentQuestion());
  },

  /** 仅顺序刷题：点工具栏「跳转」打开题号弹层（方法名勿用过长驼峰，部分基础库对 bindtap 解析偶发异常） */
  openSeqJump() {
    if (this.data.practiceModule !== "sequential") return;
    const total = (this.data.questionIds || []).length;
    if (!total) return;
    const cur = this.data.currentIndex + 1;
    this.setData({ seqJumpOpen: true, seqJumpInput: String(cur) });
  },

  closeSeqJump() {
    this.setData({ seqJumpOpen: false, seqJumpInput: "" });
  },

  onSeqJumpInput(e) {
    this.setData({ seqJumpInput: e.detail.value });
  },

  confirmSeqJump() {
    const total = (this.data.questionIds || []).length;
    if (!total) {
      this.closeSeqJump();
      return;
    }
    let n = parseInt(String(this.data.seqJumpInput || "").trim(), 10);
    if (Number.isNaN(n)) {
      wx.showToast({ title: "请输入有效题号", icon: "none" });
      return;
    }
    n = Math.min(Math.max(1, n), total);
    this.setData({ seqJumpOpen: false, seqJumpInput: "", currentIndex: n - 1 }, () => this.loadCurrentQuestion());
  },

  noop() {},

  async onPlayPrimary() {
    const mode = this.data.feedbackMode;
    const ids = this.data.questionIds || [];
    const idx = this.data.currentIndex;
    const last = idx >= ids.length - 1;
    const qid = ids[idx];

    if (mode === "exam") {
      const ua = this.getUserAnswer();
      const examAnswers = { ...this.data.examAnswers, [String(qid)]: ua };
      if (!last) {
        this.setData({ examAnswers, currentIndex: idx + 1 }, () => this.loadCurrentQuestion());
        return;
      }
      wx.showLoading({ title: "判分中" });
      try {
        const answers = ids.map((id) => ({
          question_id: id,
          user_answer: examAnswers[String(id)] ?? "",
        }));
        const res = await request({
          path: "/api/student/practice/exam-submit",
          method: "POST",
          data: { answers },
        });
        wx.hideLoading();
        const results = (res.data && res.data.results) || [];
        if (this.data.sessionOrigin === "review_today" && results.length > 0) {
          try {
            refreshHomeSummaryIfOpen();
          } catch (_) {}
        }
        this.setData(
          {
            step: "exam_result",
            examResults: results.map((row) => ({
              ...row,
              stem: row.missing ? row.stem : formatStemForDisplay(row.stem),
            })),
          },
          () => syncNavTitle(),
        );
      } catch (e) {
        wx.hideLoading();
        wx.showModal({
          title: "交卷失败",
          content: e.message || "请检查网络后重试",
          confirmText: "重试",
          cancelText: "取消",
          success: (r) => {
            if (r.confirm) this.onPlayPrimary();
          },
        });
      }
      return;
    }

    if (!this.data.submitted) {
      if (this.data.playBtnDisabled) return;
      this.submitCheckNow();
      return;
    }

    if (last) {
      this.bumpSeqProgressHint();
      const origin = this.data.sessionOrigin;
      if (this.data.feedbackMode === "immediate" && (origin === "review_today" || origin === "wrong_book")) {
        clearPracticeDraft();
        this.setData(
          {
            step: "practice_wrapup",
            wrapUpRight: Number(this.data.sessionRight) || 0,
            wrapUpWrong: Number(this.data.sessionWrong) || 0,
          },
          () => syncNavTitle(),
        );
        return;
      }
      void (async () => {
        await showPostSessionDailyFeedback(ids.length);
        this.restartWizard();
      })();
      return;
    }
    this.bumpSeqProgressHint();
    this.setData({ currentIndex: idx + 1 }, () => this.loadCurrentQuestion());
  },
});
