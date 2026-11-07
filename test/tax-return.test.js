// 宿泊税の納入申告書（宮崎市 様式第10号）の自動テスト。使い方：npm test
// 宿・人の名前や番号はすべて架空
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
import { fiscalYearOf, reiwa, taxReturn } from "../src/lib/tax-return.js";
import { checkInnPatch } from "../src/lib/inn-settings.js";

const RULES = { tax_rate: 200, tax_start_date: "2026-07-01" };
const draft = (o = {}) => ({
  month: "2026-09",
  person_nights: 4,
  tax_amount: 800,
  collected_amount: 800,
  diff: 0,
  unknown_tax: 0,
  refund_needed: 0,
  nights_before_tax_start: 0,
  rules: RULES,
  breakdown: [],
  ...o,
});
const INN = {
  name: "架空の宿",
  address: "宮崎県宮崎市（架空）",
  collector_address: "宮崎県宮崎市（架空）",
  collector_name: "架空 太郎",
  corporate_no: null,
  inn_phone: "0985-00-0000",
  facility_no: "DEMO-001",
  contact_name: "架空 太郎",
  contact_phone: "090-0000-0000",
};

test("和暦と年度：2019年は元年。1〜3月は前の年度", () => {
  assert.equal(reiwa(2019), "元");
  assert.equal(reiwa(2026), "8");
  assert.equal(fiscalYearOf("2026-04"), 2026);
  assert.equal(fiscalYearOf("2027-03"), 2026);
  assert.equal(fiscalYearOf("2027-01"), 2026);
});

test("申告書の欄：年度・月分、宿泊数＝人泊、税額＝人泊×200円、合計、日付", () => {
  const r = taxReturn(draft(), INN, "2026-10-10");
  assert.deepEqual(r.form.period, { era_year: "8", month: 9 });
  assert.deepEqual(r.form.date, { era_year: "8", month: 10, day: 10 });
  assert.equal(r.form.nights, 4);
  assert.equal(r.form.rate, 200);
  assert.equal(r.form.tax, 800);
  assert.equal(r.form.total, 800);
  assert.equal(r.form.facility.name, "架空の宿");
  assert.equal(r.form.facility.facility_no, "DEMO-001");
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
  // 1月分は前の年度
  assert.deepEqual(taxReturn(draft({ month: "2027-01" }), INN, "2027-02-03").form.period, { era_year: "8", month: 1 });
});

test("0円の月も作る（出す必要があると知らせる）", () => {
  const r = taxReturn(draft({ person_nights: 0, tax_amount: 0, collected_amount: 0 }), INN, "2026-10-10");
  assert.equal(r.form.total, 0);
  assert.ok(r.warnings.some((w) => w.level === "info" && w.text.includes("0円の月も")));
});

test("注意：まだ終わっていない月・来ていない月・分からない預かり・不足・返金・オーナー確認", () => {
  const lv = (r, word) => r.warnings.find((w) => w.text.includes(word))?.level;
  assert.equal(lv(taxReturn(draft({ month: "2026-10" }), INN, "2026-10-10"), "まだ終わっていません"), "warn");
  assert.equal(lv(taxReturn(draft({ month: "2026-11" }), INN, "2026-10-10"), "まだ来ていない月"), "danger");
  assert.equal(lv(taxReturn(draft({ unknown_tax: 400 }), INN, "2026-10-10"), "分からない予約"), "warn");
  assert.equal(lv(taxReturn(draft({ diff: -200 }), INN, "2026-10-10"), "200円 足りません"), "warn");
  assert.equal(lv(taxReturn(draft({ refund_needed: 400 }), INN, "2026-10-10"), "返金"), "warn");
  assert.equal(lv(taxReturn(draft(), INN, "2026-10-10", { ownerChecks: 2 }), "【オーナー確認】"), "warn");
  // 税率が様式（200円）とちがえば、出せない
  assert.equal(lv(taxReturn(draft({ rules: { ...RULES, tax_rate: 300 } }), INN, "2026-10-10"), "このままでは出せません"), "danger");
});

test("設定が空の欄は空けて出し、足りない欄を知らせる。法人番号は空でも知らせない", () => {
  const r = taxReturn(draft(), { ...INN, inn_phone: "", facility_no: null, contact_phone: "  " }, "2026-10-10");
  assert.equal(r.form.facility.phone, null);
  assert.equal(r.form.facility.facility_no, null);
  assert.deepEqual(r.missing, ["宿の電話番号", "施設番号", "担当者の電話番号"]);
  assert.ok(!r.missing.includes("法人番号"));
});

test("設定：法人番号は13けた・電話は0から始まる10〜11けた。全角も半角にそろえる", () => {
  assert.deepEqual(checkInnPatch({ corporate_no: "１２３４５６７８９０１２３" }), { values: { corporate_no: "1234567890123" } });
  assert.match(checkInnPatch({ corporate_no: "12345" }).error, /13けた/);
  assert.deepEqual(checkInnPatch({ corporate_no: "" }), { values: { corporate_no: null } });
  assert.deepEqual(checkInnPatch({ inn_phone: "０９８５－００－００００" }), { values: { inn_phone: "0985-00-0000" } });
  assert.deepEqual(checkInnPatch({ contact_phone: "09000000000" }), { values: { contact_phone: "09000000000" } });
  assert.match(checkInnPatch({ inn_phone: "123" }).error, /10〜11けた/);
  assert.match(checkInnPatch({ contact_phone: "090-0000-000a" }).error, /10〜11けた/);
  assert.deepEqual(checkInnPatch({ facility_no: "ＤＥＭＯ－００１" }), { values: { facility_no: "DEMO-001" } });
  assert.match(checkInnPatch({ facility_no: "<script>" }).error, /英数字/);
  assert.match(checkInnPatch({ collector_name: "あ".repeat(61) }).error, /60文字/);
});

// ---- 通り道（/api/tax/return）。D1 の代わりにメモリの SQLite に migrations/ を全部入れる ----
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => (db.prepare(sql).run(...args), { success: true }),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}
const call = (env, base, path) => worker.fetch(new Request(base + path), env, { waitUntil() {} });

test("通り道：9月分の申告書。人泊・税額と、オーナー確認の残りを数える。ログインなしでは外から開けない", async () => {
  const DB = fakeD1();
  DB.raw.exec(`
    INSERT INTO inn_profile (id, name, type, address, facility_no) VALUES (1, '架空の宿', '家主不在型', '宮崎県宮崎市（架空）', 'DEMO-001');
    INSERT INTO reservations (id, ota, checkin_date, checkout_date, nights, adults, tax_collection, lodging_tax_collected)
      VALUES ('T1', 'airbnb', '2026-09-10', '2026-09-12', 2, 2, 'ota', 800),
             ('T2', 'booking', '2026-09-20', '2026-09-21', 1, 1, 'unknown', NULL),
             ('T3', 'booking', '2026-10-01', '2026-10-02', 1, 1, 'unknown', NULL);
    INSERT INTO guest_drafts (reservation_id, kind, language, draft_template)
      VALUES ('T2', 'arrival', 'ja', '【オーナー確認】宿泊税の預かり方'),
             ('T3', 'arrival', 'ja', '【オーナー確認】宿泊税の預かり方');
  `);
  const env = { DB, DEMO_TODAY: "2026-11-07" };
  const res = await call(env, "http://localhost:8787", "/api/tax/return?month=2026-09");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.form.nights, 5);
  assert.equal(d.form.tax, 1000);
  assert.deepEqual(d.form.period, { era_year: "8", month: 9 });
  assert.equal(d.form.facility.facility_no, "DEMO-001");
  // 9月の予約（T2）の分だけ数える。10月の T3 は数えない
  assert.ok(d.warnings.some((w) => w.text.includes("【オーナー確認】」が 1件")));
  assert.ok(d.missing.includes("宿の電話番号"));

  assert.equal((await call(env, "http://localhost:8787", "/api/tax/return?month=2026-13")).status, 400);
  // パスワードが設定された本番の形では、ログインなしは 401
  const prod = { DB, OWNER_PASSWORD_HASH: "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  assert.equal((await call(prod, "https://banto.example.com", "/api/tax/return?month=2026-09")).status, 401);
});
