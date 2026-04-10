const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    list: [],
    errorText: '',
    subjects: [],
    subjectIndex: 0,
    limit: 10,
  },

  async onLoad() {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    await this.loadSubjects();
    await this.loadFavorites();
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
    const pairs = [
      ['page', '1'],
      ['pageSize', '80'],
    ];
    const subject = this.data.subjects?.[Number(this.data.subjectIndex || 0)];
    if (subject && Number(subject.id) > 0) {
      pairs.push(['subjectId', String(subject.id)]);
    }
    return pairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  },

  async loadFavorites() {
    this.setData({ loading: true, errorText: '' });
    try {
      const res = await request({ url: `/wx/favorites?${this.buildQuery()}` });
      this.setData({
        list: Array.isArray(res.data) ? res.data : [],
      });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ errorText: error.message || '加载收藏失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onSubjectChange(e) {
    this.setData({ subjectIndex: Number(e.detail.value || 0) });
  },

  onLimitChange(e) {
    const limit = Number(e.detail.value || 10);
    this.setData({ limit: Math.max(1, Math.min(50, limit)) });
  },

  onApplyFilter() {
    this.loadFavorites();
  },

  onStartFavoritePractice() {
    const subject = this.data.subjects?.[Number(this.data.subjectIndex || 0)];
    const subjectId = subject && Number(subject.id) > 0 ? Number(subject.id) : 0;
    let url = `/pages/index/index?mode=favorite&limit=${this.data.limit}`;
    if (subjectId > 0) {
      url += `&subjectId=${subjectId}`;
    }
    wx.navigateTo({ url });
  },

  async onRemoveFavorite(e) {
    const questionId = Number(e.currentTarget.dataset.qid);
    if (!questionId) return;
    try {
      await request({ url: `/wx/favorites/${questionId}`, method: 'DELETE' });
      wx.showToast({ title: '已取消收藏', icon: 'success' });
      this.loadFavorites();
    } catch (error) {
      this.setData({ errorText: error.message || '操作失败' });
    }
  },
});
