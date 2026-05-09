/** 考试中作答本地缓存（断网 / 崩溃恢复），联网后与服务端草稿合并同步 */

const storageKey = (examId) => `exam_take_cache_v1_${Number(examId)}`;

/**
 * @returns {{ examId: number, answers: Record<string, string>, dirty: boolean, savedAt: number } | null}
 */
function read(examId) {
  const id = Number(examId);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const raw = wx.getStorageSync(storageKey(id));
    if (!raw || typeof raw !== "object") return null;
    if (Number(raw.examId) !== id) return null;
    return {
      examId: id,
      answers: raw.answers && typeof raw.answers === "object" ? raw.answers : {},
      dirty: Boolean(raw.dirty),
      savedAt: Number(raw.savedAt) || 0,
    };
  } catch (_) {
    return null;
  }
}

function write(examId, answers, dirty) {
  const id = Number(examId);
  if (!Number.isInteger(id) || id <= 0) return;
  try {
    wx.setStorageSync(storageKey(id), {
      examId: id,
      answers: answers && typeof answers === "object" ? { ...answers } : {},
      dirty: Boolean(dirty),
      savedAt: Date.now(),
    });
  } catch (_) {}
}

function clear(examId) {
  const id = Number(examId);
  if (!Number.isInteger(id) || id <= 0) return;
  try {
    wx.removeStorageSync(storageKey(id));
  } catch (_) {}
}

module.exports = { read, write, clear };
