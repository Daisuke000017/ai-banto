// お金の照合 ②：台帳・予約サイトの明細・通帳を突き合わせる（M2）
// ここにAIは出てこない。数える・比べるのはプログラムだけ。
// ① 台帳 と 予約サイトの明細（予約ごとの金額）
// ② 予約サイトの振込 と 通帳の入金
// ③ 宿泊税：計算でかかる額 と 予約サイト（または台帳）が預かった額
// ずれ（discrepancies）に入れる事実（facts）は、予約番号・金額・日付・予約サイト・差・人数の数だけ。
// 名前・摘要・メモは入れない（このあと経理担当のAIに渡すため）。

import { addDays, daysBetween } from "./dates.js";
import { DEFAULT_RULES, nightsOf, taxNightsOf } from "./counting.js";
import { describeGuestCount } from "./guest.js";

export const KIND_LABEL = {
  ledger_vs_ota: "台帳と予約サイトの明細",
  payout_vs_bank: "予約サイトの振込と通帳",
  tax_collected: "宿泊税（計算と預かった額）",
  guest_count: "ゲストが入れた人数と台帳",
};
const OTA_JA = { airbnb: "Airbnb", booking: "Booking.com", rakuten: "楽天トラベル" };
const PAYOUT_WAIT_DAYS = 7; // 振込の日から通帳に入るまで、この日数までは待つ
const near = (amount) => Math.max(1000, Math.round(Math.abs(amount) * 0.03)); // これより近ければ「同じ振込のはず」とみなす

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const isConfirmed = (r) => (r.status ?? "confirmed") === "confirmed";

/** 台帳の側の「その予約で受け取るはずの額」 */
function ledgerAmount(r) {
  if (isConfirmed(r)) return Number(r.amount_gross ?? 0);
  return Number(r.cancel_fee_amount ?? 0);
}

function lineAmount(l) {
  return Number(l.gross ?? l.net ?? 0);
}

/**
 * 突き合わせ（DBを使わない・同じ入力なら必ず同じ結果）
 * @returns {{checks: object[], info: string[], lineLinks: {line_id:number, reservation_id:string}[], depositLinks: {deposit_id:number, payout_id:number}[]}}
 */
export function reconcile({ reservations, lines, payouts, deposits, bankLoaded = deposits.length > 0, rules = DEFAULT_RULES }) {
  const checks = [];
  const info = [];
  const lineLinks = [];
  const depositLinks = [];
  const add = (c) => checks.push({ ...c, diff: c.actual - c.expected, matched: c.actual === c.expected });

  // ---- ① 台帳 と 予約サイトの明細 ----
  const taxTargets = [];
  const otas = [...new Set(lines.map((l) => l.ota))].sort();
  for (const ota of otas) {
    const ls = lines.filter((l) => l.ota === ota);
    const byNo = new Map();
    for (const l of ls) {
      if (!byNo.has(l.ota_reservation_no)) byNo.set(l.ota_reservation_no, []);
      byNo.get(l.ota_reservation_no).push(l);
    }
    const dates = ls.map((l) => l.checkin_date ?? l.line_date).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];
    const resOfOta = reservations.filter((r) => r.ota === ota);
    const resByNo = new Map(resOfOta.filter((r) => r.ota_reservation_no).map((r) => [r.ota_reservation_no, r]));
    const scope = resOfOta.filter((r) => r.checkin_date >= from && r.checkin_date <= to);
    const seen = new Set();

    for (const [no, group] of byNo) {
      const r = resByNo.get(no);
      const actual = sum(group.map(lineAmount));
      const base = {
        ota,
        ota_reservation_no: no,
        statement_amount: actual,
        statement_lines: group.length,
        line_types: [...new Set(group.map((l) => l.line_type))],
      };
      if (!r) {
        add({ kind: "ledger_vs_ota", reservation_id: null, expected: 0, actual, facts: { ...base, problem: "not_in_ledger", ledger_amount: null } });
        continue;
      }
      seen.add(r.id);
      for (const l of group) if (l.id != null) lineLinks.push({ line_id: l.id, reservation_id: r.id });
      const expected = ledgerAmount(r);
      add({
        kind: "ledger_vs_ota",
        reservation_id: r.id,
        expected,
        actual,
        facts: {
          ...base,
          status: r.status ?? "confirmed",
          checkin_date: r.checkin_date,
          checkout_date: r.checkout_date,
          nights: daysBetween(r.checkin_date, r.checkout_date),
          ledger_amount: expected,
          ledger_basis: isConfirmed(r) ? "amount_gross" : "cancel_fee_amount",
          ledger_amount_gross: Number(r.amount_gross ?? 0),
        },
      });
      if (isConfirmed(r) || r.status === "cancelled") taxTargets.push({ r, group });
    }
    for (const r of scope) {
      if (seen.has(r.id)) continue;
      const expected = ledgerAmount(r);
      add({
        kind: "ledger_vs_ota",
        reservation_id: r.id,
        expected,
        actual: 0,
        facts: {
          ota,
          ota_reservation_no: r.ota_reservation_no ?? null,
          problem: "not_in_statement",
          status: r.status ?? "confirmed",
          checkin_date: r.checkin_date,
          checkout_date: r.checkout_date,
          ledger_amount: expected,
          statement_amount: 0,
          statement_period: { from, to },
        },
      });
    }
  }

  // ---- ② 予約サイトの振込 と 通帳 ----
  if (!payouts.length) {
    // 振込の明細が無い予約サイト（宿が直接受け取る形など）は、②を行わない
  } else if (!bankLoaded) {
    info.push("通帳の明細がまだ無いので、振込と通帳の突き合わせはしていません");
  } else {
    const bankLast = deposits.map((d) => d.deposit_date).sort().at(-1) ?? null;
    const used = new Set();
    const sorted = [...payouts].sort((a, b) => a.payout_date.localeCompare(b.payout_date) || a.id - b.id);
    const candidatesOf = (p) =>
      deposits.filter(
        (d) => d.amount > 0 && !used.has(d.id) && d.ota_hint === p.ota && d.deposit_date >= p.payout_date && d.deposit_date <= addDays(p.payout_date, PAYOUT_WAIT_DAYS),
      );
    const result = new Map();
    // 1回目：金額がぴったりの入金を先に結ぶ
    for (const p of sorted) {
      const d = candidatesOf(p).find((x) => x.amount === p.amount);
      if (d) {
        used.add(d.id);
        result.set(p, d);
      }
    }
    // 2回目：残りは、近い金額の入金を探す（見つからなければ「入金が無い」）
    for (const p of sorted) {
      if (result.has(p)) continue;
      const d = candidatesOf(p)
        .filter((x) => Math.abs(x.amount - p.amount) <= near(p.amount))
        .sort((a, b) => Math.abs(a.amount - p.amount) - Math.abs(b.amount - p.amount))[0];
      if (d) used.add(d.id);
      result.set(p, d ?? null);
    }
    for (const p of sorted) {
      const d = result.get(p);
      if (d) depositLinks.push({ deposit_id: d.id, payout_id: p.id });
      add({
        kind: "payout_vs_bank",
        reservation_id: null,
        payout_id: p.id,
        deposit_id: d?.id ?? null,
        expected: p.amount,
        actual: d ? d.amount : 0,
        facts: {
          ota: p.ota,
          payout_date: p.payout_date,
          payout_amount: p.amount,
          deposit_date: d?.deposit_date ?? null,
          deposit_amount: d?.amount ?? null,
          days_to_deposit: d ? daysBetween(p.payout_date, d.deposit_date) : null,
          bank_last_date: bankLast,
          wait_days: PAYOUT_WAIT_DAYS,
          reservations_in_payout: lines.filter((l) => l.payout_id === p.id).map((l) => l.ota_reservation_no),
        },
      });
    }
    const out = deposits.filter((d) => d.amount < 0).length;
    const other = deposits.filter((d) => d.amount > 0 && !d.ota_hint).length;
    const extra = deposits.filter((d) => d.amount > 0 && d.ota_hint && !used.has(d.id) && payouts.some((p) => p.ota === d.ota_hint)).length;
    if (out) info.push(`通帳の「出ていくお金」${out}件は、突き合わせから外しました（手数料の支払い・光熱費など）`);
    if (other) info.push(`予約サイト以外からの入金${other}件は外しました（直接の予約などは、台帳と手で見比べてください）`);
    if (extra) info.push(`予約サイトからの入金で、振込の明細に無いものが${extra}件あります`);
  }

  // ---- ③ 宿泊税 ----
  for (const { r, group } of taxTargets) {
    const nights = taxNightsOf(r, rules);
    const expected = sum(nights.map((n) => n.persons * rules.taxRate));
    const fromLines = group.filter((l) => l.lodging_tax != null);
    let actual;
    let source;
    if (fromLines.length) {
      actual = sum(fromLines.map((l) => Number(l.lodging_tax)));
      source = "statement";
    } else if (r.lodging_tax_collected != null) {
      actual = Number(r.lodging_tax_collected);
      source = "ledger";
    } else {
      actual = 0;
      source = "unknown";
    }
    let party = null;
    try {
      party = nightsOf(r)[0];
    } catch {
      party = null;
    }
    add({
      kind: "tax_collected",
      reservation_id: r.id,
      expected,
      actual,
      facts: {
        ota: r.ota,
        ota_reservation_no: r.ota_reservation_no ?? null,
        status: r.status ?? "confirmed",
        checkin_date: r.checkin_date,
        checkout_date: r.checkout_date,
        nights: daysBetween(r.checkin_date, r.checkout_date),
        tax_nights: nights.length,
        persons_per_night: nights.map((n) => n.persons),
        first_night_persons: nights[0]?.persons ?? null,
        infants: Number(party?.infants ?? r.infants ?? 0),
        tax_rate: rules.taxRate,
        infants_taxable: rules.infantsTaxable,
        cancel_fee_treatment: rules.cancelFeeTreatment,
        collected_source: source,
        tax_collection: r.tax_collection ?? null,
      },
    });
  }

  return { checks, info, lineLinks, depositLinks };
}

/** 同じずれかどうかを見分ける鍵（突き合わせをやり直しても、オーナーの「OK」やメモを残すため） */
export function discrepancyKey(kind, facts, reservationId) {
  if (kind === "payout_vs_bank") return `${kind}|${facts.ota}|${facts.payout_date}|${facts.payout_amount}`;
  return `${kind}|${reservationId ?? ""}|${facts.ota ?? ""}|${facts.ota_reservation_no ?? ""}`;
}

export function summarize(checks, info) {
  const byKind = {};
  for (const c of checks) {
    byKind[c.kind] ??= { label: KIND_LABEL[c.kind], total: 0, matched: 0 };
    byKind[c.kind].total++;
    if (c.matched) byKind[c.kind].matched++;
  }
  return { total: checks.length, matched: checks.filter((c) => c.matched).length, byKind, info };
}

// ---------------------------------------------------------------------------
// D1 とのやりとり
// ---------------------------------------------------------------------------

const RES_FOR_RECONCILE = `SELECT id, ota, ota_reservation_no, checkin_date, checkout_date, adults, children, infants, cosleep_free,
  status, cancel_fee_amount, amount_gross, lodging_tax_collected, tax_collection, guest_changes_json FROM reservations`;

export async function loadReconcileInput(db) {
  const [res, ls, ps, ds, bank] = await db.batch([
    db.prepare(RES_FOR_RECONCILE),
    db.prepare("SELECT id, ota, ota_reservation_no, payout_id, line_date, checkin_date, line_type, gross, fee, lodging_tax, net FROM ota_lines ORDER BY id"),
    db.prepare("SELECT id, ota, payout_date, amount FROM ota_payouts ORDER BY payout_date, id"),
    db.prepare("SELECT id, deposit_date, amount, ota_hint FROM bank_deposits ORDER BY deposit_date, id"),
    db.prepare("SELECT COUNT(*) AS n FROM uploads WHERE kind = 'bank' AND map_confirmed = 1"),
  ]);
  return { reservations: res.results, lines: ls.results, payouts: ps.results, deposits: ds.results, bankLoaded: (bank.results[0]?.n ?? 0) > 0 };
}

/** 突き合わせて、ずれを入れ直す。前と同じずれは、オーナーの判断・メモ（差が同じなら理由の候補も）を残す */
export async function runReconcile({ db, rules, now }) {
  const input = await loadReconcileInput(db);
  if (!input.lines.length && !input.payouts.length) {
    return { summary: { total: 0, matched: 0, byKind: {}, info: ["予約サイトの明細がまだありません。先に明細を読み込んでください"] }, discrepancies: [] };
  }
  const { checks, info, lineLinks, depositLinks } = reconcile({ ...input, rules });
  // ゲストが入れた人数のずれ（guest_count）は、お金の突き合わせとは別に作るので、ここでは消さない
  const { results: old } = await db.prepare("SELECT * FROM discrepancies WHERE kind != 'guest_count'").all();
  const oldByKey = new Map(old.map((d) => [discrepancyKey(d.kind, JSON.parse(d.facts_json), d.reservation_id), d]));

  const stmts = [
    db.prepare("DELETE FROM discrepancies WHERE kind != 'guest_count'"),
    db.prepare("UPDATE ota_lines SET reservation_id = NULL"),
    db.prepare("UPDATE bank_deposits SET payout_id = NULL"),
  ];
  for (const l of lineLinks) stmts.push(db.prepare("UPDATE ota_lines SET reservation_id = ? WHERE id = ?").bind(l.reservation_id, l.line_id));
  for (const d of depositLinks) stmts.push(db.prepare("UPDATE bank_deposits SET payout_id = ? WHERE id = ?").bind(d.payout_id, d.deposit_id));
  for (const c of checks.filter((x) => !x.matched)) {
    const prev = oldByKey.get(discrepancyKey(c.kind, c.facts, c.reservation_id));
    const sameDiff = prev && prev.diff_amount === c.diff;
    stmts.push(
      db
        .prepare(
          `INSERT INTO discrepancies (kind, reservation_id, payout_id, deposit_id, expected, actual, diff_amount, facts_json,
             reason_candidates_json, confidence, audit_json, status, owner_note, resolved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          c.kind,
          c.reservation_id ?? null,
          c.payout_id ?? null,
          c.deposit_id ?? null,
          c.expected,
          c.actual,
          c.diff,
          JSON.stringify(c.facts),
          sameDiff ? prev.reason_candidates_json : null,
          sameDiff ? prev.confidence : null,
          sameDiff ? prev.audit_json : null,
          prev?.status ?? "open",
          prev?.owner_note ?? null,
          prev?.resolved_at ?? null,
          prev?.created_at ?? now,
        ),
    );
  }
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return { summary: summarize(checks, info), discrepancies: await listDiscrepancies(db) };
}

const jd = (iso) => (iso ? `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日` : "");

export function describeDiscrepancy(d) {
  const f = d.facts;
  const ota = OTA_JA[f.ota] ?? f.ota;
  if (d.kind === "guest_count") return describeGuestCount(d);
  if (d.kind === "payout_vs_bank") {
    return d.deposit_id
      ? `${ota}の${jd(f.payout_date)}の振込 ${f.payout_amount.toLocaleString()}円 → 通帳は${jd(f.deposit_date)}に ${f.deposit_amount.toLocaleString()}円`
      : `${ota}の${jd(f.payout_date)}の振込 ${f.payout_amount.toLocaleString()}円が、通帳（${jd(f.bank_last_date)}まで）に見つかりません`;
  }
  if (d.kind === "tax_collected") {
    return `宿泊税：計算では ${d.expected.toLocaleString()}円、${f.collected_source === "statement" ? `${ota}が預かった額` : "台帳の預かった額"}は ${d.actual.toLocaleString()}円`;
  }
  if (f.problem === "not_in_ledger") return `${ota}の明細に、台帳に無い予約番号 ${f.ota_reservation_no}（${d.actual.toLocaleString()}円）があります`;
  if (f.problem === "not_in_statement") return `台帳の予約（${d.expected.toLocaleString()}円）が、${ota}の明細にありません`;
  return `台帳は ${d.expected.toLocaleString()}円、${ota}の明細は ${d.actual.toLocaleString()}円`;
}

export async function listDiscrepancies(db) {
  const { results } = await db.prepare("SELECT * FROM discrepancies ORDER BY id").all();
  return results.map(rowToDiscrepancy);
}

export async function getDiscrepancy(db, id) {
  const row = await db.prepare("SELECT * FROM discrepancies WHERE id = ?").bind(id).first();
  return row ? rowToDiscrepancy(row) : null;
}

export function rowToDiscrepancy(row) {
  if (row) {
    const d = {
      id: row.id,
      kind: row.kind,
      kind_label: KIND_LABEL[row.kind] ?? row.kind,
      reservation_id: row.reservation_id,
      payout_id: row.payout_id,
      deposit_id: row.deposit_id,
      expected: row.expected,
      actual: row.actual,
      diff: row.diff_amount,
      facts: JSON.parse(row.facts_json),
      reasons: row.reason_candidates_json ? JSON.parse(row.reason_candidates_json) : null,
      confidence: row.confidence,
      audit: row.audit_json ? JSON.parse(row.audit_json) : null,
      status: row.status,
      owner_note: row.owner_note,
      resolved_at: row.resolved_at,
    };
    d.title = describeDiscrepancy(d);
    return d;
  }
}
