const { request } = require("./request.js");

const HEARTBEAT_INTERVAL_MS = 60 * 1000;
/** 切出后延迟结束，避免微信短时反复 onHide/onShow 产生大量碎片会话 */
const HIDE_GRACE_MS = 15 * 1000;

let activeSessionId = null;
let endInFlight = false;
let heartbeatTimer = null;
let hideEndTimer = null;

function isLoggedIn() {
  return Boolean(wx.getStorageSync("student_token"));
}

function clearHeartbeat() {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearHideEndTimer() {
  if (hideEndTimer != null) {
    clearTimeout(hideEndTimer);
    hideEndTimer = null;
  }
}

async function sendHeartbeat() {
  const sid = activeSessionId;
  if (!sid || !isLoggedIn()) return;
  try {
    await request({
      path: "/api/student/online-sessions/heartbeat",
      method: "POST",
      data: { session_id: sid },
    });
  } catch (_) {
    /* 心跳失败不影响使用 */
  }
}

function startHeartbeat() {
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

async function sendEnd(sessionId) {
  if (!sessionId || !isLoggedIn() || endInFlight) return;
  endInFlight = true;
  try {
    await request({
      path: "/api/student/online-sessions/end",
      method: "POST",
      data: { session_id: sessionId },
    });
  } catch (_) {
    /* 网络失败时由服务端按末次心跳关闭 */
  } finally {
    endInFlight = false;
  }
}

async function handleAppShow() {
  clearHideEndTimer();
  if (!isLoggedIn()) {
    activeSessionId = null;
    clearHeartbeat();
    return;
  }
  if (activeSessionId) {
    void sendHeartbeat();
    startHeartbeat();
    return;
  }
  try {
    const res = await request({ path: "/api/student/online-sessions/start", method: "POST" });
    const sid = res && res.data && res.data.session_id;
    activeSessionId = sid != null ? Number(sid) : null;
    if (activeSessionId) {
      void sendHeartbeat();
      startHeartbeat();
    }
  } catch (_) {
    activeSessionId = null;
    clearHeartbeat();
  }
}

function handleAppHide() {
  clearHeartbeat();
  if (!activeSessionId || !isLoggedIn()) return;
  clearHideEndTimer();
  const sid = activeSessionId;
  hideEndTimer = setTimeout(() => {
    hideEndTimer = null;
    if (activeSessionId === sid) {
      activeSessionId = null;
    }
    void sendEnd(sid);
  }, HIDE_GRACE_MS);
}

module.exports = { handleAppShow, handleAppHide };
