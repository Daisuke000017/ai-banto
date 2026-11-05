// AI番頭 Worker
// 読むだけ（GET）
// - /api/kpis?month=YYYY-MM             今月の数字（売上・手取り・稼働率など。泊まった日で数える）
// - /api/tax?month=YYYY-MM              宿泊税の集計表（下書き）
// - /api/minpaku/counter                180日カウンター
// - /api/minpaku/report?period=         定期報告の4項目（例：2026-08_09）
// - /api/drafts?reservation_id=         到着前案内の下書き一覧（暗証番号は伏せる）
// - /api/g/:token/home?lang=            ゲスト画面（宿のURL）の案内文・人数を入れたか
// - /api/reservations                   これからの予約の一覧（名前は出さない）と案内の状態
// - /api/cleaning                       清掃が必要な日（M18）：今日から3週間のチェックアウトの日と入れ替え（見るだけ）
// - /api/calendar?month=YYYY-MM          宿泊カレンダー（M21）：1か月の、日ごとの泊まり・チェックイン・チェックアウト（見るだけ）
// - /api/drill                          訓練（M15）の状態と、今回の訓練の避難の案内の下書き
// - /api/eval/results                   成績（M9）：自作の例題40件を、手元のスクリプトで流した結果（画面からは流さない）
// - /api/team/runs?since=               チーム（O-3）：係ごとの働きぶり・差し戻し（入力・出力の中身は返さない）
// - それ以外の GET                       画面（public/）を返す
// 書く（POST・JSONだけ・同じ画面からだけ）
// - /api/drafts                         到着前案内をつくる {reservation_id}
// - /api/drafts/:id                     確認済みにする {action:"ok"}／手で直す {action:"edit", draft_template}
// - /api/drafts/:id/copy                コピー用の文（暗証番号・住所を入れる。保存しない）
// - /api/guest-links                    宿のURLをつくる {reservation_id}（URLの鍵は1回だけ見せる。前のURLは止める）
// - /api/drill                          訓練（M15）を始める・終える {action:"start"|"end"}
//                                       始めると、泊まっている人ごとに避難の案内の下書きをつくる（送るボタンはない）
// ゲスト画面（M12・宿のURL）。URLが使えない理由は、どれでも同じ「使えません」だけを返す
// - GET  /g/:token                        ゲストの画面（public/guest.html）
// - GET  /api/g/:token/bus?lang=&time=    バス（M13）：最寄りのバス停の次のバス・今日の最終・1日の本数（time はデモのときだけ）
// - GET  /api/g/:token/drill?lang=        訓練（M15）のときの災害モード（決まった文と近い避難先2つ。AIは使わない）
// - POST /api/g/:token/language           言語を覚える {language}
// - POST /api/g/:token/profile            人数・国籍を入れる {language, adults, children, infants, nationalities}
//                                         （台帳は書きかえない。違えば「ずれ」に入れ、オーナーがOKしたときだけ台帳に入る）
// - POST /api/g/:token/ask?time=          行って戻れるか（M14）{lang, dest | text, back_by?}（AIの質問は1つのURLにつき1日10回まで）
// 予約メール（M17・貼り付け版）
// - GET  /api/booking-emails?status=pending|done   確認待ち／決めたもの（伏せた本文だけ）
// - GET  /api/booking-emails/samples                デモ用の見本メール
// - POST /api/booking-emails                        貼り付けたメールを読む {subject, body}（伏せる前の本文は保存しない）
// - POST /api/booking-emails/:id/confirm            OK＝台帳に入れる {fields?}（直した値）
// - POST /api/booking-emails/:id/edit               直す {fields}（確認待ちのまま。台帳は変えない）
// - POST /api/booking-emails/:id/reject             捨てる
// お金の照合（M1〜M4）
// - GET  /api/statements                 読み込んだ明細の一覧
// - GET  /api/statements/samples         デモ用の見本の明細
// - POST /api/uploads                    明細のCSVを読む {filename, base64|text, kind?}（列の対応の案を返す。まだ保存しない）
// - POST /api/uploads/:id/confirm        列の対応をOKにして読み込む {mapping, base64|text}
// - POST /api/reconcile                  台帳・明細・通帳を突き合わせる（プログラムだけ）
// - GET  /api/discrepancies              ずれの一覧
// - POST /api/discrepancies/:id/reasons  理由の候補を出す（経理担当→計算で確かめる→監査役）
// - POST /api/discrepancies/:id          オーナーの判断 {action:"ok"|"fixed"|"open", note?}
// 朝の見回り（M19）と決裁箱（M20）
// - GET  /api/decisions                  決裁箱：まだ決めていないもの（急ぐ順）・さっき決めたもの・最後の見回り
// - POST /api/patrol                     いま見回る（ボタン）
// - POST /api/decisions/:id/ok           オーナーの OK（予約メールは台帳に入れる・案内は確認済みにする・ほかは「見た」）
// - POST /api/decisions/:id/review       値付けの知らせに「見直した／このまま」を記録 {choice:"reviewed"|"kept"}（予約も帳簿も変えない）
// - 定期ジョブ（scheduled）              毎朝7時（日本時間）に見回る
// - メール受け取り（email）              決めた相手からの予約メールだけ読んで確認待ちに置き、見回る
// ⚠️ オーナー画面の鍵（Cloudflare Access）を付けるまでは、手元（localhost）以外からは開けない。
// ⚠️ 暗証番号はどの表にも保存しない。env.DOOR_CODE からコピー／表示のときだけ入れる。
import { dayCounter, headcount, minpakuReport, periodMonths, reportPeriodOf, rulesFromInnProfile, stayNightRows, taxDraft } from "./lib/counting.js";
import { monthOf, todayJst } from "./lib/dates.js";
import { busBoard, parseClock } from "./lib/bus.js";
import { answerAsk, ASK_MAX_CHARS, BUTTON_DESTS } from "./lib/ask.js";
import { kpiView } from "./lib/kpis.js";
import { cleaningDays, cleaningWindow } from "./lib/cleaning.js";
import { stayCalendar } from "./lib/calendar.js";
import { checkRoomName, MAX_ROOMS, nextRoomCode } from "./lib/rooms.js";
import { checkInnPatch } from "./lib/inn-settings.js";
import { ReportCsvError, submissionCsv } from "./lib/report-csv.js";
import { makeClient } from "./lib/anthropic.js";
import {
  confirmBookingEmail,
  editBookingEmail,
  intakeBookingEmail,
  listBookingEmails,
  loadBookingEmail,
  MAX_EMAIL_CHARS,
  rejectBookingEmail,
} from "./lib/booking-email.js";
import { sampleEmails } from "../seed/demo-booking-emails.js";
import { confirmStatement, intakeStatement, listStatements, StatementError } from "./lib/statements.js";
import { listDiscrepancies, runReconcile } from "./lib/reconcile.js";
import { DiscrepancyError, resolveDiscrepancy, suggestReasons } from "./lib/discrepancy.js";
import { sampleStatements } from "../seed/demo-statements.js";
import {
  checkTemplateEdit,
  fillPlaceholders,
  fixedArrival,
  generateArrivalDraft,
  guestView,
  maskForOwner,
  normLang,
  OWNER_CHECK,
} from "./lib/arrival.js";
import { generateEvacuationDraft, guestDrillView } from "./lib/drill.js";
import { DecisionError, decideOk, decideReview, listDecisions, runPatrol } from "./lib/patrol.js";
import { guidePrice, monthTakeHome, pacePlan, rateList, reviewCompare } from "./lib/pricing.js";
import { MAX_RAW_BYTES, bytesToBinary, messageKeyOf, parseRawEmail, senderAllowed } from "./lib/mail-in.js";
import { evalResults, teamRuns } from "./lib/eval.js";
import { expiresAtFor, GuestError, guestCountDiscrepancy, GUEST_LANGS, linkProblem, validateProfile } from "./lib/guest.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_BODY_BYTES = 10_000;
const MAX_MAIL_BODY_BYTES = 60_000; // 予約メールの貼り付けだけ大きめ（日本語12,000字まで）
const MAX_STATEMENT_BODY_BYTES = 3_000_000; // 明細のCSV（2MBまで）を base64 にした大きさ
// 書体だけ Google Fonts から読む。スクリプトは自分の画面のものだけ
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": CSP,
  "referrer-policy": "no-referrer",
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 宿の設定に、登録した部屋（rooms 表）を添えて返す
// - room_list：使っている部屋（{code, name}）。rooms＝その数（部屋の表が空なら、宿の設定の数のまま）
// - all_rooms：使っていない部屋も含めた全部（設定の画面用）
async function loadInn(env) {
  const [inn, rows] = await Promise.all([
    env.DB.prepare("SELECT * FROM inn_profile WHERE id = 1").first(),
    env.DB.prepare("SELECT code, name, sort_order, active FROM rooms ORDER BY sort_order, code").all(),
  ]);
  const all = rows.results ?? [];
  const room_list = all.filter((r) => r.active === 1).map(({ code, name }) => ({ code, name }));
  const base = inn ?? {};
  return room_list.length ? { ...base, rooms: room_list.length, room_list, all_rooms: all } : { ...base, room_list: [], all_rooms: all };
}

// 部屋の並び：登録した部屋があればそれ、無ければ宿の設定の数（A から順）
const roomsOf = (inn) => (inn.room_list?.length ? inn.room_list : Number(inn.rooms ?? 1));

// 宿泊者の名前はここで読まない（数えるのにも、AIにも要らないため）
const RES_COLUMNS = `id, ota, checkin_date, checkout_date, adults, children, infants, cosleep_free,
  tax_collection, lodging_tax_collected, nationalities_json, status, cancel_fee_amount, guest_changes_json`;
const RES_SELECT = `SELECT ${RES_COLUMNS} FROM reservations ORDER BY checkin_date, id`;
const RES_ONE = `SELECT ${RES_COLUMNS}, language FROM reservations WHERE id = ?`;

async function loadReservation(env, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new HttpError(400, "reservation_id の形が違います");
  const r = await env.DB.prepare(RES_ONE).bind(id).first();
  if (!r) throw new HttpError(404, "予約が見つかりません");
  return r;
}

// 書く操作の入口：JSONだけ・同じ画面（Origin）からだけ・大きすぎる中身は断る
async function readJsonBody(request, url, maxBytes = MAX_BODY_BYTES) {
  if (request.headers.get("origin") !== url.origin) throw new HttpError(403, "この画面からの操作だけ受け付けます");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "JSONで送ってください");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, "中身が大きすぎます");
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "JSONとして読めませんでした");
  }
}

// オーナー画面に出す形（暗証番号は伏せる・住所は宿の設定から）
function ownerDraftView(row, inn) {
  const mask = (t) => (t == null ? null : maskForOwner(t, { ADDRESS: inn.address }));
  return {
    id: row.id,
    reservation_id: row.reservation_id,
    kind: row.kind,
    language: row.language,
    source: row.source,
    status: row.status,
    text: mask(row.draft_template),
    ja_text: mask(row.ja_text),
    back_translation: mask(row.back_translation),
    checks: JSON.parse(row.checks_json ?? "[]"),
    audit: JSON.parse(row.audit_json ?? "null"),
    needs_owner_check: String(row.draft_template).includes(OWNER_CHECK),
    created_at: row.created_at,
  };
}

const DRAFT_SELECT = `SELECT id, reservation_id, kind, language, draft_template, ja_text, back_translation,
  checks_json, audit_json, source, status, created_at FROM guest_drafts`;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// デモの日付があれば、その日の朝9時を「いま」とみなす
const nowIso = (env) => (env.DEMO_TODAY ? `${env.DEMO_TODAY}T09:00:00+09:00` : new Date().toISOString());

async function handleGet(url, env, today) {
  const p = url.pathname;
  if (p.startsWith("/api/booking-emails")) return handleBookingEmailGet(url, env);
  if (p === "/api/decisions") return json(await listDecisions(env.DB));
  if (p === "/api/kpis") {
    const month = url.searchParams.get("month") ?? monthOf(today);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "month は YYYY-MM で指定してください");
    const inn = await loadInn(env);
    const rules = rulesFromInnProfile(inn);
    const [res, lines, open, nights, reviews] = await Promise.all([
      env.DB.prepare(`SELECT ${RES_COLUMNS}, room, amount_gross, ota_reservation_no FROM reservations ORDER BY checkin_date, id`).all(),
      env.DB.prepare("SELECT ota, ota_reservation_no, line_type, gross, fee FROM ota_lines").all(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM discrepancies WHERE status = 'open'").first(),
      env.DB.prepare("SELECT night, fiscal_year FROM stay_nights").all(),
      env.DB.prepare("SELECT kind, room, nights_json, before_json, free_room_nights, choice FROM price_reviews ORDER BY id").all(),
    ]);
    const rooms = Number(inn.rooms);
    const view = kpiView({ reservations: res.results, lines: lines.results, rooms, month, today, rules });
    // 値付けの目安（経営企画）：AIは使わない。今の数字は変えずに、横に足すだけ
    const cleaningFee = inn.cleaning_fee == null ? null : Number(inn.cleaning_fee);
    const pricing = {
      cleaning_fee: cleaningFee,
      min_price: inn.min_price == null ? null : Number(inn.min_price),
      guide: guidePrice(res.results, today),
      rates: rateList(lines.results),
      take_home: monthTakeHome(view, res.results, cleaningFee),
      pace: pacePlan(dayCounter(nights.results, today, rules), today),
      reviews: reviewCompare(reviews.results, res.results, lines.results, cleaningFee, roomsOf(inn)),
    };
    return json({ ...view, open_discrepancies: open?.n ?? 0, statements_loaded: lines.results.length > 0, pricing });
  }
  if (p === "/api/tax") {
    const month = url.searchParams.get("month") ?? monthOf(today);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "month は YYYY-MM で指定してください");
    const rules = rulesFromInnProfile(await loadInn(env));
    const { results } = await env.DB.prepare(RES_SELECT).all();
    return json({ today, ...taxDraft(results, month, rules) });
  }
  if (p === "/api/minpaku/counter") {
    const rules = rulesFromInnProfile(await loadInn(env));
    const { results } = await env.DB.prepare("SELECT night, fiscal_year FROM stay_nights").all();
    return json({ today, ...dayCounter(results, today, rules) });
  }
  if (p === "/api/minpaku/report") {
    const period = url.searchParams.get("period") ?? reportPeriodOf(monthOf(today));
    const { results } = await env.DB.prepare(RES_SELECT).all();
    return json({ today, ...minpakuReport(results, period, today) });
  }
  if (p === "/api/minpaku/report.csv") {
    // 定期報告の提出用CSV（見出しなし・UTF-8・CRLF）。国籍が分からない人・届出番号なしのときは、つくらずに直す所を返す
    const period = url.searchParams.get("period") ?? reportPeriodOf(monthOf(today));
    try {
      periodMonths(period);
    } catch {
      throw new HttpError(400, "期間の形が違います（例：2026-08_09）");
    }
    const inn = await loadInn(env);
    const { results } = await env.DB.prepare(RES_SELECT).all();
    const report = minpakuReport(results, period, today);
    let csv;
    try {
      csv = submissionCsv(report, inn.notification_no);
    } catch (e) {
      if (e instanceof ReportCsvError) return json({ error: e.message, fix: e.fix, reservations: e.reservations }, 422);
      throw e;
    }
    return new Response(csv.text, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="report.csv"; filename*=UTF-8''${encodeURIComponent(csv.filename)}`,
        "x-filename": encodeURIComponent(csv.filename),
        "cache-control": "no-store",
        ...SECURITY_HEADERS,
      },
    });
  }
  if (p === "/api/cleaning") {
    // 清掃が必要な日（M18）：今日から3週間。名前は読まない。AIは使わない
    const inn = await loadInn(env);
    const { results } = await env.DB.prepare(
      "SELECT id, ota, room, checkin_date, checkout_date, status FROM reservations WHERE status = 'confirmed' ORDER BY checkout_date, id",
    ).all();
    return json(cleaningDays(results, today, inn));
  }
  if (p === "/api/calendar") {
    // 宿泊カレンダー（M21）：1か月分。名前は読まない。AIは使わない
    const month = url.searchParams.get("month") ?? monthOf(today);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "month は YYYY-MM で指定してください");
    const inn = await loadInn(env);
    const { results } = await env.DB.prepare(
      `SELECT id, ota, room, checkin_date, checkout_date, adults, children, infants, status FROM reservations
       WHERE status = 'confirmed' AND checkin_date <= ? AND checkout_date >= ? ORDER BY checkin_date, id`,
    )
      .bind(`${month}-31`, `${month}-01`)
      .all();
    // 止めた部屋でも、その月に泊まりがあれば列に出す（過去の予約が「部屋未定」に見えないように）
    const used = new Set(results.map((r) => r.room).filter(Boolean));
    const list = inn.room_list.length
      ? [...inn.room_list, ...inn.all_rooms.filter((r) => r.active !== 1 && used.has(r.code)).map(({ code, name }) => ({ code, name }))]
      : null;
    return json({ ...stayCalendar(results, month, today, list ?? roomsOf(inn)), room_list: list ?? [], window: cleaningWindow(inn) });
  }
  if (p === "/api/reservations") {
    // これからの予約（今日より後に出発する・取り消していない）。名前は読まない
    const inn = await loadInn(env);
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.ota, r.checkin_date, r.checkout_date, r.adults, r.children, r.infants, r.language,
        (SELECT status FROM guest_drafts d WHERE d.reservation_id = r.id AND d.kind = 'arrival' ORDER BY d.id DESC LIMIT 1) AS draft_status
       FROM reservations r WHERE r.status = 'confirmed' AND r.checkout_date > ? ORDER BY r.checkin_date, r.id`,
    )
      .bind(today)
      .all();
    return json({
      today,
      inn_name: inn.name ?? null,
      reservations: results.map((r) => ({
        id: r.id,
        ota: r.ota,
        checkin_date: r.checkin_date,
        checkout_date: r.checkout_date,
        guests: headcount({ adults: r.adults ?? 0, children: r.children ?? 0, infants: r.infants ?? 0 }),
        language: normLang(r.language),
        draft_status: r.draft_status ?? null,
      })),
    });
  }
  if (p === "/api/settings") return json(await settingsView(env, today));
  if (p === "/api/drill") return json(await drillState(env, today));
  if (p === "/api/eval/results") return json(await evalResults(env.DB));
  if (p === "/api/team/runs") {
    const since = url.searchParams.get("since") ?? "0";
    if (!/^\d{1,12}$/.test(since)) throw new HttpError(400, "since は数字で指定してください");
    return json(await teamRuns(env.DB, Number(since)));
  }
  if (p === "/api/drafts") {
    const r = await loadReservation(env, url.searchParams.get("reservation_id"));
    const inn = await loadInn(env);
    const { results } = await env.DB.prepare(`${DRAFT_SELECT} WHERE reservation_id = ? ORDER BY id DESC`).bind(r.id).all();
    return json({ reservation_id: r.id, drafts: results.map((row) => ownerDraftView(row, inn)) });
  }
  return null;
}

async function handlePost(request, url, env) {
  const p = url.pathname;
  const body = await readJsonBody(request, url);

  if (p === "/api/drill") return handleDrillPost(body, env);

  if (p === "/api/drafts") {
    const r = await loadReservation(env, body.reservation_id);
    if (r.status !== "confirmed") throw new HttpError(400, "取り消された予約には案内をつくりません");
    const inn = await loadInn(env);
    const rules = rulesFromInnProfile(inn);
    let client = null;
    try {
      client = makeClient(env);
    } catch {
      client = null; // 鍵がない → 決まった文になる
    }
    const d = await generateArrivalDraft({ client, db: env.DB, r, inn, rules });
    const row = await env.DB.prepare(
      `INSERT INTO guest_drafts (reservation_id, kind, language, draft_template, ja_text, back_translation,
        checks_json, audit_json, source, status) VALUES (?, 'arrival', ?, ?, ?, ?, ?, ?, ?, 'draft') RETURNING id`,
    )
      .bind(r.id, d.language, d.draft_template, d.ja_text, d.back_translation, JSON.stringify(d.checks ?? []),
        JSON.stringify(d.audit ?? null), d.source)
      .first();
    const saved = await env.DB.prepare(`${DRAFT_SELECT} WHERE id = ?`).bind(row.id).first();
    return json({ ...ownerDraftView(saved, inn), attempts: d.attempts, fallback_reason: d.fallback_reason }, 201);
  }

  const m = p.match(/^\/api\/drafts\/(\d+)(\/copy)?$/);
  if (m) {
    const id = Number(m[1]);
    const row = await env.DB.prepare(`${DRAFT_SELECT} WHERE id = ?`).bind(id).first();
    if (!row) throw new HttpError(404, "下書きが見つかりません");
    const inn = await loadInn(env);

    if (m[2]) {
      // コピー：確認済みのものだけ。入れた文は保存もログもしない
      if (row.status !== "ok" && row.status !== "copied") throw new HttpError(409, "先に内容を確かめて「確認済み」にしてください");
      const text = fillPlaceholders(row.draft_template, { DOOR_CODE: env.DOOR_CODE, ADDRESS: inn.address });
      await env.DB.prepare("UPDATE guest_drafts SET status = 'copied' WHERE id = ?").bind(id).run();
      return json({ id, text, door_code_set: Boolean(env.DOOR_CODE), address_set: Boolean(inn.address) });
    }

    if (body.action === "edit") {
      const problems = checkTemplateEdit(body.draft_template);
      if (problems.length) return json({ error: "直した文に問題があります", problems }, 400);
      await env.DB.prepare("UPDATE guest_drafts SET draft_template = ?, status = 'draft' WHERE id = ?")
        .bind(body.draft_template, id)
        .run();
    } else if (body.action === "ok") {
      if (String(row.draft_template).includes(OWNER_CHECK)) {
        throw new HttpError(409, `「${OWNER_CHECK}」が残っています。宿泊税の行を直してから確認済みにしてください`);
      }
      await env.DB.prepare("UPDATE guest_drafts SET status = 'ok' WHERE id = ?").bind(id).run();
    } else {
      throw new HttpError(400, "action は ok か edit です");
    }
    const saved = await env.DB.prepare(`${DRAFT_SELECT} WHERE id = ?`).bind(id).first();
    return json(ownerDraftView(saved, inn));
  }

  if (p === "/api/guest-links") {
    const r = await loadReservation(env, body.reservation_id);
    if (r.status !== "confirmed") throw new HttpError(400, "取り消された予約にはURLをつくりません");
    const token = newToken();
    const expiresAt = expiresAtFor(r.checkout_date);
    // 新しいURLをつくったら、同じ予約の前のURLは止める（1つの予約に使えるURLは1つだけ）
    await env.DB.batch([
      env.DB.prepare("UPDATE guest_links SET revoked = 1 WHERE reservation_id = ? AND revoked = 0").bind(r.id),
      env.DB.prepare(
        "INSERT INTO guest_links (reservation_id, token_hash, expires_at, checkin_date, checkout_date) VALUES (?, ?, ?, ?, ?)",
      ).bind(r.id, await sha256Hex(token), expiresAt, r.checkin_date, r.checkout_date),
    ]);
    // 鍵そのものは保存しない（ハッシュだけ）。ここで1回だけ見せる
    return json({ reservation_id: r.id, path: `/g/${token}`, token, expires_at: expiresAt }, 201);
  }

  return null;
}

// ゲスト画面（M12）。ゲストに見せるヘッダー：URLの鍵を、ほかのサイトへ漏らさない
const GUEST_HEADERS = { "referrer-policy": "no-referrer" };
// URLが使えない理由（期限切れ・取り消し・日付の変更など）は分けて見せない。宿の名前・住所も出さない
const guestGone = () => json({ error: "unavailable" }, 404, GUEST_HEADERS);

/** URLの鍵を確かめる。使えなければ null（開くたびに、期限・取り消し・予約が確定のままか・日付を見る） */
async function loadGuestLink(env, token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const link = await env.DB.prepare(
    "SELECT id, reservation_id, expires_at, revoked, checkin_date, checkout_date, language FROM guest_links WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first();
  if (!link) return null;
  const r = await env.DB.prepare(RES_ONE).bind(link.reservation_id).first();
  if (linkProblem(link, r, nowIso(env))) return null;
  return { link, r };
}

async function loadGuestProfile(env, reservationId) {
  const p = await env.DB.prepare(
    "SELECT language, adults, children, infants, nationalities_json, submitted_at FROM guest_profiles WHERE reservation_id = ?",
  )
    .bind(reservationId)
    .first();
  if (!p) return null;
  return { adults: p.adults, children: p.children, infants: p.infants, nationalities: JSON.parse(p.nationalities_json), submitted_at: p.submitted_at };
}

const parseJsonObject = (s) => {
  try {
    const o = JSON.parse(s ?? "{}");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
};

// ゲスト画面：確認済みの案内（なければ決まった文）と、人数を入れたかを返す
async function handleGuest(url, env, today, token) {
  const found = await loadGuestLink(env, token);
  if (!found) return guestGone();
  const { link, r } = found;
  const inn = await loadInn(env);
  const asked = url.searchParams.get("lang");
  const lang = normLang(asked ?? link.language ?? r.language);
  const draft = await env.DB.prepare(
    `SELECT draft_template FROM guest_drafts WHERE reservation_id = ? AND kind = 'arrival'
     AND status IN ('ok', 'copied') AND language = ? ORDER BY id DESC LIMIT 1`,
  )
    .bind(r.id, lang)
    .first();
  const template = draft?.draft_template ?? fixedArrival({ ...r, language: lang }, inn, rulesFromInnProfile(inn)).draft_template;
  // 住所・暗証番号は、チェックインの日の0時（日本時間）から（guestView の中で伏せる）
  const text = guestView(template, lang, { today, checkin: r.checkin_date, DOOR_CODE: env.DOOR_CODE, ADDRESS: inn.address });
  return json(
    {
      inn_name: inn.name,
      language: lang,
      language_chosen: GUEST_LANGS.includes(link.language),
      checkin: r.checkin_date,
      checkout: r.checkout_date,
      source: draft ? "owner_checked" : "fixed",
      text,
      // 人数の入力欄に最初から入れておく数（予約サイトから来た数）。名前は持っていない
      booked: { adults: r.adults ?? 1, children: r.children ?? 0, infants: r.infants ?? 0, nationalities: parseJsonObject(r.nationalities_json) },
      profile: await loadGuestProfile(env, r.id),
    },
    200,
    GUEST_HEADERS,
  );
}

// ゲスト画面：書く（言語を覚える・人数を入れる）
async function handleGuestPost(request, url, env, token, action) {
  const body = await readJsonBody(request, url);
  const found = await loadGuestLink(env, token);
  if (!found) return guestGone();
  const { link, r } = found;

  if (action === "language") {
    if (!GUEST_LANGS.includes(body.language)) throw new HttpError(400, "language");
    await env.DB.prepare("UPDATE guest_links SET language = ? WHERE id = ?").bind(body.language, link.id).run();
    return json({ language: body.language }, 200, GUEST_HEADERS);
  }

  // action === "profile"
  let profile;
  try {
    profile = validateProfile(body);
  } catch (e) {
    if (e instanceof GuestError) return json({ error: "invalid", problems: e.problems ?? [] }, 400, GUEST_HEADERS);
    throw e;
  }
  const now = nowIso(env);
  const d = guestCountDiscrepancy(profile, r);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO guest_profiles (reservation_id, language, adults, children, infants, nationalities_json, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (reservation_id) DO UPDATE SET language = excluded.language, adults = excluded.adults, children = excluded.children,
         infants = excluded.infants, nationalities_json = excluded.nationalities_json, submitted_at = excluded.submitted_at`,
    ).bind(r.id, profile.language, profile.adults, profile.children, profile.infants, JSON.stringify(profile.nationalities), now),
    env.DB.prepare("UPDATE guest_links SET language = ? WHERE id = ?").bind(profile.language, link.id),
    // 前に入れた数のずれ（まだ決めていないもの）は、入れ直した数で作り直す
    env.DB.prepare("DELETE FROM discrepancies WHERE kind = 'guest_count' AND reservation_id = ? AND status = 'open'").bind(r.id),
  ];
  if (d) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO discrepancies (kind, reservation_id, expected, actual, diff_amount, facts_json, status, created_at)
         VALUES ('guest_count', ?, ?, ?, ?, ?, 'open', ?)`,
      ).bind(r.id, d.expected, d.actual, d.diff, JSON.stringify(d.facts), now),
    );
  }
  await env.DB.batch(stmts);
  // ゲストには、台帳と違ったかどうかは見せない（オーナーが確かめる）
  return json({ saved: true, profile: await loadGuestProfile(env, r.id) }, 200, GUEST_HEADERS);
}

// ゲスト画面：バス（M13）。時刻はプログラムが時刻表から出す（AIは使わない）
async function handleGuestBus(url, env, today, token) {
  const found = await loadGuestLink(env, token);
  if (!found) return guestGone();
  const { link, r } = found;
  const lang = normLang(url.searchParams.get("lang") ?? link.language ?? r.language);
  // 「いま」は日本時間の時計。デモのときだけ ?time=HH:MM で時刻を変えて見せられる
  const clock = new Date(Date.now() + 9 * 3600 * 1000);
  let minutes = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  if (env.DEMO_TODAY) minutes = parseClock(url.searchParams.get("time")) ?? minutes;
  return json(busBoard({ date: today, minutes, lang }), 200, GUEST_HEADERS);
}

// ゲスト画面：行って戻れるか（M14）。時刻はプログラムが選び、AIは行き先の読み取りと説明の文だけ
async function handleGuestAsk(request, url, env, today, token) {
  const body = await readJsonBody(request, url);
  const found = await loadGuestLink(env, token);
  if (!found) return guestGone();
  const { link, r } = found;
  const lang = normLang(body.lang ?? link.language ?? r.language);
  const dest = typeof body.dest === "string" ? body.dest : null;
  const text = typeof body.text === "string" ? body.text.trim() : null;
  if ((dest == null) === (text == null || text === "")) throw new HttpError(400, "行き先か質問のどちらか1つを送ってください");
  if (dest != null && !BUTTON_DESTS.includes(dest)) throw new HttpError(400, "dest");
  if (text && [...text].length > ASK_MAX_CHARS) throw new HttpError(400, `質問は${ASK_MAX_CHARS}文字までです`);
  let backBy = null;
  if (body.back_by != null && body.back_by !== "") {
    backBy = parseClock(String(body.back_by));
    if (backBy == null) throw new HttpError(400, "back_by");
  }
  const clock = new Date(Date.now() + 9 * 3600 * 1000);
  let minutes = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  if (env.DEMO_TODAY) minutes = parseClock(url.searchParams.get("time")) ?? minutes;
  const taxi = parseJsonObject((await loadInn(env)).taxi_info_json);
  const res = await answerAsk({
    db: env.DB,
    client: aiClient(env),
    linkId: link.id,
    lang,
    dest,
    text: dest == null ? text : null,
    backBy,
    date: today,
    minutes,
    countDay: todayJst(), // 回数は本当の日本時間の日付で数える（デモの日付ではない）
    now: new Date().toISOString(),
    taxiName: typeof taxi.name === "string" ? taxi.name : null,
  });
  return json(res, 200, GUEST_HEADERS);
}

// 予約メール（M17）：読む
async function handleBookingEmailGet(url, env) {
  if (url.pathname === "/api/booking-emails/samples") {
    if (!env.DEMO_TODAY) throw new HttpError(404, "見本はデモのときだけです");
    return json({ samples: sampleEmails.map((e) => ({ key: e.key, label: e.label, subject: e.subject, body: e.body })) });
  }
  if (url.pathname === "/api/booking-emails") {
    const status = url.searchParams.get("status") === "done" ? "done" : "pending";
    return json({ status, emails: await listBookingEmails(env.DB, { status, now: nowIso(env) }) });
  }
  return null;
}

// 予約メール（M17）：書く
async function handleBookingEmailPost(request, url, env, today) {
  const p = url.pathname;
  const body = await readJsonBody(request, url, p === "/api/booking-emails" ? MAX_MAIL_BODY_BYTES : MAX_BODY_BYTES);

  if (p === "/api/booking-emails") {
    const subject = typeof body.subject === "string" ? body.subject : "";
    const text = typeof body.body === "string" ? body.body : "";
    if (!text.trim()) throw new HttpError(400, "メールの本文を貼り付けてください");
    if (subject.length > 300) throw new HttpError(400, "件名が長すぎます");
    if (text.length > MAX_EMAIL_CHARS) {
      throw new HttpError(413, `本文が長すぎます（${MAX_EMAIL_CHARS.toLocaleString("en-US")}字まで）。予約の部分だけを貼り付けてください`);
    }
    let client = null;
    try {
      client = makeClient(env);
    } catch {
      client = null; // 鍵がない → 手で入れる
    }
    const view = await intakeBookingEmail({ client, db: env.DB, subject, body: text, today, now: nowIso(env) });
    return json(view, 201);
  }

  const m = p.match(/^\/api\/booking-emails\/(\d+)\/(confirm|edit|reject)$/);
  if (!m) return null;
  const row = await loadBookingEmail(env.DB, Number(m[1]));
  if (!row) throw new HttpError(404, "予約メールが見つかりません");
  const r =
    m[2] === "confirm"
      ? await confirmBookingEmail(env.DB, row, body.fields ?? null, { now: nowIso(env), stayNightRows })
      : m[2] === "edit"
        ? await editBookingEmail(env.DB, row, body.fields ?? null)
        : await rejectBookingEmail(env.DB, row, { now: nowIso(env) });
  if (r.error) throw new HttpError(r.status, r.error);
  return json(r);
}

// お金の照合（M1〜M4）：読む
async function handleMoneyGet(url, env) {
  const p = url.pathname;
  if (p === "/api/statements/samples") {
    if (!env.DEMO_TODAY) throw new HttpError(404, "見本はデモのときだけです");
    return json({ samples: sampleStatements.map((s) => ({ key: s.key, kind: s.kind, label: s.label, filename: s.filename, text: s.text })) });
  }
  if (p === "/api/statements") return json({ statements: await listStatements(env.DB) });
  if (p === "/api/discrepancies") return json({ discrepancies: await listDiscrepancies(env.DB) });
  return null;
}

// ---- 訓練（M15）----

// 泊まっている人（チェックイン日 <= 今日 < チェックアウト日）。名前は読まない
const STAYING_SQL = `SELECT id, language, checkin_date, checkout_date FROM reservations
  WHERE status = 'confirmed' AND checkin_date <= ? AND checkout_date > ? ORDER BY checkin_date, id`;

async function loadDrill(env) {
  return env.DB.prepare("SELECT active, scenario, started_at, ended_at, draft_from_id FROM drill_state WHERE id = 1").first();
}

// オーナー画面（O-5）：訓練の状態と、今回の訓練の避難の案内
async function drillState(env, today) {
  const st = (await loadDrill(env)) ?? { active: 0, scenario: "tsunami_advisory", started_at: null, ended_at: null, draft_from_id: 0 };
  const inn = await loadInn(env);
  const staying = await env.DB.prepare(STAYING_SQL).bind(today, today).all();
  const { results } = await env.DB.prepare(`${DRAFT_SELECT} WHERE kind = 'evacuation' AND id > ? ORDER BY id`)
    .bind(st.draft_from_id ?? 0)
    .all();
  return {
    active: Boolean(st.active),
    scenario: st.scenario,
    started_at: st.started_at,
    ended_at: st.ended_at,
    staying: staying.results.map((r) => ({ id: r.id, language: normLang(r.language), checkout_date: r.checkout_date })),
    // 訓練をしていないときは、前の訓練の下書きを出さない
    drafts: st.active ? results.map((row) => ownerDraftView(row, inn)) : [],
  };
}

async function handleDrillPost(body, env) {
  const today = todayJst(env.DEMO_TODAY);
  const now = nowIso(env);
  if (body.action === "end") {
    await env.DB.prepare("UPDATE drill_state SET active = 0, ended_at = ? WHERE id = 1 AND active = 1").bind(now).run();
    return json(await drillState(env, today));
  }
  if (body.action !== "start") throw new HttpError(400, "action は start か end です");
  // 先に「訓練中」にする（ゲスト画面はすぐ災害モードになる）。2回押しても下書きは1回分だけ
  const res = await env.DB.prepare(
    `UPDATE drill_state SET active = 1, started_at = ?, ended_at = NULL,
       draft_from_id = (SELECT COALESCE(MAX(id), 0) FROM guest_drafts) WHERE id = 1 AND active = 0`,
  )
    .bind(now)
    .run();
  if (!res.meta?.changes) return json(await drillState(env, today));
  const client = aiClient(env);
  const { results: staying } = await env.DB.prepare(STAYING_SQL).bind(today, today).all();
  for (const r of staying) {
    const d = await generateEvacuationDraft({ client, db: env.DB, r });
    await env.DB.prepare(
      `INSERT INTO guest_drafts (reservation_id, kind, language, draft_template, ja_text, back_translation,
        checks_json, audit_json, source, status) VALUES (?, 'evacuation', ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    )
      .bind(r.id, d.language, d.draft_template, d.ja_text, d.back_translation, JSON.stringify(d.checks ?? []),
        JSON.stringify(d.audit ?? null), d.source)
      .run();
  }
  return json(await drillState(env, today), 201);
}

// ゲスト画面（G-5）：訓練中かどうか。訓練中なら決まった文と近い避難先2つ（プログラムだけ）
async function handleGuestDrill(url, env, token) {
  const found = await loadGuestLink(env, token);
  if (!found) return guestGone();
  const { link, r } = found;
  const st = await loadDrill(env);
  if (!st?.active) return json({ active: false }, 200, GUEST_HEADERS);
  const lang = normLang(url.searchParams.get("lang") ?? link.language ?? r.language);
  return json(guestDrillView(lang, st), 200, GUEST_HEADERS);
}

function aiClient(env) {
  try {
    return makeClient(env);
  } catch {
    return null; // 鍵がない → プログラムだけで進める
  }
}

// 朝の見回り（M19）：定期ジョブ・ボタン・メールの3つの入口から同じものを呼ぶ
const PATROL_LIB = { listBookingEmails, generateArrivalDraft, cleaningDays, dayCounter, OWNER_CHECK };
async function patrol(env, trigger) {
  const inn = await loadInn(env);
  return runPatrol({
    db: env.DB,
    trigger,
    today: todayJst(env.DEMO_TODAY),
    now: nowIso(env),
    inn,
    rules: rulesFromInnProfile(inn),
    client: aiClient(env),
    lib: PATROL_LIB,
  });
}

// 決裁箱（M20）：書く
async function handleDecisionPost(request, url, env, ctx) {
  const body = await readJsonBody(request, url);
  if (url.pathname === "/api/patrol") {
    const run = await patrol(env, "button");
    return json({ patrol: run, ...(await listDecisions(env.DB)) });
  }
  const rv = url.pathname.match(/^\/api\/decisions\/(\d+)\/review$/);
  if (rv) {
    try {
      const inn = await loadInn(env);
      const decided = await decideReview({ db: env.DB, id: Number(rv[1]), choice: body.choice, rooms: roomsOf(inn) });
      return json({ decided, ...(await listDecisions(env.DB)) });
    } catch (e) {
      if (e instanceof DecisionError) throw new HttpError(e.status, e.message);
      throw e;
    }
  }
  const m = url.pathname.match(/^\/api\/decisions\/(\d+)\/ok$/);
  if (!m) return null;
  try {
    const decided = await decideOk({
      db: env.DB,
      id: Number(m[1]),
      now: nowIso(env),
      lib: { loadBookingEmail, confirmBookingEmail, stayNightRows, OWNER_CHECK },
    });
    // 予約が台帳に入ったら、続けて見回る（近いチェックインなら到着前案内を用意する）。画面は待たせない
    const followUp = decided.kind === "booking_email";
    if (followUp && ctx?.waitUntil) {
      ctx.waitUntil(patrol(env, "button").catch((e) => console.error("patrol", e instanceof Error ? e.name : "unknown")));
    }
    return json({ decided, follow_up_patrol: followUp, ...(await listDecisions(env.DB)) });
  } catch (e) {
    if (e instanceof DecisionError) throw new HttpError(e.status, e.message);
    throw e;
  }
}

// メール受け取り（M19）：決めた相手（MAIL_ALLOW_FROM）からの予約メールだけ読む。本文は伏せてから保存する
// デモのときだけ、手元の試験用に「ota-demo.example」（だれも持てない試験用の名前）からのメールも受け取る
const DEMO_MAIL_DOMAIN = "ota-demo.example";
const mailAllow = (env) => [env.MAIL_ALLOW_FROM, env.DEMO_TODAY ? DEMO_MAIL_DOMAIN : ""].filter(Boolean).join(",");

async function receiveEmail(message, env) {
  const allow = mailAllow(env);
  if (!senderAllowed(message.from, allow)) {
    message.setReject("このアドレスでは受け付けていません");
    return { ok: false, reason: "sender" };
  }
  if (Number(message.rawSize) > MAX_RAW_BYTES) {
    message.setReject("メールが大きすぎます");
    return { ok: false, reason: "size" };
  }
  const bytes = new Uint8Array(await new Response(message.raw).arrayBuffer());
  if (bytes.length > MAX_RAW_BYTES) {
    message.setReject("メールが大きすぎます");
    return { ok: false, reason: "size" };
  }
  const parsed = parseRawEmail(bytesToBinary(bytes));
  // 封筒の送り元と、本文の From が違うときは読まない（なりすましを減らすため）
  if (parsed.from && !senderAllowed(parsed.from, allow)) {
    message.setReject("このアドレスでは受け付けていません");
    return { ok: false, reason: "sender" };
  }
  if (!parsed.text.trim()) return { ok: false, reason: "empty" };
  const messageKey = await messageKeyOf(parsed);
  const dup = await env.DB.prepare("SELECT id FROM booking_emails WHERE message_key = ?").bind(messageKey).first();
  if (dup) return { ok: true, duplicate: true, id: dup.id };
  const view = await intakeBookingEmail({
    client: aiClient(env),
    db: env.DB,
    subject: parsed.subject,
    body: parsed.text.slice(0, MAX_EMAIL_CHARS),
    today: todayJst(env.DEMO_TODAY),
    now: nowIso(env),
    source: "email",
    senderDomain: String(message.from).toLowerCase().split("@").pop(),
    authPass: parsed.auth,
    messageKey,
  });
  await patrol(env, "email");
  return { ok: true, id: view.id };
}

const fileInput = (body) => ({
  base64: typeof body.base64 === "string" ? body.base64 : undefined,
  text: typeof body.text === "string" ? body.text : undefined,
});

// お金の照合（M1〜M4）：書く
async function handleMoneyPost(request, url, env) {
  const p = url.pathname;
  const big = p === "/api/uploads" || /^\/api\/uploads\/\d+\/confirm$/.test(p);
  const body = await readJsonBody(request, url, big ? MAX_STATEMENT_BODY_BYTES : MAX_BODY_BYTES);
  const now = nowIso(env);
  try {
    if (p === "/api/uploads") {
      const kind = typeof body.kind === "string" && body.kind ? body.kind : null;
      return json(await intakeStatement({ client: aiClient(env), db: env.DB, kind, ...fileInput(body), now }), 201);
    }
    const up = p.match(/^\/api\/uploads\/(\d+)\/confirm$/);
    if (up) {
      return json(await confirmStatement({ db: env.DB, uploadId: Number(up[1]), mapping: body.mapping, ...fileInput(body), now }));
    }
    if (p === "/api/reconcile") {
      return json(await runReconcile({ db: env.DB, rules: rulesFromInnProfile(await loadInn(env)), now }));
    }
    const rs = p.match(/^\/api\/discrepancies\/(\d+)\/reasons$/);
    if (rs) {
      const d = await suggestReasons({ client: aiClient(env), db: env.DB, id: Number(rs[1]) });
      if (!d) throw new HttpError(404, "そのずれは見つかりません");
      return json(d);
    }
    const one = p.match(/^\/api\/discrepancies\/(\d+)$/);
    if (one) {
      return json(await resolveDiscrepancy({ db: env.DB, id: Number(one[1]), action: body.action, note: body.note, now }));
    }
    return null;
  } catch (e) {
    if (e instanceof StatementError || e instanceof DiscrepancyError) throw new HttpError(e.status, e.message);
    throw e;
  }
}

// ---- 宿と部屋の設定（オーナーが画面で入れる）。AIは使わない ----
const INN_FIELDS = ["name", "address", "notification_no", "cleaning_checkout_time", "cleaning_checkin_time", "cleaning_fee", "min_price"];

async function settingsView(env, today) {
  const inn = await loadInn(env);
  const { results } = await env.DB.prepare(
    "SELECT room, COUNT(*) AS n FROM reservations WHERE status = 'confirmed' AND checkout_date > ? AND room IS NOT NULL GROUP BY room",
  )
    .bind(today)
    .all();
  const upcoming = Object.fromEntries((results ?? []).map((r) => [r.room, r.n]));
  return {
    inn: Object.fromEntries(INN_FIELDS.map((k) => [k, inn[k] ?? null])),
    rooms: inn.all_rooms.map((r) => ({ code: r.code, name: r.name, active: r.active === 1, upcoming: upcoming[r.code] ?? 0 })),
    max_rooms: MAX_ROOMS,
  };
}

async function handleSettingsPost(request, url, env, today) {
  const p = url.pathname;
  const body = await readJsonBody(request, url);
  const inn = await loadInn(env);
  const all = inn.all_rooms;
  // 宿の設定の「部屋の数」も、使っている部屋の数にそろえる
  const syncCount = (activeCount) => env.DB.prepare("UPDATE inn_profile SET rooms = ? WHERE id = 1").bind(activeCount);

  if (p === "/api/settings/inn") {
    const checked = checkInnPatch(body, inn);
    if (checked.error) throw new HttpError(400, checked.error);
    const keys = Object.keys(checked.values);
    await env.DB.prepare(`UPDATE inn_profile SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = 1`)
      .bind(...keys.map((k) => checked.values[k]))
      .run();
    return json(await settingsView(env, today));
  }

  if (p === "/api/rooms") {
    const named = checkRoomName(body.name);
    if (named.error) throw new HttpError(400, named.error);
    const code = nextRoomCode(all);
    if (!code) throw new HttpError(400, `部屋は${MAX_ROOMS}部屋までです`);
    const order = all.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
    const active = all.filter((r) => r.active === 1).length + 1;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rooms (code, name, sort_order) VALUES (?, ?, ?)").bind(code, named.name, order),
      syncCount(active),
    ]);
    return json(await settingsView(env, today));
  }

  const m = p.match(/^\/api\/rooms\/([A-Z])$/);
  if (m) {
    const room = all.find((r) => r.code === m[1]);
    if (!room) throw new HttpError(404, "その部屋は見つかりません");
    const stmts = [];
    if ("name" in body) {
      const named = checkRoomName(body.name);
      if (named.error) throw new HttpError(400, named.error);
      stmts.push(env.DB.prepare("UPDATE rooms SET name = ? WHERE code = ?").bind(named.name, room.code));
    }
    if ("active" in body) {
      if (typeof body.active !== "boolean") throw new HttpError(400, "active は true か false で送ってください");
      const others = all.filter((r) => r.active === 1 && r.code !== room.code).length;
      if (!body.active && room.active === 1) {
        if (others === 0) throw new HttpError(400, `「${room.name}」は最後の1部屋なので止められません`);
        const n = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM reservations WHERE room = ? AND status = 'confirmed' AND checkout_date > ?",
        )
          .bind(room.code, today)
          .first();
        if ((n?.n ?? 0) > 0) throw new HttpError(400, `「${room.name}」には、これからの予約が${n.n}件あるので止められません。先に予約の部屋を移してください`);
      }
      stmts.push(env.DB.prepare("UPDATE rooms SET active = ? WHERE code = ?").bind(body.active ? 1 : 0, room.code));
      stmts.push(syncCount(others + (body.active ? 1 : 0)));
    }
    if (!stmts.length) throw new HttpError(400, "変える項目がありません");
    await env.DB.batch(stmts);
    return json(await settingsView(env, today));
  }
  return null;
}

const isSettingsPath = (p) => p === "/api/settings/inn" || p === "/api/rooms" || p.startsWith("/api/rooms/");

const isMoneyPath = (p) => p.startsWith("/api/uploads") || p === "/api/reconcile" || p.startsWith("/api/discrepancies") || p.startsWith("/api/statements");

// 画面のファイル（public/）。安全のヘッダーを付けて返す
async function serveAsset(request, env, path = null) {
  if (!env.ASSETS) return json({ error: "見つかりません" }, 404);
  const res = await env.ASSETS.fetch(path ? new Request(new URL(path, request.url), { method: "GET" }) : request);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!LOCAL_HOSTS.has(url.hostname)) return json({ error: "この画面はまだ公開していません" }, 403);
    const today = todayJst(env.DEMO_TODAY);
    try {
      // ゲスト画面（M12）。オーナー画面より先に見る
      const gp = url.pathname.match(/^\/g\/([A-Za-z0-9_-]{20,100})$/);
      if (gp) {
        if (request.method !== "GET") return json({ error: "この操作は受け付けていません" }, 405);
        return await serveAsset(request, env, "/guest");
      }
      const g = url.pathname.match(/^\/api\/g\/([^/]+)\/(home|bus|drill|language|profile|ask)$/);
      if (g) {
        if (g[2] === "home" || g[2] === "bus" || g[2] === "drill") {
          if (request.method !== "GET") return json({ error: "読むだけの画面です" }, 405);
          if (g[2] === "bus") return await handleGuestBus(url, env, today, g[1]);
          if (g[2] === "drill") return await handleGuestDrill(url, env, g[1]);
          return await handleGuest(url, env, today, g[1]);
        }
        if (request.method !== "POST") return json({ error: "この操作は受け付けていません" }, 405);
        if (g[2] === "ask") return await handleGuestAsk(request, url, env, today, g[1]);
        return await handleGuestPost(request, url, env, g[1], g[2]);
      }
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) return await serveAsset(request, env);
      if (request.method === "GET" && isMoneyPath(url.pathname)) {
        const res = await handleMoneyGet(url, env);
        if (res) return res;
      } else if (request.method === "GET") {
        const res = await handleGet(url, env, today);
        if (res) return res;
      } else if (request.method === "POST" && isMoneyPath(url.pathname)) {
        const res = await handleMoneyPost(request, url, env);
        if (res) return res;
      } else if (request.method === "POST" && (url.pathname.startsWith("/api/drafts") || url.pathname === "/api/guest-links" || url.pathname === "/api/drill")) {
        const res = await handlePost(request, url, env);
        if (res) return res;
      } else if (request.method === "POST" && isSettingsPath(url.pathname)) {
        const res = await handleSettingsPost(request, url, env, today);
        if (res) return res;
      } else if (request.method === "POST" && url.pathname.startsWith("/api/booking-emails")) {
        const res = await handleBookingEmailPost(request, url, env, today);
        if (res) return res;
      } else if (request.method === "POST" && (url.pathname === "/api/patrol" || url.pathname.startsWith("/api/decisions/"))) {
        const res = await handleDecisionPost(request, url, env, ctx);
        if (res) return res;
      } else {
        return json({ error: "この操作は受け付けていません" }, 405);
      }
      return json({ error: "見つかりません" }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      // 中身（文や番号）は出さない
      console.error("error", e instanceof Error ? e.name : "unknown");
      return json({ error: "うまく処理できませんでした" }, 500);
    }
  },

  // 毎朝7時（日本時間）の見回り。wrangler.jsonc の triggers.crons
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      patrol(env, "cron").catch((e) => console.error("patrol", e instanceof Error ? e.name : "unknown")),
    );
  },

  // 予約メールの受け取り（Cloudflare のメール受け取り → この Worker）
  async email(message, env) {
    try {
      const r = await receiveEmail(message, env);
      console.log("email", r.ok ? (r.duplicate ? "duplicate" : "stored") : `rejected:${r.reason}`);
    } catch (e) {
      // 中身（文や番号）は出さない
      console.error("email", e instanceof Error ? e.name : "unknown");
    }
  },
};
