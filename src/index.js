// AI番頭 Worker
// 読むだけ（GET）
// - /api/tax?month=YYYY-MM              宿泊税の集計表（下書き）
// - /api/minpaku/counter                180日カウンター
// - /api/minpaku/report?period=         定期報告の4項目（例：2026-08_09）
// - /api/drafts?reservation_id=         到着前案内の下書き一覧（暗証番号は伏せる）
// - /api/g/:token/home?lang=            ゲスト画面（宿のURL）の案内文
// - /api/reservations                   これからの予約の一覧（名前は出さない）と案内の状態
// - それ以外の GET                       画面（public/）を返す
// 書く（POST・JSONだけ・同じ画面からだけ）
// - /api/drafts                         到着前案内をつくる {reservation_id}
// - /api/drafts/:id                     確認済みにする {action:"ok"}／手で直す {action:"edit", draft_template}
// - /api/drafts/:id/copy                コピー用の文（暗証番号・住所を入れる。保存しない）
// - /api/guest-links                    宿のURLをつくる {reservation_id}（URLの鍵は1回だけ見せる）
// 予約メール（M17・貼り付け版）
// - GET  /api/booking-emails?status=pending|done   確認待ち／決めたもの（伏せた本文だけ）
// - GET  /api/booking-emails/samples                デモ用の見本メール
// - POST /api/booking-emails                        貼り付けたメールを読む {subject, body}（伏せる前の本文は保存しない）
// - POST /api/booking-emails/:id/confirm            OK＝台帳に入れる {fields?}（直した値）
// - POST /api/booking-emails/:id/edit               直す {fields}（確認待ちのまま。台帳は変えない）
// - POST /api/booking-emails/:id/reject             捨てる
// ⚠️ オーナー画面の鍵（Cloudflare Access）を付けるまでは、手元（localhost）以外からは開けない。
// ⚠️ 暗証番号はどの表にも保存しない。env.DOOR_CODE からコピー／表示のときだけ入れる。
import { dayCounter, headcount, minpakuReport, reportPeriodOf, rulesFromInnProfile, stayNightRows, taxDraft } from "./lib/counting.js";
import { monthOf, todayJst } from "./lib/dates.js";
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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_BODY_BYTES = 10_000;
const MAX_MAIL_BODY_BYTES = 60_000; // 予約メールの貼り付けだけ大きめ（日本語12,000字まで）
// 書体（BIZ UDPGothic）だけ Google Fonts から読む。スクリプトは自分の画面のものだけ
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

async function loadInn(env) {
  return (await env.DB.prepare("SELECT * FROM inn_profile WHERE id = 1").first()) ?? {};
}

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
    const expiresAt = `${r.checkout_date}T12:00:00+09:00`;
    await env.DB.prepare("INSERT INTO guest_links (reservation_id, token_hash, expires_at) VALUES (?, ?, ?)")
      .bind(r.id, await sha256Hex(token), expiresAt)
      .run();
    // 鍵そのものは保存しない（ハッシュだけ）。ここで1回だけ見せる
    return json({ reservation_id: r.id, path: `/g/${token}`, token, expires_at: expiresAt }, 201);
  }

  return null;
}

// ゲスト画面：URLの鍵を確かめて、確認済みの案内（なければ決まった文）を返す
async function handleGuest(url, env, today, token) {
  const guestHeaders = { "referrer-policy": "no-referrer" };
  const notFound = () => json({ error: "このURLは使えません" }, 404, guestHeaders);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return notFound();
  const link = await env.DB.prepare("SELECT reservation_id, expires_at, revoked FROM guest_links WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first();
  if (!link || link.revoked) return notFound();
  if (Date.parse(nowIso(env)) >= Date.parse(link.expires_at)) return json({ error: "このURLの期限が切れました" }, 410, guestHeaders);

  const r = await env.DB.prepare(RES_ONE).bind(link.reservation_id).first();
  if (!r || r.status !== "confirmed") return notFound();
  const inn = await loadInn(env);
  const lang = normLang(url.searchParams.get("lang") ?? r.language);
  const draft = await env.DB.prepare(
    `SELECT draft_template FROM guest_drafts WHERE reservation_id = ? AND kind = 'arrival'
     AND status IN ('ok', 'copied') AND language = ? ORDER BY id DESC LIMIT 1`,
  )
    .bind(r.id, lang)
    .first();
  const template = draft?.draft_template ?? fixedArrival({ ...r, language: lang }, inn, rulesFromInnProfile(inn)).draft_template;
  const text = guestView(template, lang, { today, checkin: r.checkin_date, DOOR_CODE: env.DOOR_CODE, ADDRESS: inn.address });
  return json(
    { inn_name: inn.name, language: lang, checkin: r.checkin_date, checkout: r.checkout_date, source: draft ? "owner_checked" : "fixed", text },
    200,
    guestHeaders,
  );
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

// 画面のファイル（public/）。安全のヘッダーを付けて返す
async function serveAsset(request, env) {
  if (!env.ASSETS) return json({ error: "見つかりません" }, 404);
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!LOCAL_HOSTS.has(url.hostname)) return json({ error: "この画面はまだ公開していません" }, 403);
    const today = todayJst(env.DEMO_TODAY);
    try {
      const g = url.pathname.match(/^\/api\/g\/([^/]+)\/home$/);
      if (g) {
        if (request.method !== "GET") return json({ error: "読むだけの画面です" }, 405);
        return await handleGuest(url, env, today, g[1]);
      }
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) return await serveAsset(request, env);
      if (request.method === "GET") {
        const res = await handleGet(url, env, today);
        if (res) return res;
      } else if (request.method === "POST" && (url.pathname.startsWith("/api/drafts") || url.pathname === "/api/guest-links")) {
        const res = await handlePost(request, url, env);
        if (res) return res;
      } else if (request.method === "POST" && url.pathname.startsWith("/api/booking-emails")) {
        const res = await handleBookingEmailPost(request, url, env, today);
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
};
