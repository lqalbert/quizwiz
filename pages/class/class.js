const { request } = require('../../utils/request');

function toastErr(e, fallback) {
  const msg = (e && (e.message || e.errMsg)) || fallback;
  wx.showToast({ title: String(msg), icon: 'none' });
}

Page({
  data: {
    inviteInput: '',
    joining: false,
    loading: true,
    mine: [],
    assignments: [],
    assignmentsLoading: false,
  },

  onShow() {
    if (!wx.getStorageSync('token')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.loadMine();
    this.loadAssignments();
  },

  onInviteInput(e) {
    // 不在输入时 trim，避免部分机型输入法异常；提交时再 trim
    this.setData({ inviteInput: e.detail.value || '' });
  },

  async loadMine() {
    this.setData({ loading: true });
    try {
      const res = await request({ url: '/wx/classes/mine' });
      const rows = Array.isArray(res.data) ? res.data : [];
      this.setData({ mine: rows, loading: false });
    } catch (e) {
      if (e.statusCode === 401 || String(e.message || '').includes('请先登录')) {
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ mine: [], loading: false });
      toastErr(e, '加载失败');
    }
  },

  async joinClass() {
    const code = String(this.data.inviteInput || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' });
      return;
    }
    this.setData({ joining: true });
    try {
      const res = await request({
        url: '/wx/classes/join',
        method: 'POST',
        data: { inviteCode: code },
      });
      const name = res.className || '';
      const dup = res.alreadyMember;
      wx.showToast({
        title: dup ? '已在该班级中' : '加入成功：' + name,
        icon: 'success',
      });
      this.setData({ inviteInput: '' });
      await this.loadMine();
      await this.loadAssignments();
    } catch (e) {
      toastErr(e, '加入失败');
    } finally {
      this.setData({ joining: false });
    }
  },

  async loadAssignments() {
    this.setData({ assignmentsLoading: true });
    try {
      const res = await request({ url: '/wx/assignments' });
      const rows = Array.isArray(res.data) ? res.data : [];
      this.setData({ assignments: rows, assignmentsLoading: false });
    } catch (e) {
      this.setData({ assignments: [], assignmentsLoading: false });
    }
  },

  goDoAssignment(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({ url: '/pages/index/index?assignmentId=' + id });
  },
});
