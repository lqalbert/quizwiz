const { request } = require("../../utils/request.js");

function ensureToken() {
  const token = wx.getStorageSync("student_token");
  if (!token) {
    wx.navigateTo({ url: "/pages/login/index" });
    return false;
  }
  return true;
}

Page({
  data: {
    step: "subject",
    loading: false,
    subjects: [],
    subjectId: null,
    tags: [],
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
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  onLoad() {
    if (!ensureToken()) return;
    this.bootstrap();
  },

  async bootstrap() {
    try {
      const res = await request({ path: "/api/student/subjects", method: "GET" });
      this.setData({ subjects: res.data || [] });
    } catch (e) {
      wx.showToast({ title: e.message || "加载科目失败", icon: "none" });
    }
  },

  onPickSubject(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    this.setData({ subjectId: id, step: "tags", selectedTags: [] }, () => this.loadTags());
  },

  async loadTags() {
    const sid = this.data.subjectId;
    if (!sid) return;
    try {
      const res = await request({
        path: `/api/student/practice/tags?subject_id=${sid}`,
        method: "GET",
      });
      this.setData({ tags: res.data || [] });
    } catch (e) {
      wx.showToast({ title: e.message || "加载知识点失败", icon: "none" });
    }
  },

  onToggleTag(e) {
    const name = String(e.currentTarget.dataset.name || "");
    const prev = this.data.selectedTags || [];
    const set = new Set(prev);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    this.setData({ selectedTags: Array.from(set) });
  },

  fromTagsNext() {
    this.setData({ step: "module" });
  },

  onPickModule(e) {
    const m = String(e.currentTarget.dataset.m || "");
    this.setData({ practiceModule: m });
    if (m === "section") {
      this.setData({ step: "section" });
      return;
    }
    if (m === "mock") {
      const names =
        this.data.selectedTags.length > 0
          ? this.data.selectedTags
          : (this.data.tags || []).map((x) => x.name).filter(Boolean);
      if (!names.length) {
        wx.showToast({ title: "暂无知识点标签，请先为题目标注知识点", icon: "none" });
        return;
      }
      const tags = this.data.tags || [];
      const tagLabel = (name) => {
        const found = tags.find((t) => String(t.name) === String(name));
        const u = found && found.unit_name ? String(found.unit_name).trim() : "";
        return u ? `${u} · ${name}` : String(name);
      };
      const mockRows = names.map((name) => ({
        name,
        displayLabel: tagLabel(name),
        countInput: "3",
      }));
      this.setData({ mockRows, step: "mock" });
      return;
    }
    this.setData({ step: "mode" });
  },

  onPickSectionTag(e) {
    const name = String(e.currentTarget.dataset.name || "");
    this.setData({ sectionTag: name, step: "mode" });
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
    this.setData({ step: "mode" });
  },

  async onPickMode(e) {
    const m = String(e.currentTarget.dataset.m || "");
    this.setData({ feedbackMode: m });
    await this.buildAndStart();
  },

  async buildAndStart() {
    const subjectId = this.data.subjectId;
    const practiceModule = this.data.practiceModule;
    const tag_names = this.data.selectedTags || [];
    const body = {
      subject_id: subjectId,
      tag_names,
      practice_module: practiceModule,
      limit: 30,
    };
    if (practiceModule === "section") {
      body.section_tag = this.data.sectionTag;
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
          this.loadCurrentQuestion();
        },
      );
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "组卷失败", icon: "none" });
    }
  },

  restartWizard() {
    this.setData({
      step: "subject",
      subjectId: null,
      tags: [],
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
    this.bootstrap();
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
      const total = ids.length;
      const playProgress = total > 0 ? Math.round(((idx + 1) / total) * 100) : 0;
      this.setData(
        {
          currentQuestion: res.data,
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
    if (this.data.feedbackMode === "exam") {
      /* 允许改答案 */
    }
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
        this.setData({
          step: "exam_result",
          examResults: (res.data && res.data.results) || [],
        });
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
      this.restartWizard();
      return;
    }
    this.setData({ currentIndex: idx + 1 }, () => this.loadCurrentQuestion());
  },
});
