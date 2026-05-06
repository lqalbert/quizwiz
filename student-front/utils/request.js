const { getApiBase } = require("./config.js");

function request({ path, method = "GET", data, auth = true }) {
  const base = getApiBase();
  if (!base) {
    return Promise.reject(new Error("未配置 API 地址：请修改 config/site.js 中 defaultApiBase"));
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const header = { "Content-Type": "application/json" };
  if (auth) {
    const token = wx.getStorageSync("student_token") || "";
    if (token) header.Authorization = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data: method === "GET" ? undefined : data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const msg = (res.data && (res.data.message || res.data.detail)) || `请求失败(${res.statusCode})`;
        const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        err.statusCode = res.statusCode;
        reject(err);
      },
      fail(err) {
        reject(err && err.errMsg ? new Error(err.errMsg) : new Error("网络错误"));
      },
    });
  });
}

module.exports = { request };
