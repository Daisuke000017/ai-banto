// 値付けの助言（経営企画・2026-11-05 社長決定）。AIは使わない。数字も文も、プログラムが決まった形で作る。
//
// 決めごと
// - 数字はプログラムが数える。値段を決めて予約サイトに入れるのはオーナー。番頭は帳簿も予約も変えない。
// - 「通常◯円→今だけ◯円」「売上＋◯％」のような書き方はしない。よその宿のデータは使わない。
// - 行事は、公式のページで日付を確かめたものだけを表に入れ、出典を残す。確かめられないものは入れない。
// - 手取り＝売上（宿泊税を除く）−予約サイトの手数料−清掃費。手数料は明細の実際の額、無ければ明細から出した割合で見積もる。

import { addDays, daysBetween, isHoliday, HOLIDAY_YEARS, parseDate } from "./dates.js";
import { feeOf, feeRates, linesIndex, lodgingSales } from "./kpis.js";
import { ROOMS } from "./calendar.js";

export const EVENT_FROM_DAYS = 7; // 何日先から（直前は値段を変えても間に合わない）
export const EVENT_TO_DAYS = 90; // 何日先まで
export const GAP_TO_DAYS = 90;
export const MAX_GAPS = 5;

/** 出典（2026-11-05 に公式のページで確かめた） */
export const SOURCES = Object.freeze({
  holidays: { name: "内閣府「国民の祝日について」", url: "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html" },
  nenmatsu: { name: "行政機関の休日に関する法律 第1条（e-Gov法令検索）", url: "https://laws.e-gov.go.jp/law/363AC0000000091" },
  aotai: { name: "宮崎市観光協会「第40回 青島太平洋マラソン2026」", url: "https://www.miyazaki-city.tourism.or.jp/event/12331" },
});

/** 宮崎の行事（公式で確かめたものだけ）。nights＝泊まる夜（大会の前の晩など） */
export const EVENTS = Object.freeze([
  { id: "aotai-2026", name: "第40回 青島太平洋マラソン", day: "2026-12-13", nights: ["2026-12-12"], note: "前の晩", source: SOURCES.aotai },
]);

const OTA_JA = { airbnb: "Airbnb", booking: "Booking.com", rakuten: "楽天トラベル", direct: "直接" };
const WEEK_JA = ["日", "月", "火", "水", "木", "金", "土"];
const isConfirmed = (r) => r.status === "confirmed";
const jpDate = (s) => `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
const yen = (n) => `${Number(n).toLocaleString("en-US")}円`;
const fact = (label, value, calc = false) => (calc ? { label, value: String(value), calc: true } : { label, value: String(value) });
const round100 = (n) => Math.round(n / 100) * 100;
const nightsOfRes = (r) => daysBetween(r.checkin_date, r.checkout_date);
const covers = (r, night) => r.checkin_date <= night && night < r.checkout_date;

/** 休みの日か（土日・国民の祝日・年末年始 12/29〜1/3）。祝日の表が無い年は null（分からない） */
export function isDayOff(d) {
  if (!HOLIDAY_YEARS.includes(Number(d.slice(0, 4)))) return null;
  const dow = parseDate(d).getUTCDay();
  const md = d.slice(5);
  return dow === 0 || dow === 6 || isHoliday(d) || md >= "12-29" || md <= "01-03";
}

/** from〜to（両端を含む）にかかる、3日以上続く休み。[{start, end, days}] */
export function longWeekends(from, to) {
  const out = [];
  let start = null;
  // 期間の前後に続く休みも含めて数える（連休の途中から期間に入る場合）
  let d = addDays(from, -10);
  const last = addDays(to, 10);
  for (; d <= last; d = addDays(d, 1)) {
    const off = isDayOff(d);
    if (off) {
      if (!start) start = d;
    } else {
      if (start && daysBetween(start, d) >= 3) out.push({ start, end: addDays(d, -1), days: daysBetween(start, d) });
      start = null;
    }
  }
  return out.filter((b) => b.end >= from && b.start <= to);
}

function blockName(b) {
  const range = `${jpDate(b.start)}〜${jpDate(b.end)}`;
  const nenmatsu = [...Array(b.days).keys()].some((i) => {
    const md = addDays(b.start, i).slice(5);
    return md >= "12-29" || md <= "01-03";
  });
  return nenmatsu ? `年末年始の${b.days}連休（${range}）` : `${b.days}連休（${range}）`;
}

/**
 * 今日から7〜90日先の「高く売れそうな夜」。連休（最後の日を除く夜）と、表にある行事の夜。
 * @returns {{id, name, title, nights: string[], sources: object[]}[]}
 */
export function eventNights(today) {
  const from = addDays(today, EVENT_FROM_DAYS);
  const to = addDays(today, EVENT_TO_DAYS);
  const inRange = (n) => n >= from && n <= to;
  const out = [];
  for (const b of longWeekends(from, to)) {
    const nights = [];
    for (let d = b.start; d < b.end; d = addDays(d, 1)) if (inRange(d)) nights.push(d);
    if (!nights.length) continue;
    const name = blockName(b);
    const sources = name.startsWith("年末年始") ? [SOURCES.holidays, SOURCES.nenmatsu] : [SOURCES.holidays];
    out.push({ id: `renkyu-${b.start}`, name, title: `${name}の夜`, nights, sources });
  }
  for (const e of EVENTS) {
    const nights = e.nights.filter(inRange);
    if (!nights.length) continue;
    const day = `${jpDate(e.day)}（${WEEK_JA[parseDate(e.day).getUTCDay()]}）`;
    out.push({
      id: e.id,
      name: `${e.name}（大会は${day}）の${e.note}`,
      title: `${e.name}の${e.note}（${nights.map(jpDate).join("・")}）`,
      nights,
      sources: [e.source],
    });
  }
  return out.sort((a, b) => a.nights[0].localeCompare(b.nights[0]));
}

/** ある夜の部屋のふさがり方。部屋が決まっていない予約は「どこか1部屋」として数える */
export function occupancy(reservations, night, rooms) {
  const known = new Set();
  const ids = [];
  let unknown = 0;
  for (const r of reservations) {
    if (!isConfirmed(r) || !covers(r, night)) continue;
    ids.push(r.id);
    if (ROOMS.includes(r.room)) known.add(r.room);
    else unknown += 1;
  }
  const names = ROOMS.slice(0, rooms);
  const free = Math.max(0, rooms - known.size - unknown);
  return {
    night,
    taken: known.size + unknown,
    free,
    free_rooms: unknown ? null : names.filter((x) => !known.has(x)), // 部屋未定の予約があると、どの部屋かは言えない
    reservation_ids: ids,
  };
}

/** 1泊あたりの手取り（四捨五入前）＝（1泊の値段×泊数×（1−手数料の割合）−清掃費）÷泊数 */
export function takeHome({ price, nights, rate, cleaning }) {
  return (price * nights * (1 - rate) - cleaning) / nights;
}

/** これまでに泊まり終えた予約の、1部屋1泊あたりの平均（宿泊税を除く）。千円単位 */
export function guidePrice(reservations, today) {
  let sales = 0;
  let nights = 0;
  let count = 0;
  for (const r of reservations) {
    if (!isConfirmed(r) || r.checkout_date > today) continue;
    sales += lodgingSales(r);
    nights += nightsOfRes(r);
    count += 1;
  }
  if (!nights) return null;
  return { price: Math.round(sales / nights / 1000) * 1000, reservations: count, nights };
}

/** 予約サイトごとの手数料の割合（明細から）。直接は0 */
export function rateList(lines) {
  const rates = feeRates(lines);
  return [["direct", 0], ...Object.entries(rates).sort((a, b) => a[1] - b[1])].map(([ota, rate]) => ({ ota, name: OTA_JA[ota] ?? ota, rate }));
}

/** 「直接 約9,500円・Airbnb 約9,100円」 */
function takeHomeText(price, nights, rates, cleaning) {
  return rates.map((x) => {
    const v = round100(takeHome({ price, nights, rate: x.rate, cleaning }));
    return v > 0 ? `${x.name} 約${yen(v)}` : `${x.name} 手元に残らない`;
  }).join("・");
}

/**
 * 180日のペース。4月1日から今日までの「泊まった日」の割合が続いたら、年度末に何日になるか。
 * @param {object} counter dayCounter の結果
 */
export function pacePlan(counter, today) {
  if (!counter) return null;
  const fy = Number(counter.fiscal_year);
  const start = `${fy}-04-01`;
  const yearDays = daysBetween(start, `${fy + 1}-04-01`);
  const elapsed = daysBetween(start, today);
  const rate = elapsed > 0 ? counter.used_days / elapsed : 0;
  const projected = Math.max(counter.total_days, Math.round(rate * yearDays));
  const limit = counter.limit;
  let reach = null;
  let reachText;
  if (counter.total_days >= limit) {
    reachText = `予約済みの日を入れると、もう上限（${limit}日）に届いています`;
  } else if (rate > 0 && Math.ceil(limit / rate) <= yearDays) {
    reach = addDays(start, Math.ceil(limit / rate) - 1);
    reachText = `今のペースだと、${Number(reach.slice(5, 7))}月ごろに上限（${limit}日）に届きます`;
  } else {
    reachText = `今のペースだと、年度末（3月31日）までに約${projected}日。上限（${limit}日）には届きません`;
  }
  const keep = projected >= limit;
  return {
    fiscal_year: counter.fiscal_year,
    used_days: counter.used_days,
    total_days: counter.total_days,
    elapsed_days: elapsed,
    per_month: Math.round(rate * 30 * 10) / 10, // 30日あたり何日泊まっているか
    projected_days: projected,
    limit,
    reach_date: reach,
    reach_text: reachText,
    policy: keep ? "keep" : "fill",
    policy_label: keep ? "高い日に枠を残す" : "埋める優先",
    policy_text: keep
      ? "上限に届くペースです。安い日を埋めるより、連休・行事など高く売れる夜に日数を残すほうが、手元に残ります"
      : "上限には届かないペースです。空いている夜を埋めることを先に考えます",
  };
}

/**
 * その月の「1泊あたりの手取り」＝（売上−手数料−清掃費）÷泊数。
 * 清掃費は1回の予約に1回。月をまたぐ予約は、その月の泊数の分だけ配る。
 * 手数料が分からない予約（明細が無く、割合も出せない）は外し、外した件数を出す。
 * @param {object} view kpiView / monthNumbers の結果（rows を使う）
 */
export function monthTakeHome(view, reservations, cleaningFee) {
  if (cleaningFee == null) return { available: false, reason: "清掃費が未設定です。宿の設定に入れると計算できます" };
  const byId = new Map(reservations.map((r) => [r.id, r]));
  const stays = (view.rows ?? []).filter((x) => x.kind === "stay");
  const known = stays.filter((x) => x.fee != null);
  const excluded = stays.length - known.length;
  if (!known.length) {
    return { available: false, reason: stays.length ? "手数料が分かる予約がありません（明細を読み込むと計算できます）" : "この月に泊まる予約がありません", excluded };
  }
  let sales = 0;
  let fee = 0;
  let cleaning = 0;
  let nights = 0;
  for (const x of known) {
    const r = byId.get(x.id);
    const total = r ? nightsOfRes(r) : x.nights;
    sales += x.amount;
    fee += x.fee;
    cleaning += Math.round((cleaningFee * x.nights) / total);
    nights += x.nights;
  }
  const net = sales - fee - cleaning;
  return {
    available: true,
    stays: known.length,
    nights,
    sales,
    fee,
    cleaning,
    net,
    per_night: Math.round(net / nights),
    excluded, // 手数料が分からず外した予約の数
    estimate: known.some((x) => x.fee_basis === "estimate") || (view.sales_upcoming ?? 0) > 0,
  };
}

/** 予約と予約のあいだに1泊だけ空いた夜（部屋ごと）。今日より後〜90日先 */
export function findGaps(reservations, today, rooms) {
  const to = addDays(today, GAP_TO_DAYS);
  const conf = reservations.filter(isConfirmed);
  const out = [];
  for (const room of ROOMS.slice(0, rooms)) {
    const list = conf.filter((r) => r.room === room).sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (daysBetween(a.checkout_date, b.checkin_date) !== 1) continue;
      const night = a.checkout_date;
      if (night <= today || night > to) continue;
      // その夜にかかる予約が、ほかにある（部屋未定・同じ部屋）なら、空いているとは言えない
      if (conf.some((r) => covers(r, night) && (r.room === room || !ROOMS.includes(r.room)))) continue;
      out.push({ room, night, before: a, after: b });
    }
  }
  return out.sort((x, y) => x.night.localeCompare(y.night) || x.room.localeCompare(y.room)).slice(0, MAX_GAPS);
}

const OWNER_FACT = fact("決めるのは", "値段と条件を決めて予約サイトに入れるのはオーナーです（番頭は予約も帳簿も変えません）");

/**
 * 決裁箱に置く「値付け」の知らせ。
 * @param {object} p
 * @param {string} p.today
 * @param {object} p.inn {rooms, cleaning_fee, min_price}
 * @param {object[]} p.reservations 予約（room・amount_gross・status などを含む。名前は読まない）
 * @param {object[]} p.lines 予約サイトの明細の行
 * @param {object} p.counter dayCounter の結果
 */
export function pricingItems({ today, inn, reservations, lines = [], counter }) {
  const rooms = Number(inn?.rooms ?? 1);
  const cleaning = inn?.cleaning_fee == null ? null : Number(inn.cleaning_fee);
  const minPrice = inn?.min_price == null ? null : Number(inn.min_price);
  const rates = rateList(lines);
  const guide = guidePrice(reservations, today);
  const pace = pacePlan(counter, today);
  const items = [];

  const priceFacts = (nights) => {
    const out = [];
    if (cleaning == null) {
      out.push(fact("手取りの目安", "清掃費が未設定なので出せません（宿の設定に入れると出ます）"));
      return out;
    }
    if (guide) {
      out.push(fact("手取りの目安", `1泊${yen(guide.price)}で${nights}泊なら、1泊あたり手元に ${takeHomeText(guide.price, nights, rates, cleaning)}（手数料と清掃費${yen(cleaning)}を引いた額）`, true));
      out.push(fact("目安の元", `これまでに泊まり終えた予約${guide.reservations}件（${guide.nights}泊）の1泊あたりの平均を、千円単位にした額です`));
    }
    if (minPrice != null) {
      out.push(fact("最低価格なら", `1泊${yen(minPrice)}で${nights}泊なら、1泊あたり手元に ${takeHomeText(minPrice, nights, rates, cleaning)}`, true));
    }
    return out;
  };

  // ① 上げどき：行事・連休の夜で、まだ空いている
  for (const ev of eventNights(today)) {
    const occ = ev.nights.map((n) => occupancy(reservations, n, rooms)).filter((o) => o.free > 0);
    if (!occ.length) continue;
    const roomsText = (o) => (o.free_rooms ? `${o.free}部屋（${o.free_rooms.join("・")}）` : `${o.free}部屋`);
    const facts = [
      fact("行事", ev.name),
      fact("空いている夜", occ.map((o) => `${jpDate(o.night)}：${roomsText(o)}`).join("／")),
      ...priceFacts(Math.min(occ.length, 3)),
    ];
    if (pace) facts.push(fact("180日の方針", `${pace.policy_label}：${pace.reach_text}`));
    if (occ.some((o) => o.taken > 0)) {
      facts.push(fact("180日の数え方", "もう1部屋に予約がある夜は、残りの部屋が埋まっても180日の日数は増えません"));
    }
    facts.push(fact("出典", ev.sources.map((s) => `${s.name} ${s.url}`).join("／")));
    facts.push(OWNER_FACT);
    items.push({
      ref_key: `price_event:${ev.id}`,
      kind: "price_event",
      level: "info",
      title: `上げどき：${ev.title}が、まだ空いています`,
      facts,
      target_id: null,
      link: "kpi",
      can_ok: true,
      review: { room: null, nights: occ.map((o) => o.night) },
      by: [["計算した", "program"]],
    });
  }

  // ② 1泊だけ空いた夜：連泊の条件をゆるめる・少し下げると埋まりやすい
  const eventSet = new Set(eventNights(today).flatMap((e) => e.nights));
  for (const g of findGaps(reservations, today, rooms)) {
    if (eventSet.has(g.night)) continue; // 上げどきの夜は、下げる話をしない
    const facts = [
      fact("部屋", g.room),
      fact("空いている夜", `${jpDate(g.night)}（1泊だけ）`),
      fact("前後の予約", `前：${g.before.id}（${OTA_JA[g.before.ota] ?? "予約サイト"}）が${jpDate(g.before.checkout_date)}に出発／後：${g.after.id}（${OTA_JA[g.after.ota] ?? "予約サイト"}）が${jpDate(g.after.checkin_date)}に到着`),
      fact("埋めるには", "連泊の条件（何泊から泊まれるか）をゆるめる・少し下げると埋まりやすい1泊です"),
      ...priceFacts(1),
    ];
    if (cleaning != null && minPrice != null && rates.every((x) => takeHome({ price: minPrice, nights: 1, rate: x.rate, cleaning }) <= 0)) {
      facts.push(fact("気をつける点", "最低価格で1泊だけだと、清掃費を引くと手元に残りません"));
    }
    if (pace) facts.push(fact("180日の方針", `${pace.policy_label}：${pace.policy_text}`));
    facts.push(OWNER_FACT);
    items.push({
      ref_key: `price_gap:${g.room}:${g.night}`,
      kind: "price_gap",
      level: "info",
      title: `${jpDate(g.night)}の部屋${g.room}が、予約と予約のあいだで1泊だけ空いています`,
      facts,
      target_id: null,
      link: "kpi",
      can_ok: true,
      review: { room: g.room, nights: [g.night] },
      by: [["計算した", "program"]],
    });
  }
  return items;
}

/** 「見直した／このまま」を押したときの、その夜のようす（あとで比べるために残す） */
export function reviewSnapshot(reservations, review, rooms) {
  const before = new Set();
  let free = 0;
  for (const n of review.nights ?? []) {
    const occ = occupancy(reservations, n, rooms);
    for (const id of occ.reservation_ids) before.add(id);
    if (review.room) free += occ.free_rooms ? (occ.free_rooms.includes(review.room) ? 1 : 0) : Math.min(1, occ.free);
    else free += occ.free;
  }
  return { before_ids: [...before], free_room_nights: free };
}

const CHOICE_JA = { reviewed: "見直した日", kept: "そのままの日" };

/**
 * 見直した日とそのままの日を比べる。押したあとに入った予約だけを「その後に埋まった」と数える。
 * @param {object[]} reviews price_reviews の行
 */
export function reviewCompare(reviews, reservations, lines, cleaningFee, rooms) {
  if (!reviews?.length) return { empty: true, note: "記録がたまると比べられます" };
  const rates = feeRates(lines);
  const idx = linesIndex(lines);
  const groups = {};
  for (const choice of ["reviewed", "kept"]) {
    groups[choice] = { choice, label: CHOICE_JA[choice], cards: 0, free_room_nights: 0, filled_room_nights: 0, take_home_nights: 0, take_home_sum: 0, unknown_fee: 0 };
  }
  for (const rv of reviews) {
    const g = groups[rv.choice];
    if (!g) continue;
    const nights = JSON.parse(rv.nights_json ?? "[]");
    const before = new Set(JSON.parse(rv.before_json ?? "[]"));
    g.cards += 1;
    g.free_room_nights += Number(rv.free_room_nights ?? 0);
    const added = reservations.filter((r) => isConfirmed(r) && !before.has(r.id) && nights.some((n) => covers(r, n)) && (!rv.room || r.room === rv.room));
    let filled = 0;
    for (const n of nights) filled += added.filter((r) => covers(r, n)).length;
    g.filled_room_nights += Math.min(filled, Number(rv.free_room_nights ?? 0));
    for (const r of added) {
      const f = feeOf(r, idx, rates);
      if (f.amount == null || cleaningFee == null) {
        g.unknown_fee += 1;
        continue;
      }
      const n = nightsOfRes(r);
      g.take_home_sum += lodgingSales(r) - f.amount - Number(cleaningFee);
      g.take_home_nights += n;
    }
  }
  const out = Object.values(groups).map((g) => ({
    choice: g.choice,
    label: g.label,
    cards: g.cards,
    free_room_nights: g.free_room_nights,
    filled_room_nights: g.filled_room_nights,
    take_home_per_night: g.take_home_nights ? Math.round(g.take_home_sum / g.take_home_nights) : null,
    unknown_fee: g.unknown_fee,
  }));
  return { empty: false, groups: out, note: "押したあとに入った予約だけを数えています。夜がまだ先なら、これから埋まることもあります" };
}
