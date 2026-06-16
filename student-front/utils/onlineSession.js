const { request } = require("./request.js");

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

let activeSessionId = null;
let endInFlight = false;
let heartbeatTimer = null;

function isLoggedIn() {
  return Boolean(wx.getStorageSync("student_token"));
}

function clearHeartbeat() {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
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
    /* 心跳失败不影响使用，下次 onShow 会关闭孤儿会话 */
  }
}

function startHeartbeat() {
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

async function handleAppShow() {
  if (!isLoggedIn()) {
    activeSessionId = null;
    clearHeartbeat();
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

async function handleAppHide() {
  const sid = activeSessionId;
  activeSessionId = null;
  clearHeartbeat();
  if (!sid || !isLoggedIn() || endInFlight) return;
  endInFlight = true;
  try {
    await request({
      path: "/api/student/online-sessions/end",
      method: "POST",
      data: { session_id: sid },
    });
  } catch (_) {
    /* 网络失败时下次 onShow 会由服务端按末次心跳关闭孤儿会话 */
  } finally {
    endInFlight = false;
  }
}

module.exports = { handleAppShow, handleAppHide };
