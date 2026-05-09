/**
 * 统一按 Asia/Shanghai（北京时间）解析、展示接口返回的 ISO / timestamptz 字符串。
 * 避免 `new Date(iso).getHours()` 随设备时区偏移导致与教务口径不一致。
 */

const TZ = "Asia/Shanghai";

function partsMap(d) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const m = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return m;
}

/** YYYY-MM-DD HH:mm[:ss] */
function formatBeijingDateTime(value, withSeconds = false) {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const s = String(value).trim();
    return s.length ? s.replace("T", " ").slice(0, withSeconds ? 19 : 16) : "";
  }
  try {
    const p = partsMap(d);
    const base = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    return withSeconds ? `${base}:${p.second || "00"}` : base;
  } catch (_) {
    return String(value).replace("T", " ").slice(0, withSeconds ? 19 : 16);
  }
}

function formatBeijingDateOnly(value) {
  const s = formatBeijingDateTime(value, false);
  return s ? s.slice(0, 10) : "";
}

function formatBeijingRange(startIso, endIso) {
  if (!startIso || !endIso) return "";
  return `${formatBeijingDateTime(startIso)} ～ ${formatBeijingDateTime(endIso)}`;
}

/** MM/DD（北京日历） */
function formatBeijingMonthDaySlash(value) {
  const s = formatBeijingDateTime(value, false);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return "";
  return `${m[2]}/${m[3]}`;
}

/** 与首页 hero 一致的北京「当天」日历键 YYYY-MM-DD */
function beijingCalendarDateKey(d = new Date()) {
  return formatBeijingDateOnly(d);
}

/**
 * datetime-local 用：把服务端 ISO 转成「北京墙钟」的 YYYY-MM-DDTHH:mm
 */
function toBeijingDateTimeInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const p = {};
    for (const x of fmt.formatToParts(d)) {
      if (x.type !== "literal") p[x.type] = x.value;
    }
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch (_) {
    return "";
  }
}

/**
 * 把 datetime-local 的字符串按「北京时区」解析为 Date（再 toISOString 给服务端）
 */
function parseBeijingDateTimeInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || "").trim());
  if (!m) return new Date(NaN);
  const isoStr = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`;
  return new Date(isoStr);
}

function beijingNowDateTimeLocalValue() {
  return toBeijingDateTimeInput(new Date().toISOString());
}

module.exports = {
  formatBeijingDateTime,
  formatBeijingDateOnly,
  formatBeijingRange,
  formatBeijingMonthDaySlash,
  beijingCalendarDateKey,
  toBeijingDateTimeInput,
  parseBeijingDateTimeInput,
  beijingNowDateTimeLocalValue,
};
