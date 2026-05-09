/** 刷题页本地草稿（续做）：onTabItemTap 切到其他 Tab 时写入；从子页返回刷题 Tab 时 onShow 会再补一次 */
const KEY = "student_quiz_practice_draft_v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function clearPracticeDraft() {
  try {
    wx.removeStorageSync(KEY);
  } catch (_) {}
}

function savePracticeDraft(payload) {
  try {
    wx.setStorageSync(
      KEY,
      JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        ...payload,
      }),
    );
  } catch (_) {}
}

function loadPracticeDraft() {
  try {
    const raw = wx.getStorageSync(KEY);
    if (!raw) return null;
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || o.v !== 1 || !Array.isArray(o.questionIds) || o.questionIds.length === 0) return null;
    if (Date.now() - Number(o.savedAt || 0) > MAX_AGE_MS) {
      clearPracticeDraft();
      return null;
    }
    return o;
  } catch (_) {
    return null;
  }
}

module.exports = { clearPracticeDraft, savePracticeDraft, loadPracticeDraft };
