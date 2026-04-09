function getBaseUrl() {
  const app = getApp();
  return app?.globalData?.apiBaseUrl || '';
}

function request({ url, method = 'GET', data = null }) {
  const baseUrl = getBaseUrl();
  const token = wx.getStorageSync('token');
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const err = new Error(res.data?.message || `HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        reject(err);
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
