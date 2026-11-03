// 予約メール（M17）の自動テスト。使い方：npm test
// AIを呼ばずに、プログラム側の「伏せる・確かめる・台帳と照らす」が正しく動くかを確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MASK,
  checkExtracted,
  findAmounts,
  findCounts,
  findDates,
  ledgerChecks,
  maskEmail,
  normalizeOwnerFields,
  emptyFields,
  splitSuspicious,
} from "../src/lib/booking-email.js";
import { sampleEmails } from "../seed/demo-booking-emails.js";
import { DEMO_TODAY } from "../seed/demo-reservations.js";

const sample = (key) => sampleEmails.find((s) => s.key === key);
const masked = (key) => {
  const s = sample(key);
  return maskEmail(s.subject, s.body);
};
const fieldsOf = (o) => ({ ...emptyFields(), ...o });

// ---- ① 伏せる ----
test("伏せる：日本語の予約メール（名前・電話・メールが消え、予約番号と日付は残る）", () => {
  const m = masked("airbnb_new");
  assert.ok(!m.body.includes("架空"), "名前が残っている");
  assert.ok(!m.body.includes("太郎"), "下の名前だけでも残っていない");
  assert.ok(!m.body.includes("090-1234-5678"), "電話が残っている");
  assert.ok(!m.body.includes("taro.demo@"), "メールの名前部分が残っている");
  assert.ok(m.body.includes("GUEST_1"));
  assert.ok(m.body.includes(`${MASK}@example.com`), "メールのドメインは残す");
  assert.ok(m.body.includes("HMDEMO7Q2X"), "予約番号は残す");
  assert.ok(m.body.includes("2026年11月20日"));
  assert.ok(m.body.includes("¥54,000"));
  assert.ok(m.counts.name >= 2 && m.counts.phone === 1 && m.counts.email === 2);
});

test("伏せる：英語の予約メール（Guest name・国際電話）", () => {
  const m = masked("booking_new_en");
  assert.ok(!m.body.includes("Alex"));
  assert.ok(!m.body.includes("415 555 0134"));
  assert.ok(m.body.includes("4821067735"), "予約番号（数字だけ）は電話と取り違えない");
  assert.ok(m.body.includes("December 5, 2026"));
});

test("伏せる：住所とリンク", () => {
  const r = masked("rakuten_new");
  assert.ok(!r.body.includes("架空市"));
  assert.ok(!r.body.includes("次郎"));
  assert.ok(r.body.includes("RT-DEMO-20270110"));
  assert.equal(r.counts.address, 1);
  const p = masked("phishing");
  assert.ok(!p.body.includes("login-check-demo"));
  assert.equal(p.counts.url, 1);
});

test("伏せる：どの見本でも、元の名前・電話・個人のメールが残らない", () => {
  const secrets = ["架空 太郎", "架空 花子", "架空 次郎", "架空 三郎", "架空 四郎", "Alex Demo", "Demo Guest", "090-1234-5678", "taro.demo", "alex.demo", "宮崎県架空市"];
  for (const s of sampleEmails) {
    const m = maskEmail(s.subject, s.body);
    for (const x of secrets) assert.ok(!`${m.subject}\n${m.body}`.includes(x), `${s.key} に「${x}」が残っている`);
  }
});

// ---- 指示のような行 ----
test("あやしい指示の行を見つけて、ふつうの行と分ける", () => {
  const { suspicious, clean } = splitSuspicious(masked("injection").body);
  assert.equal(suspicious.length, 2);
  assert.ok(!clean.includes("大人10名"));
  assert.ok(!clean.includes("DEMO-0016"));
  assert.ok(clean.includes("HMDEMO9K4P"));
  assert.equal(splitSuspicious(masked("airbnb_new").body).suspicious.length, 0, "ふつうの予約メールは引っかからない");
});

// ---- 本文から拾う ----
test("日付を拾う：年あり・年なし・英語・スラッシュ", () => {
  const ja = findDates("変更前：2026年11月3日〜11月5日", DEMO_TODAY);
  assert.deepEqual([...ja.keys()], ["2026-11-03", "2026-11-05"]);
  assert.equal(ja.get("2026-11-05").guessed, false, "直前に年があれば推測ではない");
  const noYear = findDates("12月29日〜1月2日", DEMO_TODAY);
  assert.deepEqual([...noYear.keys()], ["2026-12-29", "2027-01-02"], "年をまたぐ");
  assert.equal(noYear.get("2026-12-29").guessed, true);
  assert.ok(findDates("Check-in: Saturday, December 5, 2026", DEMO_TODAY).has("2026-12-05"));
  assert.ok(findDates("チェックイン：2027/01/10", DEMO_TODAY).has("2027-01-10"));
  assert.equal(findDates("2026年2月30日", DEMO_TODAY).size, 0, "ない日付は拾わない");
});

test("人数と金額を拾う（前の行の日付の数字を人数と取り違えない）", () => {
  const c = findCounts("ゲスト：大人2名、子ども1名");
  assert.ok(c.adult.has(2) && c.child.has(1));
  const c2 = findCounts("チェックイン：2026年11月20日\nゲスト：大人2名");
  assert.ok(!c2.any.has(20));
  assert.ok(findCounts("Guests: 3 adults (previously 2 adults)").adult.has(3));
  const a = findAmounts("¥54,000 / 72,000円 / JPY 38,000");
  assert.deepEqual([...a].sort(), [38000, 54000, 72000]);
});

// ---- 書き写しを確かめる ----
test("確かめる：正しく写せていれば、そのまま残る", () => {
  const raw = { kind: "new", ota: "airbnb", reservation_no: "HMDEMO7Q2X", checkin_date: "2026-11-20", checkout_date: "2026-11-23", adults: 2, children: 1, infants: 0, amount: 54000 };
  const { fields, items } = checkExtracted(raw, masked("airbnb_new"), DEMO_TODAY);
  assert.deepEqual(fields, raw);
  assert.equal(items.length, 0);
});

test("確かめる：あやしい指示に従った値は、本文に無いので空に戻る", () => {
  const raw = { kind: "cancel", ota: "airbnb", reservation_no: "DEMO-0016", checkin_date: "2026-12-12", checkout_date: "2026-12-13", adults: 10, children: 0, infants: 0, amount: 0 };
  const { fields, items } = checkExtracted(raw, masked("injection"), DEMO_TODAY);
  assert.equal(fields.kind, "unknown", "キャンセルの言葉は指示の行にしか無い");
  assert.equal(fields.reservation_no, null);
  assert.equal(fields.adults, null);
  assert.equal(fields.amount, null, "0円は指示の行にしか無い");
  assert.ok(items.some((i) => i.text.includes("指示のような文が2行")));
});

test("確かめる：作り話の日付・人数・予約番号は空に戻る", () => {
  const raw = { kind: "new", ota: "booking", reservation_no: "ZZZ99999", checkin_date: "2026-11-21", checkout_date: "2026-11-19", adults: 5, children: null, infants: null, amount: 99999 };
  const { fields, items } = checkExtracted(raw, masked("airbnb_new"), DEMO_TODAY);
  assert.equal(fields.ota, "unknown", "本文に booking の言葉が無い");
  assert.equal(fields.reservation_no, null);
  assert.equal(fields.checkin_date, null);
  assert.equal(fields.checkout_date, null);
  assert.equal(fields.adults, null);
  assert.equal(fields.amount, null);
  assert.ok(items.length >= 5);
});

test("確かめる：チェックアウトが書いていないメールは空のまま（勝手に埋めない）", () => {
  const raw = { kind: "new", ota: "airbnb", reservation_no: "HMDEMO3M8R", checkin_date: "2026-11-27", checkout_date: "2026-11-29", adults: 2, children: 0, infants: 0, amount: 36000 };
  const { fields } = checkExtracted(raw, masked("airbnb_missing"), DEMO_TODAY);
  assert.equal(fields.checkin_date, "2026-11-27");
  assert.equal(fields.checkout_date, null, "「2泊」から計算した日付は本文に無い");
});

// ---- 台帳と照らす ----
const existing = { id: "R16", ota: "airbnb", ota_reservation_no: "DEMO-0018", checkin_date: "2026-11-03", checkout_date: "2026-11-05", adults: 2, children: 0, infants: 0, amount_gross: 36000, status: "confirmed", guest_changes_json: null };

test("台帳：種類が分からないメールは入れられない", () => {
  const r = ledgerChecks(fieldsOf({}), { existing: null });
  assert.equal(r.blocked, true);
  assert.equal(r.after, null);
});

test("台帳：新しい予約は、もう同じ番号があれば二重に入れない", () => {
  const f = fieldsOf({ kind: "new", ota: "airbnb", reservation_no: "DEMO-0018", checkin_date: "2026-11-03", checkout_date: "2026-11-05", adults: 2 });
  assert.equal(ledgerChecks(f, { existing }).blocked, true);
  const ok = ledgerChecks({ ...f, reservation_no: "HMDEMO7Q2X" }, { existing: null, overlaps: [existing] });
  assert.equal(ok.blocked, false);
  assert.equal(ok.after.ota_reservation_no, "HMDEMO7Q2X");
  assert.ok(ok.items.some((i) => i.text.includes("日程が重なる")));
});

test("台帳：新しい予約で大人が空・0人なら入れない", () => {
  const f = fieldsOf({ kind: "new", ota: "airbnb", reservation_no: "HMDEMO7Q2X", checkin_date: "2026-11-20", checkout_date: "2026-11-23" });
  assert.equal(ledgerChecks(f, { existing: null }).blocked, true);
  assert.equal(ledgerChecks({ ...f, adults: 0 }, { existing: null }).blocked, true);
});

test("台帳：変更は、元の予約が無いか、もうキャンセルなら入れない", () => {
  const f = fieldsOf({ kind: "change", ota: "airbnb", reservation_no: "DEMO-0018", checkout_date: "2026-11-06", adults: 3 });
  assert.equal(ledgerChecks(f, { existing: null }).blocked, true);
  assert.equal(ledgerChecks(f, { existing: { ...existing, status: "cancelled" } }).blocked, true);
  const ok = ledgerChecks(f, { existing });
  assert.equal(ok.blocked, false);
  assert.equal(ok.after.checkin_date, "2026-11-03", "書いていない項目は台帳のまま");
  assert.equal(ok.after.checkout_date, "2026-11-06");
  assert.equal(ok.after.adults, 3);
});

test("台帳：キャンセルは、元の予約があればキャンセルにする", () => {
  const f = fieldsOf({ kind: "cancel", ota: "airbnb", reservation_no: "DEMO-0018" });
  const r = ledgerChecks(f, { existing });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.after, { status: "cancelled" });
});

// ---- オーナーが直した値 ----
test("直す：正しい値は入り、空欄は空に戻る", () => {
  const base = fieldsOf({ kind: "new", ota: "airbnb", checkin_date: "2026-12-12", checkout_date: "2026-12-13", adults: 2 });
  const { fields, errors } = normalizeOwnerFields({ checkout_date: "2026-12-14", adults: "3", amount: "" }, base);
  assert.deepEqual(errors, []);
  assert.equal(fields.checkout_date, "2026-12-14");
  assert.equal(fields.adults, 3);
  assert.equal(fields.amount, null);
});

test("直す：おかしな値は止める", () => {
  const base = fieldsOf({ kind: "new", checkin_date: "2026-12-12" });
  const bad = (input) => normalizeOwnerFields(input, base).errors;
  assert.ok(bad({ checkout_date: "2026-12-11" }).some((e) => e.includes("チェックインより後")));
  assert.ok(bad({ checkout_date: "2026-02-30" }).length > 0);
  assert.ok(bad({ adults: 31 }).length > 0);
  assert.ok(bad({ adults: 1.5 }).length > 0);
  assert.ok(bad({ kind: "delete" }).length > 0);
  assert.ok(bad({ reservation_no: "あいう" }).length > 0);
  assert.ok(bad([]).length > 0);
  assert.equal(normalizeOwnerFields({ hacker: "x" }, base).fields.hacker, undefined, "知らない項目は無視する");
});
