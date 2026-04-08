function getBaseUrl() {
  const app = getApp();
  return app?.globalData?.apiBaseUrl || '';
}

function request({ url, method = 'GET', data = null }) {
  const baseUrl = getBaseUrl();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${url}`,
      method,
      data,
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(res.data?.message || `HTTP ${res.statusCode}`));
      },
      fail: (err) => {
        reject(err);
      },
    });
  });
}

module.exports = {
  request,
};
