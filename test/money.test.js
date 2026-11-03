// お金の照合（M1〜M4）のテスト。AIは呼ばず、見本の明細でプログラムの部分を確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTable, heuristicMapping, mergeMapping, normalizeStatement, normalizeOwnerMapping, missingFields, detectKind } from "../src/lib/statements.js";
import { reconcile } from "../src/lib/reconcile.js";
import { verifyCandidates } from "../src/lib/discrepancy.js";
import { rulesFromInnProfile } from "../src/lib/counting.js";
import { innProfile, reservations } from "../seed/demo-reservations.js";
import { sampleStatements } from "../seed/demo-statements.js";

const sample = (k) => sampleStatements.find((s) => s.key === k);

/** 見本の明細を全部読み込んだ形にする（D1 に入れるときと同じ番号の付け方） */
function loadAll() {
  const lines = [];
  const payouts = [];
  const deposits = [];
  let lid = 1;
  let pid = 1;
  let did = 1;
  for (const s of sampleStatements) {
    const t = readTable(s.text);
    const n = normalizeStatement(t, s.kind, heuristicMapping(t.header, s.kind).mapping);
    const ps = n.payouts.map((p) => ({ ...p, id: pid++, ota: s.kind }));
    payouts.push(...ps);
    lines.push(...n.lines.map((l) => ({ ...l, id: lid++, ota: s.kind, payout_id: ps.find((p) => p.payout_date === l.line_date)?.id ?? null })));
    deposits.push(...n.deposits.map((d) => ({ ...d, id: did++ })));
  }
  return { lines, payouts, deposits };
}

test("見本の明細の種類を見出しから見分ける", () => {
  for (const s of sampleStatements) assert.equal(detectKind(readTable(s.text).header), s.kind);
});

test("Booking.com の宿泊料金は「変更前の額」ではなく「最終の額」を選ぶ", () => {
  const t = readTable(sample("booking").text);
  const h = heuristicMapping(t.header, "booking");
  assert.equal(t.header[h.mapping.gross], "Final amount");
});

test("AIの案と見出しからの見当が違う列は「確かめて」にして、違いを残す", () => {
  const t = readTable(sample("booking").text);
  const h = heuristicMapping(t.header, "booking");
  const ai = { mapping: [{ field: "gross", column: 5, confidence: "high" }, { field: "reservation_no", column: 0, confidence: "high" }] };
  const m = mergeMapping("booking", h, ai);
  assert.equal(m.mapping.gross, 5);
  assert.equal(m.confidence.gross, "low");
  assert.equal(m.confidence.reservation_no, "high");
  assert.deepEqual(m.disagreements, [{ field: "gross", ai: 5, program: h.mapping.gross }]);
});

test("オーナーの対応表：名前の列・同じ列の二重使い・足りない項目は受け付けない", () => {
  const header = readTable(sample("booking").text).header; // 1列目が Guest name
  const base = { reservation_no: 0, checkin_date: 2, gross: 6 };
  assert.throws(() => normalizeOwnerMapping({ ...base, line_type: 1 }, "booking", header));
  assert.throws(() => normalizeOwnerMapping({ ...base, fee: 6 }, "booking", header));
  assert.throws(() => normalizeOwnerMapping({ ...base, fee: 99 }, "booking", header));
  assert.ok(missingFields("booking", { reservation_no: 0, checkin_date: 2 }).length > 0);
  assert.doesNotThrow(() => normalizeOwnerMapping(base, "booking", header));
});

test("照合：見本では 18件を突き合わせ、仕込んだ6件のずれだけが出る", () => {
  const r = reconcile({ reservations, ...loadAll(), rules: rulesFromInnProfile(innProfile) });
  assert.equal(r.checks.length, 18);
  const bad = r.checks.filter((c) => !c.matched).map((c) => `${c.kind}:${c.reservation_id}:${c.diff}`);
  assert.deepEqual(bad.sort(), [
    "ledger_vs_ota:R08:-15000", // キャンセル料が台帳と違う
    "ledger_vs_ota:R10:-1800", // 割引
    "payout_vs_bank:null:-440", // 振込手数料
    "payout_vs_bank:null:-62910", // まだ入金されていない
    "tax_collected:R06:-200",
    "tax_collected:R09:-600",
  ].sort());
});

test("理由の確かめ：向きが逆・計算で出せない金額は差し戻し、全額を説明できない high は下げる", () => {
  const d = { kind: "ledger_vs_ota", diff: -1800, expected: 36000, actual: 34200, facts: {} };
  const ok = verifyCandidates(d, [{ code: "discount", amount: -1800, basis: "5%", confidence: "high" }], []);
  assert.equal(ok.problems.length, 0);
  assert.equal(ok.candidates[0].explains, true);

  const wrong = verifyCandidates(d, [{ code: "fee", amount: 1800, basis: "", confidence: "mid" }], []);
  assert.ok(wrong.problems.some((p) => p.includes("向きが逆")));

  const made = verifyCandidates(d, [{ code: "other", amount: -1234, basis: "", confidence: "high" }], []);
  assert.ok(made.problems.some((p) => p.includes("計算で出せません")));
  assert.notEqual(made.candidates[0].confidence, "high");
});
