const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    submitting: false,
    questions: [],
    answers: {},
    result: null,
    errorText: '',
  },

  onLoad() {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.loadQuestions();
  },

  async loadQuestions() {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setData({
      loading: true,
      errorText: '',
      result: null,
      answers: {},
    });
    try {
      const res = await request({
        url: '/wx/questions?limit=5',
      });
      this.setData({
        questions: Array.isArray(res.data) ? res.data : [],
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
      this.setData({ loading: false });
    }
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
    if (this.data.submitting || this.data.questions.length === 0) return;
    this.setData({ submitting: true, errorText: '' });
    try {
      const payload = {
        answers: this.data.questions.map((q) => ({
          questionId: q.id,
          selectedLetters: this.data.answers[q.id] || [],
        })),
      };
      const res = await request({
        url: '/wx/quiz/submit',
        method: 'POST',
        data: payload,
      });
      this.setData({ result: res });
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
