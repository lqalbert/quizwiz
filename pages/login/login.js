const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    errorText: '',
  },

  onLoad() {
    const token = wx.getStorageSync('token');
    if (token) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onLoginTap() {
    if (this.data.loading) return;
    this.setData({ loading: true, errorText: '' });
    wx.login({
      success: async (loginRes) => {
        if (!loginRes.code) {
          this.setData({ errorText: 'wx.login 未返回 code', loading: false });
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
          wx.reLaunch({ url: '/pages/index/index' });
        } catch (e) {
          this.setData({
            errorText: e.message || '登录失败，请检查服务端配置与网络',
            loading: false,
          });
        }
      },
      fail: () => {
        this.setData({ errorText: 'wx.login 调用失败', loading: false });
      },
    });
  },
});
