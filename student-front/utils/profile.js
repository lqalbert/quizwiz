const { getApiBase } = require("./config.js");

/** 上传 chooseAvatar 得到的本地临时头像，返回接口 JSON（含 data.avatarUrl、data.student） */
function uploadStudentAvatar(filePath) {
  const base = getApiBase();
  const token = wx.getStorageSync("student_token") || "";
  if (!base) return Promise.reject(new Error("未配置 API 地址"));
  if (!token) return Promise.reject(new Error("请先登录"));
  const path = String(filePath || "").trim();
  if (!path) return Promise.reject(new Error("未选择头像"));
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${base}/api/student/profile/avatar-upload`,
      filePath: path,
      name: "file",
      header: { Authorization: `Bearer ${token}` },
      success(res) {
        let body = {};
        try {
          body = JSON.parse(res.data || "{}");
        } catch (_) {
          body = {};
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }
        const msg = body.message || body.detail || `上传失败(${res.statusCode})`;
        reject(new Error(typeof msg === "string" ? msg : JSON.stringify(msg)));
      },
      fail(err) {
        reject(err && err.errMsg ? new Error(err.errMsg) : new Error("上传失败"));
      },
    });
  });
}

module.exports = { uploadStudentAvatar };
