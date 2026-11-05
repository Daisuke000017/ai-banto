// 清掃の担当と割り当ての自動テスト。使い方：npm test
// プログラムだけで扱う（AIは使わない）。担当の人は名前だけ。文面はオーナーがコピーして送る
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCleanerName, cleanerNameKey, checkAssignment, withAssignments, cleanerMessage, CLEANER_NAME_MAX } from "../src/lib/cleaners.js";
import { cleaningDays } from "../src/lib/cleaning.js";
import { DEMO_TODAY, innProfile, reservations, cleaners as demoCleaners, cleaningAssignments } from "../seed/demo-reservations.js";

const W = { checkout: "10:00", checkin: "15:00" };
const roomList = [{ code: "A", name: "和室" }, { code: "B", name: "洋室" }];
const people = [
  { id: 1, name: "さくら", active: true },
  { id: 2, name: "みなと", active: true },
  { id: 3, name: "そら", active: false },
];
const item = (reservation_id, date, room, turnover = false) => ({ reservation_id, date, room, turnover, ota: "airbnb" });
const items = [item("R1", "2026-10-12", "A"), item("R2", "2026-10-12", "B", true), item("R3", "2026-10-14", "A")];

test("名前：空白をそろえ、空・長すぎ・文字でないものは止める", () => {
  assert.deepEqual(checkCleanerName("  山田　 花子 "), { name: "山田 花子" });
  assert.ok(checkCleanerName("").error);
  assert.ok(checkCleanerName("   ").error);
  assert.ok(checkCleanerName(null).error);
  assert.ok(checkCleanerName(12).error);
  assert.ok(checkCleanerName("あ".repeat(CLEANER_NAME_MAX + 1)).error);
  assert.equal(checkCleanerName("あ".repeat(CLEANER_NAME_MAX)).name.length, CLEANER_NAME_MAX);
  assert.deepEqual(checkCleanerName("a\u0000b"), { name: "ab" });
  // 見えない文字・文字の向きを変える記号は消す
  assert.deepEqual(checkCleanerName("さ\u200bくら"), { name: "さくら" });
  assert.deepEqual(checkCleanerName("\u202eさくら"), { name: "さくら" });
  assert.deepEqual(checkCleanerName("さ\u00adく\u061cら\ufe0f"), { name: "さくら" });
});

test("同じ人かどうかは、全角・半角と大文字・小文字をそろえて比べる", () => {
  assert.equal(cleanerNameKey("Ａさん"), cleanerNameKey("aさん"));
  assert.equal(cleanerNameKey("さくら（架空）"), cleanerNameKey("さくら(架空)"));
  assert.notEqual(cleanerNameKey("さくら"), cleanerNameKey("みなと"));
});

test("割り当て：一覧にある日・使っている人だけ。null は担当なしに戻す", () => {
  const ctx = { items, cleaners: people };
  assert.deepEqual(checkAssignment({ reservation_id: "R1", cleaner_id: 2 }, ctx).values, { reservation_id: "R1", date: "2026-10-12", room: "A", cleaner_id: 2 });
  assert.deepEqual(checkAssignment({ reservation_id: "R1", cleaner_id: null }, ctx).values, { reservation_id: "R1", date: "2026-10-12", room: "A", cleaner_id: null });
  assert.ok(checkAssignment({ reservation_id: "R9", cleaner_id: 1 }, ctx).error); // 3週間の一覧にない
  assert.ok(checkAssignment({ reservation_id: "R1", cleaner_id: 9 }, ctx).error); // いない人
  assert.match(checkAssignment({ reservation_id: "R1", cleaner_id: 3 }, ctx).error, /止めている/);
  assert.ok(checkAssignment({ reservation_id: "R1", cleaner_id: "1" }, ctx).error); // 文字は止める
  assert.ok(checkAssignment({ reservation_id: "R1" }, ctx).error); // 担当の欄がない
  assert.ok(checkAssignment({ reservation_id: 1, cleaner_id: 1 }, ctx).error);
  assert.ok(checkAssignment(undefined, ctx).error);
});

test("同じ日に同じ人が2部屋なら知らせる。別の人・別の日は知らせない", () => {
  const out = withAssignments(
    items,
    [
      { reservation_id: "R1", date: "2026-10-12", room: "A", cleaner_id: 1 },
      { reservation_id: "R2", date: "2026-10-12", room: "B", cleaner_id: 1 },
      { reservation_id: "R3", date: "2026-10-14", room: "A", cleaner_id: 1 },
    ],
    people,
    { window: W, roomList },
  );
  assert.deepEqual(out.map((i) => i.same_day), [2, 2, 0]);
  assert.equal(out[0].cleaner_name, "さくら");
  const split = withAssignments(items, [{ reservation_id: "R1", date: "2026-10-12", room: "A", cleaner_id: 1 }, { reservation_id: "R2", date: "2026-10-12", room: "B", cleaner_id: 2 }], people, { window: W, roomList });
  assert.deepEqual(split.map((i) => i.same_day), [0, 0, 0]);
  assert.equal(split[2].cleaner_id, null);
  assert.equal(split[2].message, null);
});

test("予約の出る日が変わったら、前の割り当ては使わず「選び直す」にする", () => {
  const out = withAssignments(items, [{ reservation_id: "R3", date: "2026-10-13", room: "A", cleaner_id: 2 }], people, { window: W, roomList });
  assert.equal(out[2].cleaner_id, null);
  assert.equal(out[2].reassign, true);
  assert.equal(out[2].reassign_reason, "date");
  assert.equal(out[0].reassign, false);
});

test("予約の部屋が変わったら、前の割り当ては使わず「選び直す」にする（本人が前の部屋に行かないように）", () => {
  const out = withAssignments(items, [{ reservation_id: "R1", date: "2026-10-12", room: "B", cleaner_id: 1 }], people, { window: W, roomList });
  assert.equal(out[0].cleaner_id, null);
  assert.equal(out[0].message, null);
  assert.equal(out[0].reassign_reason, "room");
  // 部屋が未定のまま割り当て → あとで部屋が決まったら選び直す
  const later = withAssignments([item("R5", "2026-10-12", "A")], [{ reservation_id: "R5", date: "2026-10-12", room: null, cleaner_id: 1 }], people, { window: W, roomList });
  assert.equal(later[0].reassign_reason, "room");
});

test("止めた人でも、もう決めた割り当ては見せる（替えるのはオーナー）", () => {
  const out = withAssignments(items, [{ reservation_id: "R1", date: "2026-10-12", room: "A", cleaner_id: 3 }], people, { window: W, roomList });
  assert.equal(out[0].cleaner_name, "そら");
  assert.equal(out[0].cleaner_active, false);
  assert.equal(out[0].message, null); // 止めた人あての文面（コピーのボタン）は出さない
});

test("文面：日にち・部屋の名前・時間だけ。入れ替えの日は時間の幅を書く", () => {
  const one = cleanerMessage({ name: "さくら", date: "2026-10-14", jobs: [items[2]], window: W, roomList, innName: "架空の宿" });
  assert.match(one, /^さくらさん/);
  assert.match(one, /日にち：10月14日（水）/);
  assert.match(one, /部屋：和室/);
  assert.match(one, /時間：10:00以降/);
  assert.match(one, /架空の宿$/);
  const two = cleanerMessage({ name: "さくら", date: "2026-10-12", jobs: [items[0], items[1]], window: W, roomList });
  assert.match(two, /・和室：10:00以降/);
  assert.match(two, /・洋室：10:00〜15:00のあいだ/);
  assert.match(two, /この日は2部屋です/);
  const noRoom = cleanerMessage({ name: "さくら", date: "2026-10-12", jobs: [item("R5", "2026-10-12", null)], window: W, roomList });
  assert.match(noRoom, /部屋：部屋はあとで知らせます/);
});

test("文面には、ゲストのこと（予約の入り口・番号）や暗証番号を入れない", () => {
  const out = withAssignments(
    [{ ...items[0], ota: "airbnb", reservation_id: "R1", next_reservation_id: "R7" }],
    [{ reservation_id: "R1", date: "2026-10-12", room: "A", cleaner_id: 1 }],
    people,
    { window: W, roomList },
  );
  for (const bad of [/airbnb/i, /R1\b/, /R7/, /暗証/, /ゲスト/]) assert.doesNotMatch(out[0].message, bad);
});

test("デモの台帳：10/12 はさくら（架空）さん、10/26 はまだ決まっていない", () => {
  const seed = reservations.map((r) => ({ room: "A", status: "confirmed", ...r }));
  const d = cleaningDays(seed, DEMO_TODAY, innProfile);
  const people = demoCleaners.map((c) => ({ ...c, active: true }));
  const out = withAssignments(d.items, cleaningAssignments, people, { window: d.window, roomList: [{ code: "A", name: "部屋A" }] });
  assert.deepEqual(out.map((i) => i.cleaner_name), ["さくら（架空）", null]);
  assert.ok(demoCleaners.every((c) => c.name.includes("架空")));
});

test("清掃の担当のAPIは、ログインしないと開けない（一覧で開ける道に入っていない）", async () => {
  const { isOpenPath } = await import("../src/lib/auth.js");
  for (const [m, p] of [["GET", "/api/cleaning"], ["POST", "/api/cleaners"], ["POST", "/api/cleaners/1"], ["POST", "/api/cleaning/assign"]]) {
    assert.equal(isOpenPath(m, p), false, `${m} ${p}`);
  }
});

test("カレンダー：日付と部屋が合う割り当てだけ、チェックアウトに担当の名前を付ける", async () => {
  const { markCleaners } = await import("../src/lib/cleaners.js");
  const { stayCalendar } = await import("../src/lib/calendar.js");
  const R = (id, room, ci, co) => ({ id, ota: "airbnb", room, checkin_date: ci, checkout_date: co, adults: 1, children: 0, infants: 0, status: "confirmed" });
  const cal = stayCalendar([R(1, "A", "2026-10-10", "2026-10-12"), R(2, "B", "2026-10-10", "2026-10-12"), R(3, "A", "2026-10-13", "2026-10-15")], "2026-10", "2026-10-01");
  const people = [{ id: 1, name: "さくら(架空)", active: true }, { id: 2, name: "もみじ(架空)", active: false }];
  const asg = [
    { reservation_id: 1, date: "2026-10-12", room: "A", cleaner_id: 1 },
    { reservation_id: 2, date: "2026-10-12", room: "A", cleaner_id: 1 }, // 部屋がちがう → 付けない
    { reservation_id: 3, date: "2026-10-15", room: "A", cleaner_id: 2 }, // 止めた人
  ];
  const out = markCleaners(cal, asg, people);
  const d12 = out.days.find((d) => d.date === "2026-10-12").departures;
  assert.equal(d12.find((r) => r.reservation_id === 1).cleaner_name, "さくら(架空)");
  assert.equal(d12.find((r) => r.reservation_id === 2).cleaner_name, null);
  const d15 = out.days.find((d) => d.date === "2026-10-15").departures[0];
  assert.equal(d15.cleaner_name, "もみじ(架空)");
  assert.equal(d15.cleaner_active, false);
  // 日付がずれた割り当ては付けない
  const moved = markCleaners(cal, [{ reservation_id: 1, date: "2026-10-11", room: "A", cleaner_id: 1 }], people);
  assert.equal(moved.days.find((d) => d.date === "2026-10-12").departures[0].cleaner_name, null);
  // 元のカレンダーは書きかえない
  assert.equal(cal.days.find((d) => d.date === "2026-10-12").departures[0].cleaner_name, undefined);
});
