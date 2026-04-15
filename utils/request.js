function getBaseUrl() {
  try {
    const app = getApp();
    return app?.globalData?.apiBaseUrl || '';
  } catch (_) {
    return '';
  }
}

function normalizeFailError(err) {
  if (!err || typeof err !== 'object') {
    return new Error('网络请求失败');
  }
  const msg = err.errMsg || err.message || '';
  const e = new Error(msg || '网络请求失败');
  if (err.errno != null) e.errno = err.errno;
  return e;
}

/** 从非 2xx 响应里取可读文案；避免把 Nginx 返回的整页 HTML 塞进 toast */
function messageFromHttpBody(body) {
  if (body && typeof body === 'object' && body.message) {
    return String(body.message);
  }
  if (typeof body === 'string' && body.trim()) {
    const t = body.trim();
    if (t.startsWith('<') || t.toLowerCase().includes('<!doctype')) {
      return '';
    }
    return t.slice(0, 200);
  }
  return '';
}

function messageForStatus(statusCode, path, bodyMsg) {
  if (bodyMsg) return bodyMsg;
  if (statusCode === 404 && String(path || '').startsWith('/wx')) {
    return '接口不存在(404)：请在服务器部署含「班级」功能的最新后端，并确认网关把 /wx 转发到 Node';
  }
  return `HTTP ${statusCode}`;
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
    if (!baseUrl) {
      reject(
        new Error(
          '未配置 apiBaseUrl：请在 app.js 的 globalData 中设置后端地址（真机请用局域网 IP，并勾选不校验合法域名）'
        )
      );
      return;
    }
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
        const bodyMsg = messageFromHttpBody(res.data);
        const err = new Error(messageForStatus(res.statusCode, url, bodyMsg));
        err.statusCode = res.statusCode;
        reject(err);
      },
      fail: (err) => {
        reject(normalizeFailError(err));
      },
    });
  });
}

module.exports = {
  request,
};
