const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    submitting: false,
    starting: false,
    questions: [],
    answers: {},
    result: null,
    errorText: '',
    sessionId: null,
    subjects: [],
    subjectIndex: 0,
    chapterInput: '',
    difficulty: '',
    limit: 5,
    practiceMode: 'random',
    wrongPriorityOnly: false,
    emptyHint: '',
    stats: {
      today: { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
      last7Days: { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
      all: { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
    },
  },

  async onLoad(options) {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    await this.loadSubjects();
    this.applyRouteOptions(options || {});
    await this.startPractice();
  },

  onShow() {
    if (wx.getStorageSync('token')) {
      this.loadStats();
    }
  },

  async loadStats() {
    try {
      const res = await request({ url: '/wx/stats/practice' });
      this.setData({
        stats: {
          today: res.today || { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
          last7Days: res.last7Days || { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
          all: res.all || { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
        },
      });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        return;
      }
    }
  },

  applyRouteOptions(options) {
    const patch = {};
    const mode = String(options.mode || '').trim();
    if (mode === 'wrong') {
      patch.practiceMode = 'wrong';
    }
    const po = String(options.priorityOnly || '').trim().toLowerCase();
    if (po === '1' || po === 'true') {
      patch.wrongPriorityOnly = true;
    }
    const chapter = String(options.chapter || '').trim();
    if (chapter) patch.chapterInput = chapter;
    const limitRaw = Number(options.limit || 0);
    if (Number.isInteger(limitRaw) && limitRaw > 0) {
      patch.limit = Math.max(1, Math.min(50, limitRaw));
    }
    const difficultyRaw = String(options.difficulty || '').trim();
    if (difficultyRaw) patch.difficulty = difficultyRaw;

    const subjectIdRaw = Number(options.subjectId || 0);
    if (subjectIdRaw > 0 && Array.isArray(this.data.subjects)) {
      const idx = this.data.subjects.findIndex((x) => Number(x.id) === subjectIdRaw);
      if (idx >= 0) patch.subjectIndex = idx;
    }
    this.setData(patch);
  },

  async loadSubjects() {
    try {
      const res = await request({ url: '/wx/subjects' });
      const subjects = Array.isArray(res.data) ? res.data : [];
      this.setData({
        subjects,
        subjectIndex: subjects.length > 0 ? 0 : -1,
      });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({
        errorText: error.message || '加载学科失败',
      });
    }
  },

  getSelectedSubjectId() {
    const idx = Number(this.data.subjectIndex);
    if (!Array.isArray(this.data.subjects) || this.data.subjects.length === 0 || idx < 0) return null;
    return this.data.subjects[idx]?.id || null;
  },

  buildStartPayload() {
    const chapterText = String(this.data.chapterInput || '').trim();
    const chapters = chapterText
      ? chapterText
          .split(/[，,]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
    const difficultyText = String(this.data.difficulty || '').trim();
    const difficulty = difficultyText ? Number(difficultyText) : null;
    const mode = this.data.practiceMode || 'random';
    return {
      mode,
      subjectId: this.getSelectedSubjectId(),
      chapters,
      difficulty: Number.isInteger(difficulty) ? difficulty : null,
      limit: Number(this.data.limit) || 5,
      priorityOnly: mode === 'wrong' && Boolean(this.data.wrongPriorityOnly),
    };
  },

  async startPractice() {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setData({
      loading: true,
      starting: true,
      errorText: '',
      result: null,
      answers: {},
      emptyHint: '',
    });
    try {
      const res = await request({ url: '/wx/practice/start', method: 'POST', data: this.buildStartPayload() });
      const questions = Array.isArray(res.questions)
        ? res.questions
        : Array.isArray(res.data)
          ? res.data
          : [];
      let emptyHint = '';
      if (questions.length === 0) {
        const mode = this.data.practiceMode || 'random';
        if (mode === 'wrong') {
          emptyHint = this.data.wrongPriorityOnly
            ? '当前筛选下没有「重点」错题。可在错题本标为重点，或关闭「仅重点复习」后再试。'
            : '当前没有符合条件的未掌握错题。可调整学科/章节，或先去随机练习产生错题。';
        } else {
          emptyHint = '暂无可练习题目。请确认该学科已在后台关联题目，或放宽章节、难度筛选。';
        }
      }
      this.setData({
        sessionId: res.sessionId || null,
        questions,
        emptyHint,
      });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({
        errorText: error.message || '拉取题目失败',
      });
    } finally {
      this.setData({ loading: false, starting: false });
    }
  },

  onSubjectChange(e) {
    this.setData({ subjectIndex: Number(e.detail.value || 0) });
  },

  onChapterInput(e) {
    this.setData({ chapterInput: String(e.detail.value || '') });
  },

  onDifficultyInput(e) {
    this.setData({ difficulty: String(e.detail.value || '') });
  },

  onLimitChange(e) {
    const next = Number(e.detail.value || 5);
    this.setData({ limit: Math.max(1, Math.min(50, next)) });
  },

  goWrongBook() {
    wx.navigateTo({ url: '/pages/wrong/wrong' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  onSelectOption(e) {
    const questionId = Number(e.currentTarget.dataset.questionId);
    const letter = String(e.currentTarget.dataset.letter || '');
    const question = this.data.questions.find((x) => Number(x.id) === questionId);
    if (!question) return;

    const key = `answers.${questionId}`;
    const current = Array.isArray(this.data.answers[questionId]) ? this.data.answers[questionId] : [];
    let next = current;
    if (question.questionType === 'single') {
      next = [letter];
    } else {
      const set = new Set(current);
      if (set.has(letter)) {
        set.delete(letter);
      } else {
        set.add(letter);
      }
      next = Array.from(set).sort();
    }
    this.setData({
      [key]: next,
    });
  },

  async onSubmit() {
    if (this.data.submitting || this.data.questions.length === 0 || !this.data.sessionId) return;
    this.setData({ submitting: true, errorText: '' });
    try {
      const payload = {
        sessionId: this.data.sessionId,
        answers: this.data.questions.map((q) => ({
          questionId: q.id,
          selectedLetters: this.data.answers[q.id] || [],
        })),
      };
      const res = await request({
        url: '/wx/practice/submit',
        method: 'POST',
        data: payload,
      });
      this.setData({ result: res });
      this.loadStats();
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({
        errorText: error.message || '提交失败',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
