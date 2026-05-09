/** 统一按 Asia/Shanghai 展示/解析，避免浏览器本地时区与 ISO 截断导致的偏差 */

const TZ = "Asia/Shanghai";

function partsMap(d: Date): Record<string, string> {
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
  const m: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return m;
}

export function formatBeijingDateTime(
  value: string | Date | null | undefined,
  withSeconds = false
): string {
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
  } catch {
    return String(value).replace("T", " ").slice(0, withSeconds ? 19 : 16);
  }
}

export function formatBeijingDateOnly(value: string | Date | null | undefined): string {
  const s = formatBeijingDateTime(value, false);
  return s ? s.slice(0, 10) : "";
}

export function formatBeijingRange(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "";
  return `${formatBeijingDateTime(startIso)} ～ ${formatBeijingDateTime(endIso)}`;
}

export function formatBeijingMonthDaySlash(value: string | Date | null | undefined): string {
  const s = formatBeijingDateTime(value, false);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return "";
  return `${m[2]}/${m[3]}`;
}

export function beijingCalendarDateKey(d: Date = new Date()): string {
  return formatBeijingDateOnly(d);
}

export function toBeijingDateTimeInput(iso: string): string {
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
    const p: Record<string, string> = {};
    for (const x of fmt.formatToParts(d)) {
      if (x.type !== "literal") p[x.type] = x.value;
    }
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return "";
  }
}

export function parseBeijingDateTimeInput(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || "").trim());
  if (!m) return new Date(NaN);
  const isoStr = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`;
  return new Date(isoStr);
}

export function beijingNowDateTimeLocalValue(): string {
  return toBeijingDateTimeInput(new Date().toISOString());
}
