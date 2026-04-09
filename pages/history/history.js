const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    list: [],
    errorText: '',
    detailMap: {},
    detailLoadingId: 0,
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

  async onToggleDetail(e) {
    const sessionId = Number(e.currentTarget.dataset.id);
    if (!sessionId) return;

    const key = `detailMap.${sessionId}`;
    const existing = this.data.detailMap[String(sessionId)];
    if (existing && existing.loaded) {
      this.setData({
        [key]: {
          ...existing,
          expanded: !existing.expanded,
        },
      });
      return;
    }

    this.setData({ detailLoadingId: sessionId });
    try {
      const res = await request({ url: `/wx/practice/sessions/${sessionId}` });
      const details = Array.isArray(res.details) ? res.details : [];
      this.setData({
        [key]: {
          loaded: true,
          expanded: true,
          details,
        },
      });
    } catch (error) {
      this.setData({ errorText: error.message || '加载详情失败' });
    } finally {
      this.setData({ detailLoadingId: 0 });
    }
  },

  async onTogglePriority(e) {
    const wrongId = Number(e.currentTarget.dataset.wrongId);
    const sessionId = Number(e.currentTarget.dataset.sessionId);
    const questionId = Number(e.currentTarget.dataset.questionId);
    if (!wrongId || !sessionId || !questionId) return;

    const sessionDetail = this.data.detailMap[String(sessionId)];
    if (!sessionDetail || !Array.isArray(sessionDetail.details)) return;
    const target = sessionDetail.details.find((x) => Number(x.questionId) === questionId);
    if (!target) return;
    const next = !Boolean(target.isPriority);

    try {
      await request({
        url: `/wx/wrong-questions/${wrongId}/priority`,
        method: 'POST',
        data: { isPriority: next },
      });

      const details = sessionDetail.details.map((x) =>
        Number(x.questionId) === questionId ? { ...x, isPriority: next } : x
      );
      this.setData({
        [`detailMap.${sessionId}.details`]: details,
      });
      wx.showToast({ title: next ? '已加入重点复习' : '已取消重点复习', icon: 'success' });
    } catch (error) {
      this.setData({ errorText: error.message || '更新重点复习失败' });
    }
  },
});
