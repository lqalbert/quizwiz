/** 学习页：已下载资料本地路径（仅记录落在 USER_DATA_PATH 下的持久文件） */

const MAP_KEY = "study_resource_local_map_v1";

function readMap() {
  try {
    const v = wx.getStorageSync(MAP_KEY);
    if (!v || typeof v !== "object") return {};
    return v;
  } catch (_) {
    return {};
  }
}

function writeMap(m) {
  try {
    wx.setStorageSync(MAP_KEY, m);
  } catch (_) {}
}

function recordKey(classId, resourceId) {
  return `${Number(classId)}_${Number(resourceId)}`;
}

function getRecord(classId, resourceId) {
  const m = readMap();
  const r = m[recordKey(classId, resourceId)];
  if (!r || !r.path) return null;
  return { path: String(r.path), name: String(r.name || "") };
}

function setRecord(classId, resourceId, localPath, displayName) {
  let persistent = false;
  try {
    const root = wx.env && wx.env.USER_DATA_PATH ? String(wx.env.USER_DATA_PATH) : "";
    if (root && String(localPath).startsWith(root)) persistent = true;
  } catch (_) {
    persistent = false;
  }
  if (!persistent) return;
  const m = readMap();
  m[recordKey(classId, resourceId)] = {
    path: String(localPath),
    name: String(displayName || ""),
    at: Date.now(),
  };
  writeMap(m);
}

function removeRecord(classId, resourceId) {
  const m = readMap();
  delete m[recordKey(classId, resourceId)];
  writeMap(m);
}

/** 仅用于判断本地文件是否还在；不用 readFile */
function checkPathUsable(localPath) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: localPath,
      success: (s) => resolve((Number(s.size) || 0) > 0),
      fail: () => resolve(false),
    });
  });
}

function mergeLocalSavedFlag(classId, sections) {
  if (!classId || !Array.isArray(sections)) return sections;
  const m = readMap();
  return sections.map((sec) => ({
    ...sec,
    left: (sec.left || []).map((c) => ({
      ...c,
      local_saved: Boolean(
        c.can_dl && m[recordKey(classId, c.id)] && String(m[recordKey(classId, c.id)].path || "").length > 0,
      ),
    })),
    right: (sec.right || []).map((c) => ({
      ...c,
      local_saved: Boolean(
        c.can_dl && m[recordKey(classId, c.id)] && String(m[recordKey(classId, c.id)].path || "").length > 0,
      ),
    })),
  }));
}

module.exports = {
  getRecord,
  setRecord,
  removeRecord,
  checkPathUsable,
  mergeLocalSavedFlag,
};
