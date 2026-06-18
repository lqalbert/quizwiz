const { request } = require("./request.js");

/** 前台心跳间隔（递归 setTimeout，禁止 setInterval 防堆积） */
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
/** 切出后延迟结束：仅 App.onHide 触发，避免微信短时切后台误断会话 */
const HIDE_GRACE_MS = 15 * 1000;
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 10000;

let activeSessionId = null;
let endInFlight = false;
let heartbeatTimer = null;
let hideEndTimer = null;
let heartbeatPending = false;
let heartbeatStopped = true;
let heartbeatBackoffMs = BACKOFF_INITIAL_MS;

function isLoggedIn() {
  return Boolean(wx.getStorageSync("student_token"));
}

function clearHeartbeatTimer() {
  if (heartbeatTimer != null) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearHideEndTimer() {
  if (hideEndTimer != null) {
    clearTimeout(hideEndTimer);
    hideEndTimer = null;
  }
}

function getApiBase() {
  try {
    const { getApiBase: base } = require("./config.js");
    return base();
  } catch (_) {
    return "";
  }
}

/** 切出时尽力上报结束（不阻塞 App.onHide） */
function fireEndRequest(sessionId) {
  const base = getApiBase();
  if (!base || !sessionId || !isLoggedIn()) return;
  wx.request({
    url: `${base}/api/student/online-sessions/end`,
    method: "POST",
    header: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${wx.getStorageSync("student_token") || ""}`,
    },
    data: { session_id: sessionId },
    complete() {
      /* 成败均不阻塞；僵尸会话由服务端定时扫描收口 */
    },
  });
}

async function sendHeartbeat() {
  const sid = activeSessionId;
  if (!sid || !isLoggedIn()) return false;
  try {
    await request({
      path: "/api/student/online-sessions/heartbeat",
      method: "POST",
      data: { session_id: sid, client_ts: Date.now() },
    });
    return true;
  } catch (err) {
    if (err && err.statusCode === 404) {
      activeSessionId = null;
      stopHeartbeat(false);
      void handleAppShow();
    }
    return false;
  }
}

function scheduleHeartbeat(delayMs) {
  if (heartbeatStopped || !activeSessionId) return;
  clearHeartbeatTimer();
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    void tickHeartbeat();
  }, Math.max(0, delayMs));
}

async function tickHeartbeat() {
  if (heartbeatStopped || !activeSessionId || heartbeatPending) return;
  heartbeatPending = true;
  try {
    const ok = await sendHeartbeat();
    if (heartbeatStopped || !activeSessionId) return;
    if (ok) {
      heartbeatBackoffMs = BACKOFF_INITIAL_MS;
      scheduleHeartbeat(HEARTBEAT_INTERVAL_MS);
    } else {
      scheduleHeartbeat(heartbeatBackoffMs);
      heartbeatBackoffMs = Math.min(heartbeatBackoffMs * 2, BACKOFF_MAX_MS);
    }
  } finally {
    heartbeatPending = false;
  }
}

function startHeartbeat() {
  stopHeartbeat(false);
  heartbeatStopped = false;
  heartbeatBackoffMs = BACKOFF_INITIAL_MS;
  scheduleHeartbeat(0);
}

function stopHeartbeat(clearSession = true) {
  heartbeatStopped = true;
  clearHeartbeatTimer();
  heartbeatPending = false;
  if (clearSession) {
    activeSessionId = null;
  }
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

async function endOnlineSessionNow() {
  clearHideEndTimer();
  stopHeartbeat(false);
  const sid = activeSessionId;
  activeSessionId = null;
  if (sid && isLoggedIn()) {
    await sendEnd(sid);
  }
}

/** App.onShow：开始/恢复会话（禁止在 Page.onHide 结束会话） */
async function handleAppShow() {
  clearHideEndTimer();
  if (!isLoggedIn()) {
    stopHeartbeat(true);
    return;
  }
  if (activeSessionId) {
    startHeartbeat();
    return;
  }
  try {
    const res = await request({ path: "/api/student/online-sessions/start", method: "POST" });
    const sid = res && res.data && res.data.session_id;
    activeSessionId = sid != null ? Number(sid) : null;
    if (activeSessionId) {
      startHeartbeat();
    }
  } catch (_) {
    activeSessionId = null;
    stopHeartbeat(true);
  }
}

/** App.onHide：延迟结束会话 */
function handleAppHide() {
  stopHeartbeat(false);
  if (!activeSessionId || !isLoggedIn()) return;
  clearHideEndTimer();
  const sid = activeSessionId;
  hideEndTimer = setTimeout(() => {
    hideEndTimer = null;
    if (activeSessionId === sid) {
      activeSessionId = null;
    }
    fireEndRequest(sid);
  }, HIDE_GRACE_MS);
}

module.exports = {
  handleAppShow,
  handleAppHide,
  ensureOnlineSession: handleAppShow,
  endOnlineSessionNow,
};
