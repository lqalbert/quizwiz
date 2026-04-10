function getBaseUrl() {
  const app = getApp();
  return app?.globalData?.apiBaseUrl || '';
}

function request({ url, method = 'GET', data = null }) {
  const baseUrl = getBaseUrl();
  const token = wx.getStorageSync('token');
  const m = String(method || 'GET').toUpperCase();
  const header = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  // GET/HEAD 不要带 application/json，少数网关/解析链会因此返回 400 且无 JSON message
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
    header['content-type'] = 'application/json';
  } else if (
    m === 'DELETE' &&
    data != null &&
    typeof data === 'object' &&
    Object.keys(data).length > 0
  ) {
    header['content-type'] = 'application/json';
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${url}`,
      method: m,
      data,
      header,
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        let msg = '';
        const body = res.data;
        if (body && typeof body === 'object' && body.message) {
          msg = body.message;
        } else if (typeof body === 'string' && body.trim()) {
          msg = body.trim().slice(0, 200);
        }
        const err = new Error(msg || `HTTP ${res.statusCode}`);
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
