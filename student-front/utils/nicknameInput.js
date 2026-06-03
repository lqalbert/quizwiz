/** 读取 type=nickname 输入框实际值（选微信昵称时 bindinput 可能不触发） */
function readNicknameInputValue(selector, pageCtx) {
  return new Promise((resolve) => {
    const q = wx.createSelectorQuery();
    if (pageCtx) q.in(pageCtx);
    q.select(selector)
      .fields({ properties: ["value"] })
      .exec((res) => {
        resolve(String((res && res[0] && res[0].value) || "").trim());
      });
  });
}

module.exports = { readNicknameInputValue };
