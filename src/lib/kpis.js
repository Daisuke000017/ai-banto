// 今月の数字（M8）を「数える」プログラム。AIは出てこない。数字は保存せず、開くたびに台帳から計算する。
//
// 決めごと（2026-11-03 社長決定）
// - 売上は「泊まった日」で数える。月をまたぐ予約は、1泊ずつに分けてそれぞれの月に入れる。
//   1泊あたりの金額は円で割り切れないことがあるので、合計がぴったり元の金額になるように配る。
// - 宿泊税は売上に入れない（預かったお金）。料金に込み（included）の予約は、預かった額を引いて売上にする。
// - キャンセル料は売上とは分けて出す（泊まっていないため、稼働率・客室単価には入れない）。
// - 手数料：予約サイトの明細にその予約の行があれば、その額（実際の額）。
//   無ければ、読み込んだ明細から計算した手数料の割合で見積もる（見込み）。明細が1つも無ければ「分からない」。
//   直接予約は手数料0円。

import { addDays, daysBetween, parseDate } from "./dates.js";
import { nightsOf, headcount, taxDraft, DEFAULT_RULES } from "./counting.js";

const isConfirmed = (r) => r.status === "confirmed";

export function addMonths(ym, k) {
  let [y, m] = ym.split("-").map(Number);
  m += k;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function daysInMonth(ym) {
  parseDate(`${ym}-01`);
  return daysBetween(`${ym}-01`, `${addMonths(ym, 1)}-01`);
}

/** amount を n 個に分ける。合計はぴったり amount（i番目＝floor(a*(i+1)/n) − floor(a*i/n)） */
export function splitAmount(amount, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.floor((amount * (i + 1)) / n) - Math.floor((amount * i) / n));
  return out;
}

/** 売上に数える金額（宿泊税を除く）。料金に込みで、預かった額が分かれば引く */
export function lodgingSales(r) {
  const gross = Number(r.amount_gross ?? 0);
  if (r.tax_collection === "included" && r.lodging_tax_collected != null) return gross - Number(r.lodging_tax_collected);
  return gross;
}

function parseJson(v) {
  if (v == null || v === "") return null;
  return typeof v === "string" ? JSON.parse(v) : v;
}

/** 読み込んだ明細の行から、予約サイトごとの手数料の割合（fee ÷ gross）を出す */
export function feeRates(lines) {
  const acc = {};
  for (const l of lines) {
    if (l.fee == null || l.gross == null || Number(l.gross) <= 0) continue;
    const a = (acc[l.ota] ??= { fee: 0, gross: 0 });
    a.fee += Number(l.fee);
    a.gross += Number(l.gross);
  }
  const out = {};
  for (const [ota, a] of Object.entries(acc)) if (a.gross > 0) out[ota] = a.fee / a.gross;
  return out;
}

/** 明細の行を「予約サイト|予約番号」ごとにまとめる（feeOf に渡す） */
export function linesIndex(lines) {
  const m = new Map();
  for (const l of lines) {
    const k = `${l.ota}|${l.ota_reservation_no}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(l);
  }
  return m;
}

/** 1件の予約の手数料：{amount, basis: "actual"|"estimate"|"none"|"unknown"} */
export function feeOf(r, linesByKey, rates) {
  if (r.ota === "direct") return { amount: 0, basis: "none" };
  const ls = linesByKey.get(`${r.ota}|${r.ota_reservation_no}`) ?? [];
  const withFee = ls.filter((l) => l.fee != null);
  if (withFee.length) return { amount: withFee.reduce((s, l) => s + Number(l.fee), 0), basis: "actual" };
  if (rates[r.ota] != null) {
    const base = isConfirmed(r) ? Number(r.amount_gross ?? 0) : Number(r.cancel_fee_amount ?? 0);
    return { amount: Math.round(base * rates[r.ota]), basis: "estimate" };
  }
  return { amount: null, basis: "unknown" };
}

/**
 * 1か月分の数字。
 * @param {object} a
 * @param {object[]} a.reservations 予約（amount_gross・ota_reservation_no を含む）
 * @param {object[]} a.lines 予約サイトの明細の行（ota, ota_reservation_no, gross, fee）
 * @param {number} a.rooms 部屋の数
 * @param {string} a.month "YYYY-MM"
 * @param {string} a.today "YYYY-MM-DD"（この日より前の夜＝泊まり済み）
 */
export function monthNumbers({ reservations, lines = [], rooms, month, today }) {
  if (!Number.isInteger(rooms) || rooms < 1) throw new Error("部屋の数が設定されていません");
  const days = daysInMonth(month);
  const rates = feeRates(lines);
  const linesByKey = new Map();
  for (const l of lines) {
    const k = `${l.ota}|${l.ota_reservation_no}`;
    if (!linesByKey.has(k)) linesByKey.set(k, []);
    linesByKey.get(k).push(l);
  }

  const byOta = new Map();
  const ota = (k) => {
    if (!byOta.has(k)) byOta.set(k, { ota: k, reservations: 0, room_nights: 0, sales: 0, cancel_fees: 0, fee_actual: 0, fee_estimate: 0, fee_unknown_count: 0 });
    return byOta.get(k);
  };
  const nat = {};
  let sales = 0;
  let stayed = 0;
  let upcoming = 0;
  let cancelFees = 0;
  let roomNights = 0;
  let guestNights = 0;
  let unknownTaxIncluded = 0;
  const rows = [];

  for (const r of reservations) {
    const n = daysBetween(r.checkin_date, r.checkout_date);
    const nightDates = Array.from({ length: n }, (_, i) => addDays(r.checkin_date, i));
    const inMonth = nightDates.map((d, i) => ({ d, i })).filter((x) => x.d.slice(0, 7) === month);
    if (!inMonth.length) continue;
    const fee = feeOf(r, linesByKey, rates);
    const feeParts = fee.amount == null ? null : splitAmount(fee.amount, n);
    const o = ota(r.ota);

    if (isConfirmed(r)) {
      const parts = splitAmount(lodgingSales(r), n);
      const party = nightsOf(r);
      let s = 0;
      for (const { d, i } of inMonth) {
        s += parts[i];
        if (d < today) stayed += parts[i];
        else upcoming += parts[i];
        guestNights += headcount(party[i]);
      }
      sales += s;
      roomNights += inMonth.length;
      o.reservations += 1;
      o.room_nights += inMonth.length;
      o.sales += s;
      if (r.tax_collection === "included" && r.lodging_tax_collected == null) unknownTaxIncluded += 1;
      // 国・地域：その月に1泊でもある予約の人数（月をまたぐ予約は両方の月に入る）
      const ns = parseJson(r.nationalities_json);
      if (ns && Object.keys(ns).length) for (const [c, k] of Object.entries(ns)) nat[c] = (nat[c] ?? 0) + Number(k);
      else nat.UNKNOWN = (nat.UNKNOWN ?? 0) + headcount(party[0]);
      rows.push({ id: r.id, ota: r.ota, kind: "stay", nights: inMonth.length, amount: s });
    } else {
      const fee0 = Number(r.cancel_fee_amount ?? 0);
      if (fee0 <= 0) continue;
      const parts = splitAmount(fee0, n);
      const s = inMonth.reduce((t, { i }) => t + parts[i], 0);
      cancelFees += s;
      o.cancel_fees += s;
      rows.push({ id: r.id, ota: r.ota, kind: "cancel_fee", nights: 0, amount: s });
    }

    const f = feeParts ? inMonth.reduce((t, { i }) => t + feeParts[i], 0) : null;
    if (fee.basis === "actual") o.fee_actual += f;
    else if (fee.basis === "estimate") o.fee_estimate += f;
    else if (fee.basis === "unknown") o.fee_unknown_count += 1;
    rows[rows.length - 1].fee = f;
    rows[rows.length - 1].fee_basis = fee.basis;
  }

  const otas = [...byOta.values()].map((o) => {
    const feeKnown = o.fee_unknown_count === 0;
    return {
      ...o,
      fee: feeKnown ? o.fee_actual + o.fee_estimate : null,
      net: feeKnown ? o.sales + o.cancel_fees - o.fee_actual - o.fee_estimate : null,
    };
  }).sort((a, b) => b.sales + b.cancel_fees - (a.sales + a.cancel_fees));

  const feeUnknown = otas.some((o) => o.fee == null);
  const feeActual = otas.reduce((t, o) => t + o.fee_actual, 0);
  const feeEstimate = otas.reduce((t, o) => t + o.fee_estimate, 0);
  const available = rooms * days;

  return {
    month,
    days,
    rooms,
    sales, // 宿泊料（宿泊税を除く）
    sales_stayed: stayed,
    sales_upcoming: upcoming,
    cancel_fees: cancelFees,
    total: sales + cancelFees,
    fee: feeUnknown ? null : feeActual + feeEstimate,
    fee_actual: feeActual,
    fee_estimate: feeEstimate,
    net: feeUnknown ? null : sales + cancelFees - feeActual - feeEstimate,
    room_nights: roomNights,
    available_room_nights: available,
    occupancy_pct: Math.round((roomNights / available) * 1000) / 10, // 小数1けた（％）
    adr: roomNights ? Math.round(sales / roomNights) : null, // 客室単価（1部屋1泊あたり）
    guest_nights: guestNights,
    nationalities: Object.entries(nat).map(([code, persons]) => ({ code, persons })).sort((a, b) => b.persons - a.persons),
    by_ota: otas,
    fee_rates: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Math.round(v * 1000) / 10])), // ％
    unknown_tax_included: unknownTaxIncluded,
    rows,
  };
}

/** 画面に出す1回分：今月・前の月・宿泊税（預かったお金） */
export function kpiView({ reservations, lines, rooms, month, today, rules = DEFAULT_RULES }) {
  const cur = monthNumbers({ reservations, lines, rooms, month, today });
  const prev = monthNumbers({ reservations, lines, rooms, month: addMonths(month, -1), today });
  const tax = taxDraft(reservations, month, rules);
  return {
    today,
    ...cur,
    lodging_tax: tax.tax_amount,
    previous: { month: prev.month, total: prev.total, sales: prev.sales, occupancy_pct: prev.occupancy_pct, adr: prev.adr, room_nights: prev.room_nights },
  };
}
