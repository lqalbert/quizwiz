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
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true, errorText: '' });
    try {
      const res = await request({ url: '/wx/practice/sessions?limit=20' });
      this.setData({
        list: Array.isArray(res.data) ? res.data : [],
      });
    } catch (error) {
      if (error.statusCode === 401 || String(error.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ errorText: error.message || '加载练习历史失败' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
