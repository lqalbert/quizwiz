const { getApiBase, getExpectedMiniProgramAppId } = require("./utils/config.js");

App({
  globalData: {
    userInfo: null,
    token: "",
    /** 由 config/site.js、本地存储与 getApiBase() 合并得到 */
    apiBase: "",
    /** 错题本等跳转刷题：{ questionIds: number[], feedbackMode?: 'immediate'|'exam' }，消费后清空 */
    pendingPractice: null,
    /** 从已做题/错题本/待复习进刷题后，返回时要恢复的上下文：{ type:'record-done'|'record-wrong'|'review_today', subjectId?, unitId?, unitName? } */
    practiceReturnPage: null,
    /** navigateTo 记录页前写入，在记录页 onLoad ?restore=1 时读出后清空 */
    recordPageRestore: null,
  },

  onLaunch() {
    const token = wx.getStorageSync("student_token") || "";
    this.globalData.token = token;
    const base = getApiBase();
    if (base) this.globalData.apiBase = base;

    const expected = getExpectedMiniProgramAppId();
    if (expected) {
      try {
        const acc = wx.getAccountInfoSync();
        const cur = acc && acc.miniProgram && acc.miniProgram.appId;
        if (cur && cur !== expected) {
          console.warn(
            `[QuizWiz] 当前小程序 AppId(${cur}) 与 config/site.js 中 expectedMiniProgramAppId(${expected}) 不一致，微信登录将失败。请改 project.config.json 或 site.js，并使服务器 WECHAT_MINI_APPID 与之一致。`,
          );
        }
      } catch (_) {
        /* 部分基础库/环境无 getAccountInfoSync */
      }
    }
  },

  onShow() {
    const token = wx.getStorageSync("student_token") || "";
    this.globalData.token = token;
  },
});
