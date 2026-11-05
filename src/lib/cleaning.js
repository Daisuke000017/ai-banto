// 清掃が必要な日（M18）。プログラムだけで数える（AIは使わない）
// - 取り消していない予約の「チェックアウトの日」を、部屋ごとに清掃の日として並べる
// - 同じ部屋に、同じ日のチェックインがあれば「入れ替え」：チェックアウト〜チェックインの間に清掃する
// - 部屋が決まっていない予約（予約メールから入れたもの）は「部屋が決まっていません」と出す
// - 見るだけ。割り当て・通知・勤怠・給与・備品は扱わない
import { addDays, parseDate } from "./dates.js";
import { DEFAULT_ROOMS, roomCodes } from "./rooms.js";

export const CLEANING_DAYS = 21; // 今日から3週間
export const DEFAULT_CHECKOUT_TIME = "10:00";
export const DEFAULT_CHECKIN_TIME = "15:00";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 宿の設定から清掃できる時間（チェックアウト〜チェックイン）を読む。形が違えば決まった値にする */
export function cleaningWindow(inn = {}) {
  const out = TIME_RE.test(inn.cleaning_checkout_time ?? "") ? inn.cleaning_checkout_time : DEFAULT_CHECKOUT_TIME;
  const inT = TIME_RE.test(inn.cleaning_checkin_time ?? "") ? inn.cleaning_checkin_time : DEFAULT_CHECKIN_TIME;
  return { checkout: out, checkin: inT };
}


/**
 * 今日から days 日のあいだの清掃の日を返す（今日を含む）
 * items：{ date, room, reservation_id, ota, turnover, next_reservation_id, check_room }
 * - turnover：同じ部屋に同じ日のチェックインがある（間の時間に清掃）
 * - check_room：部屋が決まっていない予約がからみ、同じ日にチェックインがある（入れ替えか確かめる）
 */
export function cleaningDays(reservations, today, inn = {}, days = CLEANING_DAYS, rooms = inn?.room_list?.length ? inn.room_list : DEFAULT_ROOMS) {
  parseDate(today);
  const list = roomCodes(rooms);
  const roomOf = (r) => (list.includes(r.room) ? r.room : null);
  const roomOrder = (room) => (room == null ? list.length : list.indexOf(room));
  const to = addDays(today, days - 1);
  const live = reservations.filter((r) => r.status !== "cancelled");
  const items = [];
  for (const r of live) {
    const date = r.checkout_date;
    if (date < today || date > to) continue;
    const room = roomOf(r);
    const arriving = live.filter((x) => x.id !== r.id && x.checkin_date === date);
    const next = room ? arriving.find((x) => roomOf(x) === room) : undefined;
    const unknownMix = arriving.some((x) => !room || !roomOf(x));
    items.push({
      date,
      room,
      reservation_id: r.id,
      ota: r.ota,
      turnover: Boolean(next),
      next_reservation_id: next?.id ?? null,
      check_room: !next && unknownMix,
    });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : roomOrder(a.room) - roomOrder(b.room)));
  return {
    today,
    from: today,
    to,
    days,
    window: cleaningWindow(inn),
    items,
    how: "取り消していない予約のチェックアウトの日を、部屋ごとに並べています。同じ部屋に同じ日のチェックインがある日は「入れ替え」です。予約メールで変更・キャンセルを台帳に入れると、ここも変わります",
  };
}
