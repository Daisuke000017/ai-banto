// 料金のレベル（経営企画・2026-11-06 社長決定）。ここはプログラムの部分（AIは使わない）
//
// 決めごと
// - レベル1〜4の金額はオーナーが決める（宿の設定）。番頭は金額を作らない。
// - はっきりした夜のレベルはプログラムが決める：年末年始・お盆＝レベル4、連休・オーナーが OK した行事の夜＝レベル3。
// - それ以外の夜は「グレー」。いったんレベル2にしておき、経営企画（AI）が変える夜だけを選ぶ（price-level-ai.js）。
// - 歯止め：①グレーの夜はレベル2から1段階まで（1〜3）②最低価格を割るレベルは選べない ③満室の夜は外す。
// - 「通常期」のような言葉はオーナーの画面の中だけで使う（ゲストに見せる値段の書き方は景品表示法に気をつける）。

import { addDays, parseDate } from "./dates.js";
import { eventNights, occupancy, rateList, takeHome } from "./pricing.js";
import { roomCodes } from "./rooms.js";

export const LEVEL_FROM_DAYS = 7; // 何日先から（直前は変えても間に合わない）
export const LEVEL_TO_DAYS = 90; // 何日先まで
export const BASE_LEVEL = 2; // グレーな夜の出発点
export const LEVELS = [1, 2, 3, 4];
export const LEVEL_NAME = { 1: "空きやすい日", 2: "ふだんの日", 3: "混む日", 4: "年末年始・お盆" };
export const TAKE_HOME_NIGHTS = 2; // 手取りの目安は「2泊したとき」で出す

const WEEK_JA = ["日", "月", "火", "水", "木", "金", "土"];
const jpDate = (s) => `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
const yen = (n) => `${Number(n).toLocaleString("en-US")}円`;
const round100 = (n) => Math.round(n / 100) * 100;

/** 年末年始（12/29〜1/3）・お盆（8/13〜8/16）の夜か。名前を返す */
export function peakName(night) {
  const md = night.slice(5);
  if (md >= "12-29" || md <= "01-03") return "年末年始";
  if (md >= "08-13" && md <= "08-16") return "お盆";
  return null;
}

/**
 * 宿の設定から、レベルごとの金額と、使えるかどうか。
 * @returns {{set: boolean, levels: {level, price, name, usable, why}[], problems: string[]}}
 */
export function levelTable(inn) {
  const minPrice = inn?.min_price == null ? null : Number(inn.min_price);
  const levels = LEVELS.map((level) => {
    const v = inn?.[`price_l${level}`];
    const price = v == null ? null : Number(v);
    let why = null;
    if (price == null) why = "金額が未設定です";
    else if (minPrice != null && price < minPrice) why = `最低価格（${yen(minPrice)}）より安いので選べません`;
    return { level, price, name: LEVEL_NAME[level], usable: why == null, why };
  });
  const problems = [];
  if (levels.some((x) => x.price == null)) problems.push("料金のレベルが未設定です。宿の設定でレベル1〜4の金額を入れてください");
  if (minPrice == null) problems.push("最低価格が未設定です（レベル1が最低価格を割っていないか確かめられません）");
  return { set: levels.every((x) => x.price != null), levels, problems };
}

/** そのレベルで2泊したときの、1泊あたりの手取り（予約サイトごと）。清掃費が無ければ null */
export function levelTakeHome(price, rates, cleaning) {
  if (price == null || cleaning == null) return null;
  return rates.map((x) => ({ ota: x.ota, name: x.name, value: round100(takeHome({ price, nights: TAKE_HOME_NIGHTS, rate: x.rate, cleaning })) }));
}

/**
 * 今日から7〜90日先の夜ごとのレベル（プログラムの部分）。
 * @param {object} p
 * @param {string} p.today
 * @param {object} p.inn 宿の設定（price_l1〜4・min_price・cleaning_fee・room_list/rooms）
 * @param {object[]} p.reservations 予約
 * @param {object[]} [p.events] オーナーが OK した行事の候補
 * @param {object[]} [p.lines] 予約サイトの明細（手取りの目安に使う）
 */
export function planLevels({ today, inn, reservations, events = [], lines = [] }) {
  const rooms = Array.isArray(inn?.room_list) && inn.room_list.length ? roomCodes(inn.room_list) : roomCodes(Number(inn?.rooms ?? 1));
  const table = levelTable(inn);
  const from = addDays(today, LEVEL_FROM_DAYS);
  const to = addDays(today, LEVEL_TO_DAYS);

  // 連休・行事の夜（eventNights は 7〜90日先を返す）
  const busy = new Map();
  for (const ev of eventNights(today, events)) {
    for (const n of ev.nights) if (!busy.has(n)) busy.set(n, ev);
  }

  const nights = [];
  let full = 0;
  for (let n = from; n <= to; n = addDays(n, 1)) {
    const occ = occupancy(reservations, n, rooms);
    if (occ.free === 0) {
      full += 1;
      continue;
    }
    const dow = parseDate(n).getUTCDay();
    const base = { night: n, label: `${jpDate(n)}（${WEEK_JA[dow]}）`, dow, free: occ.free, taken: occ.taken, rooms: rooms.length };
    const peak = peakName(n);
    const ev = busy.get(n);
    if (peak) nights.push({ ...base, level: 4, gray: false, by: "program", reason: `${peak}の夜` });
    else if (ev) nights.push({ ...base, level: 3, gray: false, by: "program", reason: ev.title, event_id: ev.id });
    else nights.push({ ...base, level: BASE_LEVEL, gray: true, by: "program", reason: "はっきりした理由が無い夜（いったんレベル2）" });
  }

  const rates = rateList(lines);
  const cleaning = inn?.cleaning_fee == null ? null : Number(inn.cleaning_fee);
  return {
    today,
    from,
    to,
    full_nights: full, // 満室で外した夜の数
    table,
    take_home: table.levels.map((x) => ({ level: x.level, values: levelTakeHome(x.price, rates, cleaning) })),
    nights,
  };
}

/** グレーな夜に選んでよいレベル（歯止め：レベル2から1段階まで・最低価格を割らない） */
export function allowedGrayLevels(table) {
  return [BASE_LEVEL - 1, BASE_LEVEL, BASE_LEVEL + 1].filter((lv) => table.levels.find((x) => x.level === lv)?.usable);
}

/**
 * プログラムの案に、経営企画（AI）の変更を重ねる。変えてよいのはグレーな夜だけ（ほかは無視する）。
 * @param {object} plan planLevels の結果
 * @param {{night, level, reason}[]} changes
 */
export function applyChanges(plan, changes) {
  const allowed = new Set(allowedGrayLevels(plan.table));
  const byNight = new Map(changes.map((c) => [c.night, c]));
  return plan.nights.map((n) => {
    const c = byNight.get(n.night);
    if (!n.gray || !c || !allowed.has(c.level)) return n;
    return { ...n, level: c.level, by: "ai", reason: c.reason };
  });
}

/** レベルごとの夜の数（画面の上の1行） */
export function levelCounts(nights) {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const n of nights) out[n.level] += 1;
  return out;
}
