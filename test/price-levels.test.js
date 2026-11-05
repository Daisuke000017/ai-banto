// 料金のレベル（プログラムの部分）の自動テスト。使い方：npm test
// AIは使わない。はっきりした夜のレベルと、歯止めをプログラムが守ることを確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedGrayLevels, applyChanges, levelCounts, levelTable, peakName, planLevels } from "../src/lib/price-levels.js";
import { candidateNights, eventNights, pricingItems } from "../src/lib/pricing.js";
import { DEMO_TODAY, innProfile, reservations } from "../seed/demo-reservations.js";

const today = DEMO_TODAY;
const inn = { ...innProfile, room_list: ["A", "B"] };
const byNight = (plan) => new Map(plan.nights.map((n) => [n.night, n]));

test("年末年始・お盆の夜を見分ける", () => {
  assert.equal(peakName("2026-12-29"), "年末年始");
  assert.equal(peakName("2027-01-03"), "年末年始");
  assert.equal(peakName("2027-01-04"), null);
  assert.equal(peakName("2027-08-13"), "お盆");
  assert.equal(peakName("2027-08-17"), null);
});

test("デモの宿：連休はレベル3、青島太平洋マラソンの前の晩はレベル3、年末年始はレベル4", () => {
  const plan = planLevels({ today, inn, reservations });
  const m = byNight(plan);
  assert.equal(plan.from, "2026-10-17");
  assert.equal(m.get("2026-11-21").level, 3);
  assert.equal(m.get("2026-11-22").level, 3);
  assert.equal(m.get("2026-11-22").gray, false);
  assert.equal(m.get("2026-12-12").level, 3);
  assert.match(m.get("2026-12-12").reason, /青島太平洋マラソン/);
  for (const n of ["2026-12-29", "2026-12-31", "2027-01-03"]) {
    assert.equal(m.get(n).level, 4, n);
    assert.equal(m.get(n).reason, "年末年始の夜");
  }
  // ふつうの水曜はグレー（いったんレベル2）
  assert.equal(m.get("2026-11-18").gray, true);
  assert.equal(m.get("2026-11-18").level, 2);
  assert.equal(m.get("2026-11-18").by, "program");
  // 7日より前は出さない
  assert.equal(m.has("2026-10-16"), false);
});

test("満室の夜は外す", () => {
  const extra = { id: "X1", room: "B", status: "confirmed", checkin_date: "2026-10-24", checkout_date: "2026-10-26", adults: 2 };
  const plan = planLevels({ today, inn, reservations: [...reservations, extra] });
  const m = byNight(plan);
  assert.equal(m.has("2026-10-24"), false);
  assert.equal(m.has("2026-10-25"), false);
  assert.equal(m.has("2026-10-26"), true);
  assert.equal(plan.full_nights, 2);
});

test("最低価格を割るレベルは選べない・未設定も選べない", () => {
  const t = levelTable({ ...inn, price_l1: 6000 });
  assert.equal(t.levels[0].usable, false);
  assert.match(t.levels[0].why, /最低価格/);
  assert.deepEqual(allowedGrayLevels(t), [2, 3]);
  const none = levelTable({ ...inn, price_l1: null, price_l2: null, price_l3: null, price_l4: null });
  assert.equal(none.set, false);
  assert.deepEqual(allowedGrayLevels(none), []);
  assert.ok(none.problems.length);
});

test("AIの変更はグレーな夜だけ・1〜3だけ・使えるレベルだけ重ねる", () => {
  const plan = planLevels({ today, inn: { ...inn, price_l1: 6000 }, reservations });
  const after = new Map(applyChanges(plan, [
    { night: "2026-11-18", level: 3, reason: "テスト" }, // グレー → 変わる
    { night: "2026-11-19", level: 1, reason: "テスト" }, // レベル1は最低価格割れ → 変わらない
    { night: "2026-11-20", level: 4, reason: "テスト" }, // グレーで4は選べない → 変わらない
    { night: "2026-12-12", level: 1, reason: "テスト" }, // 決まった夜 → 変わらない
  ]).map((n) => [n.night, n]));
  assert.equal(after.get("2026-11-18").level, 3);
  assert.equal(after.get("2026-11-18").by, "ai");
  assert.equal(after.get("2026-11-19").level, 2);
  assert.equal(after.get("2026-11-20").level, 2);
  assert.equal(after.get("2026-12-12").level, 3);
  assert.equal(after.get("2026-12-12").by, "program");
});

test("夜の数をレベルごとに数える", () => {
  const c = levelCounts([{ level: 1 }, { level: 2 }, { level: 2 }, { level: 4 }]);
  assert.deepEqual(c, { 1: 1, 2: 2, 3: 0, 4: 1 });
});

test("行事の候補の泊まる夜：1日なら前の晩と当日の晩、何日も続くなら前の晩〜最後の日の前の晩", () => {
  assert.deepEqual(candidateNights({ start_day: "2026-11-15", end_day: "2026-11-15" }), ["2026-11-14", "2026-11-15"]);
  assert.deepEqual(candidateNights({ start_day: "2026-11-14", end_day: "2026-11-16" }), ["2026-11-13", "2026-11-14", "2026-11-15"]);
});

test("オーナーが OK した行事の候補は、上げどきとレベル3の夜になる", () => {
  const cand = { id: 7, name: "見本の花火大会", start_day: "2026-11-07", end_day: "2026-11-07", place: "宮崎市", found_by: "sample" };
  const ev = eventNights(today, [cand]).find((e) => e.id === "cand-7");
  assert.ok(ev);
  assert.deepEqual(ev.nights, ["2026-11-06", "2026-11-07"]);
  assert.equal(ev.sources[0].name, "デモの見本（実在しない行事）");

  const m = byNight(planLevels({ today, inn, reservations, events: [cand] }));
  assert.equal(m.get("2026-11-06").level, 3);
  assert.equal(m.get("2026-11-06").event_id, "cand-7");

  const items = pricingItems({ today, inn, reservations, events: [cand] });
  const it = items.find((x) => x.ref_key?.includes("cand-7"));
  assert.ok(it, "上げどきの知らせが出る");
  const lv = it.facts.find((f) => f.label === "料金のレベル");
  assert.match(lv.value, /レベル3（1泊14,000円）/);
});

test("年末年始の上げどきはレベル4を勧める", () => {
  const items = pricingItems({ today, inn, reservations });
  const all = items.flatMap((x) => x.facts ?? []).filter((f) => f.label === "料金のレベル");
  assert.ok(all.some((f) => /レベル3（1泊14,000円）/.test(f.value)));
  // 書いてはいけない言い方が入っていない
  for (const f of all) assert.doesNotMatch(f.value, /通常|今だけ|割引|%|％|売上/);
});
