// 訓練ボタン・災害モード（M15）のテスト。距離・近い避難先・AIの文の点検・決まった文・画面に渡す中身
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  checkEvacuationBody,
  composeEvacuation,
  distanceM,
  DRILL_LANGS,
  FIXED_BODY,
  generateEvacuationDraft,
  gsiLink,
  guestDrillView,
  INN_POINT,
  nearestShelters,
} from "../src/lib/drill.js";

test("直線の距離：緯度0.01度（南北）はおよそ1.1km", () => {
  const d = distanceM({ lat: 31.8, lng: 131.46 }, { lat: 31.81, lng: 131.46 });
  assert.ok(Math.abs(d - 1112) < 5, String(d));
  assert.equal(distanceM(INN_POINT, INN_POINT), 0);
});

test("宿から近い避難先は2つ：ロコビーチ 約400m・ラメールブルー 約530m", () => {
  const list = nearestShelters();
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((s) => [s.name, s.distance_m]),
    [
      ["ロコビーチ", 400],
      ["ラメールブルー", 530],
    ],
  );
});

test("地理院地図のリンク", () => {
  assert.equal(gsiLink(31.8, 131.46), "https://maps.gsi.go.jp/#17/31.800000/131.460000/");
});

test("AIが使えないときの決まった文は、4言語とも点検に通る", () => {
  for (const lang of DRILL_LANGS) assert.deepEqual(checkEvacuationBody({ text: FIXED_BODY[lang] }, lang), [], lang);
});

test("AIの文の点検：数字・URL・避難先の名前・印のぬけ・知らない印はだめ", () => {
  const ok = "これは訓練です。{SHELTER_1}まで{SHELTER_1_DIST}、{SHELTER_2}まで{SHELTER_2_DIST}です。";
  assert.deepEqual(checkEvacuationBody({ text: ok }, "ja"), []);
  assert.ok(checkEvacuationBody({ text: ok + "5分で着きます。" }, "ja").length > 0);
  assert.ok(checkEvacuationBody({ text: ok + "https://example.com" }, "ja").length > 0);
  assert.ok(checkEvacuationBody({ text: ok + "ロコビーチへ。" }, "ja").length > 0);
  assert.ok(checkEvacuationBody({ text: ok.replace("{SHELTER_2_DIST}", "") }, "ja").length > 0);
  assert.ok(checkEvacuationBody({ text: ok + "{DOOR_CODE}" }, "ja").length > 0);
  assert.ok(checkEvacuationBody({ text: "" }, "ja").length > 0);
});

test("オーナーがコピーする全文：印は残らず、名前・距離・地図・訓練の一文が入る", () => {
  const list = nearestShelters();
  for (const lang of DRILL_LANGS) {
    const t = composeEvacuation(lang, FIXED_BODY[lang], list);
    assert.doesNotMatch(t, /[{}]/, lang);
    assert.match(t, /ロコビーチ/, lang);
    assert.match(t, /maps\.gsi\.go\.jp/, lang);
  }
  const ja = composeEvacuation("ja", FIXED_BODY.ja, list);
  assert.match(ja, /訓練/);
  assert.match(ja, /代わりではありません/);
  assert.match(ja, /約400m/);
});

test("ゲスト画面（G-5）に渡す中身：決まった3つの文・避難先2つ・出典", () => {
  const v = guestDrillView("ja", { scenario: "tsunami_advisory" });
  assert.equal(v.active, true);
  assert.equal(v.lines.length, 3);
  assert.match(v.lines[0], /バスを待たずに/);
  assert.match(v.lines[1], /戻らない/);
  assert.match(v.lines[2], /ハザードマップ/);
  assert.match(v.not_official, /代わりではありません/);
  assert.equal(v.shelters.length, 2);
  for (const s of v.shelters) {
    assert.ok(s.map_url.startsWith("https://maps.gsi.go.jp/"));
    assert.match(s.dist_text, /直線/);
    assert.ok(Number.isFinite(s.dx_m) && Number.isFinite(s.dy_m));
  }
  assert.ok(v.source.url.startsWith("https://"));
  assert.ok(v.hazard_map.url.startsWith("https://"));
  // 知らない言語は英語
  assert.equal(guestDrillView("fr", { scenario: "tsunami_advisory" }).language, "en");
});

test("AIの鍵がないときは、決まった文の下書きになる", async () => {
  const d = await generateEvacuationDraft({ client: null, db: null, r: { id: "R14", language: "zh-TW" } });
  assert.equal(d.source, "fixed");
  assert.equal(d.language, "zh-TW");
  assert.doesNotMatch(d.draft_template, /[{}]/);
  assert.match(d.ja_text, /訓練/);
});

test("表の決まり：記録の係の名前（shukuhaku）と、下書きの種類（evacuation）を受け付ける", async () => {
  const sql = await readFile(new URL("../migrations/0002_messages.sql", import.meta.url), "utf8");
  const agents = sql.match(/agent IN \(([^)]*)\)/)[1];
  assert.match(agents, /'shukuhaku'/);
  assert.match(sql, /kind IN \([^)]*'evacuation'/);
  const src = await readFile(new URL("../src/lib/drill.js", import.meta.url), "utf8");
  for (const m of src.matchAll(/agent: "([a-z_]+)"/g)) assert.match(agents, new RegExp(`'${m[1]}'`), m[1]);
});
