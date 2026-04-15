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
    practiceModeLocked: false,
    practiceModeLabels: ['随机出题', '顺序出题'],
    practiceModePickerIndex: 0,
    wrongPriorityOnly: false,
    emptyHint: '',
    stats: {
      today: { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
      last7Days: { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
      all: { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
      bySubjectToday: [],
      bySubjectLast7Days: [],
      bySubjectAll: [],
    },
    reportShow: false,
    reportQuestionId: null,
    reportReasonIndex: 0,
    reportReasons: [
      { code: 'answer_wrong', label: '参考答案可能有误' },
      { code: 'stem_error', label: '题干/表述有问题' },
      { code: 'option_error', label: '选项有问题' },
      { code: 'typo', label: '错别字/格式' },
      { code: 'other', label: '其他' },
    ],
    reportDetail: '',
    myReports: [],
    myReportsLoading: false,
    reportStatusFilter: '',
    reportStatusFilterIndex: 0,
    reportStatusOptions: ['全部状态', '已接收', '处理中', '已处理'],
    assignmentMode: false,
    assignmentId: null,
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
      this.loadMyReports();
    }
  },

  reasonLabel(code) {
    const map = {
      answer_wrong: '答案可能有误',
      stem_error: '题干/表述有问题',
      option_error: '选项有问题',
      typo: '错别字/格式',
      other: '其他',
    };
    return map[code] || code;
  },

  statusLabel(code) {
    const map = {
      open: '已接收',
      reviewing: '处理中',
      closed: '已处理',
    };
    return map[code] || code;
  },

  async loadMyReports() {
    this.setData({ myReportsLoading: true });
    try {
      const status = String(this.data.reportStatusFilter || '').trim();
      const q = status ? `?status=${encodeURIComponent(status)}&pageSize=5` : '?pageSize=5';
      const res = await request({ url: `/wx/question-reports${q}` });
      const rows = Array.isArray(res.data) ? res.data : [];
      const myReports = rows.map((r) => ({
        ...r,
        reasonText: this.reasonLabel(r.reasonType),
        statusText: this.statusLabel(r.status),
      }));
      this.setData({ myReports });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      // 反馈列表属于增强能力，失败时不阻断练习
      this.setData({ myReports: [] });
    } finally {
      this.setData({ myReportsLoading: false });
    }
  },

  onReportStatusFilterChange(e) {
    const value = Number(e.detail.value || 0);
    const statusMap = ['', 'open', 'reviewing', 'closed'];
    this.setData({ reportStatusFilter: statusMap[value] || '', reportStatusFilterIndex: value }, () => this.loadMyReports());
  },

  async loadStats() {
    try {
      const res = await request({ url: '/wx/stats/practice' });
      this.setData({
        stats: {
          today: res.today || { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
          last7Days: res.last7Days || { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
          all: res.all || { attempted: 0, correct: 0, sessions: 0, accuracy: 0 },
          bySubjectToday: Array.isArray(res.bySubjectToday) ? res.bySubjectToday : [],
          bySubjectLast7Days: Array.isArray(res.bySubjectLast7Days) ? res.bySubjectLast7Days : [],
          bySubjectAll: Array.isArray(res.bySubjectAll) ? res.bySubjectAll : [],
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
      patch.practiceModeLocked = true;
    }
    if (mode === 'favorite') {
      patch.practiceMode = 'favorite';
      patch.practiceModeLocked = true;
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
    if (!patch.practiceModeLocked && patch.practiceMode !== 'sequential') {
      patch.practiceModePickerIndex = 0;
    }
    if (patch.practiceMode === 'sequential') {
      patch.practiceModePickerIndex = 1;
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
    if (this.data.assignmentMode && this.data.assignmentId) {
      return {
        mode: 'assignment',
        assignmentId: Number(this.data.assignmentId),
        limit: 100,
      };
    }
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
    this._questionFirstTap = {};
    this.setData({
      loading: true,
      starting: true,
      errorText: '',
      result: null,
      answers: {},
      emptyHint: '',
      questions: [],
      sessionId: null,
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
        } else if (mode === 'favorite') {
          emptyHint = '暂无收藏题目。练习时点击题旁的星标即可收藏。';
        } else if (this.data.assignmentMode) {
          emptyHint = '无法加载班级作业题目，请确认已加入班级且作业仍有效。';
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
        questions: [],
        sessionId: null,
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

  onPracticeModeChange(e) {
    if (this.data.practiceModeLocked) return;
    const i = Number(e.detail.value || 0);
    const modes = ['random', 'sequential'];
    this.setData({
      practiceModePickerIndex: i,
      practiceMode: modes[i] || 'random',
    });
  },

  goWrongBook() {
    wx.navigateTo({ url: '/pages/wrong/wrong' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goClass() {
    wx.navigateTo({ url: '/pages/class/class' });
  },

  goFavorite() {
    wx.navigateTo({ url: '/pages/favorite/favorite' });
  },

  preventMove() {},

  openReport(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    this.setData({
      reportShow: true,
      reportQuestionId: id,
      reportReasonIndex: 0,
      reportDetail: '',
    });
  },

  closeReport() {
    this.setData({ reportShow: false });
  },

  onReportReasonChange(e) {
    this.setData({ reportReasonIndex: Number(e.detail.value || 0) });
  },

  onReportDetailInput(e) {
    const t = String(e.detail.value || '');
    this.setData({ reportDetail: t.length > 500 ? t.slice(0, 500) : t });
  },

  async submitReport() {
    const qid = this.data.reportQuestionId;
    if (!qid) return;
    const reasons = this.data.reportReasons;
    const idx = Number(this.data.reportReasonIndex || 0);
    const code = reasons[idx]?.code;
    if (!code) return;
    try {
      await request({
        url: '/wx/question-reports',
        method: 'POST',
        data: {
          questionId: qid,
          reasonType: code,
          detail: String(this.data.reportDetail || '').trim(),
        },
      });
      wx.showToast({ title: '已提交', icon: 'success' });
      this.setData({ reportShow: false });
      this.loadMyReports();
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    }
  },

  async onToggleFavorite(e) {
    const questionId = Number(e.currentTarget.dataset.id);
    if (!questionId) return;
    const q = this.data.questions.find((x) => Number(x.id) === questionId);
    if (!q) return;
    const was = Boolean(q.isFavorite);
    const next = !was;
    try {
      if (next) {
        await request({ url: '/wx/favorites', method: 'POST', data: { questionId } });
      } else {
        await request({ url: `/wx/favorites/${questionId}`, method: 'DELETE' });
      }
      const questions = this.data.questions.map((row) =>
        Number(row.id) === questionId ? { ...row, isFavorite: next } : row
      );
      this.setData({ questions });
      wx.showToast({ title: next ? '已收藏' : '已取消', icon: 'none' });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ errorText: error.message || '收藏操作失败' });
    }
  },

  onSelectOption(e) {
    const questionId = Number(e.currentTarget.dataset.questionId);
    const letter = String(e.currentTarget.dataset.letter || '');
    const question = this.data.questions.find((x) => Number(x.id) === questionId);
    if (!question) return;

    if (!this._questionFirstTap) this._questionFirstTap = {};
    if (!this._questionFirstTap[questionId]) {
      this._questionFirstTap[questionId] = Date.now();
    }

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
      const now = Date.now();
      const taps = this._questionFirstTap || {};
      const answers = this.data.questions.map((q) => {
        const qid = q.id;
        const started = taps[qid];
        const row = {
          questionId: qid,
          selectedLetters: this.data.answers[qid] || [],
        };
        if (started) {
          const ms = Math.min(now - started, 3600000);
          if (ms >= 0) row.costMs = ms;
        }
        return row;
      });
      const payload = {
        sessionId: this.data.sessionId,
        answers,
      };
      const res = await request({
        url: '/wx/practice/submit',
        method: 'POST',
        data: payload,
      });
      const totalCostMs = res.totalCostMs;
      const timedQuestions = res.timedQuestions;
      const result = {
        ...res,
        totalCostSecText:
          totalCostMs != null && timedQuestions > 0
            ? (totalCostMs / 1000).toFixed(1)
            : '',
      };
      this.setData({ result });
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
