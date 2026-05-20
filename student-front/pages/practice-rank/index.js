const { request } = require("../../utils/request.js");
const { requireAuthNavigate } = require("../../utils/practiceGate.js");

function unwrapPayload(root) {
  if (!root || typeof root !== "object") return {};
  const inner = root.data;
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) return inner;
  return root;
}

const PERIOD_LABEL = {
  today: "今日",
  week: "本周",
  month: "本月",
  all: "全部",
};

Page({
  data: {
    period: "today",
    periodLabel: "今日",
    loading: true,
    err: "",
    rows: [],
  },

  onLoad(options) {
    if (!requireAuthNavigate()) return;
    const p = String((options && options.period) || "today").toLowerCase();
    const period = ["today", "week", "month", "all"].includes(p) ? p : "today";
    const periodLabel = PERIOD_LABEL[period] || "今日";
    this.setData({ period, periodLabel });
    wx.setNavigationBarTitle({ title: `班级排名 · ${periodLabel}` });
    this.loadRank();
  },

  async loadRank() {
    this.setData({ loading: true, err: "" });
    try {
      const res = await request({
        path: `/api/student/stats/practice-class-rank?period=${encodeURIComponent(this.data.period)}`,
        method: "GET",
      });
      const d = unwrapPayload(res);
      const rows = (d && d.rows) || [];
      this.setData({ rows, loading: false });
    } catch (e) {
      this.setData({
        loading: false,
        err: e.message || "加载失败",
        rows: [],
      });
    }
  },
});
