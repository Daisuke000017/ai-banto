// 清掃の担当と割り当て（オーナーが決める）。プログラムだけで扱う（AIは使わない）
// - 担当の人は名前だけ預かる（電話番号・連絡先は預からない）
// - 知らせの文面はプログラムが作り、オーナーがコピーして自分で送る（自動では送らない）
// - 文面に入れるのは、日にち・部屋・時間だけ。ゲストの名前・人数・暗証番号は入れない
// - 勤怠・給与・備品は扱わない
import { roomLabel } from "./rooms.js";

export const CLEANER_NAME_MAX = 20;
export const MAX_CLEANERS = 20;

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const jpDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}月${d}日（${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
};

/** 担当の人の名前の入力を確かめる。正しければ整えた名前、だめならエラーの文 */
export function checkCleanerName(v) {
  if (typeof v !== "string") return { error: "担当の人の名前を入れてください" };
  // 制御文字と、見えない文字・文字の向きを変える記号は消す（同じ名前の二重登録や、文面の崩れを防ぐ）
  const name = v
    .replace(/[\p{Cc}\p{Cf}\ufe00-\ufe0f]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { error: "担当の人の名前を入れてください" };
  if ([...name].length > CLEANER_NAME_MAX) return { error: `名前は${CLEANER_NAME_MAX}文字までです` };
  return { name };
}

/** 同じ人かどうかを比べるための形（全角・半角、大文字・小文字をそろえる） */
export const cleanerNameKey = (name) => name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * 割り当ての入力を確かめる。
 * @param body {reservation_id, cleaner_id}（cleaner_id が null なら「担当なし」に戻す）
 * @param items 今の清掃の日（cleaningDays の items）。ここに出ている日だけ割り当てられる
 * @param cleaners 担当の人の一覧（{id, name, active}）
 * @returns {{values: {reservation_id, date, room, cleaner_id}}|{error}}
 */
export function checkAssignment(body, { items = [], cleaners = [] } = {}) {
  const v = body ?? {};
  if (typeof v.reservation_id !== "string") return { error: "清掃の日を選び直してください" };
  const item = items.find((i) => i.reservation_id === v.reservation_id);
  if (!item) return { error: "この清掃の日は、もう一覧にありません。画面を読み直してください" };
  const base = { reservation_id: item.reservation_id, date: item.date, room: item.room ?? null };
  if (v.cleaner_id === null) return { values: { ...base, cleaner_id: null } };
  if (!Number.isInteger(v.cleaner_id)) return { error: "担当の人を選び直してください" };
  const c = cleaners.find((x) => x.id === v.cleaner_id);
  if (!c) return { error: "担当の人が見つかりません。画面を読み直してください" };
  if (!c.active) return { error: `「${c.name}」さんは止めているので選べません` };
  return { values: { ...base, cleaner_id: c.id } };
}

/**
 * 清掃の日に、担当の人と知らせの文面を付ける。
 * - 割り当てた日・部屋と、いまの清掃の日・部屋がちがう（予約の出る日か部屋が変わった）ときは、
 *   担当なしに戻して reassign を立てる（reassign_reason は "date" か "room"）
 * - 同じ日に同じ人が2部屋以上なら same_day に部屋の数を入れる（時間が足りるか、オーナーに確かめてもらう）
 * @returns items（元の項目に cleaner_id, cleaner_name, cleaner_active, reassign, reassign_reason, same_day, message を足したもの）
 */
export function withAssignments(items, assignments, cleaners, { window, roomList = [], innName = "" } = {}) {
  const byRes = new Map(assignments.map((a) => [a.reservation_id, a]));
  const byId = new Map(cleaners.map((c) => [c.id, c]));
  const out = items.map((i) => {
    const a = byRes.get(i.reservation_id);
    const c = a ? byId.get(a.cleaner_id) : null;
    const reason = !(a && c) ? null : a.date !== i.date ? "date" : (a.room ?? null) !== (i.room ?? null) ? "room" : null;
    const ok = Boolean(a && c && !reason);
    return {
      ...i,
      cleaner_id: ok ? c.id : null,
      cleaner_name: ok ? c.name : null,
      cleaner_active: ok ? c.active : null,
      reassign: Boolean(reason),
      reassign_reason: reason,
    };
  });
  // 同じ日・同じ人の部屋
  const groups = new Map();
  for (const i of out) {
    if (i.cleaner_id == null) continue;
    const k = `${i.date}|${i.cleaner_id}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return out.map((i) => {
    if (i.cleaner_id == null) return { ...i, same_day: 0, message: null };
    // 止めた人あての文面は作らない（担当を替えてもらう）
    if (!i.cleaner_active) return { ...i, same_day: 0, message: null };
    const same = groups.get(`${i.date}|${i.cleaner_id}`);
    return {
      ...i,
      same_day: same.length > 1 ? same.length : 0,
      message: cleanerMessage({ name: i.cleaner_name, date: i.date, jobs: same, window, roomList, innName }),
    };
  });
}

/** その人のその日の仕事をまとめた、知らせの文面（オーナーがコピーして送る） */
export function cleanerMessage({ name, date, jobs, window, roomList = [], innName = "" }) {
  const w = window ?? { checkout: "10:00", checkin: "15:00" };
  const lines = [`${name}さん`, "", "清掃のお願いです。", "", `日にち：${jpDate(date)}`];
  for (const j of jobs) {
    const room = j.room ? roomLabel(roomList, j.room) : "部屋はあとで知らせます";
    const time = j.turnover
      ? `${w.checkout}〜${w.checkin}のあいだ（この日、次のお客様がチェックインします）`
      : `${w.checkout}以降（この日、この部屋のチェックインはありません）`;
    lines.push(jobs.length > 1 ? `・${room}：${time}` : `部屋：${room}`);
    if (jobs.length === 1) lines.push(`時間：${time}`);
  }
  if (jobs.length > 1) lines.push("", `この日は${jobs.length}部屋です。時間が足りないときは、早めに教えてください。`);
  lines.push("", "よろしくお願いします。");
  if (innName) lines.push(innName);
  return lines.join("\n");
}

/**
 * 宿泊カレンダーのチェックアウトに、清掃の担当を付ける（清掃の画面と同じ決まり）。
 * - 割り当てた日・部屋が、いまのチェックアウトの日・部屋と同じときだけ「担当あり」
 * - cleaner_name：担当の名前（なければ null）。cleaner_active：その人が止めた人なら false
 * cal は stayCalendar の結果。元の cal は書きかえない
 */
export function markCleaners(cal, assignments, cleaners) {
  const byRes = new Map(assignments.map((a) => [a.reservation_id, a]));
  const byId = new Map(cleaners.map((c) => [c.id, c]));
  const mark = (r) => {
    const a = byRes.get(r.reservation_id);
    const c = a ? byId.get(a.cleaner_id) : null;
    const ok = Boolean(a && c && a.date === r.checkout_date && (a.room ?? null) === (r.room ?? null));
    return { ...r, cleaner_name: ok ? c.name : null, cleaner_active: ok ? c.active : null };
  };
  return { ...cal, days: cal.days.map((d) => ({ ...d, departures: d.departures.map(mark) })) };
}
