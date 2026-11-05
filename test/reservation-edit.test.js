// 予約の手入力・直す・取り消すの自動テスト。使い方：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReservationInput, roomClash, sameNumber, partyChanged, checkCancelFee, MAX_NIGHTS } from "../src/lib/reservation-edit.js";

const ok = (over = {}) => ({
  ota: "direct",
  checkin_date: "2026-12-10",
  checkout_date: "2026-12-12",
  adults: 2,
  room: "A",
  ...over,
});
const rooms = ["A", "B"];

test("正しい入力は、泊数と国籍の分からない人数を数えて返す", () => {
  const c = checkReservationInput(ok({ children: 1, nationalities: { KR: 2 }, amount_gross: 30000 }), { rooms });
  assert.equal(c.error, undefined);
  assert.equal(c.values.nights, 2);
  assert.equal(c.values.unknown_nationality, 1);
  assert.deepEqual(c.values.nationalities, { KR: 2 });
  assert.equal(c.values.tax_collection, "unknown");
  assert.equal(c.values.room, "A");
  assert.equal(c.values.ota_reservation_no, null);
});

test("空欄は0や「入れていない」とみなす", () => {
  const c = checkReservationInput(ok({ children: "", infants: null, room: "", amount_gross: "", language: "" }), { rooms });
  assert.equal(c.values.children, 0);
  assert.equal(c.values.infants, 0);
  assert.equal(c.values.room, null);
  assert.equal(c.values.amount_gross, null);
  assert.equal(c.values.language, null);
});

test("入り口・日付・泊数の間違いは、その欄を指して止める", () => {
  assert.equal(checkReservationInput(ok({ ota: "jalan" }), { rooms }).field, "ota");
  assert.equal(checkReservationInput(ok({ checkin_date: "2026-02-30" }), { rooms }).field, "checkin_date");
  assert.equal(checkReservationInput(ok({ checkin_date: "2019-12-31" }), { rooms }).field, "checkin_date");
  assert.equal(checkReservationInput(ok({ checkout_date: "2026-12-10" }), { rooms }).field, "checkout_date");
  assert.equal(checkReservationInput(ok({ checkout_date: "2026-12-09" }), { rooms }).field, "checkout_date");
  const long = checkReservationInput(ok({ checkin_date: "2026-01-01", checkout_date: "2026-03-03" }), { rooms });
  assert.equal(long.field, "checkout_date");
  assert.match(long.error, new RegExp(`${MAX_NIGHTS}泊まで`));
});

test("予約番号は英数字と - _ だけ", () => {
  assert.equal(checkReservationInput(ok({ ota_reservation_no: " TEL-1120 " }), { rooms }).values.ota_reservation_no, "TEL-1120");
  assert.equal(checkReservationInput(ok({ ota_reservation_no: "<script>" }), { rooms }).field, "ota_reservation_no");
  assert.equal(checkReservationInput(ok({ ota_reservation_no: "x".repeat(41) }), { rooms }).field, "ota_reservation_no");
});

test("人数：文字・小数・マイナス・0人は止める。添い寝は子どもの人数まで", () => {
  assert.equal(checkReservationInput(ok({ adults: "2" }), { rooms }).field, "adults");
  assert.equal(checkReservationInput(ok({ adults: 1.5 }), { rooms }).field, "adults");
  assert.equal(checkReservationInput(ok({ children: -1 }), { rooms }).field, "children");
  assert.equal(checkReservationInput(ok({ adults: 0 }), { rooms }).field, "adults");
  assert.equal(checkReservationInput(ok({ adults: 21 }), { rooms }).field, "adults");
  assert.equal(checkReservationInput(ok({ children: 1, cosleep_free: 2 }), { rooms }).field, "cosleep_free");
  assert.equal(checkReservationInput(ok({ adults: 0, infants: 1 }), { rooms }).error, undefined);
});

test("部屋：使っていない部屋・おかしな記号は止める", () => {
  assert.equal(checkReservationInput(ok({ room: "C" }), { rooms }).field, "room");
  assert.equal(checkReservationInput(ok({ room: "A'; DROP" }), { rooms }).field, "room");
  // 直すときは、止めた部屋でも今の部屋なら選べる（呼ぶ側が rooms に足す）
  assert.equal(checkReservationInput(ok({ room: "C" }), { rooms: [...rooms, "C"] }).values.room, "C");
});

test("国籍：知らない国・人数の合計オーバー・配列は止める。0人は数えない", () => {
  assert.equal(checkReservationInput(ok({ nationalities: { XX: 1 } }), { rooms }).field, "nationalities");
  assert.equal(checkReservationInput(ok({ nationalities: { KR: 3 } }), { rooms }).field, "nationalities");
  assert.equal(checkReservationInput(ok({ nationalities: [1] }), { rooms }).field, "nationalities");
  assert.equal(checkReservationInput(ok({ nationalities: { KR: 1.5 } }), { rooms }).field, "nationalities");
  const c = checkReservationInput(ok({ nationalities: { KR: 2, TW: 0 } }), { rooms });
  assert.deepEqual(c.values.nationalities, { KR: 2 });
  assert.equal(c.values.unknown_nationality, 0);
});

test("売上・宿泊税・言葉の間違いは止める", () => {
  assert.equal(checkReservationInput(ok({ amount_gross: -1 }), { rooms }).field, "amount_gross");
  assert.equal(checkReservationInput(ok({ amount_gross: "30000" }), { rooms }).field, "amount_gross");
  assert.equal(checkReservationInput(ok({ amount_gross: 10_000_001 }), { rooms }).field, "amount_gross");
  assert.equal(checkReservationInput(ok({ tax_collection: "cash" }), { rooms }).field, "tax_collection");
  assert.equal(checkReservationInput(ok({ lodging_tax_collected: -200 }), { rooms }).field, "lodging_tax_collected");
  assert.equal(checkReservationInput(ok({ language: "fr" }), { rooms }).field, "language");
  assert.equal(checkReservationInput(ok({ language: "zh-TW", tax_collection: "onsite" }), { rooms }).values.language, "zh-TW");
});

test("何も来なくても落ちない", () => {
  assert.equal(checkReservationInput(undefined).field, "ota");
  assert.equal(checkReservationInput(null, {}).field, "ota");
});

const others = [
  { id: "R1", ota: "airbnb", ota_reservation_no: "HM1", room: "A", checkin_date: "2026-12-11", checkout_date: "2026-12-13", status: "confirmed" },
  { id: "R2", ota: "direct", ota_reservation_no: null, room: "B", checkin_date: "2026-12-10", checkout_date: "2026-12-12", status: "cancelled" },
  { id: "R3", ota: "booking", ota_reservation_no: "BK9", room: "A", checkin_date: "2026-12-12", checkout_date: "2026-12-14", status: "confirmed" },
];

test("部屋の重なり：同じ部屋で夜が重なるものだけ。取り消し・自分・部屋未定は見ない", () => {
  const v = checkReservationInput(ok(), { rooms }).values; // A 12/10〜12/12
  assert.equal(roomClash(v, others)?.id, "R1");
  assert.equal(roomClash(v, others, "R1"), null); // 自分を直すとき。R3 は12/12着で重ならない
  assert.equal(roomClash({ ...v, room: "B" }, others), null); // R2 は取り消し済み
  assert.equal(roomClash({ ...v, room: null }, others), null);
  // 出る日と次の人の着く日が同じ日なら重ならない
  assert.equal(roomClash({ ...v, checkin_date: "2026-12-08", checkout_date: "2026-12-11" }, others), null);
});

test("同じ予約番号：入り口と番号が同じものだけ（自分は除く。番号なしは見ない）", () => {
  assert.equal(sameNumber({ ota: "airbnb", ota_reservation_no: "HM1" }, others)?.id, "R1");
  assert.equal(sameNumber({ ota: "airbnb", ota_reservation_no: "HM1" }, others, "R1"), null);
  assert.equal(sameNumber({ ota: "booking", ota_reservation_no: "HM1" }, others), null);
  assert.equal(sameNumber({ ota: "direct", ota_reservation_no: null }, others), null);
});

test("日付か人数が変わったときだけ「変わった」とする", () => {
  const cur = { checkin_date: "2026-12-10", checkout_date: "2026-12-12", adults: 2, children: 0, infants: 0, room: "A", amount_gross: 1 };
  assert.equal(partyChanged(cur, { ...cur, room: "B", amount_gross: 9 }), false);
  assert.equal(partyChanged(cur, { ...cur, adults: 3 }), true);
  assert.equal(partyChanged(cur, { ...cur, checkout_date: "2026-12-13" }), true);
});

test("キャンセル料：空欄は0円。マイナス・文字・上限超えは止める", () => {
  assert.deepEqual(checkCancelFee(null), { fee: 0 });
  assert.deepEqual(checkCancelFee(""), { fee: 0 });
  assert.deepEqual(checkCancelFee(5000), { fee: 5000 });
  assert.ok(checkCancelFee(-1).error);
  assert.ok(checkCancelFee("5000").error);
  assert.ok(checkCancelFee(10_000_001).error);
});

test("台帳の画面とAPIは、ログインしないと開けない（一覧で開ける道に入っていない）", async () => {
  const { isOpenPath } = await import("../src/lib/auth.js");
  for (const [m, p] of [["GET", "/api/ledger"], ["POST", "/api/ledger"], ["POST", "/api/ledger/R1"], ["POST", "/api/ledger/R1/cancel"]]) {
    assert.equal(isOpenPath(m, p), false, `${m} ${p}`);
  }
});
