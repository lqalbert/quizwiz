const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    list: [],
    errorText: '',
    subjects: [],
    subjectIndex: 0,
    chapterInput: '',
    masteredOptions: ['未掌握', '已掌握', '全部'],
    masteredIndex: 0,
    limit: 10,
  },

  async onLoad() {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    await this.loadSubjects();
    await this.loadWrongQuestions();
  },

  async loadSubjects() {
    try {
      const res = await request({ url: '/wx/subjects' });
      const subjects = Array.isArray(res.data) ? res.data : [];
      this.setData({
        subjects: [{ id: 0, name: '全部学科' }, ...subjects],
        subjectIndex: 0,
      });
    } catch (error) {
      this.setData({ errorText: error.message || '加载学科失败' });
    }
  },

  buildQuery() {
    // 小程序 JS 环境未必提供 URLSearchParams，用手动拼接避免运行时报错
    const pairs = [
      ['page', '1'],
      ['pageSize', '50'],
    ];
    const masteredIndex = Number(this.data.masteredIndex || 0);
    if (masteredIndex === 0) pairs.push(['mastered', 'false']);
    if (masteredIndex === 1) pairs.push(['mastered', 'true']);

    const subject = this.data.subjects?.[Number(this.data.subjectIndex || 0)];
    if (subject && Number(subject.id) > 0) {
      pairs.push(['subjectId', String(subject.id)]);
    }
    const chapter = String(this.data.chapterInput || '').trim();
    if (chapter) pairs.push(['chapter', chapter]);
    return pairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  },

  async loadWrongQuestions() {
    this.setData({ loading: true, errorText: '' });
    try {
      const res = await request({ url: `/wx/wrong-questions?${this.buildQuery()}` });
      this.setData({
        list: Array.isArray(res.data) ? res.data : [],
      });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ errorText: error.message || '加载错题本失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onSubjectChange(e) {
    this.setData({ subjectIndex: Number(e.detail.value || 0) });
  },

  onChapterInput(e) {
    this.setData({ chapterInput: String(e.detail.value || '') });
  },

  onMasteredChange(e) {
    this.setData({ masteredIndex: Number(e.detail.value || 0) });
  },

  onLimitChange(e) {
    const limit = Number(e.detail.value || 10);
    this.setData({ limit: Math.max(1, Math.min(50, limit)) });
  },

  onApplyFilter() {
    this.loadWrongQuestions();
  },

  onStartWrongPractice() {
    const subject = this.data.subjects?.[Number(this.data.subjectIndex || 0)];
    const subjectId = subject && Number(subject.id) > 0 ? Number(subject.id) : 0;
    const chapter = encodeURIComponent(String(this.data.chapterInput || '').trim());
    const url = `/pages/index/index?mode=wrong&subjectId=${subjectId}&chapter=${chapter}&limit=${this.data.limit}`;
    wx.navigateTo({ url });
  },

  async onMarkMastered(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    try {
      await request({
        url: `/wx/wrong-questions/${id}/mastered`,
        method: 'POST',
        data: { mastered: true },
      });
      wx.showToast({ title: '已标记掌握', icon: 'success' });
      this.loadWrongQuestions();
    } catch (error) {
      this.setData({ errorText: error.message || '操作失败' });
    }
  },
});
