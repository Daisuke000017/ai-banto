// 定期報告の提出用CSVの自動テスト。使い方：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { minpakuReport } from "../src/lib/counting.js";
import { NATIONALITY_COLUMNS, nationalityRow, periodLabel, ReportCsvError, submissionCsv } from "../src/lib/report-csv.js";
import { DEMO_TODAY, reservations } from "../seed/demo-reservations.js";

const fake = (over = {}) => ({
  period: "2026-10_11",
  stay_days: 3,
  guests: 4,
  guest_nights: 7,
  nights: ["2026-11-02", "2026-10-30", "2026-10-31"],
  nationality: { JP: 2, US: 1, BR: 1 },
  breakdown: { reservations: [] },
  ...over,
});

test("国籍の列：22列・マニュアルの順。最初は日本、最後はその他", () => {
  assert.equal(NATIONALITY_COLUMNS.length, 22);
  assert.equal(NATIONALITY_COLUMNS[0][1], "日本");
  assert.equal(NATIONALITY_COLUMNS[21][1], "その他");
  assert.deepEqual(NATIONALITY_COLUMNS.slice(12, 15).map(([, n]) => n), ["英国", "ドイツ", "フランス"]);
});

test("国籍：表に無い国（ブラジル）と OTHER は「その他」にまとめる。分からない人がいれば null", () => {
  const row = nationalityRow({ JP: 2, US: 1, BR: 1, OTHER: 2 });
  assert.equal(row.length, 22);
  assert.equal(row[0], 2); // 日本
  assert.equal(row[18], 1); // 米国
  assert.equal(row[21], 3); // その他
  assert.equal(row.reduce((a, b) => a + b, 0), 6);
  assert.equal(nationalityRow({ JP: 1, UNKNOWN: 1 }), null);
  assert.equal(nationalityRow({ JP: 1, UNKNOWN: 0 })[0], 1);
});

test("期間の書き方：2026-08_09 → 2026_8-9。12月〜1月は始まりの年", () => {
  assert.deepEqual(periodLabel("2026-08_09"), { year: 2026, label: "2026_8-9" });
  assert.deepEqual(periodLabel("2026-12_01"), { year: 2026, label: "2026_12-1" });
});

test("提出用CSV：見出しなし・1行・CRLF。泊まった日は並べ替えて yyyy/MM/dd を1日1列", () => {
  const { filename, text } = submissionCsv(fake(), " M012345678 ");
  assert.equal(filename, "M012345678_2026_10-11.csv");
  assert.ok(text.endsWith("\r\n"));
  assert.equal(text.split("\r\n").length, 2); // 1行＋最後の改行
  const cols = text.trimEnd().split(",");
  assert.equal(cols.length, 5 + 22 + 3);
  assert.deepEqual(cols.slice(0, 5), ["M012345678", "2026_10-11", "3", "4", "7"]);
  assert.deepEqual(cols.slice(27), ["2026/10/30", "2026/10/31", "2026/11/02"]);
  assert.ok(!text.startsWith("﻿"));
});

test("提出用CSV：届出番号が無い・形が違うときは、つくらずに「宿と部屋の設定」へ", () => {
  for (const no of ["", "  ", null, undefined]) {
    assert.throws(() => submissionCsv(fake(), no), (e) => e instanceof ReportCsvError && e.fix === "settings");
  }
  for (const no of ["M01 234", "=cmd", "M0,1", "x".repeat(31)]) {
    assert.throws(() => submissionCsv(fake(), no), (e) => e instanceof ReportCsvError && e.fix === "settings");
  }
});

test("提出用CSV：国籍が分からない人がいれば、つくらずに直す予約を返す（デモの8-9月）", () => {
  const rep = minpakuReport(reservations, "2026-08_09", DEMO_TODAY);
  assert.throws(
    () => submissionCsv(rep, "M000000000"),
    (e) => {
      assert.ok(e instanceof ReportCsvError);
      assert.equal(e.fix, "nationality");
      assert.match(e.message, /2人/);
      assert.equal(e.reservations.reduce((a, r) => a + r.missing, 0), 2);
      assert.ok(e.reservations.every((r) => r.reservation_id && r.checkin_date));
      return true;
    },
  );
});

test("提出用CSV：デモの10-11月は出せる。数はいつもの報告と同じ、国籍の合計＝宿泊者数", () => {
  const rep = minpakuReport(reservations, "2026-10_11", DEMO_TODAY);
  assert.equal(rep.nights.length, rep.stay_days);
  const { text } = submissionCsv(rep, "M000000000");
  const cols = text.trimEnd().split(",");
  assert.deepEqual(cols.slice(2, 5).map(Number), [rep.stay_days, rep.guests, rep.guest_nights]);
  const nat = cols.slice(5, 27).map(Number);
  assert.equal(nat.reduce((a, b) => a + b, 0), rep.guests);
  assert.equal(cols.length, 27 + rep.stay_days);
  assert.ok(cols.slice(27).every((d) => /^\d{4}\/\d{2}\/\d{2}$/.test(d)));
});
