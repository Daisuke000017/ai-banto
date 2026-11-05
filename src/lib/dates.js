// 日付の計算（すべて "YYYY-MM-DD" の文字列で扱う。時差の影響を受けないよう UTC で計算する）

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) {
    throw new Error(`日付の形が違います（YYYY-MM-DD）: ${s}`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error(`ありえない日付です: ${s}`);
  }
  return d;
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

export function monthOf(s) {
  parseDate(s);
  return s.slice(0, 7);
}

/** 日本時間の「今日」。デモでは DEMO_TODAY で固定する */
export function todayJst(demoToday) {
  if (demoToday) {
    parseDate(demoToday);
    return demoToday;
  }
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 祝日（内閣府の「国民の祝日」。振替休日・国民の休日を含む）。バスの「土日祝」の判定に使う。
// 2027年の春分・秋分の日は、前の年の2月に正式に決まる（ここは計算上の日）
const JP_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29",
  "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11",
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22",
  "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11",
  "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
]);

/** 祝日の表にある年（この外の年は、休みかどうかを言わない） */
export const HOLIDAY_YEARS = [2026, 2027];

/** 国民の祝日（振替休日・国民の休日を含む）か。値付けの助言（連休を探す）で使う */
export function isHoliday(s) {
  parseDate(s);
  return JP_HOLIDAYS.has(s);
}

/** その日のバスの時刻の種類：weekday＝平日／sat＝土曜／sun_holiday＝日曜・祝日（土曜の祝日も祝日にする） */
export function dayKind(s) {
  const dow = parseDate(s).getUTCDay();
  if (dow === 0 || JP_HOLIDAYS.has(s)) return "sun_holiday";
  if (dow === 6) return "sat";
  return "weekday";
}
