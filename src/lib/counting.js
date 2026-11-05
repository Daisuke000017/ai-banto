// 180日・宿泊税・定期報告を「数える」プログラム。
// 設計の芯：AIは考える・書く／プログラムは数える・確かめる。ここにAIは一切出てこない。
//
// 根拠（2026-11-03 確認。宮崎市の正式な手引きが出たら照らし直す）
// - 180日：正午から翌日の正午までを1日、4月1日正午から翌年4月1日正午までを1年と数える
//   （住宅宿泊事業法 2条3項・施行規則3条）。2部屋に予約があっても同じ日は1日。
// - 宮崎市宿泊税：2026-07-01 から、1人1泊200円。課税免除なし（総務省の同意資料）。
//   「実際に泊まった人数」で数える（鹿児島市Q&A A2-35 と同じ考え方）。
// - 料金のかからない添い寝は課税しない扱いがありうる（鹿児島市Q&A）→ 設定で選べる。既定は「数える」。
// - キャンセル料：違約金として扱えば宿泊税なし／宿泊料金として扱えばかかる（鹿児島市Q&A A2-17）。
//   既定は「違約金」。前もって預かった宿泊税は返金が必要。

import { addDays, daysBetween, monthOf, parseDate } from "./dates.js";

export const DEFAULT_RULES = Object.freeze({
  taxRate: 200, // 1人1泊（円）
  taxStartDate: "2026-07-01", // この夜から宿泊税がかかる
  infantsTaxable: true, // 乳幼児も1人と数える（免除がないため）
  cosleepFreeExempt: false, // 料金のかからない添い寝の子を宿泊税から外すか
  cancelFeeTreatment: "penalty", // penalty＝違約金（税なし）／lodging＝宿泊料金（税あり）
  annualDayLimit: 180,
});

/** inn_profile の1行から、数え方の設定を作る */
export function rulesFromInnProfile(row = {}) {
  const r = { ...DEFAULT_RULES };
  if (row.tax_rate != null) r.taxRate = Number(row.tax_rate);
  if (row.tax_start_date) r.taxStartDate = row.tax_start_date;
  if (row.infants_taxable != null) r.infantsTaxable = Number(row.infants_taxable) === 1;
  if (row.cosleep_free_exempt != null) r.cosleepFreeExempt = Number(row.cosleep_free_exempt) === 1;
  if (row.cancel_fee_treatment) r.cancelFeeTreatment = row.cancel_fee_treatment;
  if (!["penalty", "lodging"].includes(r.cancelFeeTreatment)) {
    throw new Error(`キャンセル料の扱いが不明です: ${r.cancelFeeTreatment}`);
  }
  return r;
}

/** 年度（4月1日正午はじまり）。その夜の日付が3月31日なら、正午〜翌日正午は前の年度に入る */
export function fiscalYearOf(night) {
  const d = parseDate(night);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() + 1 >= 4 ? y : y - 1;
}

function parseJson(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string") return v;
  return JSON.parse(v);
}

function party(src) {
  const p = {
    adults: Number(src.adults ?? 0),
    children: Number(src.children ?? 0),
    infants: Number(src.infants ?? 0),
    cosleep_free: Number(src.cosleep_free ?? 0),
  };
  for (const [k, v] of Object.entries(p)) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`人数が正しくありません（${k}=${v}）`);
  }
  if (p.cosleep_free > p.children) {
    throw new Error("添い寝の子の数が、子どもの数より多くなっています");
  }
  return p;
}

/**
 * 予約を「1泊ずつ」に分ける。途中で人数が変わった予約（例：2泊目から1人追加）は
 * guest_changes_json に [{"from_night":"YYYY-MM-DD","adults":3,...}] と書く。
 */
export function nightsOf(r) {
  const n = daysBetween(r.checkin_date, r.checkout_date);
  if (n <= 0) throw new Error(`出発日が到着日より後になっていません（予約 ${r.id}）`);
  const base = party(r);
  const changes = parseJson(r.guest_changes_json, [])
    .map((c) => ({ from: c.from_night, party: party({ ...base, ...c }) }))
    .sort((a, b) => a.from.localeCompare(b.from));
  for (const c of changes) {
    if (c.from <= r.checkin_date || c.from >= r.checkout_date) {
      throw new Error(`人数の変更日が宿泊期間の中にありません（予約 ${r.id}・${c.from}）`);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const night = addDays(r.checkin_date, i);
    let p = base;
    for (const c of changes) if (c.from <= night) p = c.party;
    out.push({ night, ...p });
  }
  return out;
}

export function headcount(p) {
  return p.adults + p.children + p.infants;
}

/** 宿泊税の対象になる人数（その夜） */
export function taxablePersons(p, rules = DEFAULT_RULES) {
  let n = p.adults + p.children;
  if (rules.infantsTaxable) n += p.infants;
  if (rules.cosleepFreeExempt) n -= p.cosleep_free;
  return n;
}

const isConfirmed = (r) => r.status === "confirmed";

/** stay_nights の行を作る（確定した予約だけ。取り消した予約は180日にも報告にも数えない） */
export function stayNightRows(reservations) {
  const rows = [];
  for (const r of reservations) {
    if (!isConfirmed(r)) continue;
    for (const n of nightsOf(r)) {
      rows.push({
        reservation_id: r.id,
        night: n.night,
        fiscal_year: String(fiscalYearOf(n.night)),
        guests: headcount(n),
      });
    }
  }
  return rows;
}

/** 180日カウンター。日付の「種類の数」で数える */
export function dayCounter(stayNights, today, rules = DEFAULT_RULES) {
  const fy = fiscalYearOf(today);
  const used = new Set();
  const booked = new Set();
  for (const s of stayNights) {
    if (Number(s.fiscal_year ?? fiscalYearOf(s.night)) !== fy) continue;
    (s.night < today ? used : booked).add(s.night);
  }
  for (const d of used) booked.delete(d);
  const total = used.size + booked.size;
  const remaining = rules.annualDayLimit - total;
  return {
    fiscal_year: String(fy),
    period: { from: `${fy}-04-01 12:00`, to: `${fy + 1}-04-01 12:00` },
    used_days: used.size, // 今日より前の夜
    booked_days: booked.size, // 今日以降に予約が入っている夜
    total_days: total,
    limit: rules.annualDayLimit,
    remaining_days: remaining,
    level: remaining < 0 ? "over" : remaining <= 30 ? "warn" : "ok",
    how: "正午〜翌日正午を1日とし、日付の種類の数で数えています（2部屋に予約があっても同じ日は1日）",
  };
}

/**
 * 予約1件の、宿泊税がかかる夜の一覧。
 * 取り消した予約は、キャンセル料を「宿泊料金」として扱う設定のときだけ、予約どおりの人数・泊数でかかる。
 */
export function taxNightsOf(r, rules = DEFAULT_RULES) {
  let reason;
  if (isConfirmed(r)) {
    reason = "stayed";
  } else if (r.status === "cancelled" && Number(r.cancel_fee_amount ?? 0) > 0 && rules.cancelFeeTreatment === "lodging") {
    reason = "cancel_fee_as_lodging";
  } else {
    return [];
  }
  return nightsOf(r)
    .filter((n) => n.night >= rules.taxStartDate)
    .map((n) => ({ night: n.night, month: monthOf(n.night), persons: taxablePersons(n, rules), reason }));
}

function note(r, rules, nights) {
  if (r.status === "cancelled") {
    const collected = Number(r.lodging_tax_collected ?? 0);
    if (nights.length === 0) {
      const base =
        Number(r.cancel_fee_amount ?? 0) > 0
          ? "キャンセル料は「違約金」として扱う設定のため、宿泊税はかかりません"
          : "キャンセル料がないため、宿泊税はかかりません";
      return collected > 0 ? `${base}。前もって預かった宿泊税 ${collected}円は返金が必要です` : base;
    }
    return "キャンセル料を「宿泊料金」として扱う設定のため、予約どおりの人数・泊数で宿泊税がかかります";
  }
  return null;
}

/** 予約が預かった額を、月ごとの宿泊税の割合で分ける（端数は最後の月へ） */
function splitCollected(collected, perMonthTax) {
  const months = Object.keys(perMonthTax).sort();
  const total = months.reduce((a, m) => a + perMonthTax[m], 0);
  const out = {};
  if (total === 0) return out;
  let given = 0;
  months.forEach((m, i) => {
    const share = i === months.length - 1 ? collected - given : Math.floor((collected * perMonthTax[m]) / total);
    out[m] = share;
    given += share;
  });
  return out;
}

/**
 * 宿泊税の集計表（1か月分）。宿泊税は売上ではなく預り金。
 * - person_nights：人泊数／tax_amount：人泊数×税額
 * - collected_amount：実際に預かった額（分かっている予約の分だけ）
 * - diff：預かった額 − かかる額（預かった額が分かっている予約だけで比べる）。マイナスは不足
 */
export function taxDraft(reservations, month, rules = DEFAULT_RULES) {
  const breakdown = [];
  let personNights = 0;
  let collectedKnown = 0;
  let taxKnown = 0;
  let taxUnknown = 0;
  let excludedBeforeStart = 0;
  let refundNeeded = 0;

  for (const r of reservations) {
    const all = taxNightsOf(r, rules);
    const allNights = nightsOf(r);
    const inMonth = all.filter((n) => n.month === month);
    const monthNightsAll = allNights.filter((n) => monthOf(n.night) === month);
    const before = monthNightsAll.filter((n) => n.night < rules.taxStartDate).length;
    const counts = r.status === "confirmed" || all.length > 0;
    if (counts) excludedBeforeStart += before;

    const collectedRaw = r.lodging_tax_collected;
    const collectedTotal = collectedRaw == null ? null : Number(collectedRaw);

    // 税がかからないのに預かっている予約（取り消し・7/1より前）は、到着日の月で返金の目印を出す
    if (inMonth.length === 0) {
      const firstMonth = monthOf(r.checkin_date);
      if (firstMonth === month && collectedTotal && all.length === 0) {
        // 返金が要るお金は「預かった額」に混ぜない（混ぜると他の予約の不足が見えなくなる）
        refundNeeded += collectedTotal;
        breakdown.push({
          reservation_id: r.id,
          ota: r.ota,
          nights_in_month: 0,
          person_nights: 0,
          tax: 0,
          collected: collectedTotal,
          refund_needed: collectedTotal,
          note: note(r, rules, all) ?? "宿泊税がかからない夜の分を預かっています（返金が必要か確認）",
        });
      } else if (firstMonth === month && r.status === "cancelled") {
        breakdown.push({ reservation_id: r.id, ota: r.ota, nights_in_month: 0, person_nights: 0, tax: 0, collected: collectedTotal, note: note(r, rules, all) });
      }
      continue;
    }

    const pn = inMonth.reduce((a, n) => a + n.persons, 0);
    const tax = pn * rules.taxRate;
    personNights += pn;

    const perMonthTax = {};
    for (const n of all) perMonthTax[n.month] = (perMonthTax[n.month] ?? 0) + n.persons * rules.taxRate;
    let collected = null;
    if (collectedTotal == null) {
      taxUnknown += tax;
    } else {
      collected = splitCollected(collectedTotal, perMonthTax)[month] ?? 0;
      collectedKnown += collected;
      taxKnown += tax;
    }

    breakdown.push({
      reservation_id: r.id,
      ota: r.ota,
      tax_collection: r.tax_collection ?? "unknown",
      nights_in_month: inMonth.length,
      nights_before_tax_start: before,
      person_nights: pn,
      tax,
      collected,
      split_across_months: Object.keys(perMonthTax).length > 1,
      note:
        note(r, rules, all) ??
        (collected == null ? "預かった額が分かりません（予約サイトの明細で確認）" : collected - tax < 0 ? `${tax - collected}円 足りません` : null),
    });
  }

  return {
    month,
    person_nights: personNights,
    tax_amount: personNights * rules.taxRate,
    collected_amount: collectedKnown,
    diff: collectedKnown - taxKnown,
    unknown_tax: taxUnknown, // 預かった額が分からない予約の宿泊税（diff には入れていない）
    refund_needed: refundNeeded, // 宿泊税がかからないのに預かっている額（返金が必要）
    nights_before_tax_start: excludedBeforeStart,
    rules: {
      tax_rate: rules.taxRate,
      tax_start_date: rules.taxStartDate,
      infants_taxable: rules.infantsTaxable,
      cosleep_free_exempt: rules.cosleepFreeExempt,
      cancel_fee_treatment: rules.cancelFeeTreatment,
    },
    breakdown,
  };
}

// ---- 定期報告（2か月ごと・偶数月の15日まで） ----
// 期間：2-3月→4/15、4-5月→6/15、6-7月→8/15、8-9月→10/15、10-11月→12/15、12-1月→2/15

/** 月（YYYY-MM）が入る報告期間の名前。例：2026-08 → "2026-08_09"、2027-01 → "2026-12_01" */
export function reportPeriodOf(month) {
  let [y, m] = month.split("-").map(Number);
  if (m % 2 === 1) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const end = m === 12 ? 1 : m + 1;
  return `${y}-${String(m).padStart(2, "0")}_${String(end).padStart(2, "0")}`;
}

export function periodMonths(period) {
  const m = /^(\d{4})-(\d{2})_(\d{2})$/.exec(period);
  if (!m) throw new Error(`報告期間の形が違います（例：2026-08_09）: ${period}`);
  const y = Number(m[1]);
  const start = Number(m[2]);
  if (start % 2 !== 0) throw new Error(`報告期間は偶数月から始まります: ${period}`);
  const endY = start === 12 ? y + 1 : y;
  const end = start === 12 ? 1 : start + 1;
  if (Number(m[3]) !== end) throw new Error(`報告期間の終わりの月が合いません: ${period}`);
  return [`${y}-${String(start).padStart(2, "0")}`, `${endY}-${String(end).padStart(2, "0")}`];
}

export function reportDueDate(period) {
  const [, last] = periodMonths(period);
  let [y, m] = last.split("-").map(Number);
  m += 1;
  if (m === 13) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-15`;
}

/**
 * 定期報告の4項目。0日の期間も0のまま返す。
 * - 宿泊日数：期間内の夜の日付の種類の数
 * - 延べ宿泊者数：夜ごとの人数の合計
 * - 宿泊者数・国籍別：到着日が期間内の予約で数える（期間をまたぐ予約を二重に数えないため。💭 観光庁の手引きで要確認）
 *   途中で人数が増えた予約は、いちばん多い夜の人数を実人数とする
 */
export function minpakuReport(reservations, period, today, nationalityOverrides = {}) {
  const months = periodMonths(period);
  const inPeriod = (night) => months.includes(monthOf(night));
  const days = new Set();
  let guestNights = 0;
  let guests = 0;
  const nationality = {};
  const counted = [];

  for (const r of reservations) {
    if (!isConfirmed(r)) continue;
    const nights = nightsOf(r);
    for (const n of nights) {
      if (!inPeriod(n.night)) continue;
      days.add(n.night);
      guestNights += headcount(n);
    }
    if (!inPeriod(r.checkin_date)) continue;
    const heads = Math.max(...nights.map(headcount));
    guests += heads;
    const nat = parseJson(nationalityOverrides[r.id] ?? r.nationalities_json, {});
    let known = 0;
    for (const [code, c] of Object.entries(nat)) {
      nationality[code] = (nationality[code] ?? 0) + Number(c);
      known += Number(c);
    }
    if (known < heads) nationality.UNKNOWN = (nationality.UNKNOWN ?? 0) + (heads - known);
    counted.push({ reservation_id: r.id, checkin_date: r.checkin_date, guests: heads, unknown_nationality: Math.max(0, heads - known) });
  }

  const due = reportDueDate(period);
  return {
    period,
    months,
    due_date: due,
    days_left: today ? daysBetween(today, due) : null,
    stay_days: days.size,
    nights: [...days].sort(),
    guests,
    guest_nights: guestNights,
    nationality,
    breakdown: {
      how: "宿泊日数＝夜の日付の種類の数／延べ宿泊者数＝夜ごとの人数の合計／宿泊者数・国籍＝到着日が期間内の予約で数える",
      reservations: counted,
    },
  };
}
