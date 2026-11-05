// オーナーのログインの自動テスト。使い方：npm test
// D1 の代わりに、メモリの SQLite（node:sqlite）に migrations/ を全部入れて試す
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
import {
  COOKIE_NAME,
  constantTimeEqual,
  hashPassword,
  ipGroup,
  isOpenPath,
  LOCK_WINDOW_MS,
  MAX_FAILURES_ALL,
  MSG,
  parseHash,
  SESSION_MS,
  sha256Hex,
  verifyPassword,
} from "../src/lib/auth.js";

const PASSWORD = "test-only-password-123"; // テスト用（本物ではない）

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => (db.prepare(sql).run(...args), { success: true }),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      const out = [];
      for (const s of list) out.push(await s.run());
      return out;
    },
  };
}

let HASH;
const hash = async () => (HASH ??= await hashPassword(PASSWORD));
const envWith = async (opts = {}) => ({ DB: fakeD1(), DEMO_TODAY: "2026-10-10", ...(opts.noHash ? {} : { OWNER_PASSWORD_HASH: await hash() }) });

const LOCAL = "http://localhost:8787";
const REMOTE = "https://banto.example.com";
const req = (base, path, { method = "GET", body, cookie, origin = base, ip } = {}) =>
  new Request(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(body !== undefined && origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(ip ? { "cf-connecting-ip": ip } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const call = (env, base, path, opts) => worker.fetch(req(base, path, opts), env, { waitUntil() {} });

async function login(env, base = REMOTE, password = PASSWORD, ip) {
  const res = await call(env, base, "/api/login", { method: "POST", body: { password }, ip });
  const set = res.headers.get("set-cookie");
  const cookie = set ? set.split(";")[0] : null;
  return { res, set, cookie };
}

test("パスワード：作った文字列で、正しいものだけ通る。形のおかしな Secret は通らない", async () => {
  const h = await hash();
  assert.match(h, /^pbkdf2\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!h.includes(PASSWORD));
  const p = parseHash(h);
  assert.equal(p.iterations, 100000);
  assert.equal(p.salt.length, 16);
  assert.equal(p.hash.length, 32);
  assert.equal(await verifyPassword(PASSWORD, h), true);
  assert.equal(await verifyPassword(PASSWORD + "x", h), false);
  assert.equal(await verifyPassword("", h), false);
  assert.equal(await verifyPassword(undefined, h), false);
  assert.equal(await verifyPassword(PASSWORD, undefined), false);
  assert.equal(await verifyPassword(PASSWORD, "pbkdf2$100$AAAA$BBBB"), false);
  assert.equal(await verifyPassword(PASSWORD, "plain-text"), false);
  // 塩が毎回ちがう
  assert.notEqual(await hashPassword(PASSWORD), h);
});

test("比べ方：長さも中身も同じときだけ同じ", () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

test("ログイン：Cookie は HttpOnly・Secure・SameSite=Strict・Path=/・12時間。D1 には鍵そのものを置かない", async () => {
  const env = await envWith();
  const { res, set, cookie } = await login(env);
  assert.equal(res.status, 200);
  assert.ok(set.startsWith(`${COOKIE_NAME}=`));
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", `Max-Age=${SESSION_MS / 1000}`]) assert.ok(set.includes(flag), flag);
  assert.ok(!/Domain=/i.test(set));
  const token = cookie.split("=")[1];
  assert.match(token, /^[A-Za-z0-9_-]{43}$/); // 32バイト
  const rows = env.DB.raw.prepare("SELECT token_hash, expires_at - created_at AS life FROM owner_sessions").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, await sha256Hex(token));
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(rows[0].life, SESSION_MS);
  // ログインすると、オーナーの API が開く
  assert.equal((await call(env, REMOTE, "/api/reservations", { cookie })).status, 200);
  const s = await call(env, REMOTE, "/api/session", { cookie });
  assert.deepEqual(await s.json(), { login_enabled: true });
});

test("ログイン：パスワードがちがうと 401 で、Cookie は出さない。ほかの画面からの送信は断る", async () => {
  const env = await envWith();
  const { res, set } = await login(env, REMOTE, "wrong-password");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, MSG.wrong);
  assert.equal(set, null);
  const other = await call(env, REMOTE, "/api/login", { method: "POST", body: { password: PASSWORD }, origin: "https://evil.example" });
  assert.equal(other.status, 403);
  assert.equal(other.headers.get("set-cookie"), null);
  assert.equal((await call(env, REMOTE, "/api/login")).status, 405);
});

test("15分で5回まちがえたら、正しいパスワードでも断る。15分たてばまた入れる", async () => {
  const env = await envWith();
  for (let i = 0; i < 5; i++) assert.equal((await login(env, REMOTE, `wrong-${i}`)).res.status, 401);
  const locked = await login(env);
  assert.equal(locked.res.status, 429);
  assert.equal((await locked.res.json()).error, MSG.locked);
  assert.equal(locked.set, null);
  // 断った分は数えない（5回のまま）
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM owner_login_failures").get().n, 5);
  // 時計を進める代わりに、まちがえた時刻を16分前にずらす
  env.DB.raw.prepare("UPDATE owner_login_failures SET at = at - ?").run(LOCK_WINDOW_MS + 60_000);
  const ok = await login(env);
  assert.equal(ok.res.status, 200);
  // 入れたら、まちがいの記録は消える
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM owner_login_failures").get().n, 0);
});

test("4回まちがえても、5回目が正しければ入れる", async () => {
  const env = await envWith();
  for (let i = 0; i < 4; i++) await login(env, REMOTE, `wrong-${i}`);
  assert.equal((await login(env)).res.status, 200);
});

test("期限の切れたログインは使えない。ログアウトすると鍵は消える", async () => {
  const env = await envWith();
  const { cookie } = await login(env);
  env.DB.raw.prepare("UPDATE owner_sessions SET expires_at = ?").run(Date.now() - 1);
  assert.equal((await call(env, REMOTE, "/api/kpis?month=2026-10", { cookie })).status, 401);

  const again = await login(env);
  const out = await call(env, REMOTE, "/api/logout", { method: "POST", body: {}, cookie: again.cookie });
  assert.equal(out.status, 200);
  assert.ok(out.headers.get("set-cookie").includes("Max-Age=0"));
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM owner_sessions WHERE expires_at > ?").get(Date.now()).n, 0);
  assert.equal((await call(env, REMOTE, "/api/kpis?month=2026-10", { cookie: again.cookie })).status, 401);
});

test("ログインしていないと、オーナーの API は 401・画面はログイン画面へ。でたらめな Cookie も同じ", async () => {
  const env = await envWith();
  for (const path of ["/api/kpis?month=2026-10", "/api/reservations", "/api/settings", "/api/decisions", "/api/session"]) {
    const r = await call(env, REMOTE, path);
    assert.equal(r.status, 401, path);
    assert.equal((await r.json()).error, MSG.login);
  }
  const post = await call(env, REMOTE, "/api/patrol", { method: "POST", body: {} });
  assert.equal(post.status, 401);
  for (const path of ["/", "/index.html", "/app.js", "/app.css", "/guest.html"]) {
    const r = await call(env, REMOTE, path);
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.get("location"), "/login");
  }
  const fake = `${COOKIE_NAME}=${"A".repeat(43)}`;
  assert.equal((await call(env, REMOTE, "/api/reservations", { cookie: fake })).status, 401);
  // 手元（localhost）でも、Secret があればログインが要る
  assert.equal((await call(env, LOCAL, "/api/reservations")).status, 401);
});

test("ゲストの画面・API（宿のURL）とログイン画面は、ログインなしで開ける", async () => {
  const env = await envWith();
  const token = "x".repeat(32);
  for (const path of [`/api/g/${token}/home?lang=ja`, `/api/g/${token}/bus?lang=ja`, `/api/g/${token}/drill?lang=ja`]) {
    const r = await call(env, REMOTE, path);
    assert.notEqual(r.status, 401, path);
    assert.notEqual(r.status, 302, path);
  }
  const post = await call(env, REMOTE, `/api/g/${token}/language`, { method: "POST", body: { language: "en" } });
  assert.notEqual(post.status, 401);
  // 開けてよい一覧
  assert.equal(isOpenPath("GET", `/g/${token}`), true);
  assert.equal(isOpenPath("GET", "/login"), true);
  assert.equal(isOpenPath("GET", "/login.js"), true);
  assert.equal(isOpenPath("GET", "/guest.js"), true);
  assert.equal(isOpenPath("POST", "/login.js"), false);
  assert.equal(isOpenPath("GET", "/"), false);
  assert.equal(isOpenPath("GET", "/app.js"), false);
  assert.equal(isOpenPath("GET", "/api/g/abc/other"), false);
  assert.equal(isOpenPath("GET", `/g/${token}/x`), false);
  assert.equal(isOpenPath("GET", "/api/guest-links"), false);
});

test("Secret が無いとき：手元は開いたまま・ほかからは 403。ログインはできない", async () => {
  const env = await envWith({ noHash: true });
  assert.equal((await call(env, LOCAL, "/api/reservations")).status, 200);
  assert.deepEqual(await (await call(env, LOCAL, "/api/session")).json(), { login_enabled: false });
  for (const path of ["/api/kpis?month=2026-10", "/", "/login", `/api/g/${"x".repeat(32)}/home`]) {
    const r = await call(env, REMOTE, path);
    assert.equal(r.status, 403, path);
  }
  // 手元でも、ログインは「パスワードがちがう」と同じ返事（Secret が無いことは言わない）
  const r = await login(env, LOCAL);
  assert.equal(r.res.status, 401);
  assert.equal((await r.res.json()).error, MSG.wrong);
  assert.equal(r.set, null);
});

test("締め出し対策：数えるのは相手（IP）ごと。よそが5回まちがえても、オーナーは入れる", async () => {
  const env = await envWith();
  for (let i = 0; i < 5; i++) assert.equal((await login(env, REMOTE, `wrong-${i}`, "203.0.113.9")).res.status, 401);
  assert.equal((await login(env, REMOTE, PASSWORD, "203.0.113.9")).res.status, 429);
  assert.equal((await login(env, REMOTE, PASSWORD, "198.51.100.7")).res.status, 200);
  // IP そのものは D1 に置かない
  const rows = env.DB.raw.prepare("SELECT who FROM owner_login_failures").all();
  for (const r of rows) assert.ok(!r.who.includes("203.0.113.9"));
});

test("総当たりの歯止め：全体で50回まちがえたら、ほかの相手も15分断る", async () => {
  const env = await envWith();
  for (let i = 0; i < MAX_FAILURES_ALL; i++) await login(env, REMOTE, "wrong", `10.0.${Math.floor(i / 4)}.${i % 4}`);
  const r = await login(env, REMOTE, PASSWORD, "192.0.2.1");
  assert.equal(r.res.status, 429);
  assert.equal(r.set, null);
});

test("同時に20回送っても、確かめるのは5回だけ", async () => {
  const env = await envWith();
  const all = await Promise.all(Array.from({ length: 20 }, (_, i) => login(env, REMOTE, `wrong-${i}`, "203.0.113.5")));
  const codes = all.map((x) => x.res.status);
  assert.equal(codes.filter((c) => c === 401).length, 5);
  assert.equal(codes.filter((c) => c === 429).length, 15);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM owner_login_failures").get().n, 5);
});

test("15分より古いまちがいの記録は、次に試したときに消える", async () => {
  const env = await envWith();
  for (let i = 0; i < 3; i++) await login(env, REMOTE, "wrong");
  env.DB.raw.prepare("UPDATE owner_login_failures SET at = at - ?").run(LOCK_WINDOW_MS + 1);
  await login(env, REMOTE, "wrong");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM owner_login_failures").get().n, 1);
});

test("書き方を変えたパスや HEAD・OPTIONS でも、ログインなしでは入れない", async () => {
  const env = await envWith();
  for (const path of ["/API/reservations", "/api/reservations/", "//api/reservations", "/%2e%2e/api/reservations", "/api/g/../reservations", "/login/../api/reservations"]) {
    const r = await call(env, REMOTE, path);
    assert.ok([401, 302, 404].includes(r.status) && r.status !== 200, `${path} → ${r.status}`);
    if (r.status === 302) assert.equal(r.headers.get("location"), "/login");
  }
  assert.equal((await call(env, REMOTE, "/", { method: "HEAD" })).status, 302);
  assert.equal((await call(env, REMOTE, "/api/reservations", { method: "HEAD" })).status, 401);
  assert.equal((await call(env, REMOTE, "/api/reservations", { method: "OPTIONS" })).status, 401);
});

test("ログアウトも、ほかの画面からや Origin の無い送信は断る", async () => {
  const env = await envWith();
  const { cookie } = await login(env);
  for (const origin of [null, "https://evil.example"]) {
    const r = await call(env, REMOTE, "/api/logout", { method: "POST", body: {}, cookie, origin });
    assert.equal(r.status, 403, String(origin));
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM owner_sessions").get().n, 1);
  assert.equal((await call(env, REMOTE, "/api/reservations", { cookie })).status, 200);
});

test("大きすぎる中身は、読む前に断る", async () => {
  const env = await envWith();
  const r = await worker.fetch(
    new Request(REMOTE + "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: REMOTE, "content-length": "99999999" },
      body: "{}",
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal(r.status, 413);
});

test("IPv6 は /64 ごとに1つの相手として数える（アドレスを変えても回数は減らない）", async () => {
  assert.equal(ipGroup("2001:db8:1:2::5"), ipGroup("2001:0db8:0001:0002:ffff:1:2:3"));
  assert.notEqual(ipGroup("2001:db8:1:2::5"), ipGroup("2001:db8:1:3::5"));
  assert.equal(ipGroup("::1"), "0:0:0:0::/64");
  assert.equal(ipGroup("203.0.113.9"), "203.0.113.9");
  const env = await envWith();
  for (let i = 0; i < 5; i++) assert.equal((await login(env, REMOTE, "wrong", `2001:db8:1:2::${i + 1}`)).res.status, 401);
  assert.equal((await login(env, REMOTE, PASSWORD, "2001:db8:1:2::99")).res.status, 429);
  assert.equal((await login(env, REMOTE, PASSWORD, "2001:db8:9:9::1")).res.status, 200);
});

test("ログインできても、消すのは自分のまちがいの記録だけ", async () => {
  const env = await envWith();
  for (let i = 0; i < 3; i++) await login(env, REMOTE, "wrong", "203.0.113.20");
  await login(env, REMOTE, "wrong", "198.51.100.30");
  assert.equal((await login(env, REMOTE, PASSWORD, "198.51.100.30")).res.status, 200);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM owner_login_failures").get().n, 3);
});

test("本番の設定（wrangler.jsonc）に、デモの「今日」を入れていない", () => {
  const conf = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!conf.includes("DEMO_TODAY"));
});
