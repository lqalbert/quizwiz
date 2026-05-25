const { submitJoinByInvite, syncNeedJoinClassFromServer, OPEN_JOIN_MODAL_KEY } = require("../utils/joinClass.js");

/** 入班弹框：页面混入后实现 openJoinModal 等方法，并在 wxml 挂载 join-class-modal */
module.exports = Behavior({
  data: {
    joinModalVisible: false,
    joinModalMode: "form",
    joinInviteInput: "",
    joinRealNameInput: "",
    joinSubmitting: false,
  },

  pageLifetimes: {
    show() {
      this._consumeOpenJoinModalFlag();
    },
  },

  methods: {
    _consumeOpenJoinModalFlag() {
      try {
        if (wx.getStorageSync(OPEN_JOIN_MODAL_KEY) !== "1") return;
        wx.removeStorageSync(OPEN_JOIN_MODAL_KEY);
      } catch (_) {
        return;
      }
      if (typeof this.openJoinModal === "function") {
        this.openJoinModal();
      }
    },

    openJoinModal() {
      const token = wx.getStorageSync("student_token");
      if (!token) {
        wx.showModal({
          title: "需要登录",
          content: "加入班级前请先登录。",
          confirmText: "去登录",
          success: (r) => {
            if (r.confirm) wx.navigateTo({ url: "/pages/login/index" });
          },
        });
        return;
      }
      const needJoin = wx.getStorageSync("need_join_class") === "1";
      const pendingManual = needJoin && wx.getStorageSync("join_pending_manual") === "1";
      const patch = {
        joinModalVisible: true,
        joinModalMode: pendingManual ? "pending" : "form",
      };
      const realName = String(this.data.realDisplayName || "").trim();
      if (realName && !String(this.data.joinRealNameInput || "").trim()) {
        patch.joinRealNameInput = realName;
      }
      this.setData(patch);
    },

    onCloseJoinModal() {
      this.setData({ joinModalVisible: false });
    },

    onJoinInviteInput(e) {
      const v = e.detail && e.detail.value != null ? e.detail.value : "";
      this.setData({ joinInviteInput: v });
    },

    onJoinRealNameInput(e) {
      const v = e.detail && e.detail.value != null ? e.detail.value : "";
      this.setData({ joinRealNameInput: v });
    },

    async onSubmitJoinClass() {
      if (this.data.joinSubmitting || this.data.joinModalMode !== "form") return;
      this.setData({ joinSubmitting: true });
      wx.showLoading({ title: "提交中", mask: true });
      try {
        const result = await submitJoinByInvite({
          inviteCode: this.data.joinInviteInput,
          realName: this.data.joinRealNameInput,
        });
        wx.hideLoading();
        if (result.mode === "manual") {
          this.setData({ joinModalMode: "pending", joinSubmitting: false });
          wx.showToast({ title: result.message, icon: "none", duration: 2800 });
          return;
        }
        wx.showToast({ title: result.message, icon: "success" });
        this.setData({
          joinModalVisible: false,
          joinModalMode: "form",
          joinInviteInput: "",
          joinRealNameInput: "",
          joinSubmitting: false,
        });
        if (typeof this.onJoinClassSuccess === "function") {
          await this.onJoinClassSuccess();
        }
      } catch (err) {
        wx.hideLoading();
        this.setData({ joinSubmitting: false });
        wx.showToast({ title: (err && err.message) || "加入失败", icon: "none" });
      }
    },

    async onRefreshJoinPending() {
      wx.showLoading({ title: "查询中", mask: true });
      try {
        const st = await syncNeedJoinClassFromServer();
        if (typeof this.onJoinClassSuccess === "function") {
          await this.onJoinClassSuccess();
        }
        wx.hideLoading();
        if (!st.needJoin) {
          this.setData({ joinModalVisible: false, joinModalMode: "form" });
          wx.showToast({ title: "已通过审核", icon: "success" });
          return;
        }
        this.setData({ joinModalMode: st.pendingManual ? "pending" : "form" });
        wx.showToast({ title: "仍在审核中", icon: "none" });
      } catch (_) {
        wx.hideLoading();
      }
    },
  },
});
