// 宿泊カレンダー（M21）。プログラムだけで数える（AIは使わない）
// - 1か月分、日ごとに「どの部屋に泊まっているか」「チェックイン・チェックアウトがあるか」を並べる
// - 取り消した予約は入れない。部屋が決まっていない予約（予約メールから入れたもの）は「部屋未定」
// - 同じ部屋・同じ夜に2つの予約が重なっていたら、知らせる（台帳の間違いの見つけ役）
// - 見るだけ。宿泊者の名前は受け取っても出さない（決まった欄だけを写す）
import { addDays, daysBetween, parseDate } from "./dates.js";
import { DEFAULT_ROOMS, roomCodes } from "./rooms.js";

export const ROOMS = DEFAULT_ROOMS;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** その月の日付（"YYYY-MM-DD"）を1日から順に返す */
export function daysOfMonth(month) {
  if (!MONTH_RE.test(month ?? "")) throw new Error(`月の形が違います（YYYY-MM）: ${month}`);
  const out = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

// 画面に出してよい欄だけを写す（名前などは写さない）
function brief(r, rooms) {
  return {
    reservation_id: r.id,
    room: rooms.includes(r.room) ? r.room : null,
    ota: r.ota ?? null,
    checkin_date: r.checkin_date,
    checkout_date: r.checkout_date,
    nights: daysBetween(r.checkin_date, r.checkout_date),
    adults: num(r.adults),
    children: num(r.children),
    infants: num(r.infants),
  };
}

/**
 * month の宿泊カレンダーを返す
 * days[]：{ date, weekday, is_today, stays[], departures[], overlap_rooms[] }
 * - stays：その夜に泊まっている予約（arrives＝この日にチェックイン、night_no＝何泊目）
 * - departures：この日にチェックアウトする予約（この日は清掃の日）
 * - overlap_rooms：同じ部屋に2つ以上の予約が重なっている部屋
 * rooms：宿の部屋の記号の並び（無ければ A・B）
 */
export function stayCalendar(reservations, month, today, rooms = ROOMS) {
  parseDate(today);
  const list = roomCodes(rooms);
  const order = (room) => (room == null ? list.length : list.indexOf(room));
  const dates = daysOfMonth(month);
  const live = reservations
    .filter((r) => r.status !== "cancelled")
    .filter((r) => {
      try {
        parseDate(r.checkin_date);
        parseDate(r.checkout_date);
        return r.checkin_date < r.checkout_date;
      } catch {
        return false;
      }
    })
    .map((r) => brief(r, list));

  const nights = Object.fromEntries([...list.map((c) => [c, 0]), ["unknown", 0]]);
  const touched = new Set();
  const overlaps = [];
  const days = dates.map((date) => {
    const stays = live
      .filter((r) => r.checkin_date <= date && date < r.checkout_date)
      .map((r) => ({ ...r, arrives: r.checkin_date === date, night_no: daysBetween(r.checkin_date, date) + 1 }))
      .sort((a, b) => order(a.room) - order(b.room) || a.reservation_id - b.reservation_id);
    const departures = live
      .filter((r) => r.checkout_date === date)
      .sort((a, b) => order(a.room) - order(b.room) || a.reservation_id - b.reservation_id);
    for (const s of stays) {
      nights[s.room ?? "unknown"] += 1;
      touched.add(s.reservation_id);
    }
    for (const r of departures) touched.add(r.reservation_id);
    const overlap_rooms = list.filter((room) => stays.filter((s) => s.room === room).length > 1);
    if (overlap_rooms.length) overlaps.push({ date, rooms: overlap_rooms });
    return { date, weekday: parseDate(date).getUTCDay(), is_today: date === today, stays, departures, overlap_rooms };
  });

  const roomNights = dates.length * list.length;
  const booked = list.reduce((n, c) => n + nights[c], 0);
  return {
    month,
    today,
    from: dates[0],
    to: dates[dates.length - 1],
    first_weekday: days[0].weekday,
    rooms: list,
    days,
    summary: {
      reservations: touched.size,
      nights,
      free_room_nights: Math.max(0, roomNights - booked - nights.unknown),
      room_nights: roomNights,
      departures: days.reduce((n, d) => n + d.departures.length, 0),
    },
    overlaps,
    how: "取り消していない予約を、泊まる夜ごとに並べています（チェックアウトの日は泊まりに入れず、清掃の日として出します）。部屋が決まっていない予約は「部屋未定」です。予約メールで変更・キャンセルを台帳に入れると、ここも変わります",
  };
}

