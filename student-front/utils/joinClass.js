const { request } = require("./request.js");

const PENDING_MANUAL_KEY = "join_pending_manual";
const OPEN_JOIN_MODAL_KEY = "open_join_modal_on_show";

function setNeedJoinClass(need) {
  wx.setStorageSync("need_join_class", need ? "1" : "0");
  if (!need) {
    try {
      wx.removeStorageSync(PENDING_MANUAL_KEY);
    } catch (_) {}
  }
}

/** 是否须入班（本地缓存 + 可选服务端刷新） */
async function syncNeedJoinClassFromServer() {
  const token = wx.getStorageSync("student_token") || "";
  if (!token) {
    setNeedJoinClass(false);
    return { needJoin: false, pendingManual: false };
  }
  const res = await request({ path: "/api/student/profile", method: "GET" });
  const need = Boolean(res.data && res.data.need_join_class);
  setNeedJoinClass(need);
  const pendingManual = need && wx.getStorageSync(PENDING_MANUAL_KEY) === "1";
  return { needJoin: need, pendingManual };
}

async function submitJoinByInvite({ inviteCode, realName }) {
  const invite = String(inviteCode || "").trim();
  const name = String(realName || "").trim();
  if (!name) throw new Error("请填写真实姓名");
  if (name.length > 64) throw new Error("真实姓名不超过64字");
  if (!invite) throw new Error("请填写邀请码");
  const res = await request({
    path: "/api/student/join-by-invite",
    method: "POST",
    data: { inviteCode: invite, realName: name },
  });
  const mode = res.data && res.data.mode;
  const already = Boolean(res.data && res.data.already_member);
  if (mode === "manual") {
    wx.setStorageSync(PENDING_MANUAL_KEY, "1");
    setNeedJoinClass(true);
    return {
      mode: "manual",
      message: (res.data && res.data.message) || "已提交申请，请等待老师审核",
    };
  }
  setNeedJoinClass(false);
  let message = "已加入班级";
  if (already) message = "已在该班级中";
  return { mode: mode || "auto", message };
}

module.exports = {
  PENDING_MANUAL_KEY,
  OPEN_JOIN_MODAL_KEY,
  setNeedJoinClass,
  syncNeedJoinClassFromServer,
  submitJoinByInvite,
};
