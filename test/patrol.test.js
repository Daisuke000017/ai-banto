// 朝の見回り（M19）と決裁箱（M20）の自動テスト。使い方：npm test
// 見回りで見つけたことを、決裁箱の札にする部分（DBを使わない）を確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPatrolItems, nearestReportPeriod, attemptsOf, REPORT_WARN_DAYS } from "../src/lib/patrol.js";

const TODAY = "2026-10-10";
const factOf = (item, label) => item.facts.find((f) => f.label === label)?.value;

test("定期報告の期間：前の期間（締切が今の期間の途中）と今の期間。年をまたいでも数える", () => {
  assert.deepEqual(nearestReportPeriod("2026-10-10"), ["2026-08_09", "2026-10_11"]);
  assert.deepEqual(nearestReportPeriod("2026-01-15"), ["2025-10_11", "2025-12_01"]);
  assert.deepEqual(nearestReportPeriod("2026-02-03"), ["2025-12_01", "2026-02_03"]);
});

test("何回目の下書きで通ったか：いちばん大きい attempt。壊れていれば1", () => {
  assert.equal(attemptsOf(JSON.stringify([{ attempt: 1 }, { attempt: 2 }])), 2);
  assert.equal(attemptsOf("[]"), 1);
  assert.equal(attemptsOf(null), 1);
  assert.equal(attemptsOf("こわれた"), 1);
  assert.equal(attemptsOf(JSON.stringify({ attempt: 3 })), 1);
});

test("何もなければ札は0枚", () => {
  assert.deepEqual(buildPatrolItems({ today: TODAY }), []);
});

test("予約メール：見出しと事実はプログラムが作る。点検で止まったら OK できず「急ぎ」", () => {
  const ok = {
    id: 7,
    source: "email",
    sender_domain: "ota-demo.example",
    nights: 2,
    blocked: false,
    checks: [{ level: "ok" }],
    ledger: [{ level: "warn" }],
    fields: { kind: "new", ota: "booking", checkin_date: "2026-10-12", checkout_date: "2026-10-14", adults: 2, children: 0, amount: 32000 },
  };
  const [a] = buildPatrolItems({ today: TODAY, emails: [ok] });
  assert.equal(a.ref_key, "booking_email:7");
  assert.equal(a.title, "Booking.comの新しい予約を台帳に入れますか");
  assert.equal(a.level, "warn");
  assert.equal(a.can_ok, true);
  assert.equal(a.link, "mail");
  assert.equal(factOf(a, "届き方"), "メールで届いた（ota-demo.example）");
  assert.equal(factOf(a, "日付"), "10月12日 → 10月14日（2泊）");
  assert.equal(factOf(a, "人数"), "大人2");
  assert.equal(factOf(a, "金額"), "32,000円");
  assert.equal(factOf(a, "点検"), "気をつける点が1件");

  const [b] = buildPatrolItems({ today: TODAY, emails: [{ ...ok, id: 8, blocked: true, fields: { ...ok.fields, ota: "unknown" } }] });
  assert.equal(b.level, "urgent");
  assert.equal(b.can_ok, false);
  assert.equal(factOf(b, "予約サイト"), "不明");
  assert.match(factOf(b, "点検"), /台帳に入れられません/);

  const [c] = buildPatrolItems({ today: TODAY, emails: [{ ...ok, id: 9, fields: { ...ok.fields, kind: "cancel" } }] });
  assert.equal(c.level, "urgent");
  assert.equal(c.title, "Booking.comのキャンセルを台帳に入れますか");
});

test("到着前案内：【オーナー確認】があれば OK できず、理由を事実に出す", () => {
  const d = { id: 31, reservation_id: "RM7", checkin_date: "2026-10-12", language: "en", source: "ai", attempts: 2, needs_owner_check: true };
  const [a] = buildPatrolItems({ today: TODAY, drafts: [d] });
  assert.equal(a.ref_key, "arrival_draft:31");
  assert.equal(a.title, "10月12日にチェックインの方へ、到着前の案内を用意しました");
  assert.equal(a.level, "warn");
  assert.equal(a.can_ok, false);
  assert.equal(a.link, "guest");
  assert.equal(factOf(a, "予約"), "RM7");
  assert.equal(factOf(a, "チェックイン"), "10月12日（あと2日）");
  assert.equal(factOf(a, "言葉"), "英語");
  assert.equal(factOf(a, "書いた人"), "宿泊担当（AI）が書き、監査役（AI）が点検・1回書き直し");
  assert.match(factOf(a, "オーナーの確認"), /【オーナー確認】/);
  assert.match(factOf(a, "送り方"), /自動では送りません/);

  const [b] = buildPatrolItems({ today: TODAY, drafts: [{ ...d, checkin_date: TODAY, source: "template", needs_owner_check: false }] });
  assert.equal(b.level, "urgent");
  assert.equal(b.can_ok, true);
  assert.equal(factOf(b, "チェックイン"), "10月10日（今日）");
  assert.equal(factOf(b, "書いた人"), "決まった文（AIを使わず）");
  assert.equal(factOf(b, "オーナーの確認"), undefined);
});

test("清掃：今日・明日・あさっての分だけ。入れ替えの数も出す", () => {
  const cleaning = {
    window: { checkout: "10:00", checkin: "15:00" },
    items: [
      { date: "2026-10-11", room: "A", turnover: true },
      { date: "2026-10-12", room: "A", turnover: false },
      { date: "2026-10-13", room: "B", turnover: false },
    ],
  };
  const items = buildPatrolItems({ today: TODAY, cleaning });
  assert.deepEqual(items.map((i) => i.title), ["明日（10月11日）は清掃が1件あります", "あさって（10月12日）は清掃が1件あります"]);
  assert.equal(factOf(items[0], "入れ替え"), "1件（同じ日に次の方が入ります）");
  assert.equal(factOf(items[0], "清掃できる時間"), "10:00〜15:00");
  assert.ok(items.every((i) => i.level === "info" && i.can_ok));
});

test("180日：注意と超えたときだけ札にする", () => {
  const base = { fiscal_year: 2026, total_days: 170, limit: 180, remaining_days: 10 };
  assert.equal(buildPatrolItems({ today: TODAY, counter: { ...base, level: "ok" } }).length, 0);
  const [w] = buildPatrolItems({ today: TODAY, counter: { ...base, level: "warn" } });
  assert.equal(w.level, "warn");
  assert.equal(w.title, "年間の上限まで、あと10日です");
  const [o] = buildPatrolItems({ today: TODAY, counter: { ...base, level: "over", remaining_days: 0 } });
  assert.equal(o.level, "urgent");
  assert.equal(o.ref_key, "pace:2026:over");
});

test("定期報告：締切が近いものを1枚だけ。3日以内は「急ぎ」で別の札になる", () => {
  const r = (period, days_left) => ({ period, days_left, due_date: "2026-10-15", stay_days: 6, guests: 9, guest_nights: 16 });
  const [a] = buildPatrolItems({ today: TODAY, reports: [r("2026-10_11", 46), r("2026-08_09", 5)] });
  assert.equal(a.title, "民泊の定期報告（8・9月分）の締切まで、あと5日です");
  assert.equal(a.level, "warn");
  assert.equal(a.ref_key, "report_due:2026-08_09:early");
  assert.equal(factOf(a, "対象"), "2026年8月・9月");

  const [b] = buildPatrolItems({ today: TODAY, reports: [r("2026-08_09", 3)] });
  assert.equal(b.level, "urgent");
  assert.equal(b.ref_key, "report_due:2026-08_09:soon");

  assert.equal(buildPatrolItems({ today: TODAY, reports: [r("2026-08_09", REPORT_WARN_DAYS + 1)] }).length, 0);
  assert.equal(buildPatrolItems({ today: TODAY, reports: [r("2026-08_09", -1)] }).length, 0);

  const [c] = buildPatrolItems({ today: "2026-02-03", reports: [r("2025-12_01", 12)] });
  assert.equal(factOf(c, "対象"), "2025年12月・2026年1月");
});

test("お金のずれ：0件なら札にしない", () => {
  assert.equal(buildPatrolItems({ today: TODAY, openDiscrepancies: 0 }).length, 0);
  const [a] = buildPatrolItems({ today: TODAY, openDiscrepancies: 8 });
  assert.equal(a.title, "お金の照合で、まだ決めていない「ずれ」が8件あります");
  assert.equal(a.ref_key, `discrepancy:${TODAY}`);
});

test("札の見出し・事実に、宿泊者の名前を入れない（名前の欄を渡しても出ない）", () => {
  const items = buildPatrolItems({
    today: TODAY,
    emails: [{ id: 1, source: "email", fields: { kind: "new", ota: "airbnb", guest_name: "架空 花子", checkin_date: "2026-10-12", checkout_date: "2026-10-13", adults: 1 } }],
    drafts: [{ id: 2, reservation_id: "R1", guest_name: "架空 花子", checkin_date: "2026-10-12", language: "ja", source: "ai", attempts: 1 }],
  });
  assert.ok(!JSON.stringify(items).includes("花子"));
});
