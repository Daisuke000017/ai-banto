// 「数える」プログラムの自動テスト。使い方：npm test
// カードA〜D（判断が分かれる4つの場面）の正解と、デモの数字がずれていないかを確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RULES,
  dayCounter,
  fiscalYearOf,
  minpakuReport,
  periodMonths,
  reportDueDate,
  reportPeriodOf,
  rulesFromInnProfile,
  stayNightRows,
  taxDraft,
  taxNightsOf,
} from "../src/lib/counting.js";
import { DEMO_TODAY, innProfile, reservations } from "../seed/demo-reservations.js";
import { buildSeedSql } from "../scripts/build-seed.js";
import { addDays } from "../src/lib/dates.js";

const byId = (id) => reservations.find((r) => r.id === id);
const rules = rulesFromInnProfile(innProfile);
const days = (rs) => new Set(stayNightRows(rs).map((s) => s.night)).size;
const tax = (r, rr = rules) => taxNightsOf(r, rr).reduce((a, n) => a + n.persons * rr.taxRate, 0);
const row = (draft, id) => draft.breakdown.find((b) => b.reservation_id === id);

// ---- カードA：添い寝の子ども ----
test("カードA：大人2・子ども2（うち添い寝1）・3泊 → 3日／既定2,400円、添い寝を外す設定なら1,800円", () => {
  const r = byId("R04");
  assert.equal(days([r]), 3);
  assert.equal(tax(r), 2400);
  assert.equal(tax(r, { ...rules, cosleepFreeExempt: true }), 1800);
});

// ---- カードB：年度をまたぐ予約 ----
test("カードB：3/31〜4/2 → 2026年度に1日・2027年度に1日、宿泊税1,200円（3月600・4月600）", () => {
  const r = byId("R18");
  const rows = stayNightRows([r]);
  assert.deepEqual(rows.map((s) => [s.night, s.fiscal_year]), [["2027-03-31", "2026"], ["2027-04-01", "2027"]]);
  assert.equal(tax(r), 1200);
  assert.equal(row(taxDraft([r], "2027-03", rules), "R18").tax, 600);
  assert.equal(row(taxDraft([r], "2027-04", rules), "R18").tax, 600);
});

test("年度：4月1日の夜は新しい年度、3月31日の夜は前の年度", () => {
  assert.equal(fiscalYearOf("2027-03-31"), 2026);
  assert.equal(fiscalYearOf("2027-04-01"), 2027);
});

// ---- カードC：途中で1人増えた ----
test("カードC：1泊目2人・2泊目3人 → 2日・5人泊・1,000円（預かり800円なので200円不足）", () => {
  const r = byId("R06");
  assert.equal(days([r]), 2);
  const d = taxDraft([r], "2026-08", rules);
  assert.equal(d.person_nights, 5);
  assert.equal(d.tax_amount, 1000);
  assert.equal(d.diff, -200);
  assert.match(row(d, "R06").note, /200円 足りません/);
});

// ---- カードD：キャンセル料あり ----
test("カードD：取り消し（キャンセル料あり）→ 180日は0日／既定（違約金）は税0円で、預かった800円は返金", () => {
  const r = byId("R08");
  assert.equal(days([r]), 0);
  assert.equal(tax(r), 0);
  const d = taxDraft([r], "2026-08", rules);
  assert.equal(d.tax_amount, 0);
  assert.equal(d.refund_needed, 800);
  assert.equal(d.collected_amount, 0, "返金するお金は「預かった額」に混ぜない");
  assert.match(row(d, "R08").note, /返金が必要/);
});

test("カードD：キャンセル料を「宿泊料金」とする設定 → 予約どおり2人×2泊＝800円かかり、返金はなし", () => {
  const lodging = { ...rules, cancelFeeTreatment: "lodging" };
  const d = taxDraft([byId("R08")], "2026-08", lodging);
  assert.equal(d.tax_amount, 800);
  assert.equal(d.diff, 0);
  assert.equal(d.refund_needed, 0);
});

test("キャンセル料なしの取り消しは、どちらの設定でも税0円", () => {
  const r = byId("R19");
  assert.equal(tax(r), 0);
  assert.equal(tax(r, { ...rules, cancelFeeTreatment: "lodging" }), 0);
});

// ---- 宿泊税の細かい決まり ----
test("宿泊税は7/1の夜から：6/30〜7/2の予約は7/1の1泊分（2人×200円＝400円）だけ", () => {
  const r = byId("R03");
  assert.equal(tax(r), 400);
  const june = taxDraft([r], "2026-06", rules);
  assert.equal(june.tax_amount, 0);
  assert.equal(june.nights_before_tax_start, 1);
});

test("月をまたぐ予約は夜の月で分ける：7/31〜8/3の4人 → 7月800円・8月1,600円（預かった額も同じ割合で分ける）", () => {
  const r = byId("R05");
  const jul = row(taxDraft([r], "2026-07", rules), "R05");
  const aug = row(taxDraft([r], "2026-08", rules), "R05");
  assert.deepEqual([jul.tax, jul.collected], [800, 800]);
  assert.deepEqual([aug.tax, aug.collected], [1600, 1600]);
  assert.equal(jul.split_across_months, true);
});

test("乳幼児も1人と数える（3人＋乳幼児1人×3泊＝2,400円）", () => {
  assert.equal(tax(byId("R09")), 2400);
  assert.equal(tax(byId("R09"), { ...rules, infantsTaxable: false }), 1800);
});

test("預かった額が分からない予約は「不足」に入れず、別に出す", () => {
  const d = taxDraft(reservations, "2026-09", rules);
  assert.equal(d.unknown_tax, 400);
  assert.equal(row(d, "R12").collected, null);
  assert.match(row(d, "R12").note, /分かりません/);
});

test("デモの月別：7月3,600円・8月5,200円（800円不足＋返金800円）・9月3,000円", () => {
  const jul = taxDraft(reservations, "2026-07", rules);
  const aug = taxDraft(reservations, "2026-08", rules);
  const sep = taxDraft(reservations, "2026-09", rules);
  assert.deepEqual([jul.tax_amount, jul.diff], [3600, 0]);
  assert.deepEqual([aug.tax_amount, aug.collected_amount, aug.diff, aug.refund_needed], [5200, 4400, -800, 800]);
  assert.deepEqual([sep.tax_amount, sep.collected_amount, sep.diff], [3000, 2600, 0]);
});

// ---- 180日カウンター ----
test("2部屋に同じ日の予約があっても1日（8/8はA室・B室とも予約あり）", () => {
  assert.equal(days([byId("R06"), byId("R07")]), 2);
});

test("180日カウンター（デモの今日＝2026-10-10）：使った29日＋予約11日＝40日、残り140日", () => {
  const c = dayCounter(stayNightRows(reservations), DEMO_TODAY, rules);
  assert.deepEqual(
    [c.fiscal_year, c.used_days, c.booked_days, c.total_days, c.remaining_days, c.level],
    ["2026", 29, 11, 40, 140, "ok"],
  );
});

test("残りが30日以下なら注意、上限を超えたら超過", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ night: addDays("2026-04-01", i) }));
  assert.equal(dayCounter(mk(149), "2026-12-01", rules).level, "ok"); // 残り31日
  assert.equal(dayCounter(mk(150), "2026-12-01", rules).level, "warn"); // 残り30日
  assert.equal(dayCounter(mk(180), "2026-12-01", rules).remaining_days, 0);
  assert.equal(dayCounter(mk(181), "2026-12-01", rules).level, "over");
});

// ---- 定期報告 ----
test("報告の期限：8-9月→10/15、12-1月→翌年2/15", () => {
  assert.equal(reportDueDate("2026-08_09"), "2026-10-15");
  assert.equal(reportDueDate("2026-12_01"), "2027-02-15");
  assert.equal(reportPeriodOf("2027-01"), "2026-12_01");
  assert.equal(reportPeriodOf("2026-08"), "2026-08_09");
});

test("報告期間の形がおかしいときは止める", () => {
  assert.throws(() => periodMonths("2026-09_10"));
  assert.throws(() => periodMonths("2026-08"));
});

test("8-9月の報告：13日・15人・延べ41人、国籍不明2人（R12）", () => {
  const rep = minpakuReport(reservations, "2026-08_09", DEMO_TODAY);
  assert.deepEqual([rep.stay_days, rep.guests, rep.guest_nights], [13, 15, 41]);
  assert.equal(rep.nationality.UNKNOWN, 2);
  assert.equal(rep.days_left, 5);
});

test("宿泊が0日の期間も、0のまま報告できる", () => {
  const rep = minpakuReport(reservations, "2027-02_03", DEMO_TODAY);
  assert.equal(minpakuReport(reservations, "2026-02_03", DEMO_TODAY).stay_days, 0);
  assert.deepEqual([rep.stay_days, rep.guests, rep.guest_nights], [1, 3, 3]);
});

// ---- 設定・入力のチェック ----
test("設定の既定値と、知らない設定値は止める", () => {
  assert.equal(DEFAULT_RULES.cancelFeeTreatment, "penalty");
  assert.equal(rulesFromInnProfile({}).cosleepFreeExempt, false);
  assert.throws(() => rulesFromInnProfile({ cancel_fee_treatment: "unknown" }));
});

test("おかしな予約（出発日が到着日より前・添い寝が子どもより多い）は止める", () => {
  const base = { id: "X", status: "confirmed", checkin_date: "2026-08-01", checkout_date: "2026-08-02", adults: 1 };
  assert.throws(() => stayNightRows([{ ...base, checkout_date: "2026-08-01" }]));
  assert.throws(() => stayNightRows([{ ...base, children: 0, cosleep_free: 1 }]));
});

// ---- D1に入れるSQL ----
test("D1用のSQL：予約20件・泊42行、名前はすべて架空", () => {
  const sql = buildSeedSql();
  assert.equal((sql.match(/INSERT INTO reservations /g) ?? []).length, 20);
  assert.equal((sql.match(/INSERT INTO stay_nights /g) ?? []).length, 42);
  assert.ok(reservations.every((r) => r.guest_name.startsWith("架空ゲスト")));
  assert.ok(sql.includes("しおさいの家（架空）"));
});
