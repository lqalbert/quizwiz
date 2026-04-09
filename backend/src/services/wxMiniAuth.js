import { config } from '../config.js';

/**
 * 使用 wx.login 拿到的 code 向微信换取 openid / session_key
 * @see https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 */
export async function codeToSession(code) {
  const { appId, appSecret } = config.wx;
  if (!appId || !appSecret) {
    throw new Error('WX_APP_ID/WX_APP_SECRET 未配置');
  }
  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: String(code || ''),
    grant_type: 'authorization_code',
  });
  const url = `https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`;
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (data.errcode) {
    const msg = data.errmsg || 'jscode2session failed';
    const err = new Error(`${msg} (${data.errcode})`);
    err.code = data.errcode;
    throw err;
  }
  if (!data.openid) {
    throw new Error('微信未返回 openid');
  }
  return {
    openid: data.openid,
    unionid: data.unionid || null,
    sessionKey: data.session_key,
  };
}
