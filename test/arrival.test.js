// 到着前案内（M6）のテスト。AIは本物を呼ばず、決まった答えを返す「にせのAI」で流れを確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesFromInnProfile } from "../src/lib/counting.js";
import {
  normLang,
  formatDate,
  placeholderProblems,
  checkArrivalDraft,
  checkTemplateEdit,
  buildArrivalInput,
  taxLines,
  fixedArrival,
  generateArrivalDraft,
  fillPlaceholders,
  maskForOwner,
  guestView,
  OWNER_CHECK,
} from "../src/lib/arrival.js";
import { innProfile, reservations } from "../seed/demo-reservations.js";

const byId = (id) => reservations.find((r) => r.id === id);
const rules = rulesFromInnProfile(innProfile);
const inn = innProfile;

/** にせのAI：queue の答えを順に返す（Error なら失敗させる）。呼ばれた中身を calls に残す */
function mk(queue) {
  const calls = [];
  const client = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const x = queue.shift();
          if (x instanceof Error) throw x;
          return { content: [{ type: "text", text: JSON.stringify(x) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, model: "m" };
        },
      },
    },
  };
  return { client, calls };
}

/** R16（英語）の、点検に通る下書き */
function goodEnDraft() {
  return {
    greeting: "Welcome! We look forward to your stay.",
    sections: [
      { key: "equipment", title: "Equipment", body: "Please ask the host how to use the equipment." },
      { key: "transport", title: "Getting here", body: "Please ask the host about the best way to get here." },
      { key: "noise", title: "Quiet hours", body: "Please keep quiet after 10 pm." },
      { key: "garbage", title: "Garbage", body: "Please sort your garbage and put it in the box at the entrance." },
      { key: "fire", title: "Fire safety", body: "Smoking is not allowed inside." },
      { key: "evacuation", title: "Evacuation", body: "Please ask the host where to go in a disaster." },
      { key: "checkin", title: "Check-in", body: "The address is {ADDRESS}. The key box code is {DOOR_CODE}." },
    ],
    closing: "Have a nice trip!",
  };
}
const withBody = (d, key, body) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? { ...s, body } : s)) });

// ---- 言語・日付 ----

test("言語の書き方をそろえる（分からないときは英語）", () => {
  assert.equal(normLang("ja"), "ja");
  assert.equal(normLang("ja-JP"), "ja");
  assert.equal(normLang("KO_kr"), "ko");
  assert.equal(normLang("zh-TW"), "zh-TW");
  assert.equal(normLang("zh-Hant"), "zh-TW");
  assert.equal(normLang("zh-HK"), "zh-TW");
  assert.equal(normLang("fr"), "en");
  assert.equal(normLang(null), "en");
});

test("日付を言語に合わせて書く", () => {
  assert.equal(formatDate("en", "2026-11-03"), "Nov 3");
  assert.equal(formatDate("ko", "2026-11-03"), "11월 3일");
  assert.equal(formatDate("ja", "2026-11-03"), "11月3日");
  assert.equal(formatDate("zh-TW", "2026-11-03"), "11月3日");
});

// ---- AIに渡すもの ----

test("AIに渡す入力には、名前・暗証番号の置き場所を入れない", () => {
  const input = buildArrivalInput(byId("R16"), inn);
  const s = JSON.stringify(input);
  assert.equal(input.language, "en");
  assert.deepEqual(input.stay, { checkin: "2026-11-03", checkout: "2026-11-05", nights: 2, guests: 2 });
  assert.equal(input.checkin_type, "keybox");
  assert.ok(!s.includes("架空ゲスト"), "名前が入っている");
  assert.ok(!s.includes("SECRET"), "暗証番号の置き場所が入っている");
});

test("途中で人数が変わる予約は、人数を「2-3」のように渡す", () => {
  assert.equal(buildArrivalInput(byId("R06"), inn).stay.guests, "2-3");
});

// ---- プログラムの点検 ----

test("差し込み位置は {DOOR_CODE} と {ADDRESS} だけ", () => {
  assert.deepEqual(placeholderProblems("番号は {DOOR_CODE}、住所は {ADDRESS}"), []);
  assert.equal(placeholderProblems("Wi-Fi は {WIFI}").length, 1);
  assert.ok(placeholderProblems("閉じていない { かっこ").some((p) => p.includes("閉じていません")));
});

test("点検：正しい下書きは問題なし", () => {
  assert.deepEqual(checkArrivalDraft(goodEnDraft(), buildArrivalInput(byId("R16"), inn)), []);
});

test("点検：入力にない数字を見つける", () => {
  const d = withBody(goodEnDraft(), "equipment", "There are 7 towels.");
  const p = checkArrivalDraft(d, buildArrivalInput(byId("R16"), inn));
  assert.ok(p.some((x) => x.includes("入力にない数字") && x.includes("7")));
});

test("点検：チェックイン以外の項目に差し込み位置があれば止める", () => {
  const d = withBody(goodEnDraft(), "equipment", "The code is {DOOR_CODE}.");
  const p = checkArrivalDraft(d, buildArrivalInput(byId("R16"), inn));
  assert.ok(p.some((x) => x.includes("項目 equipment に差し込み位置")));
});

test("点検：税金のことを書いたら止める（taxi は止めない）", () => {
  const input = buildArrivalInput(byId("R16"), inn);
  const taxed = withBody(goodEnDraft(), "transport", "Please pay the tax at check-in.");
  assert.ok(checkArrivalDraft(taxed, input).some((x) => x.includes("税金")));
  const taxi = withBody(goodEnDraft(), "transport", "Please ask the host about a taxi.");
  assert.deepEqual(checkArrivalDraft(taxi, input), []);
});

test("点検：URLを書いたら止める", () => {
  const d = withBody(goodEnDraft(), "transport", "See www.example.com for details.");
  assert.ok(checkArrivalDraft(d, buildArrivalInput(byId("R16"), inn)).some((x) => x.includes("URL")));
});

test("点検：項目が足りなければ止める", () => {
  const d = goodEnDraft();
  d.sections = d.sections.filter((s) => s.key !== "fire");
  assert.ok(checkArrivalDraft(d, buildArrivalInput(byId("R16"), inn)).includes("項目 fire がありません"));
});

test("点検：英語の予約に日本語で書いたら止める", () => {
  const d = {
    greeting: "ようこそ。お待ちしています。",
    sections: goodEnDraft().sections.map((s) => ({ ...s, title: "ご案内", body: s.key === "checkin" ? "住所は{ADDRESS}、番号は{DOOR_CODE}です。" : "ホストにお尋ねください。" })),
    closing: "よい旅を。",
  };
  assert.ok(checkArrivalDraft(d, buildArrivalInput(byId("R16"), inn)).includes("英語で書かれていません"));
});

test("オーナーが手で直した文の点検", () => {
  assert.deepEqual(checkTemplateEdit("番号は {DOOR_CODE} です"), []);
  assert.ok(checkTemplateEdit("   ").includes("空にはできません"));
  assert.ok(checkTemplateEdit("{WIFI}").some((p) => p.includes("{WIFI}")));
  assert.ok(checkTemplateEdit("あ".repeat(8001)).some((p) => p.includes("長すぎます")));
});

// ---- 宿泊税の行（プログラムが書く） ----

test("宿泊税：予約サイトで払い済み（R16）", () => {
  const t = taxLines("en", byId("R16"), rules);
  assert.equal(t.total, 800);
  assert.equal(t.needs_owner_check, false);
  assert.equal(t.lines[0], "Accommodation tax: a tax under Miyazaki City ordinance. It has already been paid through your booking site.");
  assert.equal(t.lines[1], "If the number of guests changes, the tax amount changes too.");
});

test("宿泊税：預かり方が分からない（R12）は【オーナー確認】を付ける", () => {
  const t = taxLines("ja", byId("R12"), rules);
  assert.equal(t.total, 400);
  assert.equal(t.needs_owner_check, true);
  assert.ok(t.lines.some((l) => l.startsWith(OWNER_CHECK) && l.includes("預かり方が分かりません") && l.includes("400円")));
});

test("宿泊税：預かった額と計算した額が違う（R06）は【オーナー確認】を付ける", () => {
  const t = taxLines("ja", byId("R06"), rules);
  assert.equal(t.total, 1000);
  assert.equal(t.needs_owner_check, true);
  assert.ok(t.lines.some((l) => l.includes("預かった額（800円）") && l.includes("計算した額（1,000円）")));
});

test("宿泊税：当施設が預かる（R14・3人3泊）は式を書く", () => {
  const t = taxLines("zh-TW", byId("R14"), rules);
  assert.equal(t.total, 1800);
  assert.equal(t.needs_owner_check, false);
  assert.ok(t.ja[0].includes("× 3人 × 3泊 ＝ 1,800円"));
  assert.ok(t.lines[0].includes("1,800日圓"));
});

test("宿泊税：現地で預かる（R07）は「チェックインの時に」を足す", () => {
  const t = taxLines("ja", byId("R07"), rules);
  assert.equal(t.total, 200);
  assert.equal(t.needs_owner_check, false);
  assert.ok(t.lines.includes("チェックインの時にお預かりします。"));
});

// ---- 全体の流れ ----

test("AIの鍵がないときは決まった文（止まらない）", async () => {
  const out = await generateArrivalDraft({ client: null, db: null, r: byId("R16"), inn, rules });
  assert.equal(out.source, "fixed");
  assert.equal(out.fallback_reason, "no_key");
  assert.ok(out.draft_template.startsWith("Before your arrival | Nov 3 – Nov 5 (2 nights), 2 guests"));
  assert.ok(out.draft_template.includes("call 119"));
  assert.ok(out.ja_text.startsWith("ご到着前のご案内｜11月3日〜11月5日（2泊）・2名様"));
});

test("決まった文：宿の設定に自分の文があれば使う", () => {
  const own = { ...inn, fixed_arrival_json: JSON.stringify({ en: "Please message the host.", ja: "ホストにご連絡ください。" }) };
  const out = fixedArrival(byId("R16"), own, rules);
  assert.ok(out.draft_template.includes("Please message the host."));
  assert.ok(out.ja_text.includes("ホストにご連絡ください。"));
});

test("AIの呼び出しが失敗したら決まった文に切り替える", async () => {
  const { client } = mk([new Error("つながらない")]);
  const out = await generateArrivalDraft({ client, db: null, r: byId("R16"), inn, rules });
  assert.equal(out.source, "fixed");
  assert.equal(out.fallback_reason, "api_error");
});

test("下書き → 訳し戻し → 監査OK で、AIの案内ができる", async () => {
  const { client, calls } = mk([goodEnDraft(), { ja_text: "ようこそ。（訳し戻し）" }, { verdict: "ok", reasons: [] }]);
  const out = await generateArrivalDraft({ client, db: null, r: byId("R16"), inn, rules });
  assert.equal(out.source, "ai");
  assert.equal(out.attempts, 1);
  assert.equal(calls.length, 3);
  assert.equal(out.checks.length, 2);
  assert.ok(out.draft_template.includes("{DOOR_CODE}"), "差し込み位置が残っていない");
  assert.ok(out.draft_template.includes("■ Check-in"));
  assert.ok(out.draft_template.includes("already been paid"));
  assert.ok(out.ja_text.includes("ようこそ。（訳し戻し）"));
  assert.equal(out.back_translation, "ようこそ。（訳し戻し）");
});

test("プログラムの点検で止まったら、直しの依頼を付けて書き直させる", async () => {
  const bad = withBody(goodEnDraft(), "transport", "Please pay the tax at check-in.");
  const { client, calls } = mk([bad, goodEnDraft(), { ja_text: "訳" }, { verdict: "ok", reasons: [] }]);
  const out = await generateArrivalDraft({ client, db: null, r: byId("R16"), inn, rules });
  assert.equal(out.source, "ai");
  assert.equal(out.attempts, 2);
  assert.equal(out.checks.length, 3);
  assert.equal(out.checks[0].by, "program");
  const second = JSON.parse(calls[1].messages[0].content);
  assert.ok(second.fix_requests.some((x) => x.includes("税金")), "直しの依頼が渡っていない");
});

test("監査役に3回差し戻されたら、決まった文に切り替える", async () => {
  const sendBack = { verdict: "send_back", reasons: [{ code: "other", detail: "x" }] };
  const q = [];
  for (let i = 0; i < 3; i++) q.push(goodEnDraft(), { ja_text: "訳" }, sendBack);
  const { client, calls } = mk(q);
  const out = await generateArrivalDraft({ client, db: null, r: byId("R16"), inn, rules });
  assert.equal(out.source, "fixed");
  assert.equal(out.fallback_reason, "send_back_limit");
  assert.equal(out.attempts, 3);
  assert.equal(out.checks.length, 6);
  assert.equal(calls.length, 9);
});

test("日本語の予約は訳し戻しをしない", async () => {
  const jaDraft = {
    greeting: "ようこそ。お待ちしています。",
    sections: goodEnDraft().sections.map((s) => ({ ...s, title: "ご案内", body: s.key === "checkin" ? "住所は{ADDRESS}、番号は{DOOR_CODE}です。" : "ホストにお尋ねください。" })),
    closing: "よい旅を。",
  };
  const { client, calls } = mk([jaDraft, { verdict: "ok", reasons: [] }]);
  const out = await generateArrivalDraft({ client, db: null, r: byId("R12"), inn, rules });
  assert.equal(out.source, "ai");
  assert.equal(calls.length, 2);
  assert.equal(out.back_translation, null);
  assert.equal(out.needs_owner_check, true);
});

// ---- 差し込み・表示 ----

test("コピーのとき：値がなければ「未設定」", () => {
  assert.equal(fillPlaceholders("番号 {DOOR_CODE}／{ADDRESS}", { DOOR_CODE: "0000" }), "番号 0000／未設定");
});

test("オーナー画面：暗証番号は伏せる", () => {
  assert.equal(maskForOwner("番号 {DOOR_CODE}／{ADDRESS}", {}), "番号 ●●●●（コピー時に入ります）／（住所 未設定）");
  assert.equal(maskForOwner("{ADDRESS}", { ADDRESS: "架空町1-1" }), "架空町1-1");
});

test("ゲスト画面：チェックイン当日より前は暗証番号と住所を出さない", () => {
  const t = "Code: {DOOR_CODE} / {ADDRESS}";
  const v = { checkin: "2026-11-03", DOOR_CODE: "0000", ADDRESS: "架空町1-1" };
  assert.equal(guestView(t, "en", { ...v, today: "2026-11-02" }), "Code: (shown on your check-in day) / (shown on your check-in day)");
  assert.equal(guestView(t, "en", { ...v, today: "2026-11-03" }), "Code: 0000 / 架空町1-1");
});
