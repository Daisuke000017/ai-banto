// 料金のレベル（AIの部分）と、宮崎市の行事の候補の自動テスト。使い方：npm test
// 本物のAIは呼ばない（にせのAIで、点検・差し戻し・歯止めがはたらくことを確かめる）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkChanges, cleanMarketNote, MARKET_NOTE_MAX, suggestLevels } from "../src/lib/price-level-ai.js";
import { checkFoundEvents, normalizeUrl, sampleEventDay, searchEvents } from "../src/lib/price-events-ai.js";
import { planLevels } from "../src/lib/price-levels.js";
import { MODELS } from "../src/lib/models.js";
import { SEARCH_REQUEST_OPTIONS } from "../src/lib/anthropic.js";
import { reasonJa } from "../src/lib/eval.js";
import { DEMO_TODAY, innProfile, reservations } from "../seed/demo-reservations.js";

const today = DEMO_TODAY;
const inn = { ...innProfile, room_list: ["A", "B"] };
const base = { db: null, today, inn, reservations };

/** にせのAI：queue の答えを順に返す（Error なら失敗させる。{raw} ならそのまま返す） */
function mk(queue) {
  const calls = [];
  const optsList = [];
  const client = {
    beta: {
      messages: {
        create: async (params, opts) => {
          calls.push(params);
          optsList.push(opts);
          const x = queue.shift();
          if (x instanceof Error) throw x;
          if (x?.raw) return x.raw;
          return { content: [{ type: "text", text: JSON.stringify(x) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, model: "m" };
        },
      },
    },
  };
  return { client, calls, optsList };
}
const inputOf = (call) => JSON.parse(call.messages[0].content);
const levelOf = (res, night) => res.nights.find((n) => n.night === night);

const OK = { verdict: "ok", reasons: [] };
const draft = (changes) => ({ changes, summary: "土曜を上げ、空いた平日を下げました" });

test("鍵が無いときは、プログラムの案（グレーな夜はレベル2）だけを出す", async () => {
  const res = await suggestLevels({ ...base, client: null });
  assert.equal(res.source, "program");
  assert.equal(res.unavailable, "no_key");
  assert.equal(levelOf(res, "2026-11-18").level, 2);
});

test("経営企画の案が点検と監査を通れば、グレーな夜にだけ重ねる", async () => {
  const { client, calls } = mk([
    draft([
      { night: "2026-11-18", level: 1, reason: "平日で、2部屋とも空いています" },
      { night: "2026-11-14", level: 3, reason: "土曜の夜です" },
    ]),
    OK,
  ]);
  const res = await suggestLevels({ ...base, client });
  assert.equal(res.source, "ai");
  assert.equal(levelOf(res, "2026-11-18").level, 1);
  assert.equal(levelOf(res, "2026-11-18").by, "ai");
  assert.equal(levelOf(res, "2026-11-14").level, 3);
  // はっきりした夜（年末年始）はそのまま
  assert.equal(levelOf(res, "2026-12-31").level, 4);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, MODELS.keiei);
  assert.equal(calls[1].model, MODELS.kansa);
  // 経営企画に渡す材料：グレーな夜と選べるレベルだけ。名前・予約番号は渡さない
  const sent = inputOf(calls[0]);
  assert.deepEqual(sent.allowed_levels, [1, 2, 3]);
  assert.ok(sent.gray_nights.every((n) => n.night && n.weekday && Number.isInteger(n.free_rooms)));
  assert.doesNotMatch(calls[0].messages[0].content, /guest_name|ota_reservation_no/);
});

test("書いてはいけない言い方は、プログラムが差し戻して直させる", async () => {
  const { client, calls } = mk([
    draft([{ night: "2026-11-18", level: 1, reason: "通常より安い今だけの値段" }]),
    draft([{ night: "2026-11-18", level: 1, reason: "平日で、2部屋とも空いています" }]),
    OK,
  ]);
  const res = await suggestLevels({ ...base, client });
  assert.equal(levelOf(res, "2026-11-18").level, 1);
  assert.equal(calls.length, 3);
  assert.ok(inputOf(calls[1]).fix_requests.some((x) => /書いてはいけない言い方/.test(x)));
  assert.equal(res.checks[0].by, "program");
  assert.ok(res.checks[0].problems.length);
});

test("歯止め：グレーでない夜・レベル4・最低価格割れ・周りの値段の作り話は通さない", () => {
  const plan = planLevels({ today, inn: { ...inn, price_l1: 6000 }, reservations });
  const p = checkChanges(plan, [
    { night: "2026-12-31", level: 3, reason: "年末" },
    { night: "2026-11-18", level: 1, reason: "平日で空いています" },
    { night: "2026-11-19", level: 4, reason: "木曜" },
    { night: "2026-11-20", level: 3, reason: "周りの宿が高いので" },
  ]);
  assert.ok(p.some((x) => /2026-12-31はグレーな夜ではありません/.test(x)));
  assert.ok(p.some((x) => /2026-11-18のレベル1は選べません/.test(x)));
  assert.ok(p.some((x) => /2026-11-19のレベル4は選べません/.test(x)));
  assert.ok(p.some((x) => /周りの宿の値段は貼られていない/.test(x)));
  // 貼られていれば、周りの値段を理由にしてよい
  assert.deepEqual(checkChanges(plan, [{ night: "2026-11-20", level: 3, reason: "周りの宿が15,000円前後です" }], { marketNote: "近所のA宿 15,000円" }), []);
});

test("監査役が何度も同じ夜を差し戻したら、その夜だけレベル2のまま残す", async () => {
  const d = draft([
    { night: "2026-11-18", level: 1, reason: "平日で、2部屋とも空いています" },
    { night: "2026-11-14", level: 3, reason: "土曜の夜です" },
  ]);
  const back = { verdict: "send_back", reasons: [{ code: "weak_reason", night: "2026-11-14", detail: "土曜というだけでは弱い" }] };
  const { client, calls } = mk([d, back, d, back, d, back]);
  const res = await suggestLevels({ ...base, client });
  assert.equal(calls.length, 6);
  assert.equal(levelOf(res, "2026-11-14").level, 2);
  assert.equal(levelOf(res, "2026-11-18").level, 1);
  assert.equal(res.audit.gave_up, true);
  assert.deepEqual(res.dropped, ["2026-11-14"]);
  // 差し戻しの理由は、点検の画面で日本語になる
  assert.match(reasonJa("weak_reason：土曜というだけでは弱い"), /^理由が弱い：/);
  assert.match(reasonJa("misleading_wording：割引と書いている"), /^誤解を招く書き方：/);
});

test("AIが失敗したら、プログラムの案で続ける", async () => {
  const { client } = mk([new Error("network")]);
  const res = await suggestLevels({ ...base, client });
  assert.equal(res.source, "program");
  assert.equal(res.unavailable, "api_error");
  assert.equal(levelOf(res, "2026-11-18").level, 2);
});

test("貼られた周りの値段は、制御文字を外して長さを切る", () => {
  assert.equal(cleanMarketNote("A宿\u0007 12,000円 "), "A宿 12,000円");
  assert.equal(cleanMarketNote("x".repeat(MARKET_NOTE_MAX + 50)).length, MARKET_NOTE_MAX);
  assert.equal(cleanMarketNote(null), "");
});

test("行事の候補：出典が検索で見たページでないもの・期間外・長すぎるものは落とす", () => {
  const pages = [{ url: "https://miyazaki-city.tourism.or.jp/event/123/", title: "宮崎市の催し" }];
  const { ok, dropped } = checkFoundEvents([
    { name: "まつり", start_day: "2026-11-21", end_day: "2026-11-22", place: "宮崎市", source_url: "https://miyazaki-city.tourism.or.jp/event/123#top", source_title: "", crowd: "large" },
    { name: "作り話", start_day: "2026-11-21", end_day: "2026-11-21", place: "", source_url: "https://example.com/x", source_title: "", crowd: "unknown" },
    { name: "昔の行事", start_day: "2026-10-12", end_day: "2026-10-12", place: "", source_url: pages[0].url, source_title: "", crowd: "small" },
    { name: "長い", start_day: "2026-11-01", end_day: "2026-11-30", place: "", source_url: pages[0].url, source_title: "", crowd: "small" },
    { name: "日付なし", start_day: "11月下旬", end_day: "11月下旬", place: "", source_url: pages[0].url, source_title: "", crowd: "small" },
  ], { today, pages });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].source_url, pages[0].url);
  assert.equal(ok[0].source_title, "宮崎市の催し");
  assert.deepEqual(dropped.map((x) => x.name), ["作り話", "昔の行事", "長い", "日付なし"]);
  assert.equal(normalizeUrl("https://a.jp/x/#h"), "https://a.jp/x");
});

test("行事を探す：公式のサイトだけを検索し、見たページを出典にした候補だけを残す", async () => {
  const url = "https://www.city.miyazaki.miyazaki.jp/event/1.html";
  const searchReply = {
    raw: {
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "宮崎市 イベント 12月" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url, title: "市の催し" }] },
        { type: "text", text: "12月5日に宮崎市で冬の音楽祭があります。" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      model: "m",
    },
  };
  const readReply = {
    events: [
      { name: "冬の音楽祭", start_day: "2026-12-05", end_day: "2026-12-05", place: "宮崎市", source_url: url, source_title: "市の催し", crowd: "medium" },
      { name: "ほかのサイトの行事", start_day: "2026-12-06", end_day: "2026-12-06", place: "", source_url: "https://example.com", source_title: "", crowd: "unknown" },
    ],
  };
  const { client, calls, optsList } = mk([searchReply, readReply]);
  const inserted = [];
  const db = {
    prepare: (sql) => ({
      bind(...a) { this.a = a; return this; },
      all: async () => ({ results: [] }),
      first: async () => (/COUNT/.test(sql) ? { n: 0 } : { id: 1 }),
      run: async function () { if (/INSERT OR IGNORE INTO price_event_candidates/.test(sql)) inserted.push(this.a); return { meta: { changes: 1 } }; },
    }),
  };
  const out = await searchEvents({ client, db, today });
  assert.equal(out.added, 1);
  assert.equal(out.dropped.length, 1);
  assert.equal(inserted[0][0], "冬の音楽祭");
  assert.deepEqual(calls[0].tools[0].allowed_domains, ["miyazaki-city.tourism.or.jp", "www.city.miyazaki.miyazaki.jp"]);
  assert.equal(calls[0].tools[0].type, "web_search_20260209");
  // 検索は時間がかかるので長めに待ち、やり直さない（料金が2回かからないように）
  assert.deepEqual(optsList[0], SEARCH_REQUEST_OPTIONS);
  assert.equal(calls[0].tools[0].max_uses, 3);
});

test("デモの見本の行事は、28日以上先の最初の土曜", () => {
  assert.equal(sampleEventDay("2026-10-10"), "2026-11-07");
  assert.equal(sampleEventDay("2026-10-12"), "2026-11-14");
});
