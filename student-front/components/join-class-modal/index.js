Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: "form" },
    inviteInput: { type: String, value: "" },
    realNameInput: { type: String, value: "" },
    submitting: { type: Boolean, value: false },
    closable: { type: Boolean, value: true },
    titleForm: { type: String, value: "加入班级" },
    titlePending: { type: String, value: "入班申请审核中" },
    leadForm: {
      type: String,
      value: "请填写与学校登记一致的真实姓名及班级邀请码，便于老师在后台识别你。",
    },
    leadPending: {
      type: String,
      value: "教师通过后自动解锁刷题、考试等功能；可先刷新审核状态。",
    },
  },

  methods: {
    noop() {},

    onMaskTap() {
      if (this.properties.closable) this.triggerEvent("close");
    },

    onCloseTap() {
      this.triggerEvent("close");
    },

    onInviteInput(e) {
      this.triggerEvent("inviteinput", { value: e.detail.value });
    },

    onRealNameInput(e) {
      this.triggerEvent("realnameinput", { value: e.detail.value });
    },

    onSubmitTap() {
      this.triggerEvent("submit");
    },

    onRefreshTap() {
      this.triggerEvent("refresh");
    },
  },
});
