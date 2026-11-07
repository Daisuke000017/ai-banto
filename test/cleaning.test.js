// 清掃が必要な日（M18）の自動テスト。使い方：npm test
// プログラムだけで数える。デモの台帳には入れ替えの日がないので、入れ替えは作った予約で確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleaningDays, cleaningWindow, CLEANING_DAYS } from "../src/lib/cleaning.js";
import { ledgerChecks, emptyFields } from "../src/lib/booking-email.js";
import { DEMO_TODAY, innProfile, reservations } from "../seed/demo-reservations.js";

const seed = reservations.map((r) => ({ room: "A", status: "confirmed", ...r }));
const dates = (d) => d.items.map((i) => i.date);
const res = (id, room, checkin_date, checkout_date, extra = {}) => ({ id, ota: "airbnb", room, checkin_date, checkout_date, status: "confirmed", ...extra });

test("デモの台帳：今日（11/7）から3週間に、11/9（R21）と 11/15（R22）の2日が出る", () => {
  const d = cleaningDays(seed, DEMO_TODAY, innProfile);
  assert.equal(d.days, CLEANING_DAYS);
  assert.equal(d.from, "2026-11-07");
  assert.equal(d.to, "2026-11-27");
  // R23（11/29〜12/1）のチェックアウトは3週間の外。10月の R14・R15 は過去なので出ない
  assert.deepEqual(dates(d), ["2026-11-09", "2026-11-15"]);
  assert.deepEqual(d.items.map((i) => i.reservation_id), ["R21", "R22"]);
  assert.ok(d.items.every((i) => i.room === "A" && !i.turnover && !i.check_room));
});

test("キャンセルのメールを台帳に入れると、その日が清掃の予定から消える（見本のキャンセルメール＝R22）", () => {
  const r22 = seed.find((r) => r.id === "R22");
  const f = { ...emptyFields(), kind: "cancel", ota: r22.ota, reservation_no: r22.ota_reservation_no };
  const l = ledgerChecks(f, { existing: r22 });
  assert.equal(l.blocked, false);
  const after = seed.map((r) => (r.id === "R22" ? { ...r, ...l.after } : r));
  assert.deepEqual(dates(cleaningDays(after, DEMO_TODAY, innProfile)), ["2026-11-09"]);
});

test("取り消した予約は数えない", () => {
  const d = cleaningDays([res("X1", "A", "2026-10-11", "2026-10-13", { status: "cancelled" })], "2026-10-10");
  assert.deepEqual(d.items, []);
});

test("入れ替え：同じ部屋に同じ日のチェックインがあれば、間の時間に清掃する日にする", () => {
  const list = [res("X1", "A", "2026-10-11", "2026-10-13"), res("X2", "A", "2026-10-13", "2026-10-15"), res("X3", "B", "2026-10-12", "2026-10-13")];
  const d = cleaningDays(list, "2026-10-10");
  const a = d.items.find((i) => i.reservation_id === "X1");
  const b = d.items.find((i) => i.reservation_id === "X3");
  assert.equal(a.turnover, true);
  assert.equal(a.next_reservation_id, "X2");
  assert.equal(b.turnover, false, "部屋Bには同じ日のチェックインがない");
  assert.deepEqual(d.items.map((i) => `${i.date}${i.room}`), ["2026-10-13A", "2026-10-13B", "2026-10-15A"], "日付、部屋の順");
});

test("入れ替え：次の予約がキャンセルされたら、ふつうの清掃の日に戻る", () => {
  const list = [res("X1", "A", "2026-10-11", "2026-10-13"), res("X2", "A", "2026-10-13", "2026-10-15", { status: "cancelled" })];
  const [i] = cleaningDays(list, "2026-10-10").items;
  assert.equal(i.turnover, false);
  assert.equal(i.next_reservation_id, null);
});

test("部屋が決まっていない予約：部屋は空で出し、同じ日にチェックインがあれば確かめる印を付ける", () => {
  const list = [res("RM1", null, "2026-10-11", "2026-10-13"), res("X2", "A", "2026-10-13", "2026-10-14"), res("RM2", null, "2026-10-20", "2026-10-22")];
  const d = cleaningDays(list, "2026-10-10");
  const m1 = d.items.find((i) => i.reservation_id === "RM1");
  const m2 = d.items.find((i) => i.reservation_id === "RM2");
  assert.equal(m1.room, null);
  assert.equal(m1.turnover, false);
  assert.equal(m1.check_room, true);
  assert.equal(m2.check_room, false, "同じ日にチェックインがなければ印は付けない");
  assert.equal(d.items.at(-1).reservation_id, "RM2");
});

test("期間の端：今日のチェックアウトは入り、21日目は入り、22日目と昨日は入らない", () => {
  const list = [
    res("Y0", "A", "2026-10-08", "2026-10-09"),
    res("Y1", "A", "2026-10-09", "2026-10-10"),
    res("Y2", "B", "2026-10-28", "2026-10-30"),
    res("Y3", "B", "2026-10-30", "2026-10-31"),
  ];
  assert.deepEqual(dates(cleaningDays(list, "2026-10-10")), ["2026-10-10", "2026-10-30"]);
});

test("清掃の時間：宿の設定から読み、形が違えば 10:00〜15:00 にする", () => {
  assert.deepEqual(cleaningWindow({}), { checkout: "10:00", checkin: "15:00" });
  assert.deepEqual(cleaningWindow({ cleaning_checkout_time: "11:00", cleaning_checkin_time: "16:00" }), { checkout: "11:00", checkin: "16:00" });
  assert.deepEqual(cleaningWindow({ cleaning_checkout_time: "25:00", cleaning_checkin_time: "3pm" }), { checkout: "10:00", checkin: "15:00" });
  assert.deepEqual(cleaningDays([], "2026-10-10", { cleaning_checkout_time: "11:00" }).window, { checkout: "11:00", checkin: "15:00" });
});
