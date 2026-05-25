/** 今日收获快照：与首页 dateText 一致，按北京时间日历日 */

const { beijingCalendarDateKey } = require("./beijingTime.js");

function localDateKey(d) {
  return beijingCalendarDateKey(d instanceof Date ? d : new Date(d));
}

/**
 * @param {object} opt
 * @param {string} opt.dateText 与首页 hero 日期一致
 * @param {object|null} opt.todayPeriod practice_periods.today
 * @param {number} [opt.checkinStreak] 服务端按刷题记录统计的连续打卡天数
 * @param {boolean} [opt.checkedInToday] 北京日历「今天」是否已刷题
 */
function buildTodaySnapshot(opt) {
  const dateText = String((opt && opt.dateText) || localDateKey(new Date()));
  const t = (opt && opt.todayPeriod) || {};
  const practiced = Number(t.practice_questions || 0);
  const reviewDue =
    t.review_due_count != null && t.review_due_count !== ""
      ? Number(t.review_due_count)
      : Number(t.wrong_count || 0);
  const accuracy = Number(t.accuracy_pct || 0);
  const streak = Math.max(0, parseInt(String((opt && opt.checkinStreak) ?? 0), 10) || 0);
  const checkedInToday = Boolean(opt && opt.checkedInToday);

  let lead = "今天先练 1 题就有收获";
  if (practiced >= 1) {
    lead = reviewDue > 0 ? "今日已有收获，记得清一下待复习" : "今日已有收获，继续保持";
  } else if (streak > 0 && !checkedInToday) {
    lead = `已连续打卡 ${streak} 天，今日尚未刷题`;
  }

  let streakHint = "";
  if (streak > 0 && !checkedInToday) {
    streakHint = "（截至昨日）";
  }

  return {
    dateText,
    practiced,
    reviewDue,
    accuracy,
    streak,
    streakHint,
    checkedInToday,
    lead,
  };
}

module.exports = {
  localDateKey,
  buildTodaySnapshot,
};
