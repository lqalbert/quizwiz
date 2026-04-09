const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    list: [],
    errorText: '',
  },

  onLoad() {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.loadWrongQuestions();
  },

  async loadWrongQuestions() {
    this.setData({ loading: true, errorText: '' });
    try {
      const res = await request({ url: '/wx/wrong-questions?page=1&pageSize=50&mastered=false' });
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
