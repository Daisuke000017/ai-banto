// 行って戻れるか（M14）のテスト。時刻の計算・判定・安全の言葉・AIの文の確かめ・回数の上限
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerAsk,
  ASK_AGENT,
  ASK_DAILY_LIMIT,
  checkExplain,
  checkParsed,
  fillAnswer,
  fixedAnswer,
  isSafetyQuestion,
  maskQuestion,
  placeholderValues,
  planTrip,
} from "../src/lib/ask.js";

const SAT = "2026-10-10"; // 土曜（土日祝の時刻表）
const at = (h, m = 0) => h * 60 + m;

test("鵜戸神宮・10時：行き10:33→11:07、帰り15:27→16:01、宿に16:09、最終16:32", () => {
  const p = planTrip({ date: SAT, minutes: at(10), destId: "udo" });
  assert.equal(p.judgment, "ok");
  assert.deepEqual(p.go, { leave_inn: "10:25", dep: "10:33", arr: "11:07" });
  assert.deepEqual(p.back, { dep: "15:27", arr: "16:01", home: "16:09" });
  assert.deepEqual(p.last, { dep: "16:32", arr: "17:06" });
});

test("戻りたい時刻で判定が変わる：17時＝ok、16:15＝ぎりぎり、12時＝ng", () => {
  assert.equal(planTrip({ date: SAT, minutes: at(10), destId: "udo", backBy: at(17) }).judgment, "ok");
  const close = planTrip({ date: SAT, minutes: at(10), destId: "udo", backBy: at(16, 15) });
  assert.equal(close.judgment, "tight");
  assert.equal(close.reason, "close");
  const late = planTrip({ date: SAT, minutes: at(10), destId: "udo", backBy: at(12) });
  assert.equal(late.judgment, "ng");
  assert.equal(late.reason, "late");
});

test("夜は行きのバスがない（ng・no_go）", () => {
  const p = planTrip({ date: SAT, minutes: at(23), destId: "udo" });
  assert.equal(p.judgment, "ng");
  assert.equal(p.reason, "no_go");
  assert.equal(p.go, null);
});

test("決まった文：時刻はプログラムが差し込む。ng のときはタクシー・オーナーの一文", () => {
  const p = planTrip({ date: SAT, minutes: at(10), destId: "udo" });
  assert.equal(
    fillAnswer(fixedAnswer(p, "ja"), placeholderValues(p, null)),
    "行って戻れます。10:33のバスで行き、15:27のバスで帰ると、宿には16:09ごろ着きます。",
  );
  const ng = planTrip({ date: SAT, minutes: at(10), destId: "udo", backBy: at(12) });
  const en = fillAnswer(fixedAnswer(ng, "en"), placeholderValues(ng, at(12)));
  assert.match(en, /12:00/);
  assert.match(en, /taxi/);
  for (const lang of ["ja", "en", "ko", "zh-TW"]) assert.doesNotMatch(fillAnswer(fixedAnswer(ng, lang), placeholderValues(ng, at(12))), /\{/);
});

test("安全の言葉：病気・けが・事故・迷子はAIに渡さない。似た言葉は引っかけない", () => {
  for (const s of ["気分が悪いです", "子どもがケガをした", "道に迷いました", "I'm lost", "We had an accident", "길을 잃었어요", "身體不舒服"]) {
    assert.equal(isSafetyQuestion(s), true, s);
  }
  for (const s of ["I will go to Udo", "still open?", "出かけがてら鵜戸神宮へ", "기념품을 사고 싶어요", "鵜戸神宮に行きたい"]) {
    assert.equal(isSafetyQuestion(s), false, s);
  }
});

test("質問は伏せてから使う（メール・電話番号）", () => {
  const m = maskQuestion("taro@example.com 090-1234-5678 鵜戸神宮に行きたい");
  assert.doesNotMatch(m, /taro/);
  assert.doesNotMatch(m, /1234/);
  assert.match(m, /鵜戸神宮/);
});

test("AI①の読み取りを確かめる", () => {
  assert.deepEqual(checkParsed({ destination: "udo", back_by: "17:00", day: "today" }), []);
  assert.deepEqual(checkParsed({ destination: "udo", back_by: "", day: "tomorrow" }), []);
  assert.ok(checkParsed({ destination: "tokyo", back_by: "", day: "today" }).length > 0);
  assert.ok(checkParsed({ destination: "udo", back_by: "夕方", day: "today" }).length > 0);
});

test("AI②の説明の文を確かめる：数字・URL・知らない記号はだめ", () => {
  const allowed = ["GO_TIME", "BACK_TIME", "HOME_TIME"];
  assert.deepEqual(checkExplain({ text: "{GO_TIME}のバスで行き、{BACK_TIME}のバスで帰れます。" }, allowed), []);
  assert.ok(checkExplain({ text: "10時33分のバスで行けます。" }, allowed).length > 0);
  assert.ok(checkExplain({ text: "１０時のバス" }, allowed).length > 0);
  assert.ok(checkExplain({ text: "詳しくは https://example.com へ" }, allowed).length > 0);
  assert.ok(checkExplain({ text: "{LAST_TIME}が最終です。" }, allowed).length > 0);
  assert.ok(checkExplain({ text: "{GO_TIME のバス" }, allowed).length > 0);
  assert.ok(checkExplain({ text: "" }, allowed).length > 0);
});

// 回数を数える表（guest_links）と、質問を残す表のまね
function fakeDb() {
  const link = { ai_calls_today: 0, ai_calls_date: null };
  const saved = [];
  return {
    link,
    saved,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            sql,
            a,
            async first() {
              if (!sql.includes("UPDATE guest_links")) return null;
              const [day, , , , limit] = a;
              if (link.ai_calls_date === day && link.ai_calls_today >= limit) return null;
              link.ai_calls_today = link.ai_calls_date === day ? link.ai_calls_today + 1 : 1;
              link.ai_calls_date = day;
              return { n: link.ai_calls_today };
            },
          };
        },
      };
    },
    async batch(stmts) {
      for (const s of stmts) if (s.sql.includes("INSERT")) saved.push(s.a);
    },
  };
}
const base = (db, extra) => ({ db, client: null, linkId: 1, lang: "ja", date: SAT, minutes: at(10), countDay: "2026-11-04", now: "2026-11-04T01:00:00.000Z", taxiName: "架空タクシー", ...extra });

test("ボタンで聞く：AIがなくても決まった文で答える。ng のときだけタクシーの名前", async () => {
  const db = fakeDb();
  const ok = await answerAsk(base(db, { dest: "udo" }));
  assert.equal(ok.judgment, "ok");
  assert.equal(ok.text_source, "fixed");
  assert.equal(ok.taxi, null);
  assert.equal(ok.remaining, ASK_DAILY_LIMIT - 1);
  assert.ok(ok.timetable.url.startsWith("https://"));
  const ng = await answerAsk(base(db, { dest: "udo", backBy: at(12) }));
  assert.equal(ng.judgment, "ng");
  assert.deepEqual(ng.taxi, { name: "架空タクシー" });
  assert.equal(db.saved.length, 2);
});

test("青島神社は歩いて行ける（数えない）。安全の質問はAIに渡さず、伏せた文だけ残す", async () => {
  const db = fakeDb();
  const walk = await answerAsk(base(db, { dest: "aoshima_shrine" }));
  assert.equal(walk.judgment, "walk");
  assert.equal(db.link.ai_calls_today, 0);
  const s = await answerAsk(base(db, { text: "道に迷いました 090-1234-5678" }));
  assert.equal(s.judgment, "safety");
  assert.match(s.text, /119/);
  assert.equal(db.link.ai_calls_today, 0);
  assert.doesNotMatch(JSON.stringify(db.saved), /1234/);
});

test("1日10回まで：11回目の自由な質問は断る。ボタンは決まった文で答え続ける", async () => {
  const db = fakeDb();
  for (let i = 0; i < ASK_DAILY_LIMIT; i++) await answerAsk(base(db, { dest: "udo" }));
  assert.equal(db.link.ai_calls_today, ASK_DAILY_LIMIT);
  const t = await answerAsk(base(db, { text: "鵜戸神宮に行って17時に戻れる？" }));
  assert.equal(t.judgment, "limit");
  const b = await answerAsk(base(db, { dest: "udo" }));
  assert.equal(b.judgment, "ok");
  assert.equal(b.limited, true);
  assert.equal(b.remaining, 0);
  // 次の日はまた数え直す
  const next = await answerAsk(base(db, { dest: "udo", countDay: "2026-11-05" }));
  assert.equal(next.remaining, ASK_DAILY_LIMIT - 1);
});

test("AIの記録に書く係の名前は、表が受け付ける名前（agent_runs の決まり）", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../migrations/0002_messages.sql", import.meta.url), "utf8");
  const allowed = sql.match(/agent IN \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  assert.ok(allowed.includes(ASK_AGENT), `${ASK_AGENT} は ${allowed.join(",")} にない`);
});

test("AIの鍵がないときの自由な質問は「分かりません」", async () => {
  const r = await answerAsk(base(fakeDb(), { text: "鵜戸神宮に行きたい" }));
  assert.equal(r.judgment, "unknown");
  assert.match(r.text, /オーナー/);
});
