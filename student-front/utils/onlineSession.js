const { request } = require("./request.js");

let activeSessionId = null;
let endInFlight = false;

function isLoggedIn() {
  return Boolean(wx.getStorageSync("student_token"));
}

async function handleAppShow() {
  if (!isLoggedIn()) {
    activeSessionId = null;
    return;
  }
  try {
    const res = await request({ path: "/api/student/online-sessions/start", method: "POST" });
    const sid = res && res.data && res.data.session_id;
    activeSessionId = sid != null ? Number(sid) : null;
  } catch (_) {
    activeSessionId = null;
  }
}

async function handleAppHide() {
  const sid = activeSessionId;
  activeSessionId = null;
  if (!sid || !isLoggedIn() || endInFlight) return;
  endInFlight = true;
  try {
    await request({
      path: "/api/student/online-sessions/end",
      method: "POST",
      data: { session_id: sid },
    });
  } catch (_) {
    /* 网络失败时下次 onShow 会由服务端关闭 orphan 会话 */
  } finally {
    endInFlight = false;
  }
}

module.exports = { handleAppShow, handleAppHide };
