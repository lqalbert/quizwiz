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

function syncNavTitle(step) {
  const map = {
    catalog: "刷题",
    practice_style: "刷题模式",
    subsections: "刷题模式",
    mock: "模拟练习",
    play: "练习",
    exam_result: "交卷结果",
  };
  const t = map[step] || "刷题";
  wx.setNavigationBarTitle({ title: t });
}

Page({
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
    selectedSubTagId: null,
    selectedSubTagName: "",
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
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    const token = wx.getStorageSync("student_token");
    if (!token) {
      wx.navigateTo({ url: "/pages/login/index" });
      return;
    }
    try {
      const app = getApp();
      const pending = app && app.globalData && app.globalData.pendingPractice;
      if (pending && Array.isArray(pending.questionIds) && pending.questionIds.length > 0) {
        app.globalData.pendingPractice = null;
        const fm = pending.feedbackMode === "exam" ? "exam" : "immediate";
        this.startFromWrongBook(pending.questionIds, fm);
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
    syncNavTitle(this.data.step);
  },

  onLoad() {
    if (!ensureToken()) return;
    this.bootstrap();
    syncNavTitle(this.data.step);
  },

  async bootstrap() {
    try {
      const res = await request({ path: "/api/student/subjects", method: "GET" });
      const subjects = res.data || [];
      let subjectId = this.data.subjectId;
      if ((!subjectId || !subjects.some((s) => Number(s.id) === Number(subjectId))) && subjects.length) {
        subjectId = subjects[0].id;
      }
      this.setData({ subjects, subjectId: subjectId || null });
      if (subjectId) await this.loadKnowledgeUnits(subjectId);
    } catch (e) {
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
      this.setData({ units: res.data || [] });
    } catch (e) {
      wx.showToast({ title: e.message || "加载知识单元失败", icon: "none" });
    }
  },

  startFromWrongBook(questionIds, feedbackMode) {
    const ids = (questionIds || []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    if (!ids.length) return;
    wx.showLoading({ title: "加载中" });
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
            subjectId: null,
            units: [],
            unitId: null,
            unitName: "",
            unitTags: [],
            subsectionRows: [],
            selectedSubTagId: null,
            selectedSubTagName: "",
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
          },
          () => {
            syncNavTitle("play");
            this.loadCurrentQuestion();
          },
        );
      })
      .catch((e) => {
        wx.hideLoading();
        wx.showToast({ title: e.message || "无法开始练习", icon: "none" });
      });
  },

  onPickSubjectLeft(e) {
    const id = Number(e.currentTarget.dataset.id);
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
    const tags = this.data.unitTags || [];
    if (!sid || !uid) return;
    const subsectionRows = tags.map((t) => ({
      id: t.id,
      name: t.name,
      question_count: t.question_count,
      progressText: this.subsectionProgressText(sid, uid, t),
    }));
    this.setData({ subsectionRows });
  },

  async onPickKnowledgeUnit(e) {
    const id = Number(e.currentTarget.dataset.id);
    const name = String(e.currentTarget.dataset.name || "");
    const sid = this.data.subjectId;
    if (!id || !sid) return;
    wx.showLoading({ title: "加载中" });
    try {
      const res = await request({
        path: `/api/student/catalog/unit-detail?unit_id=${id}`,
        method: "GET",
      });
      const d = res.data || {};
      const unit = d.unit || {};
      const tags = d.tags || [];
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
          selectedSubTagId: null,
          selectedSubTagName: "",
          step: "practice_style",
        },
        () => {
          wx.hideLoading();
          syncNavTitle("practice_style");
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
        selectedSubTagId: null,
        selectedSubTagName: "",
      },
      () => {
        syncNavTitle("catalog");
      },
    );
  },

  backFromSubsections() {
    this.setData(
      {
        step: "practice_style",
        selectedSubTagId: null,
        selectedSubTagName: "",
      },
      () => syncNavTitle("practice_style"),
    );
  },

  openFeedbackThenBuild(module) {
    this.setData({ practiceModule: module });
    if (module === "section") {
      this.setData({ sectionTag: this.data.selectedSubTagName });
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
      this.refreshSubsectionRows();
      this.setData({ step: "subsections", selectedSubTagId: null, selectedSubTagName: "" }, () =>
        syncNavTitle("subsections"),
      );
      return;
    }
    if (m === "mock") {
      const tags = this.data.unitTags || [];
      if (!tags.length) {
        wx.showToast({ title: "该单元暂无知识点，无法模拟练习", icon: "none" });
        return;
      }
      const mockRows = tags.map((t) => ({
        name: t.name,
        displayLabel: t.name,
        countInput: "3",
      }));
      this.setData({ practiceModule: "mock", mockRows, step: "mock" }, () => syncNavTitle("mock"));
      return;
    }
    this.openFeedbackThenBuild(m);
  },

  onSelectSubTag(e) {
    const id = Number(e.currentTarget.dataset.id);
    const name = String(e.currentTarget.dataset.name || "");
    if (!id) return;
    this.setData({ selectedSubTagId: id, selectedSubTagName: name });
  },

  /** 双击快捷刷题：短时间内第二次点击同一条则直接开始 */
  _lastSubTap: { id: 0, t: 0 },
  onSubTagRowTapMaybeDouble(e) {
    const id = Number(e.currentTarget.dataset.id);
    const now = Date.now();
    const prev = this._lastSubTap || { id: 0, t: 0 };
    if (prev.id === id && now - prev.t < 420) {
      this._lastSubTap = { id: 0, t: 0 };
      this.onSelectSubTag(e);
      this.startSectionPracticeNow();
      return;
    }
    this._lastSubTap = { id, t: now };
    this.onSelectSubTag(e);
  },

  startSectionPracticeNow() {
    if (!this.data.selectedSubTagId || !this.data.selectedSubTagName) {
      wx.showToast({ title: "请先选择知识小节", icon: "none" });
      return;
    }
    this.setData({ sectionTag: this.data.selectedSubTagName });
    this.openFeedbackThenBuild("section");
  },

  onMockCountInput(e) {
    const name = String(e.currentTarget.dataset.name || "");
    const val = e.detail.value;
    const mockRows = (this.data.mockRows || []).map((row) =>
      row.name === name ? { ...row, countInput: val } : row,
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
    this.setData({ step: "practice_style", mockRows: [] }, () => syncNavTitle("practice_style"));
  },

  async buildAndStart() {
    const subjectId = this.data.subjectId;
    const unitId = this.data.unitId;
    const practiceModule = this.data.practiceModule;
    const tag_names = this.data.selectedTags || [];
    const body = {
      subject_id: subjectId,
      practice_module: practiceModule,
      limit: 30,
    };
    if (tag_names.length) body.tag_names = tag_names;
    if (unitId) body.unit_id = unitId;
    if (practiceModule === "section") {
      body.section_tag = this.data.sectionTag || this.data.selectedSubTagName;
    }
    if (practiceModule === "mock") {
      body.mock_allocation = (this.data.mockRows || [])
        .map((row) => ({
          tag_name: row.name,
          count: parseInt(String(row.countInput || "0"), 10) || 0,
        }))
        .filter((row) => row.count > 0);
      if (body.mock_allocation.length === 0) {
        wx.showToast({ title: "请填写至少一行的题数", icon: "none" });
        return;
      }
    }
    wx.showLoading({ title: "组卷中" });
    try {
      const res = await request({ path: "/api/student/practice/build", method: "POST", data: body });
      const ids = (res.data && res.data.question_ids) || [];
      if (!ids.length) throw new Error("没有题目");
      this.setData(
        {
          questionIds: ids,
          currentIndex: 0,
          examAnswers: {},
          step: "play",
          submitted: false,
          checkResult: null,
        },
        () => {
          wx.hideLoading();
          syncNavTitle("play");
          this.loadCurrentQuestion();
        },
      );
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "组卷失败", icon: "none" });
    }
  },

  restartWizard() {
    const sid = this.data.subjectId;
    this.setData({
      step: "catalog",
      units: [],
      unitId: null,
      unitName: "",
      unitTags: [],
      subsectionRows: [],
      selectedSubTagId: null,
      selectedSubTagName: "",
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
    });
    syncNavTitle("catalog");
    if (sid) {
      this.loadKnowledgeUnits(sid);
    } else {
      this.bootstrap();
    }
  },

  async loadCurrentQuestion() {
    const ids = this.data.questionIds || [];
    const idx = this.data.currentIndex;
    if (idx >= ids.length) {
      wx.showToast({ title: "已完成", icon: "none" });
      this.restartWizard();
      return;
    }
    const id = ids[idx];
    this.setData({ loading: true });
    try {
      const res = await request({ path: `/api/student/questions/${id}`, method: "GET" });
      const raw = res.data || {};
      const currentQuestion = {
        ...raw,
        stem: formatStemForDisplay(raw.stem),
      };
      const total = ids.length;
      const playProgress = total > 0 ? Math.round(((idx + 1) / total) * 100) : 0;
      this.setData(
        {
          currentQuestion,
          loading: false,
          selectedAnswer: "",
          multiSelected: [],
          textAnswer: "",
          submitted: false,
          checkResult: null,
          playProgress,
        },
        () => this.syncPlayButton(),
      );
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || "加载失败", icon: "none" });
    }
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
      const st = this.data.sectionTag;
      const tagRow = tags.find((t) => String(t.name) === String(st));
      const tid = tagRow && tagRow.id;
      if (tid) {
        wx.setStorageSync(this.seqStorageKeyTagPos(sid, uid, tid), done);
      }
    }
  },

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
        this.setData(
          {
            step: "exam_result",
            examResults: results.map((row) => ({
              ...row,
              stem: row.missing ? row.stem : formatStemForDisplay(row.stem),
            })),
          },
          () => syncNavTitle("exam_result"),
        );
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: e.message || "交卷失败", icon: "none" });
      }
      return;
    }

    if (!this.data.submitted) {
      if (this.data.playBtnDisabled) return;
      wx.showLoading({ title: "判题" });
      try {
        const res = await request({
          path: `/api/student/questions/${qid}/check`,
          method: "POST",
          data: { user_answer: this.getUserAnswer() },
        });
        wx.hideLoading();
        this.setData({ submitted: true, checkResult: res.data || {} }, () => this.syncPlayButton());
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: e.message || "提交失败", icon: "none" });
      }
      return;
    }

    if (last) {
      wx.showToast({ title: "本轮已完成", icon: "none" });
      this.bumpSeqProgressHint();
      this.restartWizard();
      return;
    }
    this.bumpSeqProgressHint();
    this.setData({ currentIndex: idx + 1 }, () => this.loadCurrentQuestion());
  },
});
