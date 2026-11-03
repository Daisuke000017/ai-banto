// ゲスト画面（M12）のテスト。URLの期限・入力の確かめ・台帳とのずれ・QRコード。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expiresAtFor,
  linkProblem,
  canShowSecrets,
  validateProfile,
  guestCountDiscrepancy,
  describeGuestCount,
  guestCountApplyStatements,
  GuestError,
} from "../src/lib/guest.js";
import { stayNightRows } from "../src/lib/counting.js";
import { qrMatrix } from "../public/qr.js";

const res = { id: "R1", ota: "airbnb", status: "confirmed", checkin_date: "2026-10-24", checkout_date: "2026-10-26", adults: 2, children: 0, infants: 0, cosleep_free: 0, nationalities_json: '{"US":2}', guest_changes_json: null };
const link = { revoked: 0, checkin_date: "2026-10-24", checkout_date: "2026-10-26", expires_at: expiresAtFor("2026-10-26") };

test("URLの期限はチェックアウト日の正午（日本時間）", () => {
  assert.equal(expiresAtFor("2026-10-26"), "2026-10-26T12:00:00+09:00");
  assert.equal(linkProblem(link, res, "2026-10-26T02:59:59Z"), null); // 11:59:59
  assert.equal(linkProblem(link, res, "2026-10-26T03:00:00Z"), "expired"); // 12:00
});

test("取り消し・キャンセル・日付の変更で使えなくなる", () => {
  assert.equal(linkProblem(null, res, "2026-10-20T00:00:00Z"), "not_found");
  assert.equal(linkProblem({ ...link, revoked: 1 }, res, "2026-10-20T00:00:00Z"), "revoked");
  assert.equal(linkProblem(link, { ...res, status: "cancelled" }, "2026-10-20T00:00:00Z"), "not_confirmed");
  assert.equal(linkProblem(link, null, "2026-10-20T00:00:00Z"), "not_confirmed");
  assert.equal(linkProblem(link, { ...res, checkout_date: "2026-10-27" }, "2026-10-20T00:00:00Z"), "dates_changed");
  assert.equal(linkProblem({ ...link, expires_at: expiresAtFor("2026-10-30") }, res, "2026-10-20T00:00:00Z"), "dates_changed");
});

test("住所と暗証番号はチェックインの日から", () => {
  assert.equal(canShowSecrets("2026-10-23", "2026-10-24"), false);
  assert.equal(canShowSecrets("2026-10-24", "2026-10-24"), true);
  assert.equal(canShowSecrets("2026-10-25", "2026-10-24"), true);
});

test("ゲストの入力：正しい形だけ受け付ける", () => {
  const ok = validateProfile({ language: "ko", adults: 2, children: 1, infants: 0, nationalities: { KR: 3, US: 0 } });
  assert.deepEqual(ok, { language: "ko", adults: 2, children: 1, infants: 0, nationalities: { KR: 3 } });

  const bad = (body, problem) => {
    assert.throws(() => validateProfile(body), (e) => e instanceof GuestError && e.problems.includes(problem));
  };
  bad({ language: "fr", adults: 1, nationalities: { JP: 1 } }, "language");
  bad({ language: "ja", adults: 0, nationalities: {} }, "adults");
  bad({ language: "ja", adults: 21, nationalities: { JP: 21 } }, "adults");
  bad({ language: "ja", adults: 1.5, nationalities: { JP: 1 } }, "adults");
  bad({ language: "ja", adults: 1, children: -1, nationalities: { JP: 1 } }, "children");
  bad({ language: "ja", adults: 1, nationalities: { XX: 1 } }, "nationalities");
  bad({ language: "ja", adults: 1, nationalities: [1] }, "nationalities");
  bad({ language: "ja", adults: 2, nationalities: { JP: 1 } }, "nationalities_total");
  // 名前など、決まっていない項目は返さない
  const extra = validateProfile({ language: "ja", adults: 1, nationalities: { JP: 1 }, name: "x" });
  assert.equal("name" in extra, false);
});

test("台帳と同じならずれにしない。違えば数だけを入れる", () => {
  assert.equal(guestCountDiscrepancy({ adults: 2, children: 0, infants: 0, nationalities: { US: 2 } }, res), null);

  const d = guestCountDiscrepancy({ adults: 2, children: 1, infants: 0, nationalities: { US: 2, KR: 1 } }, res);
  assert.equal(d.kind, "guest_count");
  assert.equal(d.expected, 2);
  assert.equal(d.actual, 3);
  assert.equal(d.facts.problem, "count");
  assert.deepEqual(Object.keys(d.facts).sort(), ["checkin_date", "checkout_date", "guest", "ledger", "ota", "problem"]);
  assert.equal(describeGuestCount(d), "ゲストが入れた人数（大人2・子ども1）が、台帳（大人2）と違います");

  const n = guestCountDiscrepancy({ adults: 2, children: 0, infants: 0, nationalities: { TW: 2 } }, res);
  assert.equal(n.facts.problem, "nationality");
  assert.equal(describeGuestCount(n), "ゲストが入れた国籍が、台帳と違います");
});

// D1 のかわりに、決まった行を返すだけの台
function fakeDb(row) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { first: async () => row, sql, args };
        },
      };
    },
  };
}

test("OK のとき：台帳の人数と泊ごとの表を、ゲストの数で作り直す", async () => {
  const d = guestCountDiscrepancy({ adults: 2, children: 1, infants: 0, nationalities: { US: 2, KR: 1 } }, res);
  const db = fakeDb(res);
  const stmts = await guestCountApplyStatements(db, d, stayNightRows);
  assert.match(stmts[0].sql, /^UPDATE reservations/);
  assert.deepEqual(stmts[0].args, [2, 1, 0, 0, '{"US":2,"KR":1}', "R1"]);
  assert.match(stmts[1].sql, /^DELETE FROM stay_nights/);
  const inserts = stmts.slice(2);
  assert.equal(inserts.length, 2); // 10/24・10/25 の2泊
  assert.deepEqual(inserts.map((s) => s.args[1]), ["2026-10-24", "2026-10-25"]);
});

test("ずれを見つけたあとで台帳が変わっていたら、止める", async () => {
  const d = guestCountDiscrepancy({ adults: 3, children: 0, infants: 0, nationalities: { US: 3 } }, res);
  await assert.rejects(guestCountApplyStatements(fakeDb({ ...res, adults: 4 }), d, stayNightRows), (e) => e.status === 409);
  await assert.rejects(guestCountApplyStatements(fakeDb({ ...res, status: "cancelled" }), d, stayNightRows), (e) => e.status === 409);
  await assert.rejects(guestCountApplyStatements(fakeDb(null), d, stayNightRows), (e) => e.status === 409);
});

test("QRコード：大きさと四隅の印", () => {
  const m = qrMatrix("https://example.test/g/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
  assert.equal(m.length, 37); // 66バイト → 型番5
  // 四隅の印（左上・右上・左下）の真ん中は黒、その外は白
  for (const [x, y] of [[3, 3], [33, 3], [3, 33]]) {
    assert.equal(m[y][x], true);
    assert.equal(m[y][x + 2], false);
  }
  assert.equal(m[29][8], true); // 左下の黒い1マス（size-8）
  assert.throws(() => qrMatrix("x".repeat(214)), /入りきりません/);
});
