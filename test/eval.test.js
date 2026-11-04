// 成績（M9）とチーム（O-3）のテスト。AI は呼ばない
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVAL_CASES } from "../src/lib/eval-cases.js";
import {
  gradeBus,
  gradeKeiri,
  gradeMinpaku,
  gradeReply,
  replyProblems,
  runCase,
  reasonJa,
  sendBackExamples,
  summarize,
  TEAM,
  topCandidate,
  VARIANTS,
} from "../src/lib/eval.js";
import { programMaterials } from "../src/lib/discrepancy.js";
import { checkParsed } from "../src/lib/ask.js";

test("例題は40件・分野ごとの数・id が重ならない", () => {
  assert.equal(EVAL_CASES.length, 40);
  const n = (d) => EVAL_CASES.filter((c) => c.domain === d).length;
  assert.deepEqual([n("keiri"), n("tagengo"), n("minpaku"), n("bus")], [20, 10, 5, 5]);
  assert.equal(new Set(EVAL_CASES.map((c) => c.id)).size, 40);
  for (const c of EVAL_CASES) assert.ok(c.note, c.id);
});

test("例題に実在しそうな電話番号・暗証番号の数字を入れていない", () => {
  for (const c of EVAL_CASES) {
    const s = JSON.stringify(c.input);
    assert.doesNotMatch(s, /\d{2,4}-\d{2,4}-\d{3,4}/, c.id);
  }
});

test("お金のずれの例題：正解の金額は、ずれの金額と同じ", () => {
  for (const c of EVAL_CASES.filter((x) => x.domain === "keiri")) {
    assert.equal(c.expected.amount, c.input.diff, c.id);
    assert.ok(programMaterials(c.input), c.id);
  }
});

test("行き先の例題：正解はプログラムの点検を通る形", () => {
  for (const c of EVAL_CASES.filter((x) => x.domain === "bus")) assert.deepEqual(checkParsed(c.expected), [], c.id);
});

test("候補のいちばん上：確からしさの高い順、同じなら先", () => {
  const cands = [
    { code: "a", amount: 1, confidence: "mid" },
    { code: "b", amount: 2, confidence: "high" },
    { code: "c", amount: 3, confidence: "high" },
  ];
  assert.equal(topCandidate(cands).code, "b");
  assert.equal(topCandidate([]), null);
  assert.equal(gradeKeiri({ code: "b", amount: 2 }, cands), true);
  assert.equal(gradeKeiri({ code: "b", amount: 3 }, cands), false);
  assert.equal(gradeKeiri({ code: "a", amount: 1 }, cands), false);
});

test("ゲストへの返事：言語・暗証番号の書き方・数字・必要な言葉", () => {
  const ex = { actions: ["answer"], must_match: ["\\{DOOR_CODE\\}"] };
  assert.equal(gradeReply(ex, "en", { action: "answer", text: "Please open the key box with {DOOR_CODE}." }), true);
  // 暗証番号の数字を書いた
  assert.equal(gradeReply(ex, "en", { action: "answer", text: "The code is 4821. {DOOR_CODE}" }), false);
  // 必要な言葉がない
  assert.equal(gradeReply(ex, "en", { action: "answer", text: "Please use the key box." }), false);
  // action が違う
  assert.equal(gradeReply(ex, "en", { action: "ask_owner", text: "Use {DOOR_CODE}." }), false);
  // 電話番号（ハイフンあり）も4けた以上の数字とみなす
  assert.ok(replyProblems("en", { action: "answer", text: "Call 090-1234-5678." }).length > 0);
  assert.deepEqual(replyProblems("en", { action: "answer", text: "" }), ["返事が空です"]);
});

test("民泊の数字・行き先：ぴったり同じときだけ正解", () => {
  assert.equal(gradeMinpaku({ value: 1200 }, { value: 1200, basis: "" }), true);
  assert.equal(gradeMinpaku({ value: 1200 }, { value: 1200.5, basis: "" }), false);
  assert.equal(gradeMinpaku({ value: 0 }, null), false);
  const ex = { destination: "udo", back_by: "17:00", day: "today" };
  assert.equal(gradeBus(ex, { ...ex }), true);
  assert.equal(gradeBus(ex, { ...ex, back_by: "" }), false);
});

test("集計：分野×やり方、止められなかった数・人の確認に回した数", () => {
  const rows = [
    { domain: "keiri", variant: "full", correct: 1, missed: 0, false_alarm: 1 },
    { domain: "keiri", variant: "full", correct: 0, missed: 0, false_alarm: 0 },
    { domain: "keiri", variant: "no_audit", correct: 0, missed: 1, false_alarm: 0 },
    { domain: "bus", variant: "no_skill", correct: 1, missed: 0, false_alarm: 0 },
    { domain: "bus", variant: "zzz", correct: 1, missed: 0, false_alarm: 0 },
  ];
  const s = summarize(rows);
  const cell = (d, v) => s.domains.find((x) => x.domain === d).variants.find((x) => x.variant === v);
  assert.deepEqual(cell("keiri", "full"), { variant: "full", n: 2, correct: 1, missed: 0, false_alarm: 1 });
  assert.equal(cell("keiri", "no_audit").missed, 1);
  assert.equal(cell("tagengo", "full").n, 0);
  const full = s.totals.find((t) => t.variant === "full");
  assert.equal(full.flagged, 1);
  assert.equal(s.totals.length, Object.keys(VARIANTS).length);
});

test("差し戻しの例：full の監査役の差し戻しだけ・壊れた行は飛ばす", () => {
  const audits = [{ by: "kansa", verdict: "send_back", reasons: ["wrong_number：金額が違う"] }, { by: "kansa", verdict: "ok", reasons: [] }];
  const rows = [
    { case_id: "a", variant: "full", domain: "keiri", note: "n", correct: 1, output_json: JSON.stringify({ audits, flagged: false }) },
    { case_id: "b", variant: "no_skill", domain: "keiri", note: "n", correct: 1, output_json: JSON.stringify({ audits, flagged: false }) },
    { case_id: "c", variant: "full", domain: "keiri", note: "n", correct: 1, output_json: "{壊れた" },
  ];
  const ex = sendBackExamples(rows);
  assert.equal(ex.length, 1);
  assert.equal(ex[0].case_id, "a");
  assert.equal(ex[0].fixed, true);
  assert.match(ex[0].reason, /^数字が合わない：金額/);
});

test("人の確認に回した数：答えが合っていても監査役が止めたものは数える", () => {
  const rows = [
    { domain: "minpaku", variant: "full", correct: 1, missed: 0, false_alarm: 3, output_json: JSON.stringify({ flagged: true }) },
    { domain: "minpaku", variant: "full", correct: 1, missed: 0, false_alarm: 0, output_json: "{壊れた" },
  ];
  assert.equal(summarize(rows).totals.find((t) => t.variant === "full").flagged, 1);
});

test("監査役の理由：記号と英語の言葉を日本語にする", () => {
  assert.equal(reasonJa("not_from_facts：facts にない。value と basis が違う"), "材料にないこと：材料にない。答えの数と計算の説明が違う");
  assert.equal(reasonJa("ふつうの文"), "ふつうの文");
  assert.equal(reasonJa("zzz: 何か"), "その他：何か");
});

test("チームの係は記録の表の5つと同じ／eval.js の係の名前も表にある", async () => {
  const sql = await readFile(new URL("../migrations/0002_messages.sql", import.meta.url), "utf8");
  const agents = sql.match(/agent IN \(([^)]*)\)/)[1];
  for (const t of TEAM) assert.match(agents, new RegExp(`'${t.agent}'`), t.agent);
  assert.equal(TEAM.length, agents.split(",").length);
  const src = await readFile(new URL("../src/lib/eval.js", import.meta.url), "utf8");
  for (const m of src.matchAll(/agent: "([a-z_]+)"/g)) assert.match(agents, new RegExp(`'${m[1]}'`), m[1]);
});

test("成績の表：やり方は3つ・分野は4つ（eval.js と同じ）", async () => {
  const sql = await readFile(new URL("../migrations/0008_eval.sql", import.meta.url), "utf8");
  for (const v of Object.keys(VARIANTS)) assert.match(sql, new RegExp(`'${v}'`));
  for (const d of ["keiri", "tagengo", "minpaku", "bus"]) assert.match(sql, new RegExp(`'${d}'`));
});

// ---- にせのAIで、流れ方（下書き→点検→監査役→差し戻し）を確かめる ----

function mk(queue) {
  const calls = [];
  const client = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const x = queue.shift();
          if (x === undefined) throw new Error("にせのAIの答えが足りません");
          return { content: [{ type: "text", text: JSON.stringify(x) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, model: "m" };
        },
      },
    },
  };
  return { client, calls };
}
const byId = (id) => EVAL_CASES.find((c) => c.id === id);
const OK = { verdict: "ok", reasons: [] };
const NG = { verdict: "send_back", reasons: [{ code: "other", detail: "直してください" }] };

test("返事：監査役が1回差し戻し → 直して通る。正解（expected）はAIに渡さない", async () => {
  const c = byId("tagengo-05");
  const good = { action: "answer", text: "Please use the key box. The code is {DOOR_CODE}." };
  const { client, calls } = mk([good, NG, good, OK]);
  const r = await runCase({ client, c, variant: "full" });
  assert.equal(r.correct, 1);
  assert.equal(r.missed, 0);
  assert.equal(r.false_alarm, 1); // 正しい下書きを差し戻した
  assert.equal(r.output.attempts, 2);
  assert.equal(calls.length, 4);
  for (const p of calls) assert.doesNotMatch(JSON.stringify(p), /must_match|expected/);
  assert.match(JSON.stringify(calls[2]), /fix_requests/);
});

test("返事：暗証番号の数字を書いたら、プログラムが差し戻す（監査役なしでも）", async () => {
  const c = byId("tagengo-10");
  const bad = { action: "answer", text: "The door code is 4821." };
  const good = { action: "ask_owner", text: "I'm sorry, I can't share that. I will ask the owner." };
  const { client, calls } = mk([bad, good]);
  const r = await runCase({ client, c, variant: "no_audit" });
  assert.equal(r.correct, 1);
  assert.equal(calls.length, 2);
  assert.equal(r.output.audits[0].by, "program");
});

test("民泊の数字：3回とも差し戻されたら人の確認へ（止められた＝missed にしない）", async () => {
  const c = byId("minpaku-01");
  const wrong = { value: 800, basis: "大人2人×2泊" };
  const { client } = mk([wrong, NG, wrong, NG, wrong, NG]);
  const r = await runCase({ client, c, variant: "full" });
  assert.equal(r.correct, 0);
  assert.equal(r.missed, 0);
  assert.equal(r.output.flagged, true);
});

test("民泊の数字：監査役なしで間違い → 止められずに出た（missed）", async () => {
  const { client } = mk([{ value: 800, basis: "大人2人×2泊" }]);
  const r = await runCase({ client, c: byId("minpaku-01"), variant: "no_audit" });
  assert.equal(r.missed, 1);
});

test("行き先：手引きなしは、指示に地名の言いかえがつかない", async () => {
  const ans = { destination: "udo", back_by: "", day: "today" };
  const a = mk([ans, OK]);
  await runCase({ client: a.client, c: byId("bus-05"), variant: "no_skill" });
  const b = mk([ans, OK]);
  const r = await runCase({ client: b.client, c: byId("bus-05"), variant: "full" });
  assert.equal(r.correct, 1);
  assert.doesNotMatch(JSON.stringify(a.calls[0].system), /鵜戸さん/);
  assert.match(JSON.stringify(b.calls[0].system), /鵜戸さん/);
});
