/** 每日练题目标、连续打开、「今日待复习」判题标记：与首页 dateText 一致，按北京时间日历日 */

const { beijingCalendarDateKey } = require("./beijingTime.js");

const GOAL_KEY = "student_daily_practice_goal_v1";
const STREAK_LAST = "student_daily_streak_last_v1";
const STREAK_VAL = "student_daily_streak_value_v1";
/** 当日至少完成 1 道待复习判题（即时提交或考试交卷） */
const REVIEW_DONE_PREFIX = "student_daily_review_done_v1_";

function localDateKey(d) {
  return beijingCalendarDateKey(d instanceof Date ? d : new Date(d));
}

function yesterdayKeyFrom(todayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayKey || "").trim());
  if (!m) return String(todayKey || "");
  const anchor = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  anchor.setTime(anchor.getTime() - 86400000);
  return beijingCalendarDateKey(anchor);
}

function getPracticeGoal() {
  try {
    const n = parseInt(String(wx.getStorageSync(GOAL_KEY) || "10"), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 99) return n;
  } catch (_) {}
  return 10;
}

function setPracticeGoal(n) {
  const v = Math.min(99, Math.max(1, parseInt(String(n), 10) || 10));
  try {
    wx.setStorageSync(GOAL_KEY, String(v));
  } catch (_) {}
  return v;
}

/** 在首页 onShow（已登录）调用：按本地日历更新连续打开天数 */
function bumpOpenStreak() {
  const today = localDateKey(new Date());
  let last = "";
  let val = 0;
  try {
    last = String(wx.getStorageSync(STREAK_LAST) || "");
    val = parseInt(String(wx.getStorageSync(STREAK_VAL) || "0"), 10) || 0;
  } catch (_) {}
  if (last === today) {
    return Number.isFinite(val) && val > 0 ? val : 1;
  }
  let next = 1;
  if (last === yesterdayKeyFrom(today) && val > 0) next = val + 1;
  try {
    wx.setStorageSync(STREAK_LAST, today);
    wx.setStorageSync(STREAK_VAL, String(next));
  } catch (_) {}
  return next;
}

function hasReviewPracticeDoneToday(dateKey) {
  try {
    return Boolean(wx.getStorageSync(REVIEW_DONE_PREFIX + dateKey));
  } catch (_) {
    return false;
  }
}

/** 从「今日待复习」进入的练习里，成功判题 ≥1 次后调用（即时模式每题提交、考试模式交卷成功） */
function markReviewPracticeCompleted(dateKey) {
  try {
    wx.setStorageSync(REVIEW_DONE_PREFIX + String(dateKey || ""), "1");
  } catch (_) {}
}

/**
 * @param {object} opt
 * @param {string} opt.dateText 与首页 hero 日期一致
 * @param {object|null} opt.todayPeriod practice_periods.today
 */
function buildTodaySnapshot(opt) {
  const dateText = String((opt && opt.dateText) || localDateKey(new Date()));
  const t = (opt && opt.todayPeriod) || {};
  const practiced = Number(t.practice_questions || 0);
  const reviewDue = Number(t.wrong_count || 0);
  const accuracy = Number(t.accuracy_pct || 0);
  const goal = getPracticeGoal();
  let streak = 0;
  try {
    streak = parseInt(String(wx.getStorageSync(STREAK_VAL) || "0"), 10) || 0;
  } catch (_) {}

  const task1 = practiced >= 1;
  const task2 = practiced >= goal;
  const task3 = hasReviewPracticeDoneToday(dateText);
  const tasksDone = [task1, task2, task3].filter(Boolean).length;
  const goalPct = goal > 0 ? Math.min(100, Math.round((100 * practiced) / goal)) : 0;

  let lead = "今天先练 1 题就有收获";
  if (tasksDone >= 3) lead = "今天的任务都完成了，太棒了";
  else if (tasksDone === 2) lead = "还差一小步就完成今日全部任务";
  else if (task1) lead = "继续向今日目标前进";

  return {
    dateText,
    practiced,
    reviewDue,
    accuracy,
    goal,
    goalPct,
    streak,
    task1,
    task2,
    task3,
    tasksDone,
    tasksTotal: 3,
    lead,
  };
}

module.exports = {
  localDateKey,
  getPracticeGoal,
  setPracticeGoal,
  bumpOpenStreak,
  markReviewPracticeCompleted,
  buildTodaySnapshot,
};
