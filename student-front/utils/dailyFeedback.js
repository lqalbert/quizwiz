const { request } = require("./request.js");

function unwrapStudentPayload(root) {
  if (!root || typeof root !== "object") return {};
  const inner = root.data;
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) return inner;
  return root;
}

/**
 * 本轮结束后拉取首页汇总，弹窗反馈「今日累计」与待复习情况
 * @param {number} roundQuestions 本轮完成的题数（或交卷题数）
 */
async function showPostSessionDailyFeedback(roundQuestions) {
  const r = Number(roundQuestions) || 0;
  let practiced = 0;
  let reviewDue = 0;
  let acc = 0;
  try {
    const res = await request({ path: "/api/student/stats/home-summary", method: "GET" });
    const d = unwrapStudentPayload(res);
    const t = d.practice_periods && d.practice_periods.today;
    practiced = Number(t && t.practice_questions != null ? t.practice_questions : 0);
    reviewDue = Number(t && t.wrong_count != null ? t.wrong_count : 0);
    acc = Number(t && t.accuracy_pct != null ? t.accuracy_pct : 0);
  } catch (_) {
    /* 仍展示本轮信息 */
  }
  const lines = [
    `本轮完成 ${r} 题。`,
    practiced > 0 || acc >= 0 ? `今日累计答题 ${practiced} 题，今日正确率约 ${acc}%。` : "",
    reviewDue > 0 ? `「今日待复习」还有 ${reviewDue} 题，有空记得清一下。` : `「今日待复习」当前为 0，继续保持。`,
  ]
    .filter(Boolean)
    .join("\n");
  await new Promise((resolve) => {
    wx.showModal({
      title: "今天的收获",
      content: lines || "已完成本轮练习，回首页可查看今日收获。",
      showCancel: false,
      confirmText: "好的",
      complete: resolve,
    });
  });
}

module.exports = { showPostSessionDailyFeedback };
