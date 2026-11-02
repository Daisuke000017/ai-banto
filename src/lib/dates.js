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
