const { request } = require("./request.js");

async function fetchClassesForLeave() {
  const res = await request({ path: "/api/student/profile", method: "GET" });
  const classesRaw = (res.data && res.data.classes) || [];
  const pendingLeave = (res.data && res.data.pending_leave_requests) || [];
  return classesRaw.map((c) => ({
    ...c,
    leave_pending: pendingLeave.some((p) => Number(p.class_id) === Number(c.id)),
  }));
}

function promptLeaveClassConfirm(cls, options = {}) {
  if (!cls || !cls.id) return;
  if (cls.leave_pending) {
    wx.showToast({ title: "该班级退出申请已在审核中", icon: "none" });
    return;
  }
  wx.showModal({
    title: "退出班级",
    content: `班级「${String(cls.name || "").trim() || "未命名"}」\n\n须教师审核通过后方可退出；审核通过前你仍在原班级。\n\n退出后，凡曾关联该班的考试，你的答卷会被删除（即使你还在其它班级）；个人刷题记录会保留。\n\n是否提交退出申请？`,
    confirmText: "提交申请",
    cancelText: "取消",
    success: async (r) => {
      if (!r.confirm) return;
      wx.showLoading({ title: "提交中" });
      try {
        await request({
          path: "/api/student/leave-class-request",
          method: "POST",
          data: { class_id: cls.id },
        });
        wx.hideLoading();
        wx.showToast({ title: "已提交，请等待教师审核", icon: "none" });
        if (typeof options.onSuccess === "function") {
          await options.onSuccess();
        }
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || "提交失败", icon: "none" });
      }
    },
  });
}

function showLeaveClassActionSheet(classes, offset, options = {}) {
  const PAGE = 5;
  const page = classes.slice(offset, offset + PAGE);
  const more = offset + PAGE < classes.length;
  const itemList = page.map((c) => {
    const n = String(c.name || "").trim() || "未命名班级";
    return c.leave_pending ? `${n}（审核中）` : n;
  });
  if (more) itemList.push("下一页…");
  wx.showActionSheet({
    itemList,
    success: (res) => {
      const idx = res.tapIndex;
      if (more && idx === itemList.length - 1) {
        showLeaveClassActionSheet(classes, offset + PAGE, options);
        return;
      }
      const cls = page[idx];
      if (!cls) return;
      promptLeaveClassConfirm(cls, options);
    },
    fail: (err) => {
      const msg = err && err.errMsg ? String(err.errMsg) : "";
      if (msg.includes("cancel")) return;
      wx.showToast({ title: msg || "无法打开选择", icon: "none" });
    },
  });
}

function startLeaveClassFlow(classes, options = {}) {
  const list = Array.isArray(classes) ? classes : [];
  if (!list.length) {
    wx.showToast({ title: "你尚未加入班级", icon: "none" });
    return;
  }
  if (list.length === 1) {
    promptLeaveClassConfirm(list[0], options);
    return;
  }
  showLeaveClassActionSheet(list, 0, options);
}

async function startLeaveClassFlowFromServer(options = {}) {
  try {
    const classes = await fetchClassesForLeave();
    startLeaveClassFlow(classes, options);
  } catch (err) {
    wx.showToast({ title: (err && err.message) || "加载班级失败", icon: "none" });
  }
}

module.exports = {
  fetchClassesForLeave,
  promptLeaveClassConfirm,
  showLeaveClassActionSheet,
  startLeaveClassFlow,
  startLeaveClassFlowFromServer,
};
