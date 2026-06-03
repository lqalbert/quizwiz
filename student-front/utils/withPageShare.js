const pageShare = require("./pageShare.js");

/**
 * 在页面级注册 onShareAppMessage / onShareTimeline（Behavior 在 lazyCodeLoading 下可能不生效）
 */
function withPageShare(pageConfig) {
  const userOnLoad = pageConfig.onLoad;
  const userOnShow = pageConfig.onShow;

  pageConfig.onLoad = function onLoadWithShare(options) {
    pageShare.enableShareMenu();
    if (typeof userOnLoad === "function") userOnLoad.call(this, options);
  };

  pageConfig.onShow = function onShowWithShare() {
    pageShare.enableShareMenu();
    if (typeof userOnShow === "function") userOnShow.call(this);
  };

  if (!pageConfig.onShareAppMessage) {
    pageConfig.onShareAppMessage = function onShareAppMessage() {
      return pageShare.buildAppMessage(this);
    };
  }

  if (!pageConfig.onShareTimeline) {
    pageConfig.onShareTimeline = function onShareTimeline() {
      return pageShare.buildTimeline(this);
    };
  }

  return Page(pageConfig);
}

module.exports = withPageShare;
