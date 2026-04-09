const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    submitting: false,
    questions: [],
    answers: {},
    result: null,
    errorText: '',
    loginOk: false,
  },

  async onLoad() {
    const ok = await this.ensureStudentLogin();
    this.setData({ loginOk: ok });
    if (ok) {
      this.loadQuestions();
    }
  },

  /** 微信登录：code -> 服务端换 JWT */
  ensureStudentLogin() {
    return new Promise((resolve) => {
      wx.login({
        success: async (loginRes) => {
          if (!loginRes.code) {
            this.setData({ errorText: 'wx.login 未返回 code' });
            resolve(false);
            return;
          }
          try {
            const data = await request({
              url: '/wx/auth/login',
              method: 'POST',
              data: { code: loginRes.code },
            });
            if (data.token) {
              wx.setStorageSync('token', data.token);
            }
            resolve(true);
          } catch (error) {
            this.setData({
              errorText: error.message || '登录失败，请检查服务端 WX_APP_ID / WX_APP_SECRET 与网络',
            });
            resolve(false);
          }
        },
        fail: () => {
          this.setData({ errorText: 'wx.login 调用失败' });
          resolve(false);
        },
      });
    });
  },

  async loadQuestions() {
    if (!this.data.loginOk) {
      const ok = await this.ensureStudentLogin();
      this.setData({ loginOk: ok });
      if (!ok) return;
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
        const ok = await this.ensureStudentLogin();
        this.setData({ loginOk: ok });
        if (ok) {
          return this.loadQuestions();
        }
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
      this.setData({
        errorText: error.message || '提交失败',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
