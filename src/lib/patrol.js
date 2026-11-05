// 朝の見回り（M19）と決裁箱（M20）
// 番頭が決まった時刻（定期ジョブ）か「いま見回る」ボタンか、予約メールが届いたときに、台帳・予約メール・期限を見て回る。
// 見つけたことは決裁箱に入れて、オーナーの「OK」を待つ（台帳を変えるのは OK のときだけ）。
// 守ること
// - 見出しと事実（数字・日付）はプログラムが組み立てる。AIが書くのは到着前案内の文だけ（監査役が点検する）
// - 宿泊者の名前は読まない・入れない
// - 同じことは二度入れない（ref_key）。元の状態が消えたもの（ほかの画面で決めた等）は「済み」にして片づける

import { addDays, daysBetween, monthOf } from "./dates.js";
import { minpakuReport, reportPeriodOf } from "./counting.js";
import { pricingItems, reviewSnapshot } from "./pricing.js";

export const ARRIVAL_DAYS_AHEAD = 3; // 何日先のチェックインまで、到着前案内を用意するか
export const MAX_AI_DRAFTS = 2; // 1回の見回りでAIに書かせる案内の数（使いすぎないため）
export const REPORT_WARN_DAYS = 14; // 定期報告の締切の何日前から知らせるか

const OTA_JA = { airbnb: "Airbnb", booking: "Booking.com", rakuten: "楽天トラベル", direct: "直接", unknown: "不明" };
const KIND_JA = { new: "新しい予約", change: "予約の変更", cancel: "キャンセル", unknown: "種類がわからない" };
const LANG_JA = { ja: "日本語", en: "英語", ko: "韓国語", "zh-TW": "中国語（繁体字）" };

const jpDate = (s) => (s ? `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日` : "—");
const yen = (n) => `${Number(n).toLocaleString("en-US")}円`;
// calc：プログラムが数えた・計算した数字の行（画面で「プログラムが数えた」の印を付ける）
const fact = (label, value, calc = false) => (calc ? { label, value: String(value), calc: true } : { label, value: String(value) });
// by：だれが書き・だれが確かめたか（画面の「書いた／確かめた」の行）。"program" はプログラム、ほかは担当の鍵か、そのまま出す言葉
const BY_PROGRAM = [["数えた", "program"]];

/** 予約メールの人数（大人・子ども・乳幼児） */
function peopleText(f) {
  const parts = [];
  if (f.adults != null) parts.push(`大人${f.adults}`);
  if (f.children) parts.push(`子ども${f.children}`);
  if (f.infants) parts.push(`乳幼児${f.infants}`);
  return parts.length ? parts.join("・") : "—";
}

/** 今日から見て、締切がまだ来ていない定期報告の期間（いちばん近いもの）。前の期間の締切は今の期間の途中にある */
export function nearestReportPeriod(today) {
  const month = monthOf(today);
  const [y, m] = month.split("-").map(Number);
  const prev = m <= 2 ? `${y - 1}-${String(m + 10).padStart(2, "0")}` : `${y}-${String(m - 2).padStart(2, "0")}`;
  return [reportPeriodOf(prev), reportPeriodOf(month)];
}

/**
 * 見回りで見つけたことを、決裁箱に入れる形にする（DBは使わない。テストできるように分けてある）
 * @param {object} s
 * @param {string} s.today YYYY-MM-DD
 * @param {Array} s.emails 確認待ちの予約メール（booking-email.js の viewRow の形）
 * @param {Array} s.drafts まだ確かめていない到着前案内 {id, reservation_id, checkin_date, language, source, attempts, needs_owner_check}
 * @param {object} s.cleaning cleaningDays の結果
 * @param {object} s.counter dayCounter の結果
 * @param {Array} s.reports minpakuReport の結果（締切の近い順でなくてよい）
 * @param {number} s.openDiscrepancies まだ決めていない「ずれ」の数
 * @param {object} [s.pricing] 値付けの助言（pricing.js の pricingItems に渡すもの）。無ければ出さない
 */
export function buildPatrolItems(s) {
  const items = [];
  const today = s.today;

  for (const e of s.emails ?? []) {
    const f = e.fields ?? {};
    const warn = (e.checks ?? []).filter((c) => c.level === "warn" || c.level === "block").length + (e.ledger ?? []).filter((c) => c.level === "warn" || c.level === "block").length;
    const facts = [
      fact("届き方", e.source === "email" ? `メールで届いた${e.sender_domain ? `（${e.sender_domain}）` : ""}` : "貼り付け"),
      fact("種類", KIND_JA[f.kind] ?? KIND_JA.unknown),
      fact("予約サイト", OTA_JA[f.ota] ?? OTA_JA.unknown),
      fact("日付", `${jpDate(f.checkin_date)} → ${jpDate(f.checkout_date)}${e.nights ? `（${e.nights}泊）` : ""}`),
      fact("人数", peopleText(f)),
    ];
    if (f.amount != null) facts.push(fact("金額", yen(f.amount)));
    facts.push(fact("点検", e.blocked ? "このままでは台帳に入れられません（直してください）" : warn ? `気をつける点が${warn}件` : "問題なし"));
    items.push({
      ref_key: `booking_email:${e.id}`,
      kind: "booking_email",
      level: f.kind === "cancel" || f.kind === "change" || e.blocked ? "urgent" : "warn",
      title: `${OTA_JA[f.ota] ?? "予約サイト"}の${KIND_JA[f.kind] ?? "予約メール"}を台帳に入れますか`,
      facts,
      target_id: String(e.id),
      link: "mail",
      can_ok: !e.blocked,
      by: e.read_by === "ai" ? [["読んだ", "banto"], ["確かめた", "program"]] : [["読んだ", "まだ（AIが使えませんでした）"], ["確かめた", "program"]],
    });
  }

  for (const d of s.drafts ?? []) {
    const days = daysBetween(today, d.checkin_date);
    items.push({
      ref_key: `arrival_draft:${d.id}`,
      kind: "arrival_draft",
      level: days <= 1 ? "urgent" : "warn",
      title: `${jpDate(d.checkin_date)}にチェックインの方へ、到着前の案内を用意しました`,
      facts: [
        fact("予約", d.reservation_id),
        fact("チェックイン", days === 0 ? `${jpDate(d.checkin_date)}（今日）` : `${jpDate(d.checkin_date)}（あと${days}日）`),
        fact("言葉", LANG_JA[d.language] ?? d.language),
        fact("書いた人", d.source === "ai" ? `宿泊担当（AI）が書き、監査役（AI）が点検${d.attempts > 1 ? `・${d.attempts - 1}回書き直し` : ""}` : "決まった文（AIを使わず）"),
        ...(d.needs_owner_check
          ? [fact("オーナーの確認", "案内の中に「【オーナー確認】」の行があります（宿泊税の預かり方など、番頭が決められないこと）。「直す」から、ゲスト連絡の画面で直してください")]
          : []),
        fact("送り方", "OKのあと、ゲスト連絡の画面でコピーして送ります（自動では送りません）"),
      ],
      target_id: String(d.id),
      link: "guest",
      can_ok: !d.needs_owner_check,
      by: d.source === "ai" ? [["書いた", "shukuhaku"], ["確かめた", "kansa", "program"]] : [["書いた", "決まった文（AIを使わず）"]],
    });
  }

  const DAY_JA = ["今日", "明日", "あさって"];
  for (const [i, date] of [today, addDays(today, 1), addDays(today, 2)].entries()) {
    const list = (s.cleaning?.items ?? []).filter((c) => c.date === date);
    if (!list.length) continue;
    const turnover = list.filter((c) => c.turnover).length;
    items.push({
      ref_key: `cleaning:${date}`,
      kind: "cleaning",
      level: "info",
      title: `${DAY_JA[i]}（${jpDate(date)}）は清掃が${list.length}件あります`,
      facts: [
        fact("部屋", list.map((c) => c.room ?? "部屋不明").join("・")),
        fact("入れ替え", turnover ? `${turnover}件（同じ日に次の方が入ります）` : "なし", true),
        ...(s.cleaning?.window ? [fact("清掃できる時間", `${s.cleaning.window.checkout}〜${s.cleaning.window.checkin}`)] : []),
      ],
      target_id: null,
      link: "cleaning",
      can_ok: true,
      by: BY_PROGRAM,
    });
  }

  const c = s.counter;
  if (c && (c.level === "warn" || c.level === "over")) {
    items.push({
      ref_key: `pace:${c.fiscal_year}:${c.level}`,
      kind: "pace",
      level: c.level === "over" ? "urgent" : "warn",
      title: c.level === "over" ? "年間の上限（180日）を超える予約が入っています" : `年間の上限まで、あと${c.remaining_days}日です`,
      facts: [
        fact("今年度", `${c.fiscal_year}年度`),
        fact("泊まった日・予約済みの日", `${c.total_days}日／上限${c.limit}日`, true),
        fact("のこり", `${c.remaining_days}日`, true),
      ],
      target_id: null,
      link: "minpaku",
      can_ok: true,
      by: BY_PROGRAM,
    });
  }

  const due = (s.reports ?? [])
    .filter((r) => r.days_left != null && r.days_left >= 0 && r.days_left <= REPORT_WARN_DAYS)
    .sort((a, b) => a.days_left - b.days_left)[0];
  if (due) {
    const [y, m1, m2] = /^(\d{4})-(\d{2})_(\d{2})$/.exec(due.period).slice(1).map(Number);
    items.push({
      ref_key: `report_due:${due.period}:${due.days_left <= 3 ? "soon" : "early"}`,
      kind: "report_due",
      level: due.days_left <= 3 ? "urgent" : "warn",
      title: `民泊の定期報告（${m1}・${m2}月分）の締切まで、あと${due.days_left}日です`,
      facts: [
        fact("締切", jpDate(due.due_date)),
        fact("宿泊日数", `${due.stay_days}日`, true),
        fact("宿泊者数", `${due.guests}人`, true),
        fact("延べ宿泊者数", `${due.guest_nights}人`, true),
        fact("対象", `${y}年${m1}月・${m2 < m1 ? `${y + 1}年` : ""}${m2}月`),
      ],
      target_id: due.period,
      link: "minpaku",
      can_ok: true,
      by: BY_PROGRAM,
    });
  }

  const n = Number(s.openDiscrepancies ?? 0);
  if (n > 0) {
    items.push({
      ref_key: `discrepancy:${today}`,
      kind: "discrepancy",
      level: "warn",
      title: `お金の照合で、まだ決めていない「ずれ」が${n}件あります`,
      facts: [fact("件数", `${n}件`, true), fact("どこで決めるか", "お金の照合の画面")],
      target_id: null,
      link: "money",
      can_ok: true,
      by: BY_PROGRAM,
    });
  }

  // 値付けの助言（経営企画）：AIは使わない。文はプログラムが決まった形で作る
  if (s.pricing) items.push(...pricingItems(s.pricing));

  return items;
}

// ---------------------------------------------------------------------------
// DB を使う部分
// ---------------------------------------------------------------------------

/** 値付けの助言に使う予約（名前は読まない） */
const PRICE_RES_SQL = `SELECT id, ota, room, checkin_date, checkout_date, status, amount_gross, ota_reservation_no,
  tax_collection, lodging_tax_collected, cancel_fee_amount FROM reservations ORDER BY checkin_date, id`;

/** 決裁箱に残す中身。値付けの知らせは、どの夜の話か（review）も残す */
function bodyOf(it) {
  return { facts: it.facts, can_ok: it.can_ok, ...(it.by ? { by: it.by } : {}), ...(it.review ? { review: it.review } : {}) };
}

/** 何日か先にチェックインで、到着前案内がまだ1つもない予約（名前は読まない） */
const NEEDS_DRAFT_SQL = `SELECT r.id, r.ota, r.checkin_date, r.checkout_date, r.adults, r.children, r.infants, r.cosleep_free,
  r.tax_collection, r.lodging_tax_collected, r.nationalities_json, r.status, r.language
  FROM reservations r WHERE r.status = 'confirmed' AND r.checkin_date >= ? AND r.checkin_date <= ?
  AND NOT EXISTS (SELECT 1 FROM guest_drafts d WHERE d.reservation_id = r.id AND d.kind = 'arrival')
  ORDER BY r.checkin_date, r.id`;

/** まだ確かめていない到着前案内（いちばん新しいものだけ） */
const OPEN_DRAFTS_SQL = `SELECT d.id, d.reservation_id, d.language, d.source, d.checks_json, d.draft_template, r.checkin_date
  FROM guest_drafts d JOIN reservations r ON r.id = d.reservation_id
  WHERE d.kind = 'arrival' AND d.status = 'draft' AND r.status = 'confirmed' AND r.checkin_date >= ? AND r.checkin_date <= ?
  AND d.id = (SELECT MAX(d2.id) FROM guest_drafts d2 WHERE d2.reservation_id = d.reservation_id AND d2.kind = 'arrival')
  ORDER BY r.checkin_date, d.id`;

/** 何回目の下書きで通ったか（点検の記録の attempt のいちばん大きい数） */
export function attemptsOf(checksJson) {
  try {
    const list = JSON.parse(checksJson ?? "[]");
    return Math.max(1, ...(Array.isArray(list) ? list : []).map((c) => Number(c?.attempt) || 1));
  } catch {
    return 1;
  }
}

const UPSERT_SQL = `INSERT INTO decisions (ref_key, kind, level, title, facts_json, target_id, link, status, patrol_run_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, datetime('now'))
  ON CONFLICT (ref_key) DO UPDATE SET level = excluded.level, title = excluded.title, facts_json = excluded.facts_json
  WHERE decisions.status = 'open'`;

/**
 * 見回る。
 * @param {object} p
 * @param {object} p.db D1
 * @param {"cron"|"button"|"email"} p.trigger
 * @param {string} p.today YYYY-MM-DD
 * @param {string} p.now ISO（予約メールの期限切れの片づけに使う）
 * @param {object} p.inn 宿の設定
 * @param {object} p.rules rulesFromInnProfile の結果
 * @param {object|null} p.client AI（無ければ決まった文）
 * @param {object} p.lib index.js から渡す関数 {listBookingEmails, generateArrivalDraft, cleaningDays, dayCounter, OWNER_CHECK}
 */
export async function runPatrol({ db, trigger, today, now, inn, rules, client, lib }) {
  const run = await db
    .prepare("INSERT INTO patrol_runs (trigger, started_at) VALUES (?, datetime('now')) RETURNING id")
    .bind(trigger)
    .first();
  const runId = run.id;
  const until = addDays(today, ARRIVAL_DAYS_AHEAD);

  // ① 到着前案内がまだない予約に、案内を用意する（ほかの見回りが動いている間は書かない＝二重に作らない）
  let aiDrafts = 0;
  const busy = await db
    .prepare("SELECT COUNT(*) AS n FROM patrol_runs WHERE id <> ? AND finished_at IS NULL AND started_at >= datetime('now', '-2 minutes')")
    .bind(runId)
    .first();
  if (!busy?.n) {
    const { results: needs } = await db.prepare(NEEDS_DRAFT_SQL).bind(today, until).all();
    for (const r of (needs ?? []).slice(0, MAX_AI_DRAFTS)) {
      const d = await lib.generateArrivalDraft({ client, db, r, inn, rules });
      await db
        .prepare(
          `INSERT INTO guest_drafts (reservation_id, kind, language, draft_template, ja_text, back_translation,
            checks_json, audit_json, source, status) VALUES (?, 'arrival', ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        )
        .bind(r.id, d.language, d.draft_template, d.ja_text, d.back_translation, JSON.stringify(d.checks ?? []),
          JSON.stringify(d.audit ?? null), d.source)
        .run();
      aiDrafts++;
    }
  }

  // ② 見て回る
  const [emails, drafts, resRows, nights, reportRows, open] = await Promise.all([
    lib.listBookingEmails(db, { status: "pending", now }),
    db.prepare(OPEN_DRAFTS_SQL).bind(today, until).all(),
    db.prepare("SELECT id, ota, room, checkin_date, checkout_date, status FROM reservations WHERE status = 'confirmed' ORDER BY checkout_date, id").all(),
    db.prepare("SELECT night, fiscal_year FROM stay_nights").all(),
    db.prepare(`SELECT id, ota, checkin_date, checkout_date, adults, children, infants, cosleep_free, tax_collection,
      lodging_tax_collected, nationalities_json, status, cancel_fee_amount, guest_changes_json FROM reservations ORDER BY checkin_date, id`).all(),
    db.prepare("SELECT COUNT(*) AS n FROM discrepancies WHERE status = 'open'").first(),
  ]);
  const [priceRes, priceLines] = await Promise.all([
    db.prepare(PRICE_RES_SQL).all(),
    db.prepare("SELECT ota, ota_reservation_no, line_type, gross, fee FROM ota_lines").all(),
  ]);
  const counter = lib.dayCounter(nights.results ?? [], today, rules);
  const items = buildPatrolItems({
    today,
    emails,
    drafts: (drafts.results ?? []).map((d) => ({
      id: d.id,
      reservation_id: d.reservation_id,
      checkin_date: d.checkin_date,
      language: d.language,
      source: d.source,
      attempts: attemptsOf(d.checks_json),
      needs_owner_check: String(d.draft_template).includes(lib.OWNER_CHECK),
    })),
    cleaning: lib.cleaningDays(resRows.results ?? [], today, inn),
    counter,
    reports: nearestReportPeriod(today).map((p) => minpakuReport(reportRows.results ?? [], p, today)),
    openDiscrepancies: open?.n ?? 0,
    pricing: { today, inn, reservations: priceRes.results ?? [], lines: priceLines.results ?? [], counter },
  });

  // ③ 決裁箱に入れる（同じものは入れ直さず、まだ決めていなければ事実だけ新しくする）
  const before = await db.prepare("SELECT COUNT(*) AS n FROM decisions").first();
  if (items.length) {
    await db.batch(
      items.map((it) =>
        db.prepare(UPSERT_SQL).bind(it.ref_key, it.kind, it.level, it.title, JSON.stringify(bodyOf(it)),
          it.target_id, it.link, runId),
      ),
    );
  }
  const after = await db.prepare("SELECT COUNT(*) AS n FROM decisions").first();
  // ④ 元の状態が消えたもの（ほかの画面で決めた・日が過ぎた）は片づける
  await db
    .prepare("UPDATE decisions SET status = 'closed', decided_at = datetime('now') WHERE status = 'open' AND ref_key NOT IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(items.map((i) => i.ref_key)))
    .run();

  const newItems = (after?.n ?? 0) - (before?.n ?? 0);
  const summary = {};
  for (const it of items) summary[it.kind] = (summary[it.kind] ?? 0) + 1;
  await db
    .prepare("UPDATE patrol_runs SET finished_at = datetime('now'), new_items = ?, ai_drafts = ?, summary_json = ? WHERE id = ?")
    .bind(newItems, aiDrafts, JSON.stringify(summary), runId)
    .run();
  return { id: runId, trigger, new_items: newItems, ai_drafts: aiDrafts, found: summary };
}

const LEVEL_ORDER = "CASE level WHEN 'urgent' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END";

function decisionView(row) {
  let body = {};
  try {
    body = JSON.parse(row.facts_json ?? "{}") ?? {};
  } catch {
    body = {};
  }
  return {
    id: row.id,
    kind: row.kind,
    level: row.level,
    title: row.title,
    facts: Array.isArray(body.facts) ? body.facts : [],
    can_ok: body.can_ok !== false,
    review: body.review ?? null, // 値付けの知らせだけ：「見直した／このまま」で決める
    by: Array.isArray(body.by) ? body.by : null, // だれが書き・確かめたか（古い記録には無い）
    link: row.link,
    status: row.status,
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

/**
 * 決裁箱：まだ決めていないもの（急ぐ順）・さっき決めたもの・最後の見回り。
 * ほかの画面で決めた予約メール・案内は、ここで「済み」にしてから返す
 */
export async function listDecisions(db) {
  await db.batch([
    db.prepare(`UPDATE decisions SET status = 'closed', decided_at = datetime('now') WHERE status = 'open' AND kind = 'booking_email'
      AND NOT EXISTS (SELECT 1 FROM booking_emails b WHERE b.id = CAST(decisions.target_id AS INTEGER) AND b.status = 'pending')`),
    db.prepare(`UPDATE decisions SET status = 'closed', decided_at = datetime('now') WHERE status = 'open' AND kind = 'arrival_draft'
      AND NOT EXISTS (SELECT 1 FROM guest_drafts g WHERE g.id = CAST(decisions.target_id AS INTEGER) AND g.status = 'draft')`),
  ]);
  const [open, done, last] = await Promise.all([
    db.prepare(`SELECT * FROM decisions WHERE status = 'open' ORDER BY ${LEVEL_ORDER}, id LIMIT 50`).all(),
    db.prepare("SELECT * FROM decisions WHERE status IN ('ok', 'closed') ORDER BY decided_at DESC, id DESC LIMIT 10").all(),
    db.prepare("SELECT id, trigger, started_at, finished_at, new_items, ai_drafts, summary_json FROM patrol_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1").first(),
  ]);
  return {
    open: (open.results ?? []).map(decisionView),
    done: (done.results ?? []).map(decisionView),
    last_patrol: last
      ? { id: last.id, trigger: last.trigger, finished_at: last.finished_at, new_items: last.new_items, ai_drafts: last.ai_drafts }
      : null,
  };
}

export class DecisionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * オーナーの OK。
 * - 予約メール：台帳に入れる（booking-email.js の confirmBookingEmail。プログラムの点検に通らなければ入れない）
 * - 到着前案内：確認済みにする（宿泊税の行に確かめる印が残っていれば断る）
 * - それ以外：見た、の印
 */
export async function decideOk({ db, id, now, lib }) {
  const row = await db.prepare("SELECT * FROM decisions WHERE id = ?").bind(id).first();
  if (!row) throw new DecisionError(404, "決裁箱に見つかりません");
  if (row.status !== "open") throw new DecisionError(409, "これはもう決めてあります");

  if (row.kind === "booking_email") {
    const mail = await lib.loadBookingEmail(db, Number(row.target_id));
    if (!mail) throw new DecisionError(404, "予約メールが見つかりません");
    const r = await lib.confirmBookingEmail(db, mail, null, { now, stayNightRows: lib.stayNightRows });
    if (r.error) throw new DecisionError(r.status, r.error);
  } else if (row.kind === "arrival_draft") {
    const d = await db.prepare("SELECT id, status, draft_template FROM guest_drafts WHERE id = ?").bind(Number(row.target_id)).first();
    if (!d) throw new DecisionError(404, "案内の下書きが見つかりません");
    if (d.status === "draft") {
      if (String(d.draft_template).includes(lib.OWNER_CHECK)) {
        throw new DecisionError(409, `「${lib.OWNER_CHECK}」が残っています。ゲスト連絡の画面で直してください`);
      }
      await db.prepare("UPDATE guest_drafts SET status = 'ok' WHERE id = ? AND status = 'draft'").bind(d.id).run();
    }
  }
  await db.prepare("UPDATE decisions SET status = 'ok', decided_at = datetime('now') WHERE id = ? AND status = 'open'").bind(id).run();
  return decisionView(await db.prepare("SELECT * FROM decisions WHERE id = ?").bind(id).first());
}

export const REVIEW_CHOICES = Object.freeze(["reviewed", "kept"]);

/**
 * 値付けの知らせに「見直した／このまま」を記録する。
 * 予約も帳簿も変えない。押したときにもう入っていた予約を残し、あとで比べる。
 * @param {object} p
 * @param {string} p.choice "reviewed"（見直した）か "kept"（このまま）
 * @param {number} p.rooms 部屋の数
 */
export async function decideReview({ db, id, choice, rooms }) {
  if (!REVIEW_CHOICES.includes(choice)) throw new DecisionError(400, "「見直した」か「このまま」を選んでください");
  const row = await db.prepare("SELECT * FROM decisions WHERE id = ?").bind(id).first();
  if (!row) throw new DecisionError(404, "決裁箱に見つかりません");
  if (row.kind !== "price_event" && row.kind !== "price_gap") throw new DecisionError(400, "これは値付けの知らせではありません");
  if (row.status !== "open") throw new DecisionError(409, "これはもう決めてあります");
  const view = decisionView(row);
  if (!view.review || !Array.isArray(view.review.nights) || !view.review.nights.length) {
    throw new DecisionError(409, "どの夜の知らせか分かりません。もう一度見回ってください");
  }
  const { results } = await db.prepare(PRICE_RES_SQL).all();
  const snap = reviewSnapshot(results ?? [], view.review, rooms);
  const done = await db.batch([
    db.prepare("UPDATE decisions SET status = 'ok', decided_at = datetime('now') WHERE id = ? AND status = 'open'").bind(id),
    db
      .prepare(
        `INSERT INTO price_reviews (decision_id, ref_key, kind, room, nights_json, before_json, free_room_nights, choice)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
      )
      .bind(id, row.ref_key, row.kind, view.review.room ?? null, JSON.stringify(view.review.nights), JSON.stringify(snap.before_ids),
        snap.free_room_nights, choice),
  ]);
  if (!done[0]?.meta?.changes) throw new DecisionError(409, "これはもう決めてあります");
  return decisionView(await db.prepare("SELECT * FROM decisions WHERE id = ?").bind(id).first());
}
