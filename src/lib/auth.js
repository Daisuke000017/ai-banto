// オーナーのログイン（1人だけ）
// - パスワードは Worker の Secret「OWNER_PASSWORD_HASH」に、PBKDF2-SHA256 の形でだけ置く
//   形：pbkdf2$100000$<塩 base64>$<ハッシュ base64>（scripts/hash-password.js で作る）
// - ログインすると、ランダムな鍵（32バイト）を Cookie に入れる。D1 にはその sha256 と期限だけを置く
// - 15分のうちに、同じ相手（IP）から5回まちがえたら、その15分が過ぎるまで断る
//   よそからわざとまちがえてオーナーを締め出せないよう、数えるのは相手ごと（IPv6 は /64 ごと）。全体でも50回で断る（総当たりの歯止め）
//   全体の50回で締め出されたら：15分待つか、D1 で DELETE FROM owner_login_failures を流す
// - Secret が無いとき：手元（localhost）は開いたまま（デモ用）。それ以外からは、オーナーの画面・API は 403
// - ゲストの画面・API（宿のURL）とログイン画面だけは、ログインなしで開ける（OPEN の一覧に書いたものだけ）
// - 手元以外では、パスワードを確かめる前に Cloudflare のロボット除け（Turnstile）を通す（ゾロ審査 2026-11-06）
//   Secret「TURNSTILE_SECRET」と「TURNSTILE_SITE_KEY」が無いと、手元以外ではログインできない（503）
//   ロボット除けで落ちた分は、まちがいの回数に数えない（よそからオーナーを締め出せないように）

export const COOKIE_NAME = "__Host-banto_owner";
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES = 5; // 同じ相手から
export const MAX_FAILURES_ALL = 50; // 全体で
const PBKDF2_ITERATIONS = 100_000; // Workers の上限も 100,000
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const MSG = {
  wrong: "パスワードがちがいます",
  locked: "パスワードを続けてまちがえたため、しばらくログインできません。15分ほど待ってから、もう一度お試しください",
  login: "ログインしてください",
  closed: "この画面はまだ公開していません",
  robot: "ロボットではないことの確認ができませんでした。画面を読み直して、もう一度お試しください",
  notReady: "ログインの準備がまだできていません",
};

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "login";
const TURNSTILE_TOKEN_MAX = 2048;

// 手元以外ではロボット除けを必ず使う（手元でも Secret があれば使う）
export const turnstileRequired = (env, url) => !isLocalHost(url) || Boolean(env.TURNSTILE_SECRET);

/**
 * ロボット除けの札を Cloudflare に確かめてもらう。
 * @returns {Promise<"ok"|"bad"|"not_ready">}
 */
export async function verifyTurnstile(env, token, request, url) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) return "not_ready";
  if (typeof token !== "string" || !token || token.length > TURNSTILE_TOKEN_MAX) return "bad";
  const ip = request.headers.get("cf-connecting-ip");
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("auth", "turnstile siteverify status", res.status);
      return "bad";
    }
    const r = await res.json();
    if (r?.success !== true) return "bad";
    // 別のサイト・別の操作のために出された札は使わせない
    if (r.hostname && r.hostname !== url.hostname) return "bad";
    if (r.action && r.action !== TURNSTILE_ACTION) return "bad";
    return "ok";
  } catch (e) {
    console.error("auth", "turnstile siteverify failed", e?.name);
    return "bad";
  }
}

// ログインなしで開けるもの（ここに無いものは、すべてログインが要る）
const OPEN_STATIC = new Set(["/login", "/login.html", "/login.js", "/login.css", "/guest.js", "/guest.css"]);
const OPEN_PATTERNS = [
  /^\/g\/[A-Za-z0-9_-]{20,100}$/, // ゲストの画面（宿のURL）
  /^\/api\/g\/[^/]+\/(home|bus|drill|language|profile|ask)$/, // ゲストの API（URLの鍵で守る）
];
export function isOpenPath(method, path) {
  if (OPEN_PATTERNS.some((re) => re.test(path))) return true;
  return (method === "GET" || method === "HEAD") && OPEN_STATIC.has(path);
}

export const isLocalHost = (url) => LOCAL_HOSTS.has(url.hostname);

// ---- 小さな道具 ----
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes) => b64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

// 長さが同じなら、どこで違っても同じ時間で比べる
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password, salt, iterations, bytes) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, bytes * 8);
  return new Uint8Array(bits);
}

// Secret の文字列を読む。形が違えば null
export function parseHash(stored) {
  if (typeof stored !== "string") return null;
  const parts = stored.trim().split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) return null;
  try {
    const salt = unb64(parts[2]);
    const hash = unb64(parts[3]);
    if (salt.length < 16 || hash.length < 32 || hash.length > 64) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

// Secret の文字列を作る（scripts/hash-password.js とテストで使う）
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, 32);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

// パスワードが合うか。Secret が無い・形が違うときも、同じだけ計算してから「ちがう」を返す
const DUMMY = { iterations: PBKDF2_ITERATIONS, salt: new Uint8Array(16), hash: new Uint8Array(32) };
export async function verifyPassword(password, stored) {
  const p = parseHash(stored);
  const use = p ?? DUMMY;
  const got = await pbkdf2(typeof password === "string" ? password : "", use.salt, use.iterations, use.hash.length);
  return constantTimeEqual(got, use.hash) && p !== null;
}

export const loginEnabled = (env) => typeof env.OWNER_PASSWORD_HASH === "string" && env.OWNER_PASSWORD_HASH.trim() !== "";

// ---- Cookie ----
export function readCookie(request, name = COOKIE_NAME) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
export const sessionCookie = (token) =>
  `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
export const clearCookie = () => `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

// ---- セッション（D1 には鍵の sha256 と期限だけ） ----
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function createSession(env, now = Date.now()) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM owner_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO owner_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").bind(
      await sha256Hex(token),
      now,
      now + SESSION_MS,
    ),
  ]);
  return token;
}

export async function hasSession(request, env, now = Date.now()) {
  const token = readCookie(request);
  if (!token || !TOKEN_RE.test(token)) return false;
  const row = await env.DB.prepare("SELECT expires_at FROM owner_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).first();
  return !!row && Number(row.expires_at) > now;
}

export async function deleteSession(request, env) {
  const token = readCookie(request);
  if (!token || !TOKEN_RE.test(token)) return;
  await env.DB.prepare("DELETE FROM owner_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

// ---- ログイン（まちがいの回数を数える） ----
// 送ってきた相手の印。IP そのものは置かず、Secret を混ぜた sha256 にする
// IPv6 は1つの契約で山ほどアドレスを持てるので、前半の64ビット（/64）ごとに1つの相手として数える
export function ipGroup(ip) {
  if (!ip || !ip.includes(":")) return ip || "local";
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

export async function clientKey(request, env) {
  const ip = ipGroup(request.headers.get("cf-connecting-ip") ?? "local");
  return sha256Hex(`${ip}|${env.OWNER_PASSWORD_HASH ?? ""}`);
}

// 先に「試した」を1行入れてから、15分以内で何番目かを数える（同時にたくさん来ても、6回目からは断る）
export async function tryLogin(env, password, now = Date.now(), who = "") {
  const since = now - LOCK_WINDOW_MS;
  await env.DB.prepare("DELETE FROM owner_login_failures WHERE at <= ?").bind(since).run();
  const ins = await env.DB.prepare("INSERT INTO owner_login_failures (at, who) VALUES (?, ?) RETURNING id").bind(now, who).first();
  const id = ins.id;
  const pos = await env.DB.prepare(
    "SELECT COUNT(*) AS n_all, COALESCE(SUM(CASE WHEN who = ? THEN 1 ELSE 0 END), 0) AS n_mine FROM owner_login_failures WHERE at > ? AND id <= ?",
  )
    .bind(who, since, id)
    .first();
  if (Number(pos.n_mine) > MAX_FAILURES || Number(pos.n_all) > MAX_FAILURES_ALL) {
    // 断った分は数えない（数えると、ずっと開かなくなる）
    await env.DB.prepare("DELETE FROM owner_login_failures WHERE id = ?").bind(id).run();
    return { ok: false, locked: true };
  }
  const ok = loginEnabled(env) && (await verifyPassword(password, env.OWNER_PASSWORD_HASH));
  if (!ok) {
    if (loginEnabled(env) && !parseHash(env.OWNER_PASSWORD_HASH)) console.error("auth", "bad OWNER_PASSWORD_HASH format");
    return { ok: false, locked: false };
  }
  // 消すのは自分のまちがいだけ（よその相手の回数まで0に戻さない）
  await env.DB.prepare("DELETE FROM owner_login_failures WHERE who = ?").bind(who).run();
  return { ok: true, token: await createSession(env, now) };
}

// ---- 入口：fetch のいちばん初めに呼ぶ。Response を返したらそれで終わり、null なら先へ進む ----
// tools：index.js の json（安全のヘッダー付き）・readJsonBody（同じ画面から・JSONだけ）・headers（安全のヘッダー）
export async function ownerGate(request, url, env, tools, now = Date.now()) {
  const { json, readJsonBody, headers } = tools;
  const enabled = loginEnabled(env);
  const local = isLocalHost(url);
  const p = url.pathname;

  // Secret が無いまま公開されたら、手元以外は全部閉じる（前と同じ）
  if (!enabled && !local) return json({ error: MSG.closed }, 403);

  // ログイン画面が、ロボット除けの部品を出すための公開の鍵（サイトキー）。秘密ではない
  if (p === "/api/login-config") {
    if (request.method !== "GET") return json({ error: "この操作は受け付けていません" }, 405);
    return json({ turnstile_site_key: turnstileRequired(env, url) ? env.TURNSTILE_SITE_KEY || null : null });
  }
  if (p === "/api/login") {
    if (request.method !== "POST") return json({ error: "この操作は受け付けていません" }, 405);
    const body = await readJsonBody(request, url);
    if (turnstileRequired(env, url)) {
      const t = await verifyTurnstile(env, body.turnstile, request, url);
      if (t === "not_ready") return json({ error: MSG.notReady }, 503);
      if (t !== "ok") return json({ error: MSG.robot }, 400);
    }
    const password = typeof body.password === "string" && body.password.length <= 200 ? body.password : "";
    const r = await tryLogin(env, password, now, await clientKey(request, env));
    if (r.locked) return json({ error: MSG.locked }, 429);
    if (!r.ok) return json({ error: MSG.wrong }, 401);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(r.token) });
  }
  if (p === "/api/logout") {
    if (request.method !== "POST") return json({ error: "この操作は受け付けていません" }, 405);
    await readJsonBody(request, url);
    await deleteSession(request, env);
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (isOpenPath(request.method, p)) return null;
  // 手元で Secret が無いとき（デモ）は開いたまま
  if (!enabled) return p === "/api/session" ? json({ login_enabled: false }) : null;
  if (await hasSession(request, env, now)) return p === "/api/session" ? json({ login_enabled: true }) : null;
  if (p.startsWith("/api/")) return json({ error: MSG.login }, 401);
  if (request.method === "GET" || request.method === "HEAD") {
    return new Response(null, { status: 302, headers: { ...headers, location: "/login" } });
  }
  return json({ error: MSG.login }, 401);
}
