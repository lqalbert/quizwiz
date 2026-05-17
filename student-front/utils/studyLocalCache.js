/** 学习页：已下载资料本地路径（持久化到 USER_DATA_PATH 并写入 Storage） */

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

function normalizeFsPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .trim();
}

function getUserDataRoot() {
  try {
    return wx.env && wx.env.USER_DATA_PATH ? String(wx.env.USER_DATA_PATH) : "";
  } catch (_) {
    return "";
  }
}

function pathInUserData(localPath, userRoot) {
  const p = normalizeFsPath(localPath);
  const r = normalizeFsPath(userRoot);
  if (!p || !r) return false;
  return p === r || p.startsWith(`${r}/`);
}

function inferExt(displayName) {
  const m = String(displayName || "").match(/\.([a-zA-Z0-9]{1,12})$/);
  return m ? m[1].toLowerCase() : "bin";
}

function buildPersistentPath(userRoot, classId, resourceId, displayName) {
  const root = normalizeFsPath(userRoot).replace(/\/$/, "");
  const ext = inferExt(displayName);
  return `${root}/qw_study_${Number(classId)}_${Number(resourceId)}.${ext}`;
}

function getRecord(classId, resourceId) {
  const m = readMap();
  const r = m[recordKey(classId, resourceId)];
  if (!r || !r.path) return null;
  return { path: String(r.path), name: String(r.name || "") };
}

function setRecord(classId, resourceId, localPath, displayName) {
  const m = readMap();
  m[recordKey(classId, resourceId)] = {
    path: String(localPath),
    name: String(displayName || ""),
    at: Date.now(),
  };
  writeMap(m);
}

function removeFileQuiet(filePath) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().unlink({
      filePath,
      success: () => resolve(),
      fail: () => resolve(),
    });
  });
}

function copyToDest(srcPath, destPath) {
  const fs = wx.getFileSystemManager();
  return removeFileQuiet(destPath).then(
    () =>
      new Promise((resolve, reject) => {
        fs.copyFile({
          srcPath,
          destPath,
          success: () => resolve(destPath),
          fail: (err) => reject(err || new Error("copy failed")),
        });
      }),
  );
}

function saveFileToUserData(srcPath) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fs.saveFile({
      tempFilePath: srcPath,
      success: (res) => {
        const saved = String(res.savedFilePath || "").trim();
        if (!saved) {
          reject(new Error("no saved path"));
          return;
        }
        resolve(saved);
      },
      fail: (err) => reject(err || new Error("saveFile failed")),
    });
  });
}

/**
 * 将下载得到的本地路径持久化并写入 Storage（供「已下载」标注）。
 */
function saveDownloadRecord(classId, resourceId, localPath, displayName) {
  const path = String(localPath || "").trim();
  if (!path) return Promise.reject(new Error("empty path"));

  const userRoot = getUserDataRoot();
  if (!userRoot) return Promise.reject(new Error("no user data path"));

  const cid = Number(classId);
  const rid = Number(resourceId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(rid) || rid <= 0) {
    return Promise.reject(new Error("bad id"));
  }

  const dest = buildPersistentPath(userRoot, cid, rid, displayName);
  const normDest = normalizeFsPath(dest);
  const normSrc = normalizeFsPath(path);

  if (normSrc === normDest) {
    setRecord(cid, rid, dest, displayName);
    return Promise.resolve(dest);
  }

  if (pathInUserData(path, userRoot)) {
    return copyToDest(path, dest)
      .then((p) => {
        setRecord(cid, rid, p, displayName);
        return p;
      })
      .catch(() => {
        setRecord(cid, rid, path, displayName);
        return path;
      });
  }

  return copyToDest(path, dest)
    .then((p) => {
      setRecord(cid, rid, p, displayName);
      return p;
    })
    .catch(() =>
      saveFileToUserData(path).then((saved) => {
        if (normalizeFsPath(saved) !== normDest) {
          return copyToDest(saved, dest)
            .then((p) => {
              setRecord(cid, rid, p, displayName);
              return p;
            })
            .catch(() => {
              setRecord(cid, rid, saved, displayName);
              return saved;
            });
        }
        setRecord(cid, rid, saved, displayName);
        return saved;
      }),
    );
}

function removeRecord(classId, resourceId) {
  const m = readMap();
  delete m[recordKey(classId, resourceId)];
  writeMap(m);
}

function hasLocalRecord(classId, resourceId) {
  const m = readMap();
  const r = m[recordKey(classId, resourceId)];
  return Boolean(r && String(r.path || "").length > 0);
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
  const cid = Number(classId);
  return sections.map((sec) => ({
    subject_key: sec.subject_key,
    subject_name: sec.subject_name,
    left: (sec.left || []).map((c) => ({
      ...c,
      local_saved: hasLocalRecord(cid, c.id),
    })),
    right: (sec.right || []).map((c) => ({
      ...c,
      local_saved: hasLocalRecord(cid, c.id),
    })),
  }));
}

module.exports = {
  getRecord,
  setRecord,
  saveDownloadRecord,
  removeRecord,
  checkPathUsable,
  mergeLocalSavedFlag,
  hasLocalRecord,
};
