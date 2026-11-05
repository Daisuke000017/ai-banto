// 値付けの助言（経営企画）の自動テスト。使い方：npm test
// AIは使わない。数字も文もプログラムが決まった形で作ることを確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventNights,
  findGaps,
  guidePrice,
  isDayOff,
  longWeekends,
  monthTakeHome,
  occupancy,
  pacePlan,
  pricingItems,
  reviewCompare,
  reviewSnapshot,
  takeHome,
} from "../src/lib/pricing.js";
import { buildPatrolItems } from "../src/lib/patrol.js";
import { kpiView } from "../src/lib/kpis.js";
import { dayCounter, rulesFromInnProfile, stayNightRows } from "../src/lib/counting.js";
import { readTable, heuristicMapping, normalizeStatement } from "../src/lib/statements.js";
import { DEMO_TODAY, innProfile, reservations } from "../seed/demo-reservations.js";
import { sampleStatements } from "../seed/demo-statements.js";

const today = DEMO_TODAY;
const rules = rulesFromInnProfile(innProfile);
const counter = dayCounter(stayNightRows(reservations), today, rules);

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
const demoItems = () => pricingItems({ today, inn: innProfile, reservations, lines, counter });

/** 架空の予約（テスト用） */
const res = (id, room, checkin, checkout, extra = {}) => ({
  id, ota: "direct", room, checkin_date: checkin, checkout_date: checkout, status: "confirmed",
  amount_gross: 20000, tax_collection: "unknown", lodging_tax_collected: null, cancel_fee_amount: 0, ...extra,
});

test("休みの日：土日・祝日・年末年始。祝日の表が無い年は「分からない」", () => {
  assert.equal(isDayOff("2026-11-21"), true); // 土
  assert.equal(isDayOff("2026-11-23"), true); // 勤労感謝の日（月）
  assert.equal(isDayOff("2026-11-24"), false); // 火
  assert.equal(isDayOff("2026-12-29"), true); // 年末年始（火）
  assert.equal(isDayOff("2030-05-01"), null);
});

test("3日以上続く休み：11月の3連休と、年末年始の6連休", () => {
  const blocks = longWeekends("2026-11-01", "2027-01-08");
  assert.deepEqual(blocks.map((b) => [b.start, b.end, b.days]), [
    ["2026-11-21", "2026-11-23", 3],
    ["2026-12-29", "2027-01-03", 6],
  ]);
});

test("上げどきの夜：今日から7〜90日先の連休と、表にある行事（出典つき）", () => {
  const evs = eventNights(today);
  assert.deepEqual(evs.map((e) => e.id), ["renkyu-2026-11-21", "aotai-2026", "renkyu-2026-12-29"]);
  // 連休の最後の日は次の日が平日なので、夜に入れない
  assert.deepEqual(evs[0].nights, ["2026-11-21", "2026-11-22"]);
  assert.deepEqual(evs[1].nights, ["2026-12-12"]); // マラソンの前の晩
  for (const e of evs) {
    assert.ok(e.sources.length >= 1);
    for (const s of e.sources) assert.match(s.url, /^https:\/\//);
  }
  // 7日より近い夜は出さない（値段を変えても間に合わない）
  assert.equal(eventNights("2026-11-18").some((e) => e.id === "renkyu-2026-11-21"), false);
});

test("夜のふさがり方：部屋が決まっていない予約は「どこか1部屋」と数え、どの部屋かは言わない", () => {
  const rs = [res("X1", "A", "2026-11-21", "2026-11-23"), res("X2", null, "2026-11-22", "2026-11-23"), res("X3", "B", "2026-11-21", "2026-11-22", { status: "cancelled" })];
  assert.deepEqual(occupancy(rs, "2026-11-21", 2), { night: "2026-11-21", taken: 1, free: 1, free_rooms: ["B"], reservation_ids: ["X1"] });
  assert.deepEqual(occupancy(rs, "2026-11-22", 2), { night: "2026-11-22", taken: 2, free: 0, free_rooms: null, reservation_ids: ["X1", "X2"] });
});

test("1泊あたりの手取り＝（値段×泊数×（1−手数料）−清掃費）÷泊数", () => {
  assert.equal(takeHome({ price: 20000, nights: 2, rate: 0, cleaning: 5000 }), 17500);
  assert.equal(takeHome({ price: 20000, nights: 1, rate: 0.15, cleaning: 5000 }), 12000);
});

test("値段の目安：泊まり終えた予約の1泊あたりの平均を千円単位に", () => {
  assert.deepEqual(guidePrice(reservations, today), { price: 20000, reservations: 13, nights: 29 });
  assert.equal(guidePrice([], today), null);
});

test("180日のペース：見本の宿は上限に届かない →「埋める優先」", () => {
  const p = pacePlan(counter, today);
  assert.equal(p.policy, "fill");
  assert.equal(p.policy_label, "埋める優先");
  assert.equal(p.limit, 180);
  assert.match(p.reach_text, /上限（180日）には届きません/);
});

test("180日のペース：よく泊まる宿は上限に届く月を出し →「高い日に枠を残す」", () => {
  const busy = { fiscal_year: "2026", used_days: 150, total_days: 160, limit: 180 };
  const p = pacePlan(busy, today); // 4月1日から192日で150日
  assert.equal(p.policy, "keep");
  assert.equal(p.policy_label, "高い日に枠を残す");
  assert.match(p.reach_text, /^今のペースだと、\d+月ごろに上限（180日）に届きます$/);
  assert.equal(pacePlan(null, today), null);
});

test("月の1泊あたりの手取り：売上−手数料−清掃費。清掃費が未設定なら出さない", () => {
  const v = kpiView({ reservations, lines, rooms: innProfile.rooms, month: "2026-09", today, rules });
  const t = monthTakeHome(v, reservations, 5000);
  assert.equal(t.available, true);
  assert.equal(t.net, t.sales - t.fee - t.cleaning);
  assert.equal(t.per_night, Math.round(t.net / t.nights));
  assert.equal(t.excluded, 0);
  assert.equal(monthTakeHome(v, reservations, null).available, false);
});

test("月の1泊あたりの手取り：手数料が分からない予約は外して、外した数を出す", () => {
  const view = { rows: [
    { kind: "stay", id: "Y1", amount: 30000, fee: 3000, nights: 2, fee_basis: "statement" },
    { kind: "stay", id: "Y2", amount: 20000, fee: null, nights: 1 },
  ] };
  const rs = [res("Y1", "A", "2026-09-01", "2026-09-03"), res("Y2", "B", "2026-09-05", "2026-09-06")];
  const t = monthTakeHome(view, rs, 5000);
  assert.equal(t.excluded, 1);
  assert.equal(t.stays, 1);
  assert.equal(t.per_night, (30000 - 3000 - 5000) / 2);
  const none = monthTakeHome({ rows: [view.rows[1]] }, rs, 5000);
  assert.equal(none.available, false);
  assert.equal(none.excluded, 1);
});

test("1泊だけ空いた夜：同じ部屋の予約と予約のあいだに1泊だけ空いている夜を拾う", () => {
  const rs = [
    res("G1", "A", "2026-11-02", "2026-11-04"),
    res("G2", "A", "2026-11-05", "2026-11-07"), // 11/4 が1泊だけ空く
    res("G3", "B", "2026-11-02", "2026-11-04"),
    res("G4", "B", "2026-11-06", "2026-11-07"), // 2泊空く → 拾わない
    res("G5", "A", "2026-10-08", "2026-10-09"),
    res("G6", "A", "2026-10-10", "2026-10-11"), // 今日の夜 → 拾わない
  ];
  const gaps = findGaps(rs, today, 2);
  assert.deepEqual(gaps.map((g) => [g.room, g.night]), [["A", "2026-11-04"]]);
  // その夜に部屋未定の予約があれば、空いているとは言わない
  assert.equal(findGaps([...rs, res("G7", null, "2026-11-04", "2026-11-05")], today, 2).length, 0);
});

test("1泊だけ空いた夜の知らせ：「連泊の条件をゆるめる・少し下げると埋まりやすい」", () => {
  const rs = [res("G1", "A", "2026-11-02", "2026-11-04"), res("G2", "A", "2026-11-05", "2026-11-07")];
  const items = pricingItems({ today, inn: innProfile, reservations: rs, lines, counter }).filter((x) => x.kind === "price_gap");
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.ref_key, "price_gap:A:2026-11-04");
  assert.deepEqual(it.review, { room: "A", nights: ["2026-11-04"] });
  const text = it.facts.map((f) => `${f.label}:${f.value}`).join("\n");
  assert.match(text, /連泊の条件（何泊から泊まれるか）をゆるめる・少し下げると埋まりやすい/);
  assert.match(text, /値段と条件を決めて予約サイトに入れるのはオーナー/);
});

test("見本の宿の知らせ：上げどき3枚（3連休・マラソン前の晩・年末年始）、1泊だけの空きは無し", () => {
  const items = demoItems();
  assert.deepEqual(items.map((x) => x.ref_key), ["price_event:renkyu-2026-11-21", "price_event:aotai-2026", "price_event:renkyu-2026-12-29"]);
  for (const it of items) {
    assert.equal(it.kind, "price_event");
    assert.equal(it.can_ok, true);
    assert.equal(it.link, "kpi");
    assert.match(it.title, /^上げどき：/);
    assert.ok(it.review.nights.length >= 1);
    const labels = it.facts.map((f) => f.label);
    for (const l of ["行事", "空いている夜", "手取りの目安", "180日の方針", "出典", "決めるのは"]) assert.ok(labels.includes(l), l);
    // 「通常◯円→今だけ◯円」「売上＋◯％」のような書き方をしない
    const text = [it.title, ...it.facts.map((f) => f.value)].join("\n");
    assert.doesNotMatch(text, /通常|今だけ|％|%|→/);
  }
  const guide = items[0].facts.find((f) => f.label === "手取りの目安").value;
  assert.match(guide, /^1泊20,000円で2泊なら、1泊あたり手元に 直接 約17,500円/);
});

test("清掃費が未設定なら、手取りの目安は出さずにそう書く", () => {
  const items = pricingItems({ today, inn: { ...innProfile, cleaning_fee: null }, reservations, lines, counter });
  const f = items[0].facts.find((x) => x.label === "手取りの目安");
  assert.match(f.value, /清掃費が未設定/);
});

test("巡回：値付けの材料を渡したときだけ、値付けの知らせが入る（今までの知らせは変わらない）", () => {
  assert.deepEqual(buildPatrolItems({ today }), []);
  const items = buildPatrolItems({ today, pricing: { today, inn: innProfile, reservations, lines, counter } });
  assert.equal(items.filter((x) => x.kind === "price_event").length, 3);
});

test("「見直した／このまま」の記録：押したときに入っていた予約と、空いていた部屋×夜を残す", () => {
  const rs = [res("S1", "A", "2026-11-21", "2026-11-22")];
  const snap = reviewSnapshot(rs, { room: null, nights: ["2026-11-21", "2026-11-22"] }, 2);
  assert.deepEqual(snap, { before_ids: ["S1"], free_room_nights: 3 });
  assert.equal(reviewSnapshot(rs, { room: "A", nights: ["2026-11-21", "2026-11-22"] }, 2).free_room_nights, 1);
});

test("見直した日と、そのままの日の比べ：記録が無ければ「記録がたまると比べられます」", () => {
  assert.deepEqual(reviewCompare([], reservations, lines, 5000, 2), { empty: true, note: "記録がたまると比べられます" });
});

test("見直した日と、そのままの日の比べ：押したあとに入った予約だけを数える", () => {
  const rs = [
    res("C0", "A", "2026-11-21", "2026-11-22"), // 押す前からあった
    res("C1", "B", "2026-11-21", "2026-11-23", { amount_gross: 40000 }), // 押したあとに入った（直接・2泊）
  ];
  const reviews = [
    { choice: "reviewed", room: null, nights_json: '["2026-11-21","2026-11-22"]', before_json: '["C0"]', free_room_nights: 3 },
    { choice: "kept", room: "A", nights_json: '["2026-12-12"]', before_json: "[]", free_room_nights: 1 },
  ];
  const c = reviewCompare(reviews, rs, lines, 5000, 2);
  assert.equal(c.empty, false);
  const [rv, kp] = c.groups;
  assert.equal(rv.choice, "reviewed");
  assert.equal(rv.label, "見直した日");
  assert.equal(rv.cards, 1);
  assert.equal(rv.free_room_nights, 3);
  assert.equal(rv.filled_room_nights, 2);
  assert.equal(rv.take_home_per_night, (40000 - 5000) / 2);
  assert.equal(kp.cards, 1);
  assert.equal(kp.filled_room_nights, 0);
  assert.equal(kp.take_home_per_night, null);
});
