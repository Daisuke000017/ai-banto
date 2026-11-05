// 部屋の登録と宿の設定の自動テスト。使い方：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomCodes, nextRoomCode, roomLabel, checkRoomName, isRoomCode, MAX_ROOMS } from "../src/lib/rooms.js";
import { checkInnPatch } from "../src/lib/inn-settings.js";
import { stayCalendar } from "../src/lib/calendar.js";
import { cleaningDays } from "../src/lib/cleaning.js";
import { findGaps, occupancy } from "../src/lib/pricing.js";

const R = (id, room, checkin_date, checkout_date) => ({
  id, room, ota: "airbnb", checkin_date, checkout_date, adults: 2, children: 0, infants: 0, status: "confirmed",
});

test("部屋の記号：配列・行・数のどれでも同じ並びにする。おかしな記号は落とす", () => {
  assert.deepEqual(roomCodes(["A", "C"]), ["A", "C"]);
  assert.deepEqual(roomCodes([{ code: "B", name: "和室" }, { code: "A" }]), ["B", "A"]);
  assert.deepEqual(roomCodes(3), ["A", "B", "C"]);
  assert.deepEqual(roomCodes(0), []);
  assert.deepEqual(roomCodes(["a", "AB", "", null, "D"].filter((x) => x !== null)), ["D"]);
  assert.equal(roomCodes(99).length, MAX_ROOMS);
  assert.equal(isRoomCode("Z"), true);
  assert.equal(isRoomCode("z"), false);
});

test("次の記号：空いているいちばん前。26部屋で終わり", () => {
  assert.equal(nextRoomCode([]), "A");
  assert.equal(nextRoomCode([{ code: "A" }, { code: "C" }]), "B");
  assert.equal(nextRoomCode(roomCodes(26)), null);
});

test("部屋の名前：付けた名前、無ければ「部屋X」、部屋が無ければ「部屋未定」", () => {
  const list = [{ code: "A", name: "和室" }];
  assert.equal(roomLabel(list, "A"), "和室");
  assert.equal(roomLabel(list, "B"), "部屋B");
  assert.equal(roomLabel(list, null), "部屋未定");
  assert.equal(roomLabel(undefined, "C"), "部屋C");
});

test("部屋の名前の入力：空・長すぎは断る。制御文字は消して前後の空白を取る", () => {
  assert.deepEqual(checkRoomName("  離れ（2階）\n"), { name: "離れ（2階）" });
  assert.ok(checkRoomName("").error);
  assert.ok(checkRoomName("   ").error);
  assert.ok(checkRoomName(5).error);
  assert.ok(checkRoomName("あ".repeat(21)).error);
  assert.deepEqual(checkRoomName("あ".repeat(20)), { name: "あ".repeat(20) });
});

test("宿の設定：送った項目だけ確かめる。金額のカンマは取り、空は「なし」にする", () => {
  const cur = { cleaning_checkout_time: "10:00", cleaning_checkin_time: "15:00" };
  assert.deepEqual(checkInnPatch({ cleaning_fee: "6,000" }, cur), { values: { cleaning_fee: 6000 } });
  assert.deepEqual(checkInnPatch({ min_price: "" }, cur), { values: { min_price: null } });
  assert.deepEqual(checkInnPatch({ address: "" }, cur), { values: { address: null } });
  assert.deepEqual(checkInnPatch({ notification_no: "M012345678" }, cur), { values: { notification_no: "M012345678" } });
  assert.deepEqual(checkInnPatch({ notification_no: "第M012345678号" }, cur), { values: { notification_no: "第M012345678号" } });
});

test("宿の設定：まちがいは断る", () => {
  const cur = { cleaning_checkout_time: "10:00", cleaning_checkin_time: "15:00" };
  assert.ok(checkInnPatch({ name: "" }, cur).error);
  assert.ok(checkInnPatch({ name: "あ".repeat(41) }, cur).error);
  assert.ok(checkInnPatch({ notification_no: "M01 234" }, cur).error);
  assert.ok(checkInnPatch({ notification_no: "<b>" }, cur).error);
  assert.ok(checkInnPatch({ notification_no: "-M012345678" }, cur).error); // 先頭の「-」は表計算で式とみなされうる
  assert.ok(checkInnPatch({ cleaning_fee: "-1" }, cur).error);
  assert.ok(checkInnPatch({ cleaning_fee: "1.5" }, cur).error);
  assert.ok(checkInnPatch({ min_price: 2_000_000 }, cur).error);
  assert.ok(checkInnPatch({ cleaning_checkout_time: "9:00" }, cur).error);
  assert.ok(checkInnPatch({}, cur).error);
  // チェックアウトはチェックインより前（片方だけ変えても、いまの値と比べる）
  assert.ok(checkInnPatch({ cleaning_checkout_time: "16:00" }, cur).error);
  assert.ok(checkInnPatch({ cleaning_checkin_time: "09:00" }, cur).error);
  assert.deepEqual(checkInnPatch({ cleaning_checkout_time: "11:00" }, cur), { values: { cleaning_checkout_time: "11:00" } });
});

test("3部屋のカレンダー：登録した部屋の順で数え、部屋Cも空き数に入る", () => {
  const rooms = [{ code: "A", name: "和室" }, { code: "B", name: "洋室" }, { code: "C", name: "離れ" }];
  const cal = stayCalendar([R(1, "C", "2026-10-12", "2026-10-14"), R(2, "C", "2026-10-13", "2026-10-15")], "2026-10", "2026-10-10", rooms);
  assert.deepEqual(cal.rooms, ["A", "B", "C"]);
  assert.equal(cal.summary.room_nights, 31 * 3);
  assert.equal(cal.summary.nights.C, 4);
  assert.deepEqual(cal.days.find((d) => d.date === "2026-10-13").overlap_rooms, ["C"]);
});

test("止めた部屋（並びに無い部屋）の予約は「部屋未定」として数える", () => {
  const cal = stayCalendar([R(1, "B", "2026-10-12", "2026-10-13")], "2026-10", "2026-10-10", ["A"]);
  assert.equal(cal.summary.nights.unknown, 1);
});

test("3部屋の清掃：部屋Cの入れ替えも見つけ、並びは登録した順", () => {
  const inn = { room_list: [{ code: "C", name: "離れ" }, { code: "A", name: "和室" }] };
  const d = cleaningDays([R(1, "A", "2026-10-10", "2026-10-12"), R(2, "C", "2026-10-10", "2026-10-12"), R(3, "C", "2026-10-12", "2026-10-13")], "2026-10-10", inn);
  const day12 = d.items.filter((i) => i.date === "2026-10-12");
  assert.deepEqual(day12.map((i) => i.room), ["C", "A"]);
  assert.equal(day12[0].turnover, true);
  assert.equal(day12[1].turnover, false);
});

test("3部屋の値付け：部屋Cの1泊の空きを見つけ、空き部屋に C を数える", () => {
  const res = [R(1, "C", "2026-10-20", "2026-10-22"), R(2, "C", "2026-10-23", "2026-10-25")];
  const gaps = findGaps(res, "2026-10-10", ["A", "B", "C"]);
  assert.deepEqual(gaps.map((g) => [g.room, g.night]), [["C", "2026-10-22"]]);
  const occ = occupancy(res, "2026-10-21", ["A", "B", "C"]);
  assert.equal(occ.free, 2);
  assert.deepEqual(occ.free_rooms, ["A", "B"]);
});
