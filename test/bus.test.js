// バスのタブ（M13）のテスト。曜日の区分・次のバス・最終バス・線の太さ（本数）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKind } from "../src/lib/dates.js";
import { busBoard, parseClock } from "../src/lib/bus.js";

const dir = (b, d) => b.directions.find((x) => x.direction === d);

test("曜日の区分：土曜・日曜・祝日・平日", () => {
  assert.equal(dayKind("2026-10-10"), "sat");
  assert.equal(dayKind("2026-10-11"), "sun_holiday");
  assert.equal(dayKind("2026-10-12"), "sun_holiday"); // スポーツの日
  assert.equal(dayKind("2026-10-13"), "weekday");
});

test("土曜10時：次のバスと今日の最終バス", () => {
  const b = busBoard({ date: "2026-10-10", minutes: 600, lang: "ja" });
  assert.equal(b.now, "10:00");
  assert.equal(b.stop.id, "aoshima");
  const up = dir(b, "up");
  assert.equal(up.next[0].time, "10:47");
  assert.equal(up.next[0].in_minutes, 47);
  assert.equal(up.next.length, 3);
  assert.equal(up.last.time, "19:20");
  assert.equal(up.all.length, 14);
  const down = dir(b, "down");
  assert.equal(down.next[0].time, "10:08");
  assert.equal(down.last.time, "19:43");
  assert.equal(down.all.length, 10);
  for (const a of [...up.all, ...down.all]) assert.equal(a.passed, parseClock(a.time) < 600, a.time);
});

test("線の太さ＝1日の本数（上り・下りの合計）", () => {
  const b = busBoard({ date: "2026-10-10", minutes: 600, lang: "ja" });
  const n = Object.fromEntries(b.segments.map((s) => [s.id, s.count]));
  assert.deepEqual(n, { north: 31, south_a: 10, south_n: 10 });
});

test("夜遅くは次のバスなし。最終バスは残す", () => {
  const b = busBoard({ date: "2026-10-10", minutes: 1300, lang: "ja" });
  for (const d of b.directions) {
    assert.equal(d.next.length, 0);
    assert.ok(d.last);
    assert.ok(d.last.in_minutes < 0);
  }
});

test("日曜は日曜・祝日だけの便を使い、土曜だけの便は使わない", () => {
  const sun = dir(busBoard({ date: "2026-10-11", minutes: 0, lang: "ja" }), "up").all.map((a) => a.time);
  const sat = dir(busBoard({ date: "2026-10-10", minutes: 0, lang: "ja" }), "up").all.map((a) => a.time);
  assert.ok(sun.includes("09:27"));
  assert.ok(!sun.includes("09:13"));
  assert.ok(sat.includes("09:13"));
  assert.ok(!sat.includes("09:27"));
});

test("便の注意書きと停留所名は、選んだ言語で出す", () => {
  const b = busBoard({ date: "2026-10-10", minutes: 0, lang: "en" });
  assert.equal(b.stop.name, "Aoshima");
  const notes = b.directions.flatMap((d) => d.all.map((a) => a.note)).filter(Boolean);
  assert.ok(notes.length > 0);
  assert.ok(notes.every((x) => !/[ぁ-んァ-ン一-龥]/.test(x)), notes.join(","));
});

test("時刻の形が違えば受け付けない", () => {
  assert.equal(parseClock("10:00"), 600);
  assert.equal(parseClock("9:05"), 545);
  for (const bad of ["24:00", "10:60", "abc", "", null, "10:0", "1000"]) assert.equal(parseClock(bad), null, String(bad));
});
