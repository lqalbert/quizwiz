const { request } = require("../../utils/request.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");

Page({
  data: {
    mode: "",
    loadErr: "",
    examId: 0,
    examTitle: "",
    questions: [],
    answers: {},
    currentIndex: 0,
    currentQuestion: null,
    selectedAnswer: "",
    multiSelected: [],
    textAnswer: "",
    progressPct: 0,
    timerLabel: "",
    timeWarn: false,
    submitting: false,
    deadlineMs: 0,
    review: [],
    totalScore: null,
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      this.setData({ loadErr: "考试参数无效" });
      return;
    }
    this.setData({ examId: id });
    this.loadSession();
  },

  onUnload() {
    if (this._examTimer) clearInterval(this._examTimer);
    if (this._draftTimer) clearTimeout(this._draftTimer);
  },

  onHide() {
    if (this._examTimer) clearInterval(this._examTimer);
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: "/pages/exam-list/index" }) });
  },

  async loadSession() {
    const examId = this.data.examId;
    if (!examId) return;
    try {
      const res = await request({ path: `/api/student/exams/${examId}/session`, method: "GET" });
      const d = (res && res.data) || {};
      if (d.mode === "submitted") {
        wx.setNavigationBarTitle({ title: "考试结果" });
        const review = (d.review || []).map((row) => ({
          ...row,
          stem: formatStemForDisplay(row.stem || ""),
        }));
        this.setData({
          mode: "submitted",
          examTitle: (d.exam && d.exam.title) || "考试",
          review,
          totalScore: d.submission && d.submission.total_score != null ? Number(d.submission.total_score) : null,
        });
        return;
      }
      if (d.mode !== "take") {
        this.setData({ loadErr: "无法进入考试" });
        return;
      }
      const draft = d.draft_answers || {};
      const answers = {};
      Object.keys(draft).forEach((k) => {
        answers[String(k)] = draft[k];
      });
      const questions = (d.questions || []).map((q) => ({
        ...q,
        stem: formatStemForDisplay(q.stem || ""),
      }));
      const deadlineMs = new Date(d.deadline_iso).getTime();
      wx.setNavigationBarTitle({ title: d.exam.title || "考试" });
      this.setData(
        {
          mode: "take",
          examTitle: d.exam.title || "",
          questions,
          answers,
          currentIndex: 0,
          deadlineMs,
        },
        () => {
          this.applyCurrent();
          this.startTimer();
        },
      );
    } catch (e) {
      this.setData({ loadErr: e.message || "加载失败" });
    }
  },

  startTimer() {
    if (this._examTimer) clearInterval(this._examTimer);
    const tick = () => {
      const ms = this.data.deadlineMs - Date.now();
      if (ms <= 0) {
        this.setData({ timerLabel: "时间到", timeWarn: true });
        if (this._examTimer) clearInterval(this._examTimer);
        return;
      }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const label = `剩余 ${m}:${s < 10 ? `0${s}` : `${s}`}`;
      this.setData({ timerLabel: label, timeWarn: ms < 5 * 60 * 1000 });
    };
    tick();
    this._examTimer = setInterval(tick, 1000);
  },

  applyCurrent() {
    const { questions, currentIndex, answers } = this.data;
    const q = questions[currentIndex];
    if (!q) return;
    const qid = String(q.question_id);
    const saved = answers[qid] || "";
    const qt = Number(q.question_type);
    let selectedAnswer = "";
    let multiSelected = [];
    let textAnswer = "";
    if (qt === 1 || qt === 3) selectedAnswer = saved;
    else if (qt === 2) {
      multiSelected = saved
        ? saved
            .split(",")
            .map((x) => String(x).trim().toUpperCase())
            .filter(Boolean)
        : [];
    } else {
      textAnswer = saved;
    }
    const progressPct = questions.length ? Math.round(((currentIndex + 1) / questions.length) * 100) : 0;
    this.setData({
      currentQuestion: q,
      selectedAnswer,
      multiSelected,
      textAnswer,
      progressPct,
    });
  },

  persistCurrentToAnswers() {
    const q = this.data.questions[this.data.currentIndex];
    if (!q) return null;
    const qid = String(q.question_id);
    const qt = Number(q.question_type);
    let val = "";
    if (qt === 1 || qt === 3) val = String(this.data.selectedAnswer || "").trim();
    else if (qt === 2) {
      val = (this.data.multiSelected || [])
        .slice()
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(",");
    } else val = String(this.data.textAnswer || "").trim();
    const answers = { ...this.data.answers, [qid]: val };
    this.setData({ answers });
    return { question_id: Number(q.question_id), user_answer: val };
  },

  queueDraftSave() {
    const pkg = this.persistCurrentToAnswers();
    if (!pkg) return;
    const examId = this.data.examId;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => {
      request({
        method: "PUT",
        path: `/api/student/exams/${examId}/answers`,
        data: { answers: [pkg] },
      }).catch(() => {});
    }, 450);
  },

  onPickSingle(e) {
    const k = String(e.currentTarget.dataset.k || "");
    this.setData({ selectedAnswer: k }, () => this.queueDraftSave());
  },

  onToggleMulti(e) {
    const k = String(e.currentTarget.dataset.k || "").toUpperCase();
    const arr = (this.data.multiSelected || []).slice();
    const i = arr.indexOf(k);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(k);
    this.setData({ multiSelected: arr }, () => this.queueDraftSave());
  },

  onPickJudge(e) {
    const v = String(e.currentTarget.dataset.v || "");
    this.setData({ selectedAnswer: v }, () => this.queueDraftSave());
  },

  onTextAnswer(e) {
    this.setData({ textAnswer: e.detail.value }, () => this.queueDraftSave());
  },

  async onPrev() {
    await this.flushDraftNow();
    const idx = this.data.currentIndex - 1;
    if (idx < 0) return;
    this.setData({ currentIndex: idx }, () => this.applyCurrent());
  },

  async onNext() {
    await this.flushDraftNow();
    const idx = this.data.currentIndex + 1;
    if (idx >= this.data.questions.length) return;
    this.setData({ currentIndex: idx }, () => this.applyCurrent());
  },

  async flushDraftNow() {
    const pkg = this.persistCurrentToAnswers();
    if (!pkg || !this.data.examId) return;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    try {
      await request({
        method: "PUT",
        path: `/api/student/exams/${this.data.examId}/answers`,
        data: { answers: [pkg] },
      });
    } catch (_) {}
  },

  onSubmitPaper() {
    wx.showModal({
      title: "交卷",
      content: "确定交卷？交卷后将自动判分且不可再修改。",
      success: async (r) => {
        if (!r.confirm) return;
        await this.doSubmit();
      },
    });
  },

  async doSubmit() {
    if (this.data.submitting) return;
    await this.flushDraftNow();
    const examId = this.data.examId;
    const { questions, answers } = this.data;
    const body = {
      answers: questions.map((q) => ({
        question_id: q.question_id,
        user_answer: answers[String(q.question_id)] ?? "",
      })),
    };
    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中", mask: true });
    try {
      const res = await request({
        method: "POST",
        path: `/api/student/exams/${examId}/submit`,
        data: body,
      });
      wx.hideLoading();
      const d = (res && res.data) || {};
      wx.setNavigationBarTitle({ title: "考试结果" });
      this.setData({
        mode: "submitted",
        submitting: false,
        review: (d.results || []).map((row) => ({
          ...row,
          stem: formatStemForDisplay(row.stem || ""),
        })),
        totalScore: d.total_score != null ? Number(d.total_score) : null,
        currentQuestion: null,
      });
      if (this._examTimer) clearInterval(this._examTimer);
    } catch (e) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: e.message || "交卷失败", icon: "none" });
    }
  },
});
