// 宿泊カレンダー（M21）の自動テスト。使い方：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { stayCalendar, daysOfMonth } from "../src/lib/calendar.js";

const TODAY = "2026-10-10";
const R = (id, room, checkin_date, checkout_date, extra = {}) => ({
  id, room, ota: "airbnb", checkin_date, checkout_date, adults: 2, children: 0, infants: 0, status: "confirmed", ...extra,
});
const day = (cal, date) => cal.days.find((d) => d.date === date);

test("月の日付：うるう年の2月・30日の月・12月", () => {
  assert.equal(daysOfMonth("2028-02").length, 29);
  assert.equal(daysOfMonth("2026-02").length, 28);
  assert.equal(daysOfMonth("2026-11").length, 30);
  assert.equal(daysOfMonth("2026-12").at(-1), "2026-12-31");
  assert.throws(() => daysOfMonth("2026-13"));
  assert.throws(() => daysOfMonth("2026-1"));
});

test("泊まる夜にだけ入れる。チェックアウトの日は泊まりに入れず、清掃の日として出す", () => {
  const cal = stayCalendar([R(1, "A", "2026-10-12", "2026-10-15")], "2026-10", TODAY);
  assert.equal(cal.first_weekday, 4); // 2026年10月1日は木曜
  assert.equal(day(cal, "2026-10-11").stays.length, 0);
  const d12 = day(cal, "2026-10-12").stays[0];
  assert.equal(d12.arrives, true);
  assert.equal(d12.night_no, 1);
  assert.equal(d12.nights, 3);
  assert.equal(day(cal, "2026-10-14").stays[0].night_no, 3);
  assert.equal(day(cal, "2026-10-15").stays.length, 0);
  assert.equal(day(cal, "2026-10-15").departures[0].reservation_id, 1);
  assert.equal(cal.summary.nights.A, 3);
  assert.equal(cal.summary.departures, 1);
  assert.equal(day(cal, TODAY).is_today, true);
});

test("取り消した予約・日付がこわれた予約は入れない", () => {
  const cal = stayCalendar(
    [R(1, "A", "2026-10-12", "2026-10-14", { status: "cancelled" }), R(2, "B", "2026-10-20", "2026-10-18"), R(3, "B", "こわれた", "2026-10-18")],
    "2026-10",
    TODAY,
  );
  assert.ok(cal.days.every((d) => d.stays.length === 0 && d.departures.length === 0));
  assert.equal(cal.summary.reservations, 0);
});

test("月をまたぐ連泊：その月の夜だけ数え、何泊目かは予約の初めから数える", () => {
  const res = [R(1, "B", "2026-10-30", "2026-11-03")];
  const oct = stayCalendar(res, "2026-10", TODAY);
  assert.equal(oct.summary.nights.B, 2);
  assert.equal(oct.summary.departures, 0);
  const nov = stayCalendar(res, "2026-11", TODAY);
  assert.equal(nov.summary.nights.B, 2);
  assert.equal(day(nov, "2026-11-01").stays[0].night_no, 3);
  assert.equal(day(nov, "2026-11-01").stays[0].arrives, false);
  assert.equal(day(nov, "2026-11-03").departures.length, 1);
});

test("部屋が決まっていない予約は「部屋未定」として数え、空きを1つ減らす", () => {
  const cal = stayCalendar([R(1, null, "2026-10-12", "2026-10-13"), R(2, "C", "2026-10-12", "2026-10-13")], "2026-10", TODAY);
  const d = day(cal, "2026-10-12");
  assert.deepEqual(d.stays.map((s) => s.room), [null, null]);
  assert.equal(cal.summary.nights.unknown, 2);
  assert.equal(cal.summary.free_room_nights, 31 * 2 - 2);
});

test("入れ替えの日：同じ日にチェックアウトとチェックイン。部屋の順（A→B→未定）に並べる", () => {
  const cal = stayCalendar([R(2, "B", "2026-10-14", "2026-10-16"), R(1, "A", "2026-10-12", "2026-10-14"), R(3, "A", "2026-10-14", "2026-10-15")], "2026-10", TODAY);
  const d = day(cal, "2026-10-14");
  assert.deepEqual(d.departures.map((r) => r.reservation_id), [1]);
  assert.deepEqual(d.stays.map((s) => [s.room, s.reservation_id, s.arrives]), [["A", 3, true], ["B", 2, true]]);
  assert.deepEqual(d.overlap_rooms, []);
});

test("同じ部屋・同じ夜に予約が重なっていたら知らせる", () => {
  const cal = stayCalendar([R(1, "A", "2026-10-12", "2026-10-14"), R(2, "A", "2026-10-13", "2026-10-15")], "2026-10", TODAY);
  assert.deepEqual(cal.overlaps, [{ date: "2026-10-13", rooms: ["A"] }]);
  assert.deepEqual(day(cal, "2026-10-13").overlap_rooms, ["A"]);
  assert.deepEqual(day(cal, "2026-10-12").overlap_rooms, []);
});

test("宿泊者の名前は、渡しても出さない", () => {
  const cal = stayCalendar([R(1, "A", "2026-10-12", "2026-10-14", { guest_name: "架空 花子", ota_reservation_no: "HMXXXX" })], "2026-10", TODAY);
  const text = JSON.stringify(cal);
  assert.ok(!text.includes("花子"));
  assert.ok(!text.includes("HMXXXX"));
});
