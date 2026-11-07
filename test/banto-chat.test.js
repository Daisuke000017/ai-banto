// 番頭に聞く（オーナーのチャット）のテスト。使い方：npm test
// 「台帳にない数字は通さない」「わからないは、わからないと言う」「回数の上限」「名前をAIに渡さない」を確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerOwner,
  buildFacts,
  checkAnswer,
  numbersIn,
  OWNER_ASK_AGENT,
  OWNER_ASK_DAILY_LIMIT,
  OWNER_MESSAGES,
} from "../src/lib/banto-chat.js";
import { dayCounter, minpakuReport, rulesFromInnProfile, stayNightRows } from "../src/lib/counting.js";
import { cleaningDays } from "../src/lib/cleaning.js";
import { nearestReportPeriod } from "../src/lib/patrol.js";
import { readTable, heuristicMapping, normalizeStatement } from "../src/lib/statements.js";
import { DEMO_TODAY, innProfile, reservations } from "../seed/demo-reservations.js";
import { sampleStatements } from "../seed/demo-statements.js";

const today = DEMO_TODAY;

function demoLines() {
  const lines = [];
  for (const s of sampleStatements) {
    if (s.kind === "bank") continue;
    const t = readTable(s.text);
    const n = normalizeStatement(t, s.kind, heuristicMapping(t.header, s.kind).mapping);
    lines.push(...n.lines.map((l) => ({ ...l, ota: s.kind })));
  }
  return lines;
}

const confirmed = reservations.filter((r) => r.status === "confirmed");
const facts = buildFacts({
  today,
  reservations,
  lines: demoLines(),
  rooms: innProfile.rooms,
  lodgingTax: 1200,
  counter: dayCounter(stayNightRows(confirmed), today, rulesFromInnProfile(innProfile)),
  cleaning: cleaningDays(confirmed, today, innProfile),
  decisions: ["Airbnbの入金が予約より少なくなっています"],
  reports: nearestReportPeriod(today).map((p) => minpakuReport(reservations, p, today)),
});
const thisMonth = facts.months.find((m) => m.when === "今月");

test("事実の一覧：今月の数字・民泊の日数・清掃・確認待ちが入る", () => {
  assert.equal(facts.today, today);
  assert.equal(facts.months.length, 9);
  assert.ok(thisMonth, "今月の行がある");
  assert.equal(thisMonth.month, today.slice(0, 7));
  assert.equal(typeof facts.minpaku_days.remaining_days, "number");
  assert.equal(facts.minpaku_days.limit, 180);
  assert.ok(Array.isArray(facts.cleaning.days));
  assert.deepEqual(facts.waiting_for_owner, ["Airbnbの入金が予約より少なくなっています"]);
  assert.equal(facts.lodging_tax_this_month, 1200);
});

test("事実の一覧：宿泊者の名前・予約番号は入れない", () => {
  const s = JSON.stringify(facts);
  for (const r of reservations) {
    if (r.guest_name) assert.ok(!s.includes(r.guest_name), `名前 ${r.guest_name} が入っている`);
    if (r.ota_reservation_no) assert.ok(!s.includes(r.ota_reservation_no), `予約番号 ${r.ota_reservation_no} が入っている`);
  }
  assert.doesNotMatch(s, /guest_name|ota_reservation_no|email|phone/);
});

test("数の読み取り：1,234円・全角・日付", () => {
  assert.deepEqual(numbersIn("売上は123,000円です"), [123000]);
  assert.deepEqual(numbersIn("１２，５００円"), [12500]);
  assert.deepEqual(numbersIn("11月7日"), [11, 7]);
});

const good = (answer, extra = {}) => ({ known: true, answer, source: "今月の数字", ...extra });

test("答えの確かめ：台帳にある数字はそのまま通す", () => {
  const total = thisMonth.total.toLocaleString("en-US");
  assert.deepEqual(checkAnswer(good(`今月の売上の合計は${total}円です。`), facts), []);
  const left = facts.minpaku_days.remaining_days;
  assert.deepEqual(checkAnswer(good(`上限まであと${left}日です。`, { source: "民泊の日数" }), facts), []);
  // 全角で書いても同じ数として扱う
  const zen = String(left).replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  assert.deepEqual(checkAnswer(good(`上限まであと${zen}日です。`, { source: "民泊の日数" }), facts), []);
});

test("答えの確かめ：台帳にない数字（AIの計算・推測）は通さない", () => {
  const p = checkAnswer(good("今月の売上は987,654,321円です。"), facts);
  assert.ok(p.some((x) => x.includes("facts にない数字")), p.join("／"));
});

test("答えの確かめ：質問に出てきた数字は使ってよい", () => {
  assert.deepEqual(checkAnswer(good("987,654,321円という数字は台帳にありません。", { known: false, answer: "わかりません。987,654,321円という数字は台帳にありません。" }), facts, "987654321円って本当？"), []);
});

test("答えの確かめ：「万」「千」・URL・長すぎ・形の誤りは通さない", () => {
  assert.ok(checkAnswer(good("今月は約12万円です。"), facts).length > 0);
  assert.ok(checkAnswer(good("詳しくは https://example.com を見てください。"), facts).length > 0);
  assert.ok(checkAnswer(good("あ".repeat(201)), facts).length > 0);
  assert.ok(checkAnswer({ known: true, answer: "はい", source: "天気" }, facts).length > 0);
  assert.ok(checkAnswer({ known: "yes", answer: "はい", source: "なし" }, facts).length > 0);
  assert.deepEqual(checkAnswer({ known: true, answer: "  ", source: "なし" }, facts), ["answer が空です"]);
});

test("答えの確かめ：分からないときは「わかりません」と書く", () => {
  assert.ok(checkAnswer({ known: false, answer: "来月は混むと思います。", source: "なし" }, facts).length > 0);
  assert.deepEqual(checkAnswer({ known: false, answer: "わかりません。予想は台帳にありません。", source: "なし" }, facts), []);
});

// ── 1問に答える（AIは偽物） ──

/** agent_runs の数え方だけをまねる偽のDB */
function fakeDb({ asked = 0 } = {}) {
  const runs = [];
  return {
    runs,
    prepare(sql) {
      const stmt = (args) => ({
        async first() {
          if (sql.includes("COUNT(*)") && sql.includes("task = ?")) return { n: asked };
          if (sql.includes("COUNT(*)")) return { n: 0 };
          if (sql.startsWith("INSERT INTO agent_runs")) {
            runs.push({ agent: args[0], task: args[1], summary: args[3] });
            return { id: runs.length };
          }
          return null;
        },
        async run() {
          return { success: true };
        },
      });
      return { bind: (...a) => stmt(a), ...stmt([]) };
    },
  };
}

/** 決まった答えを返す偽のAI。送られた中身を残す */
function fakeClient(answers) {
  const sent = [];
  let i = 0;
  return {
    sent,
    beta: {
      messages: {
        async create(body) {
          sent.push(body);
          const d = answers[Math.min(i++, answers.length - 1)];
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(d) }], usage: { input_tokens: 10, output_tokens: 5 }, model: "claude-sonnet-5-5" };
        },
      },
    },
  };
}

test("AIの鍵がないときは決まった文（お知らせ）", async () => {
  const r = await answerOwner({ db: fakeDb(), client: null, question: "今月の売上は？", facts });
  assert.equal(r.answer_source, "fixed");
  assert.equal(r.answer, OWNER_MESSAGES.no_key);
  assert.equal(r.remaining, OWNER_ASK_DAILY_LIMIT);
});

test(`1日${OWNER_ASK_DAILY_LIMIT}回まで：使い切ったらAIを呼ばない`, async () => {
  const client = fakeClient([good("呼ばれないはず")]);
  const r = await answerOwner({ db: fakeDb({ asked: OWNER_ASK_DAILY_LIMIT }), client, question: "今月の売上は？", facts });
  assert.equal(r.answer, OWNER_MESSAGES.limit);
  assert.equal(r.remaining, 0);
  assert.equal(client.sent.length, 0);
});

test("台帳の数字で答えられたら、そのまま返す（残りの回数も）", async () => {
  const total = thisMonth.total.toLocaleString("en-US");
  const client = fakeClient([good(`今月の売上の合計は${total}円です。`)]);
  const db = fakeDb({ asked: 3 });
  const r = await answerOwner({ db, client, question: "今月の売上は？", facts });
  assert.equal(r.answer_source, "ai");
  assert.equal(r.known, true);
  assert.equal(r.source, "今月の数字");
  assert.equal(r.remaining, OWNER_ASK_DAILY_LIMIT - 4);
  assert.equal(db.runs[0].agent, OWNER_ASK_AGENT);
  assert.equal(db.runs[0].task, "owner_ask");
  assert.doesNotMatch(db.runs[0].summary, /売上は？/, "質問の文は記録に残さない");
});

test("2回とも台帳にない数字を書いたら、うまく答えられなかったと返す（AIの数字は出さない）", async () => {
  const client = fakeClient([good("今月は987,654,321円です。")]);
  const r = await answerOwner({ db: fakeDb(), client, question: "今月の売上は？", facts });
  assert.equal(r.answer_source, "fixed");
  assert.equal(r.answer, OWNER_MESSAGES.failed);
  assert.equal(client.sent.length, 2);
  assert.doesNotMatch(r.answer, /987/);
});

test("質問のメール・電話番号は伏せてからAIに渡す", async () => {
  const client = fakeClient([{ known: false, answer: "わかりません。", source: "なし" }]);
  await answerOwner({ db: fakeDb(), client, question: "taro@example.com 090-1234-5678 の人はいつ来る？", facts });
  const body = JSON.stringify(client.sent[0].messages);
  assert.doesNotMatch(body, /taro@example\.com/);
  assert.doesNotMatch(body, /1234-5678/);
});

test("AIの記録に書く係の名前（banto）は、表が受け付ける名前", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../migrations/0002_messages.sql", import.meta.url), "utf8");
  const allowed = sql.match(/agent IN \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  assert.ok(allowed.includes(OWNER_ASK_AGENT));
});
