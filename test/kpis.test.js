// 今月の数字（M8）の自動テスト。使い方：npm test
// 「泊まった日で数える」「宿泊税は売上に入れない」「手数料は明細→見込み→分からない」の順を確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, feeRates, kpiView, lodgingSales, monthNumbers, splitAmount } from "../src/lib/kpis.js";
import { rulesFromInnProfile } from "../src/lib/counting.js";
import { readTable, heuristicMapping, normalizeStatement } from "../src/lib/statements.js";
import { DEMO_TODAY, innProfile, reservations } from "../seed/demo-reservations.js";
import { sampleStatements } from "../seed/demo-statements.js";

const rooms = innProfile.rooms;
const today = DEMO_TODAY;
const rules = rulesFromInnProfile(innProfile);

/** 見本の明細（Airbnb・Booking.com）を読み込んだ形にする */
function demoLines() {
  const lines = [];
  for (const s of sampleStatements) {
    if (s.kind === "bank") continue;
    const t = readTable(s.text);
    const n = normalizeStatement(t, s.kind, heuristicMapping(t.header, s.kind).mapping);
    lines.push(...n.lines.map((l) => ({ ...l, ota: s.kind })));
  }
  return lines;
}
const lines = demoLines();
const month = (m, ls = lines) => monthNumbers({ reservations, lines: ls, rooms, month: m, today });

test("金額を泊数で分けても、合計はぴったり元の金額（1円もずれない）", () => {
  for (const [a, n] of [[100, 3], [84000, 3], [1, 2], [0, 4], [99999, 7]]) {
    const parts = splitAmount(a, n);
    assert.equal(parts.length, n);
    assert.equal(parts.reduce((s, x) => s + x, 0), a);
    assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
  }
});

test("月をまたぐ予約（7/31〜8/3・3泊）は、7月に1泊分・8月に2泊分が入る。宿泊税込みの分は引く", () => {
  const r = reservations.find((x) => x.checkin_date === "2026-07-31");
  assert.equal(lodgingSales(r), 84000 - 2400);
  const jul = month("2026-07").rows.find((x) => x.id === r.id);
  const aug = month("2026-08").rows.find((x) => x.id === r.id);
  assert.equal(jul.nights, 1);
  assert.equal(aug.nights, 2);
  assert.equal(jul.amount + aug.amount, 81600);
});

test("8月：売上175,400円＋キャンセル料30,000円、手数料は明細の実際の額12,210円、手取り193,190円", () => {
  const d = month("2026-08");
  assert.equal(d.sales, 175400);
  assert.equal(d.cancel_fees, 30000);
  assert.equal(d.total, 205400);
  assert.equal(d.fee, 12210);
  assert.equal(d.fee_estimate, 0);
  assert.equal(d.net, 193190);
  assert.equal(d.sales_upcoming, 0);
});

test("8月：埋まった割合は 8泊÷(2部屋×31日)＝12.9%、1部屋1泊の平均は 21,925円（キャンセル料は入れない）", () => {
  const d = month("2026-08");
  assert.equal(d.room_nights, 8);
  assert.equal(d.available_room_nights, 62);
  assert.equal(d.occupancy_pct, 12.9);
  assert.equal(d.adr, 21925);
});

test("10月：今日（10/10）より前の夜は泊まり済み、それ以降はこれから。明細がまだ無い手数料は割合で見込む", () => {
  const d = month("2026-10");
  assert.equal(d.sales, 144200);
  assert.equal(d.sales_stayed, 53400);
  assert.equal(d.sales_upcoming, 90800);
  assert.equal(d.room_nights, 7);
  assert.equal(d.fee_actual, 0);
  assert.equal(d.fee_estimate, 11580); // Airbnb 86,000×3% ＋ Booking.com 60,000×15%
  assert.equal(d.net, 132620);
  assert.deepEqual(d.fee_rates, { airbnb: 3, booking: 15 });
});

test("画面用：宿泊税（預かったお金）は売上と別に出す。前の月の数字も付ける", () => {
  const v = kpiView({ reservations, lines, rooms, month: "2026-10", today, rules });
  assert.equal(v.lodging_tax, 4200);
  assert.equal(v.sales, 144200); // 宿泊税を足していない
  assert.equal(v.previous.month, "2026-09");
  assert.equal(v.previous.total, 116200);
});

test("明細を1つも読み込んでいなければ、予約サイトの手数料は「分からない」。直接予約は0円", () => {
  const d = month("2026-08", []);
  assert.equal(d.fee, null);
  assert.equal(d.net, null);
  const direct = d.by_ota.find((o) => o.ota === "direct");
  assert.equal(direct.fee, 0);
  assert.equal(direct.net, 9000);
  assert.equal(d.by_ota.find((o) => o.ota === "airbnb").fee, null);
});

test("どの月に分けても、全部の月を足せば泊まった予約の売上の合計に戻る", () => {
  const confirmed = reservations.filter((r) => r.status === "confirmed");
  const want = confirmed.reduce((s, r) => s + lodgingSales(r), 0);
  let got = 0;
  for (let m = "2026-01"; m <= "2027-12"; m = addMonths(m, 1)) got += month(m).sales;
  assert.equal(got, want);
});

test("キャンセル料0円のキャンセルは数えない。料金込みで預かった額が分からない予約は件数を出す", () => {
  const base = { ota: "airbnb", ota_reservation_no: "X-1", checkin_date: "2026-12-01", checkout_date: "2026-12-03", adults: 2, children: 0, infants: 0, cosleep_free: 0, nationalities_json: null, guest_changes_json: null };
  const rs = [
    { ...base, id: "T1", status: "cancelled", cancel_fee_amount: 0, amount_gross: 30000, tax_collection: "ota", lodging_tax_collected: null },
    { ...base, id: "T2", status: "confirmed", cancel_fee_amount: null, amount_gross: 30000, tax_collection: "included", lodging_tax_collected: null },
  ];
  const d = monthNumbers({ reservations: rs, lines: [], rooms: 2, month: "2026-12", today });
  assert.equal(d.cancel_fees, 0);
  assert.equal(d.sales, 30000);
  assert.equal(d.unknown_tax_included, 1);
  assert.deepEqual(d.nationalities, [{ code: "UNKNOWN", persons: 2 }]);
});

test("明細の割合は、金額のある行だけで出す", () => {
  const r = feeRates([
    { ota: "airbnb", gross: 10000, fee: 300 },
    { ota: "airbnb", gross: -5000, fee: -150 },
    { ota: "airbnb", gross: null, fee: 100 },
  ]);
  assert.equal(r.airbnb, 0.03);
});

test("部屋の数が無いときは止める（稼働率が出せないため）", () => {
  assert.throws(() => monthNumbers({ reservations, lines, rooms: 0, month: "2026-08", today }));
});
