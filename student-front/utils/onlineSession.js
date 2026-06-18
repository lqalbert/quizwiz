const { request } = require("./request.js");

/** 前台心跳间隔（递归 setTimeout，禁止 setInterval 防堆积） */
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
/** 切出后延迟结束：仅 App.onHide 触发，避免微信短时切后台误断会话 */
const HIDE_GRACE_MS = 15 * 1000;
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 10000;
const START_RETRY_BASE_MS = 1500;
const START_MAX_ATTEMPTS = 4;
const PENDING_END_STORAGE_KEY = "online_session_pending_ends";
const MAX_PENDING_ENDS = 8;

let activeSessionId = null;
let endInFlight = false;
let heartbeatTimer = null;
let hideEndTimer = null;
let heartbeatPending = false;
let heartbeatStopped = true;
let heartbeatBackoffMs = BACKOFF_INITIAL_MS;
/** 合并并发 start，避免 App.onShow 与页面 onShow 重复建会话 */
let startSessionPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function readPendingEnds() {
  try {
    const raw = wx.getStorageSync(PENDING_END_STORAGE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => ({
        session_id: Number(item && item.session_id),
        queued_at: Number(item && item.queued_at) || 0,
      }))
      .filter((item) => Number.isInteger(item.session_id) && item.session_id > 0);
  } catch (_) {
    return [];
  }
}

function writePendingEnds(list) {
  try {
    wx.setStorageSync(PENDING_END_STORAGE_KEY, list.slice(-MAX_PENDING_ENDS));
  } catch (_) {
    /* 存储失败时仍尽力发 end，由服务端兜底 */
  }
}

function enqueuePendingEnd(sessionId) {
  const sid = Number(sessionId);
  if (!Number.isInteger(sid) || sid <= 0) return;
  const next = readPendingEnds().filter((item) => item.session_id !== sid);
  next.push({ session_id: sid, queued_at: Date.now() });
  writePendingEnds(next);
}

function dequeuePendingEnd(sessionId) {
  const sid = Number(sessionId);
  writePendingEnds(readPendingEnds().filter((item) => item.session_id !== sid));
}

/** 重试本地队列里未送达的 end（先于 start 执行） */
async function flushPendingEnds() {
  if (!isLoggedIn()) return;
  const pending = readPendingEnds();
  for (const item of pending) {
    const sid = item.session_id;
    if (sid === activeSessionId) continue;
    const ok = await postEndReliable(sid, { queueOnFail: false });
    if (!ok) break;
  }
}

async function postEndReliable(sessionId, { queueOnFail = true } = {}) {
  const sid = Number(sessionId);
  if (!Number.isInteger(sid) || sid <= 0 || !isLoggedIn()) return false;
  if (endInFlight) {
    if (queueOnFail) enqueuePendingEnd(sid);
    return false;
  }
  endInFlight = true;
  try {
    await request({
      path: "/api/student/online-sessions/end",
      method: "POST",
      data: { session_id: sid },
    });
    dequeuePendingEnd(sid);
    return true;
  } catch (err) {
    if (err && err.statusCode === 404) {
      dequeuePendingEnd(sid);
      return true;
    }
    if (queueOnFail) enqueuePendingEnd(sid);
    return false;
  } finally {
    endInFlight = false;
  }
}

/** 切出时尽力上报结束；失败写入本地队列，下次 onShow 重试 */
function fireEndRequest(sessionId) {
  const sid = Number(sessionId);
  if (!Number.isInteger(sid) || sid <= 0 || !isLoggedIn()) return;
  enqueuePendingEnd(sid);
  const base = getApiBase();
  if (!base) return;
  wx.request({
    url: `${base}/api/student/online-sessions/end`,
    method: "POST",
    header: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${wx.getStorageSync("student_token") || ""}`,
    },
    data: { session_id: sid },
    success(res) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        dequeuePendingEnd(sid);
        return;
      }
      if (res.statusCode === 404) {
        dequeuePendingEnd(sid);
      }
    },
    fail() {
      /* 已入队，待 flushPendingEnds */
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

async function startSessionWithRetry() {
  if (startSessionPromise) return startSessionPromise;
  startSessionPromise = (async () => {
    let delay = START_RETRY_BASE_MS;
    for (let attempt = 0; attempt < START_MAX_ATTEMPTS; attempt += 1) {
      if (!isLoggedIn()) return null;
      try {
        const res = await request({ path: "/api/student/online-sessions/start", method: "POST" });
        const sid = res && res.data && res.data.session_id;
        const n = sid != null ? Number(sid) : null;
        if (Number.isInteger(n) && n > 0) return n;
      } catch (_) {
        /* 指数退避后重试 */
      }
      if (attempt < START_MAX_ATTEMPTS - 1) {
        await sleep(delay);
        delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      }
    }
    return null;
  })();
  try {
    return await startSessionPromise;
  } finally {
    startSessionPromise = null;
  }
}

async function endOnlineSessionNow() {
  clearHideEndTimer();
  stopHeartbeat(false);
  const sid = activeSessionId;
  activeSessionId = null;
  if (sid) {
    await postEndReliable(sid);
  }
  await flushPendingEnds();
}

/**
 * App.onShow：冲刷 pending end → 开始/恢复会话
 * @returns {Promise<boolean>} 是否已有或成功建立会话
 */
async function handleAppShow() {
  clearHideEndTimer();
  if (!isLoggedIn()) {
    stopHeartbeat(true);
    return false;
  }
  await flushPendingEnds();
  if (activeSessionId) {
    startHeartbeat();
    return true;
  }
  const sid = await startSessionWithRetry();
  if (sid) {
    activeSessionId = sid;
    startHeartbeat();
    return true;
  }
  stopHeartbeat(true);
  return false;
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
