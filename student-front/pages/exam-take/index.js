const { request } = require("../../utils/request.js");
const { redirectIfNeedJoinClass } = require("../../utils/joinGate.js");
const { formatStemForDisplay } = require("../../utils/stemFormat.js");
const examLocalCache = require("../../utils/examLocalCache.js");

/** 离开小程序（AppHide）达到此次数则自动交卷 */
const FORCE_SUBMIT_AFTER_APP_LEAVES = 3;

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
    reviewIndex: 0,
    reviewProgressPct: 0,
    reviewCard: null,
    examNetHint: "",
    examLeaveCount: 0,
  },

  onLoad(options) {
    if (redirectIfNeedJoinClass()) return;
    const id = Number(options.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      this.setData({ loadErr: "考试参数无效" });
      return;
    }
    this.setData({ examId: id });
    this.loadSession();
  },

  onUnload() {
    this.stopTakeGuards();
    if (this._examTimer) clearInterval(this._examTimer);
    if (this._draftTimer) clearTimeout(this._draftTimer);
    if (this._forceSubmitTimer) clearTimeout(this._forceSubmitTimer);
  },

  onHide() {
    if (this._examTimer) clearInterval(this._examTimer);
    if (this.data.mode === "take") {
      this._pageLeftForExam = true;
      this.reportProctorEvent("page_hide", "page");
    }
  },

  onShow() {
    if (this.data.mode === "take" && this.data.deadlineMs) {
      this.startTimer();
      this.tryFlushAllAnswersRemote();
    }
    if (this.data.mode === "take" && this._pageLeftForExam) {
      this._pageLeftForExam = false;
      this.reportProctorEvent("page_show", "page");
      this._toastExam("请勿离开考试页，切屏行为已记录");
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: "/pages/exam-list/index" }) });
  },

  applySubmittedFromPayload(d) {
    this.stopTakeGuards();
    const review = (d.review || []).map((row) => ({
      ...row,
      stem: formatStemForDisplay(row.stem || ""),
      options: Array.isArray(row.options) ? row.options : [],
    }));
    wx.setNavigationBarTitle({ title: "考试复盘" });
    this.setData(
      {
        mode: "submitted",
        examTitle: (d.exam && d.exam.title) || "考试",
        review,
        totalScore: d.submission && d.submission.total_score != null ? Number(d.submission.total_score) : null,
        reviewIndex: 0,
      },
      () => this.applyReviewSlide(),
    );
  },

  answerKeySet(raw, qt) {
    const s = String(raw ?? "").trim();
    const set = new Set();
    const t = Number(qt);
    if (t === 1) {
      const u = s.toUpperCase().slice(0, 1);
      if (u) set.add(u);
      return set;
    }
    if (t === 3) {
      const x = s.trim();
      const u = s.toUpperCase().slice(0, 1);
      if (x === "对" || u === "A" || x === "正确" || x === "TRUE" || x === "T" || x === "1") set.add("A");
      else if (x === "错" || u === "B" || x === "错误" || x === "FALSE" || x === "F" || x === "0") set.add("B");
      else if (u) set.add(u.slice(0, 1));
      return set;
    }
    if (t === 2) {
      s.replace(/，/g, ",")
        .split(",")
        .forEach((x) => {
          const k = String(x).trim().toUpperCase();
          if (k) set.add(k);
        });
    }
    return set;
  },

  buildReviewOptionRows(item, qt) {
    const opts = item.options || [];
    const userSet = this.answerKeySet(item.user_answer, qt);
    const corrSet = this.answerKeySet(item.correct_answer, qt);
    return opts.map((o) => {
      const k = String(o.option_key || "")
        .trim()
        .toUpperCase();
      const pickedUser = userSet.has(k);
      const isCorrect = corrSet.has(k);
      let rowClass = "opt-pill opt-pill--review";
      if (isCorrect) rowClass += " opt-pill--review-correct";
      else if (pickedUser) rowClass += " opt-pill--review-wrong";
      return { ...o, rowClass };
    });
  },

  applyReviewSlide() {
    const { review, reviewIndex } = this.data;
    const item = review[reviewIndex];
    if (!item) {
      this.setData({ reviewCard: null, reviewProgressPct: 0 });
      return;
    }
    const qt = Number(item.question_type);
    const optionRows = (qt === 1 || qt === 2) && (item.options || []).length ? this.buildReviewOptionRows(item, qt) : [];
    const pct = review.length ? Math.round(((reviewIndex + 1) / review.length) * 100) : 0;
    this.setData({
      reviewProgressPct: pct,
      reviewCard: { ...item, optionRows },
    });
  },

  onReviewPrev() {
    const idx = this.data.reviewIndex - 1;
    if (idx < 0) return;
    this.setData({ reviewIndex: idx }, () => this.applyReviewSlide());
  },

  onReviewNext() {
    const idx = this.data.reviewIndex + 1;
    if (idx >= this.data.review.length) return;
    this.setData({ reviewIndex: idx }, () => this.applyReviewSlide());
  },

  stopTakeGuards() {
    if (this._takeGuardsOn) {
      this._takeGuardsOn = false;
      if (typeof wx.offAppHide === "function" && this._appHideHandler) wx.offAppHide(this._appHideHandler);
      if (typeof wx.offAppShow === "function" && this._appShowHandler) wx.offAppShow(this._appShowHandler);
      this._appHideHandler = null;
      this._appShowHandler = null;
    }
    if (this._netHandler) {
      wx.offNetworkStatusChange(this._netHandler);
      this._netHandler = null;
    }
  },

  startTakeGuards() {
    if (this._takeGuardsOn) return;
    this._takeGuardsOn = true;
    this._appHideHandler = () => {
      if (this.data.mode !== "take") return;
      const n = Number(this.data.examLeaveCount || 0) + 1;
      this.setData({ examLeaveCount: n });
      this.reportProctorEvent("leave", "app");
      if (n >= FORCE_SUBMIT_AFTER_APP_LEAVES) this.scheduleForceSubmitForLeave();
    };
    this._appShowHandler = () => {
      if (this.data.mode !== "take") return;
      this.reportProctorEvent("enter", "app");
      this._toastExam("请勿切换到其他应用，考试过程已记录");
      this.tryFlushAllAnswersRemote();
    };
    if (typeof wx.onAppHide === "function") wx.onAppHide(this._appHideHandler);
    if (typeof wx.onAppShow === "function") wx.onAppShow(this._appShowHandler);
    if (!this._netHandler) {
      this._netHandler = (res) => {
        if (res.isConnected && this.data.mode === "take") this.tryFlushAllAnswersRemote();
      };
      wx.onNetworkStatusChange(this._netHandler);
    }
  },

  _toastExam(title) {
    const t = Date.now();
    if (t - (this._lastExamToastAt || 0) < 1800) return;
    this._lastExamToastAt = t;
    wx.showToast({ title, icon: "none", duration: 2600 });
  },

  async reportProctorEvent(event, source) {
    const examId = this.data.examId;
    if (!examId || this.data.mode !== "take") return;
    const now = Date.now();
    if (now - (this._lastProctorPostAt || 0) < 350) return;
    this._lastProctorPostAt = now;
    try {
      await request({
        method: "POST",
        path: `/api/student/exams/${examId}/proctor-events`,
        data: { event, source, clientTs: now },
      });
    } catch (_) {}
  },

  async tryFlushAllAnswersRemote() {
    if (this.data.mode !== "take" || !this.data.questions.length) return;
    const examId = this.data.examId;
    const merged = this.buildMergedAnswers();
    const items = this.data.questions.map((q) => ({
      question_id: q.question_id,
      user_answer: merged[String(q.question_id)] ?? "",
    }));
    try {
      await request({
        method: "PUT",
        path: `/api/student/exams/${examId}/answers`,
        data: { answers: items },
      });
      this._examDraftDirty = false;
      examLocalCache.write(examId, merged, false);
      this.setData({ examNetHint: "" });
    } catch (_) {
      this._examDraftDirty = true;
      examLocalCache.write(examId, merged, true);
      this.setData({ examNetHint: "网络异常，答案已保存在本机，恢复后将自动同步" });
    }
  },

  async loadSession() {
    const examId = this.data.examId;
    if (!examId) return;
    try {
      const res = await request({ path: `/api/student/exams/${examId}/session`, method: "GET" });
      const d = (res && res.data) || {};
      if (d.mode === "submitted") {
        examLocalCache.clear(examId);
        this.applySubmittedFromPayload(d);
        return;
      }
      if (d.mode !== "take") {
        this.setData({ loadErr: "无法进入考试" });
        return;
      }
      const draft = d.draft_answers || {};
      const serverAnswers = {};
      Object.keys(draft).forEach((k) => {
        serverAnswers[String(k)] = draft[k];
      });
      const local = examLocalCache.read(examId);
      const merged = { ...serverAnswers };
      if (local && local.answers && typeof local.answers === "object") {
        Object.assign(merged, local.answers);
      }
      const questions = (d.questions || []).map((q) => ({
        ...q,
        stem: formatStemForDisplay(q.stem || ""),
      }));
      const deadlineMs = new Date(d.deadline_iso).getTime();
      wx.setNavigationBarTitle({ title: d.exam.title || "考试" });
      this._examDraftDirty = Boolean(local && local.dirty);
      this._forceSubmitTriggered = false;
      const hadLocalOverlay = Boolean(local && local.answers && Object.keys(local.answers).length > 0);
      this.setData(
        {
          mode: "take",
          examTitle: d.exam.title || "",
          questions,
          answers: merged,
          currentIndex: 0,
          deadlineMs,
          examNetHint: hadLocalOverlay || this._examDraftDirty ? "正在同步本机与服务器答案…" : "",
          examLeaveCount: 0,
        },
        () => {
          this.applyCurrent();
          this.startTimer();
          this.startTakeGuards();
          if (hadLocalOverlay || this._examDraftDirty) this.tryFlushAllAnswersRemote();
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
    examLocalCache.write(this.data.examId, answers, Boolean(this._examDraftDirty));
    return { question_id: Number(q.question_id), user_answer: val };
  },

  queueDraftSave() {
    const pkg = this.persistCurrentToAnswers();
    if (!pkg) return;
    const examId = this.data.examId;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => {
      const latest = this.persistCurrentToAnswers();
      if (!latest) return;
      request({
        method: "PUT",
        path: `/api/student/exams/${examId}/answers`,
        data: { answers: [latest] },
      })
        .then(() => {
          this._examDraftDirty = false;
          examLocalCache.write(examId, this.data.answers, false);
          if (this.data.examNetHint) this.setData({ examNetHint: "" });
        })
        .catch(() => {
          this._examDraftDirty = true;
          examLocalCache.write(examId, this.data.answers, true);
          this.setData({ examNetHint: "网络异常，答案已保存在本机，恢复后将自动同步" });
        });
    }, 450);
  },

  onPickSingle(e) {
    if (this.data.submitting) return;
    const k = String(e.currentTarget.dataset.k || "");
    this.setData({ selectedAnswer: k }, () => this.queueDraftSave());
  },

  onToggleMulti(e) {
    if (this.data.submitting) return;
    const k = String(e.currentTarget.dataset.k || "").toUpperCase();
    const arr = (this.data.multiSelected || []).slice();
    const i = arr.indexOf(k);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(k);
    this.setData({ multiSelected: arr }, () => this.queueDraftSave());
  },

  onPickJudge(e) {
    if (this.data.submitting) return;
    const v = String(e.currentTarget.dataset.v || "");
    this.setData({ selectedAnswer: v }, () => this.queueDraftSave());
  },

  onTextAnswer(e) {
    if (this.data.submitting) return;
    this.setData({ textAnswer: e.detail.value }, () => this.queueDraftSave());
  },

  async onPrev() {
    if (this.data.submitting) return;
    await this.flushDraftNow();
    const idx = this.data.currentIndex - 1;
    if (idx < 0) return;
    this.setData({ currentIndex: idx }, () => this.applyCurrent());
  },

  async onNext() {
    if (this.data.submitting) return;
    await this.flushDraftNow();
    const idx = this.data.currentIndex + 1;
    if (idx >= this.data.questions.length) return;
    this.setData({ currentIndex: idx }, () => this.applyCurrent());
  },

  async flushDraftNow() {
    const pkg = this.persistCurrentToAnswers();
    if (!pkg || !this.data.examId) return;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    const examId = this.data.examId;
    try {
      await request({
        method: "PUT",
        path: `/api/student/exams/${examId}/answers`,
        data: { answers: [pkg] },
      });
      this._examDraftDirty = false;
      examLocalCache.write(examId, this.data.answers, false);
      if (this.data.examNetHint) this.setData({ examNetHint: "" });
    } catch (_) {
      this._examDraftDirty = true;
      examLocalCache.write(examId, this.data.answers, true);
      this.setData({ examNetHint: "网络异常，答案已保存在本机，恢复后将自动同步" });
    }
  },

  /** 合并当前屏答案，用于统计未完成题数（不依赖 setData 异步） */
  buildMergedAnswers() {
    const { questions, answers, currentIndex, selectedAnswer, multiSelected, textAnswer } = this.data;
    const merged = { ...answers };
    const q = questions[currentIndex];
    if (!q) return merged;
    const qid = String(q.question_id);
    const qt = Number(q.question_type);
    let val = "";
    if (qt === 1 || qt === 3) val = String(selectedAnswer || "").trim();
    else if (qt === 2) {
      val = (multiSelected || [])
        .slice()
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(",");
    } else val = String(textAnswer || "").trim();
    merged[qid] = val;
    return merged;
  },

  countUnanswered() {
    const merged = this.buildMergedAnswers();
    let n = 0;
    for (const q of this.data.questions) {
      const v = merged[String(q.question_id)];
      if (v === undefined || v === null || String(v).trim() === "") n += 1;
    }
    return n;
  },

  scheduleForceSubmitForLeave() {
    if (this._forceSubmitTriggered || this.data.mode !== "take" || this.data.submitting) return;
    this._forceSubmitTriggered = true;
    if (this._forceSubmitTimer) clearTimeout(this._forceSubmitTimer);
    this._forceSubmitTimer = setTimeout(() => {
      this._forceSubmitTimer = null;
      this.forceSubmitForLeave().catch(() => {});
    }, 200);
  },

  async forceSubmitForLeave() {
    if (this.data.mode !== "take") return;
    if (this.data.submitting) {
      this._forceSubmitTriggered = false;
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: "多次离开，正在自动交卷", mask: true });
    try {
      await this.flushDraftNow();
      const examId = this.data.examId;
      const merged = this.buildMergedAnswers();
      const body = {
        answers: this.data.questions.map((q) => ({
          question_id: q.question_id,
          user_answer: merged[String(q.question_id)] ?? "",
        })),
      };
      const res = await request({
        method: "POST",
        path: `/api/student/exams/${examId}/submit`,
        data: body,
      });
      const d = (res && res.data) || {};
      await this.afterSubmitSuccess(examId, d);
      wx.showToast({ title: "已因多次离开考试自动交卷", icon: "none", duration: 3200 });
    } catch (e) {
      wx.hideLoading();
      this.setData({ submitting: false });
      this._forceSubmitTriggered = false;
      wx.showToast({ title: e.message || "自动交卷失败，请联网后重试", icon: "none", duration: 3200 });
    }
  },

  async afterSubmitSuccess(examId, d) {
    wx.hideLoading();
    examLocalCache.clear(examId);
    this.stopTakeGuards();
    this.setData({ submitting: false, currentQuestion: null });
    if (this._examTimer) clearInterval(this._examTimer);
    try {
      const res2 = await request({ path: `/api/student/exams/${examId}/session`, method: "GET" });
      const d2 = (res2 && res2.data) || {};
      if (d2.mode === "submitted") {
        this.applySubmittedFromPayload(d2);
      } else {
        this.applySubmittedFromPayload({
          mode: "submitted",
          exam: { title: this.data.examTitle },
          submission: { total_score: d.total_score },
          review: (d.results || []).map((row) => ({
            ...row,
            options: [],
          })),
        });
      }
    } catch (_) {
      this.applySubmittedFromPayload({
        mode: "submitted",
        exam: { title: this.data.examTitle },
        submission: { total_score: d.total_score },
        review: (d.results || []).map((row) => ({
          ...row,
          options: [],
        })),
      });
    }
  },

  onSubmitPaper() {
    if (this.data.submitting) return;
    const n = this.countUnanswered();
    const tail = "交卷后将自动判分且不可再修改。";
    const title = n > 0 ? "尚有题目未完成" : "交卷确认";
    const content =
      n > 0
        ? `还有 ${n} 道题未作答。\n${tail}\n\n仍要交卷吗？`
        : `确定交卷？${tail}`;
    wx.showModal({
      title,
      content,
      confirmText: n > 0 ? "仍要交卷" : "确定交卷",
      cancelText: "继续作答",
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
    const { questions } = this.data;
    const merged = this.buildMergedAnswers();
    const body = {
      answers: questions.map((q) => ({
        question_id: q.question_id,
        user_answer: merged[String(q.question_id)] ?? "",
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
      const d = (res && res.data) || {};
      await this.afterSubmitSuccess(examId, d);
    } catch (e) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: e.message || "交卷失败", icon: "none" });
    }
  },
});
