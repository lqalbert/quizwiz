/** 若首页已在页面栈中（例如 Tab 页常驻），主动拉一次汇总，刷新「今日收获」等 */
function refreshHomeSummaryIfOpen() {
  try {
    const pages = getCurrentPages();
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i];
      const route = (p && (p.route || p.__route__)) || "";
      if (route !== "pages/home/index") continue;
      if (typeof p.loadHomeSummary === "function") {
        void p.loadHomeSummary();
      }
      break;
    }
  } catch (_) {}
}

module.exports = { refreshHomeSummaryIfOpen };
