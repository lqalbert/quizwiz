/** 备案：浏览阶段不再强制跳首页入班；入班仅在开始刷题时由 practiceGate 处理 */
function redirectIfNeedJoinClass() {
  return false;
}

module.exports = { redirectIfNeedJoinClass };
