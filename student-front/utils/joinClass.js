const { request } = require("./request.js");
const { startLeaveClassFlowFromServer } = require("./leaveClass.js");

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

function formatClassNames(classes) {
  const names = (classes || [])
    .map((c) => String((c && c.name) || "").trim())
    .filter(Boolean);
  return names.length ? names.join("、") : "当前班级";
}

function promptLeaveBeforeJoin(classes) {
  const label = formatClassNames(classes);
  return new Promise((resolve) => {
    wx.showModal({
      title: "请先退出当前班级",
      content: `你已在「${label}」中。须先申请退出并通过教师审核后，才能加入新班级。`,
      confirmText: "退出",
      cancelText: "取消",
      success: (r) => {
        if (r.confirm) {
          void startLeaveClassFlowFromServer();
        }
        resolve(false);
      },
      fail: () => resolve(false),
    });
  });
}

async function fetchStudentClasses() {
  const res = await request({ path: "/api/student/profile", method: "GET" });
  return (res.data && res.data.classes) || [];
}

/** 已入班则引导先退班；返回 true 表示可继续入班流程 */
async function ensureCanJoinClass() {
  const token = wx.getStorageSync("student_token") || "";
  if (!token) return true;
  const classes = await fetchStudentClasses();
  if (!classes.length) return true;
  await promptLeaveBeforeJoin(classes);
  return false;
}

function handleAlreadyInClassError(err) {
  if (!err || err.apiCode !== "ALREADY_IN_CLASS") return false;
  const classes = (err.apiData && err.apiData.classes) || [];
  void promptLeaveBeforeJoin(classes.length ? classes : [{ name: "当前班级" }]);
  return true;
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
  ensureCanJoinClass,
  promptLeaveBeforeJoin,
  handleAlreadyInClassError,
};
