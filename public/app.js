// AI番頭 オーナー画面。
// 約束：AI・ゲスト由来の文は textContent だけで出す（innerHTML を使わない）。暗証番号は画面に出さない。
// 決めごとは docs/DESIGN.md

import { qrMatrix } from "./qr.js";

const MASK = "●●●●（コピー時に入ります）";
const LANG = { ja: "日本語", en: "英語", ko: "韓国語", "zh-TW": "繁体字中国語" };
const OTA = { airbnb: "Airbnb", booking: "Booking.com", direct: "直接予約", rakuten: "楽天トラベル", jalan: "じゃらん" };
const COUNTRY = {
  JP: "日本", KR: "韓国", TW: "台湾", CN: "中国", HK: "香港", US: "アメリカ", AU: "オーストラリア",
  GB: "イギリス", FR: "フランス", DE: "ドイツ", SG: "シンガポール", TH: "タイ", OTHER: "その他", UNKNOWN: "分からない",
  MY: "マレーシア", ID: "インドネシア", PH: "フィリピン", VN: "ベトナム", IN: "インド", IT: "イタリア", ES: "スペイン", RU: "ロシア", CA: "カナダ",
};
const STATUS = {
  null: { label: "まだ", cls: "" },
  draft: { label: "下書き", cls: "warn" },
  ok: { label: "確認済み", cls: "ok" },
  copied: { label: "コピー済み", cls: "ok" },
};
const WD = ["日", "月", "火", "水", "木", "金", "土"];

const state = { today: null, kpiMonth: null, taxMonth: null, period: null, selectedRes: null, ledgerEdit: null, loaded: {} };

// ---- 小さな道具 ----

function el(tag, opts = {}, children = []) {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text != null) e.textContent = String(opts.text);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) e.addEventListener(k, v);
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}
const btn = (text, onClick, cls = "btn") => el("button", { cls, text, attrs: { type: "button" }, on: { click: onClick } });
const yen = (n) => `${Number(n).toLocaleString("ja-JP")}`;
const $ = (id) => document.getElementById(id);

function jpDate(iso, withWeek = true) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日${withWeek ? `（${WD[w]}）` : ""}`;
}
const jpMonth = (ym) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
function jpPeriod(p) {
  const [, y, a, b] = /^(\d{4})-(\d{2})_(\d{2})$/.exec(p);
  return `${y}年${Number(a)}月・${Number(b)}月`;
}
function nightsBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
function addMonths(ym, k) {
  let [y, m] = ym.split("-").map(Number);
  m += k;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? "うまくいきませんでした");
    this.status = status;
    this.body = body;
  }
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  // ログインが切れた・まだのときは、ログイン画面へ
  if (res.status === 401) location.assign("/login");
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ログアウト（ログインを使っているときだけ、下の注意書きの横に出す）
async function setupLogout() {
  const s = await api("/api/session").catch(() => null);
  if (!s?.login_enabled) return;
  const b = btn("ログアウト", async () => {
    b.disabled = true;
    await api("/api/logout", { method: "POST", body: {} }).catch(() => {});
    location.assign("/login");
  }, "btn small logout");
  document.querySelector("footer.notes")?.append(b);
}

// サーバーの言葉（決まった日本語）だけを出す。5xx や通信の失敗は、決まった文にする
function errorText(err) {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.body?.error) return err.body.error;
  return "読み込めませんでした。少し待ってから、もう一度開いてください";
}

function loading(text) {
  return el("p", { cls: "state" }, [el("span", { cls: "spinner", attrs: { "aria-hidden": "true" } }), text]);
}
function errorBox(err, retry) {
  return el("div", { cls: "state error" }, [
    el("p", { text: errorText(err) }),
    retry ? el("div", { cls: "btns" }, [btn("もう一度読む", retry, "btn small")]) : null,
  ]);
}

let toastTimer = null;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// ---- チーム（O-3）----
// 名札：働いている担当を光らせ、「いま働いています」を言葉でも出す（色だけで伝えない）。
// AI が動いている間は、仕事の記録（agent_runs）を1秒ごとに読み、本当に働いている担当を光らせる。
// 監査役の差し戻しは「監査役 → 担当」の矢印と、名札の回数で見せる。名札を押すと最近の仕事が見られる
const crew = { since: null, seen: new Set(), counts: {}, data: null, open: null, poll: null, stopAt: 0, stepRoles: [], stepNote: null };
const TEAM_NAME = { banto: "番頭", keiri: "経理担当", kansa: "監査役", shukuhaku: "宿泊担当", keiei: "経営企画" };
const RUN_STATUS = { working: ["働き中", "warn"], done: ["できた", "ok"], sent_back: ["差し戻された", "danger"], failed: ["失敗", "danger"] };
const QUIET_NOTE = "数字はプログラムが数え、文はチームが下書きします。";

function team(roles, note) {
  crew.stepRoles = roles;
  crew.stepNote = note;
  paintTeam();
}

// 記録で働き中の担当がいればそちらを、いなければ画面の段取り（steps）の担当を光らせる
function paintTeam() {
  const real = crew.poll ? (crew.data?.agents ?? []).filter((a) => a.working) : [];
  const roles = real.length ? real.map((a) => a.agent) : crew.stepRoles;
  for (const li of $("team").children) {
    li.classList.toggle("working", roles.includes(li.dataset.role));
    const n = crew.counts[li.dataset.role] ?? 0;
    const b = li.querySelector(".chip");
    let badge = b.querySelector(".chip-badge");
    if (n && !badge) b.append((badge = el("span", { cls: "chip-badge" })));
    if (badge) badge.textContent = `↩${n}`;
    b.setAttribute("aria-label", `${TEAM_NAME[li.dataset.role]}${n ? `（差し戻し${n}回）` : ""}${roles.includes(li.dataset.role) ? "（働き中）" : ""}`);
  }
  const n = $("team-note");
  const working = roles.length > 0;
  n.classList.toggle("is-working", working);
  let text = crew.stepNote ?? QUIET_NOTE;
  if (real.length && !real.some((a) => crew.stepRoles.includes(a.agent))) {
    text = real.map((a) => `${a.name}が「${a.recent.find((r) => r.status === "working")?.task ?? "仕事"}」に取りかかっています`).join("／");
  }
  n.textContent = working ? `いま働いています：${text}` : text;
}

async function pullTeam() {
  try {
    const d = await api(`/api/team/runs?since=${crew.since ?? 0}`);
    if (crew.since == null) {
      // 開いたときより前の差し戻しは、矢印にしない（回数は履歴の中で見られる）
      crew.since = d.latest_id;
      d.new_sent_back = [];
    }
    crew.data = d;
    for (const s of d.new_sent_back) {
      if (crew.seen.has(s.id)) continue;
      crew.seen.add(s.id);
      crew.counts[s.agent] = (crew.counts[s.agent] ?? 0) + 1;
      showArrow(s);
    }
    paintTeam();
    if (crew.open) renderTeamLog();
  } catch {
    // 読めなくても画面の段取りで光らせ続ける（記録が読めないだけで仕事は止めない）
  }
}

function showArrow(s) {
  const a = $("team-arrow");
  a.replaceChildren(
    el("span", { cls: "arrow-who", text: "監査役" }),
    el("span", { cls: "arrow-mark", text: "→", attrs: { "aria-label": "から" } }),
    el("span", { cls: "arrow-who", text: TEAM_NAME[s.agent] ?? s.agent }),
    el("span", { text: `　差し戻し（${s.task}）${s.reason ? `：${s.reason}` : ""}` }),
  );
  a.hidden = false;
}

// AI が動く間だけ1秒ごとに読む。終わってから3秒は読み続ける（最後の「できた」を拾うため）
function watchTeam(on) {
  if (on) {
    crew.stopAt = 0;
    $("team-arrow").hidden = true;
    if (!crew.poll) crew.poll = setInterval(() => {
      if (crew.stopAt && Date.now() > crew.stopAt) {
        clearInterval(crew.poll);
        crew.poll = null;
      }
      pullTeam();
    }, 1000);
    pullTeam();
  } else {
    crew.stopAt = Date.now() + 3000;
  }
}

function toggleTeamLog(role) {
  crew.open = crew.open === role ? null : role;
  for (const li of $("team").children) li.querySelector(".chip").setAttribute("aria-expanded", String(li.dataset.role === crew.open));
  $("team-log").hidden = !crew.open;
  if (crew.open) {
    renderTeamLog();
    pullTeam();
  }
}

// 記録の時刻は世界標準時。日本の時刻（+9時間）にして出す
function jpTime(utc) {
  const t = new Date(`${utc.replace(" ", "T")}Z`);
  if (Number.isNaN(t.getTime())) return "";
  const j = new Date(t.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}

function renderTeamLog() {
  const box = $("team-log");
  const a = crew.data?.agents.find((x) => x.agent === crew.open);
  const name = TEAM_NAME[crew.open];
  const close = btn("閉じる", () => toggleTeamLog(crew.open), "btn small");
  if (!a) {
    box.replaceChildren(el("div", { cls: "team-log-head" }, [el("h2", { cls: "card-title", text: `${name}の最近の仕事` }), close]), loading("記録を読んでいます"));
    return;
  }
  const list = a.recent.length
    ? el(
        "ol",
        { cls: "run-list" },
        a.recent.map((r) => {
          const [label, tone] = RUN_STATUS[r.status] ?? [r.status, ""];
          return el("li", {}, [
            el("span", { cls: "run-time", text: jpTime(r.created_at) }),
            el("span", { cls: "run-task", text: r.task }),
            el("span", { cls: `pill ${tone}`, text: label }),
            r.sent_back_reason ? el("p", { cls: "run-reason", text: `理由：${r.sent_back_reason}` }) : null,
          ]);
        }),
      )
    : el("p", { cls: "state", text: a.agent === "keiei" ? "経営企画の記録はまだありません（料金のレベルの相談や、宮崎市の行事探しをすると、ここに記録が出ます。手取り・180日のペースはプログラムが計算しています）" : "まだ仕事の記録がありません" });
  box.replaceChildren(
    el("div", { cls: "team-log-head" }, [el("h2", { cls: "card-title", text: `${name}の最近の仕事` }), close]),
    list,
    el("p", { cls: "sub", text: `${a.agent === "kansa" ? "" : `監査役に差し戻された回数：${a.sent_back_count}回。`}記録には、何の仕事かと結果だけを出します（宿泊者の名前や文の中身は出しません）。時刻は、AIが実際に働いた日時です（デモの日付とはちがいます）` }),
  );
}

// SVG の部品（図の幅や色は属性とクラスで決める。インラインの style は使わない）
const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}
const shortMonth = (ym) => `${Number(ym.slice(5, 7))}月`;

// CSV：数式として読まれないよう、= + - @ で始まる文字の前に ' を付ける
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
function downloadCsv(name, rows) {
  const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { attrs: { href: url, download: name } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${name} をつくりました。提出はご本人が行います`);
}

function num(label, value, unit, cls = "", sub = "") {
  return el("div", { cls: `num ${cls}` }, [
    el("dt", { text: label }),
    el("dd", {}, [String(value), unit ? el("small", { text: unit }) : null]),
    sub ? el("p", { cls: "num-sub", text: sub }) : null,
  ]);
}

// ---- 今月の数字（M8） ----
// 数えるのはプログラム（/api/kpis）。売上は「泊まった日」で数え、宿泊税は売上に入れない。

const pct = (v) => `${Number(v).toFixed(1)}`;

async function showKpi() {
  const p = $("panel-kpi");
  const head = [el("h2", { cls: "h2", text: "今月の数字" }), kpiMonths()];
  p.replaceChildren(...head, loading("プログラムが数えています"));
  try {
    const d = await api(`/api/kpis?month=${encodeURIComponent(state.kpiMonth)}`);
    if (d.total === 0 && d.room_nights === 0) {
      p.replaceChildren(...head, kpiEmpty(d), ...kpiPricing(d));
      return;
    }
    p.replaceChildren(...head, kpiHeroCard(d), kpiKeepCard(d), kpiOtaCard(d), kpiFactsCard(d), ...kpiLinks(d), kpiCountryCard(d), ...kpiPricing(d));
  } catch (err) {
    p.replaceChildren(...head, errorBox(err, showKpi));
  }
}

// 月の切り替え：これからの2か月（予約が入っている分）から、半年前まで
function kpiMonths() {
  const now = state.today.slice(0, 7);
  const cur = state.kpiMonth;
  const prev = addMonths(cur, -1);
  const next = addMonths(cur, 1);
  const move = (m) => () => {
    state.kpiMonth = m;
    showKpi();
  };
  const back = btn(`◀ ${shortMonth(prev)}`, move(prev), "btn small");
  back.disabled = prev < addMonths(now, -6);
  back.setAttribute("aria-label", `前の月（${jpMonth(prev)}）を見る`);
  const fwd = btn(`${shortMonth(next)} ▶`, move(next), "btn small");
  fwd.disabled = next > addMonths(now, 2);
  fwd.setAttribute("aria-label", `次の月（${jpMonth(next)}）を見る`);
  const label = el("p", { cls: "now", attrs: { "aria-live": "polite" } }, [jpMonth(cur), cur === now ? el("small", { text: "今月" }) : null]);
  return el("div", { cls: "months" }, [back, label, fwd]);
}

function kpiEmpty(d) {
  return el("article", { cls: "card" }, [
    el("p", { cls: "state", text: `${shortMonth(d.month)}に泊まる予約はまだありません` }),
    el("div", { cls: "btns" }, [btn("予約メールを開く", () => go("mail"))]),
  ]);
}

// 1枚目：売上（決まっている数字）。前の月との差は言葉で書く
function kpiHeroCard(d) {
  const prev = d.previous;
  const diff = d.total - prev.total;
  const vs = el(
    "p",
    { cls: "vs" },
    diff === 0
      ? [`${shortMonth(prev.month)}と同じです`]
      : [`${shortMonth(prev.month)}より `, el("b", { cls: diff > 0 ? "up" : "", text: `${diff > 0 ? "＋" : "−"}${yen(Math.abs(diff))}円` }), diff > 0 ? " 増えました" : " 減りました"],
  );

  // 泊まり済み／これから／キャンセル料（今日より前の夜＝泊まり済み）
  const parts = [
    { label: "泊まり済み", value: d.sales_stayed, cls: "c1" },
    { label: "これから泊まる分", value: d.sales_upcoming, cls: "c3" },
    { label: "キャンセル料", value: d.cancel_fees, cls: "c2" },
  ].filter((x) => x.value > 0);
  const sum = parts.reduce((t, x) => t + x.value, 0);
  let x = 0;
  const rects = parts.map((pt) => {
    const w = (pt.value / sum) * 1000;
    const r = svg("rect", { x, y: 0, width: w, height: 22, class: pt.cls });
    x += w;
    return r;
  });
  const split = sum > 0 ? svg("svg", { class: "split", viewBox: "0 0 1000 22", preserveAspectRatio: "none", "aria-hidden": "true" }, rects) : null;
  const legend = el(
    "ul",
    { cls: "split-legend" },
    parts.map((pt) => el("li", {}, [el("span", { cls: `sw ${pt.cls}`, attrs: { "aria-hidden": "true" } }), el("span", { text: pt.label }), el("b", { text: `${yen(pt.value)}円` })])),
  );

  return el("article", { cls: "card hero-card" }, [
    el("p", { cls: "hero-label", text: `${shortMonth(d.month)}の売上` }),
    el("p", { cls: "hero" }, [yen(d.total), el("span", { cls: "unit", text: "円" })]),
    vs,
    split,
    parts.length ? legend : null,
    d.sales_upcoming > 0 ? el("p", { cls: "sub", text: `「これから」は ${jpDate(d.today, false)}より後の夜の分です。` }) : null,
    el("p", { cls: "sub", text: `宿泊税 ${yen(d.lodging_tax)}円は預かったお金なので、売上に入れていません。泊まった日で数えていて、月をまたぐ予約は泊まった夜の分だけこの月に入れます。` }),
  ]);
}

// 2枚目：手元に残るお金（レシートの形）。見込みを含むときは「見込み」と書く
function kpiKeepCard(d) {
  const est = d.sales_upcoming > 0 || d.fee_estimate > 0;
  const known = d.fee != null && d.net != null;
  const row = (label, value, cls = null) => el("div", { cls }, [el("dt", { text: label }), el("dd", { text: value })]);
  const rows = [
    row("売上", `${yen(d.sales)}円`),
    row("キャンセル料", `${yen(d.cancel_fees)}円`),
    row("予約サイトの手数料", d.fee == null ? "分からない" : `−${yen(d.fee)}円`, "minus"),
    el("div", { cls: "total keep-total" }, [el("dt", { text: "手取り" }), el("dd", {}, known ? [yen(d.net), el("span", { cls: "unit", text: "円" })] : ["—"])]),
  ];
  const notes = [];
  if (d.fee == null) {
    notes.push(el("p", { cls: "notice warn", text: "手数料が分からない予約があります。お金の照合で予約サイトの明細を読み込むと出ます" }));
  } else if (d.fee_estimate > 0) {
    const rates = Object.entries(d.fee_rates ?? {}).map(([k, v]) => `${OTA[k] ?? k} ${pct(v)}%`).join("・");
    notes.push(el("p", { cls: "sub", text: `予約サイトの明細がまだ無い分は、これまでの明細の割合${rates ? `（${rates}）` : ""}から手数料を見込んでいます。明細が届いたら正しい額に変わります。` }));
  }
  if (d.sales_upcoming > 0) notes.push(el("p", { cls: "sub", text: "これから泊まる分も入っています。キャンセルがあると変わります。" }));
  if (d.unknown_tax_included > 0) notes.push(el("p", { cls: "notice warn", text: `宿泊税の預かった額が分からない予約が ${d.unknown_tax_included}件 あります。その分は宿泊税を引かずに売上に入れています` }));
  return el("article", { cls: "card" }, [
    el("h2", { cls: "card-title" }, ["手元に残るお金", est ? el("span", { cls: "tag-est", text: "見込み" }) : null]),
    el("dl", { cls: "receipt" }, rows),
    ...notes,
  ]);
}

// ---- 値付けの目安（経営企画）----
// 手取り・180日のペースはプログラムが計算する。料金のレベルは、はっきりした夜をプログラムが、
// グレーな夜を経営企画（AI）が決め、監査役が確かめる。値段を決めて予約サイトに入れるのはオーナー

function kpiPricing(d) {
  const pr = d.pricing;
  if (!pr) return [];
  return [kpiPriceCard(d, pr), kpiLevelCard(), kpiReviewCard(pr.reviews)];
}

// ---- 料金のレベル（経営企画・2026-11-06）----
const LEVEL_STEPS = [
  [["keiei"], "経営企画が、はっきりしない夜のレベルを考えています"],
  [["kansa"], "プログラムと監査役が、理由と書き方を確かめています"],
];
const EVENT_STEPS = [
  [["keiei"], "経営企画が、宮崎市の公式サイトで行事を探しています"],
  [["keiei"], "経営企画が、見つけた行事の日付と出典を書き写しています"],
];
const LEVEL_UNAVAILABLE = {
  not_set: "料金のレベルの金額が入っていません。宿の設定でレベル1〜4の金額を入れてください",
  no_gray: "はっきりしない夜がないので、相談することはありませんでした（プログラムの案のままです）",
  no_key: "AIの鍵がないので、プログラムの案（はっきりしない夜はレベル2）を出しています",
  daily_limit: "今日のAIの使用回数の上限に達しました。プログラムの案を出しています",
  refusal: "AIがうまく答えられなかったので、プログラムの案を出しています",
  bad_output: "AIがうまく答えられなかったので、プログラムの案を出しています",
  api_error: "AIにつながらなかったので、プログラムの案を出しています",
};
const CROWD_JA = { large: "人出：多い", medium: "人出：ふつう", small: "人出：少なめ" };
const lv = { result: null, note: null, busy: false };

function kpiLevelCard() {
  const holder = el("article", { cls: "card", attrs: { id: "level-card" } }, [loading("料金のレベルを読み込んでいます")]);
  loadLevels(holder);
  return holder;
}

async function loadLevels(holder = $("level-card")) {
  if (!holder) return;
  try {
    renderLevels(holder, await api("/api/price-levels"));
  } catch (err) {
    holder.replaceChildren(el("h2", { cls: "card-title", text: "料金のレベル（経営企画）" }), errorBox(err, () => loadLevels(holder)));
  }
}

// 画面に出す夜：相談した直後はその結果、そうでなければ最後の案（AIが選んだグレーな夜だけ）をプログラムの案に重ねる
function levelNights(v) {
  if (lv.result) return { nights: lv.result.nights, from: "result" };
  const plan = v.plan;
  if (!v.latest) return { nights: plan.nights, from: "plan" };
  const saved = new Map(v.latest.nights.map((n) => [n.night, n]));
  const usable = new Set(plan.table.levels.filter((x) => x.usable).map((x) => x.level));
  const nights = plan.nights.map((n) => {
    const s = saved.get(n.night);
    if (!n.gray || !s || s.by !== "ai" || !usable.has(s.level)) return n;
    return { ...n, level: s.level, by: "ai", reason: s.reason };
  });
  return { nights, from: "latest" };
}

function renderLevels(holder, v) {
  const plan = v.plan;
  const table = plan.table;
  const price = (level) => table.levels.find((x) => x.level === level)?.price;
  const out = [
    el("h2", { cls: "card-title" }, ["料金のレベル（経営企画）", v.latest?.status === "draft" && !lv.result ? el("span", { cls: "pill warn", text: "案（まだOKしていません）" }) : null, v.latest?.status === "ok" && !lv.result ? el("span", { cls: "pill ok", text: "OKした案" }) : null]),
    el("p", { cls: "sub", text: "金額はオーナーが決めます。年末年始・お盆・連休・OKした行事の夜はプログラムが決め、それ以外のはっきりしない夜は経営企画（AI）がレベル1〜3から選び、監査役が理由を確かめます。予約サイトに値段を入れるのはオーナーです。" }),
  ];
  if (lv.note) out.push(lv.note);

  // レベルの表
  const take = new Map((plan.take_home ?? []).map((x) => [x.level, x.values]));
  out.push(
    el("dl", { cls: "kv price-kv level-kv" }, table.levels.flatMap((x) => {
      const th = take.get(x.level);
      const extra = th?.length ? `（2泊したときの1泊の手取り ${th.map((t) => `${t.name} 約${yen(t.value)}円`).join("・")}）` : "";
      return [
        el("dt", { text: `レベル${x.level}・${x.name}` }),
        el("dd", {}, [x.price == null ? "未設定" : `1泊${yen(x.price)}円`, x.usable ? extra : el("span", { cls: "pill warn", text: x.why })]),
      ];
    })),
  );
  for (const p of table.problems) out.push(el("p", { cls: "notice warn", text: p }));
  if (!table.set) {
    out.push(el("div", { cls: "btns" }, [btn("宿の設定で金額を入れる", () => go("settings"), "btn small")]));
    holder.replaceChildren(...out);
    return;
  }

  // 夜ごとのレベル
  const { nights, from } = levelNights(v);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const n of nights) counts[n.level] += 1;
  out.push(
    el("h3", { cls: "card-title price-sub", text: `${jpDate(plan.from)}〜${jpDate(plan.to)}の夜` }),
    el("p", { text: [1, 2, 3, 4].map((l) => `レベル${l}：${counts[l]}泊`).join("　") + (plan.full_nights ? `（満室の${plan.full_nights}泊は外しています）` : "") }),
  );
  const moved = nights.filter((n) => n.level !== 2);
  if (moved.length) {
    out.push(
      el("ul", { cls: "level-list" }, moved.map((n) =>
        el("li", {}, [
          el("strong", { text: `${n.label}　レベル${n.level}（${yen(price(n.level))}円）` }),
          n.by === "ai" ? el("span", { cls: "pill ok", text: "経営企画が選んだ" }) : null,
          el("span", { cls: "sub", text: `　${n.reason}` }),
        ]),
      )),
    );
  }
  const plain = nights.filter((n) => n.level === 2);
  if (plain.length) {
    out.push(el("details", {}, [el("summary", { text: `レベル2の夜（${plain.length}泊）` }), el("p", { cls: "sub", text: plain.map((n) => n.label).join("・") })]));
  }

  // 相談した直後の結果
  const r = lv.result;
  if (r) {
    if (r.unavailable) out.push(el("p", { cls: "notice info", text: LEVEL_UNAVAILABLE[r.unavailable] ?? LEVEL_UNAVAILABLE.api_error }));
    else {
      const n = r.nights.filter((x) => x.by === "ai").length;
      out.push(el("p", { cls: "notice info", text: `経営企画が${n}泊のレベルを変えました。${r.summary ?? ""}` }));
      if (r.audit?.gave_up && r.dropped?.length) {
        out.push(el("p", { cls: "notice warn", text: `監査役が理由に納得しなかった ${r.dropped.map((d) => jpDate(d)).join("・")} は、レベル2のままにしています` }));
      } else if (r.audit) {
        out.push(el("p", { cls: "sub", text: "監査役が、理由が事実どおりか・誤解を招く書き方がないかを確かめました" }));
      }
    }
  }

  // OK ボタン（下書きの案があるとき）
  if (v.latest?.status === "draft") {
    out.push(
      el("div", { cls: "btns" }, [
        btn("この案でOK（予約サイトには自分で入れます）", (e) => okLevelPlan(e.currentTarget, v.latest.id), "btn primary"),
      ]),
    );
  } else if (v.latest?.status === "ok" && from !== "result") {
    out.push(el("p", { cls: "sub", text: "この案はOKしました。予約サイトの値段は、オーナーが入れてください。" }));
  }

  // 経営企画に相談する
  const note = el("textarea", { cls: "text-in note-in", attrs: { "aria-label": "周りの宿の値段（なくてもよい）", maxlength: "2000", placeholder: "周りの宿の値段（なくてもよい）。例：近所のA宿 11月21日 15,000円" } });
  out.push(
    el("h3", { cls: "card-title price-sub", text: "経営企画に相談する" }),
    el("p", { cls: "sub", text: "はっきりしない夜を、空き具合・曜日・何日先かから見直します。周りの宿の値段は、ここに貼ったときだけ使います（貼られていない値段を理由にはしません）。" }),
    note,
  );
  const ask = btn("経営企画に相談する", (e) => askLevels(e.currentTarget, note.value), "btn primary");
  if (!v.ai_ready) {
    ask.disabled = true;
    out.push(el("p", { cls: "notice info", text: "AIの鍵がないので、今はプログラムの案だけです" }));
  }
  out.push(el("div", { cls: "btns" }, [ask]), el("div", { attrs: { id: "level-msg" } }));

  // 宮崎市の行事
  out.push(...levelEvents(v));
  holder.replaceChildren(...out);
  if (lv.busy) for (const b of holder.querySelectorAll("button")) b.disabled = true;
}

function levelEvents(v) {
  const out = [
    el("h3", { cls: "card-title price-sub", text: "宮崎市の行事（上げどきの候補）" }),
    el("p", { cls: "sub", text: "経営企画が、宮崎市の公式の観光サイトと市役所のサイトだけを調べます。出典のページを確かめてから「上げどきにする」を押してください。OKした行事の前の晩と当日の晩は、レベル3になります。" }),
  ];
  const live = v.candidates.filter((c) => c.status !== "dismissed");
  const gone = v.candidates.filter((c) => c.status === "dismissed");
  const item = (c) => {
    const when = c.start_day === c.end_day ? jpDate(c.start_day) : `${jpDate(c.start_day)}〜${jpDate(c.end_day)}`;
    const meta = [when, c.place, CROWD_JA[c.crowd]].filter(Boolean).join("・");
    const buttons =
      c.status === "candidate"
        ? [btn("上げどきにする", (e) => decideEvent(e.currentTarget, c.id, "ok"), "btn small primary"), btn("見送る", (e) => decideEvent(e.currentTarget, c.id, "dismiss"), "btn small")]
        : [btn("戻す", (e) => decideEvent(e.currentTarget, c.id, "undo"), "btn small")];
    return el("li", { cls: "level-event" }, [
      el("strong", { text: c.name }),
      c.found_by === "sample" ? el("span", { cls: "pill mask", text: "見本（架空）" }) : null,
      c.status === "ok" ? el("span", { cls: "pill ok", text: "上げどき" }) : null,
      el("p", { cls: "sub", text: meta }),
      c.source_url ? el("p", { cls: "sub" }, ["出典：", el("a", { text: c.source_title || c.source_url, attrs: { href: c.source_url, target: "_blank", rel: "noopener" } })]) : null,
      c.note ? el("p", { cls: "sub", text: c.note }) : null,
      el("div", { cls: "btns" }, buttons),
    ]);
  };
  if (live.length) out.push(el("ul", { cls: "level-list" }, live.map(item)));
  else out.push(el("p", { cls: "state", text: "まだ候補はありません" }));
  if (gone.length) out.push(el("details", {}, [el("summary", { text: `見送った行事（${gone.length}件）` }), el("ul", { cls: "level-list" }, gone.map(item))]));
  const buttons = [];
  if (v.ai_ready) buttons.push(btn("宮崎市の行事を探す", (e) => searchLevelEvents(e.currentTarget), "btn"));
  if (v.demo) buttons.push(btn("見本の行事を入れる（デモ）", (e) => sampleLevelEvents(e.currentTarget), "btn small"));
  if (buttons.length) out.push(el("div", { cls: "btns" }, buttons));
  if (!v.ai_ready) out.push(el("p", { cls: "sub", text: "AIの鍵がないので、行事を探すことはできません" }));
  out.push(el("div", { attrs: { id: "event-msg" } }));
  return out;
}

function lockLevels(on) {
  lv.busy = on;
  for (const b of $("level-card")?.querySelectorAll("button") ?? []) b.disabled = on;
}

async function askLevels(b, marketNote) {
  lockLevels(true);
  const msg = $("level-msg");
  teamWorking((note) => msg?.replaceChildren(loading(`${note}（10〜40秒ほど）`)), LEVEL_STEPS);
  try {
    const r = await api("/api/price-levels/suggest", { method: "POST", body: { market_note: marketNote } });
    teamDone(r.result.source === "ai" ? "料金のレベルの案ができました" : "プログラムの案を出しました");
    lv.result = r.result;
    lv.note = null;
    lv.busy = false;
    renderLevels($("level-card"), r);
    toast("料金のレベルの案を出しました");
  } catch (err) {
    teamDone("料金のレベルを相談できませんでした");
    lockLevels(false);
    msg?.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
  b.blur();
}

async function okLevelPlan(b, id) {
  lockLevels(true);
  try {
    const v = await api(`/api/price-levels/${id}/ok`, { method: "POST", body: {} });
    lv.result = null;
    lv.note = el("p", { cls: "notice info", text: "この案でOKしました。予約サイトの値段は、オーナーが入れてください（番頭は予約サイトを変えません）" });
    lv.busy = false;
    renderLevels($("level-card"), v);
  } catch (err) {
    lockLevels(false);
    $("level-msg")?.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
  b.blur();
}

async function decideEvent(b, id, what) {
  lockLevels(true);
  try {
    const v = await api(`/api/price-events/${id}/${what}`, { method: "POST", body: {} });
    // 行事を OK／戻すと、はっきりした夜が変わる。古い相談結果は消して、最後の案を重ね直す
    lv.result = null;
    lv.note = what === "ok" ? el("p", { cls: "notice info", text: "上げどきにしました。この行事の夜はレベル3になります" }) : null;
    lv.busy = false;
    renderLevels($("level-card"), v);
  } catch (err) {
    lockLevels(false);
    $("event-msg")?.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
  b.blur();
}

async function searchLevelEvents(b) {
  lockLevels(true);
  const msg = $("event-msg");
  teamWorking((note) => msg?.replaceChildren(loading(`${note}（1〜3分ほど）`)), EVENT_STEPS);
  try {
    const r = await api("/api/price-events/search", { method: "POST", body: {} });
    const f = r.found;
    teamDone("行事を探し終えました");
    let text;
    if (f.unavailable) text = f.unavailable === "no_key" ? "AIの鍵がないので、行事を探せませんでした" : f.unavailable === "daily_limit" ? "今日のAIの使用回数の上限に達したので、行事を探せませんでした" : "AIがうまく答えられなかったので、行事を探せませんでした";
    else if (!f.pages) text = "公式のサイトで、行事のページが見つかりませんでした";
    else text = `公式のサイトを${f.pages}ページ見て、新しく${f.added}件を候補にしました${f.dropped.length ? `（日付や出典を確かめられなかった${f.dropped.length}件は外しました）` : ""}`;
    lv.note = el("p", { cls: `notice ${f.added ? "info" : "warn"}`, text });
    lv.busy = false;
    renderLevels($("level-card"), r);
  } catch (err) {
    teamDone("行事を探せませんでした");
    lockLevels(false);
    msg?.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
  b.blur();
}

async function sampleLevelEvents(b) {
  lockLevels(true);
  try {
    const r = await api("/api/price-events/samples", { method: "POST", body: {} });
    lv.note = el("p", { cls: "notice info", text: r.sample.added ? `見本の行事（架空）を${jpDate(r.sample.day)}に入れました` : "見本の行事は、もう入っています" });
    lv.busy = false;
    renderLevels($("level-card"), r);
  } catch (err) {
    lockLevels(false);
    $("event-msg")?.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
  b.blur();
}

function kpiPriceCard(d, pr) {
  const row = (label, value, cls = null) => el("div", { cls }, [el("dt", { text: label }), el("dd", { text: value })]);
  const t = pr.take_home;
  const body = [];
  if (t?.available) {
    body.push(
      el("dl", { cls: "receipt" }, [
        row(`売上（${t.stays}件・${t.nights}泊）`, `${yen(t.sales)}円`),
        row("予約サイトの手数料", `−${yen(t.fee)}円`, "minus"),
        row(`清掃費（1回${yen(pr.cleaning_fee)}円）`, `−${yen(t.cleaning)}円`, "minus"),
        el("div", { cls: "total keep-total" }, [el("dt", { text: "1泊あたりの手取り" }), el("dd", {}, [yen(t.per_night), el("span", { cls: "unit", text: "円" })])]),
      ]),
    );
    const notes = ["清掃費は1回の予約に1回。月をまたぐ予約は、この月の泊数の分だけ数えています。"];
    if (t.estimate) notes.push("これから泊まる分や、明細がまだ無い分の手数料の見込みが入っています。");
    body.push(el("p", { cls: "sub", text: notes.join("") }));
    if (t.excluded > 0) body.push(el("p", { cls: "notice warn", text: `手数料が分からない予約が ${t.excluded}件 あるので、この計算から外しています` }));
  } else {
    body.push(el("p", { cls: "state", text: t?.reason ?? "まだ計算できません" }));
  }

  const pace = pr.pace;
  if (pace) {
    body.push(
      el("h3", { cls: "card-title price-sub" }, ["180日のペース", el("span", { cls: `pill ${pace.policy === "keep" ? "warn" : "ok"}`, text: pace.policy_label })]),
      el("dl", { cls: "kv price-kv" }, [
        el("dt", { text: "泊まった日" }),
        el("dd", { text: `${pace.used_days}日（予約済みを入れると${pace.total_days}日）／上限${pace.limit}日` }),
        el("dt", { text: "今のペース" }),
        el("dd", { text: pace.reach_text }),
        el("dt", { text: "方針" }),
        el("dd", { text: pace.policy_text }),
      ]),
    );
  }

  const set = [
    `清掃費 1回${pr.cleaning_fee == null ? "（未設定）" : `${yen(pr.cleaning_fee)}円`}`,
    `最低価格 1泊${pr.min_price == null ? "（未設定）" : `${yen(pr.min_price)}円`}`,
  ];
  if (pr.guide) set.push(`これまでの1泊の平均 約${yen(pr.guide.price)}円`);
  body.push(
    el("p", { cls: "sub", text: `宿の設定：${set.join("・")}。上げどきの夜や、1泊だけ空いた夜は、決裁箱でお知らせします。値段を決めて予約サイトに入れるのはオーナーです（番頭は予約も帳簿も変えません。手取りとペースはプログラムが計算しています）` }),
    el("div", { cls: "btns" }, [btn("決裁箱を見る", () => go("decisions"), "btn small")]),
  );
  return el("article", { cls: "card" }, [
    el("h2", { cls: "card-title" }, ["値付けの目安（経営企画）", t?.available && t.estimate ? el("span", { cls: "tag-est", text: "見込み" }) : null]),
    ...body,
  ]);
}

// 「見直した／このまま」の記録を比べる。記録がなければ、つくらずにそう言う
function kpiReviewCard(rv) {
  const head = el("h2", { cls: "card-title", text: "見直した日と、そのままの日" });
  if (!rv || rv.empty) {
    return el("article", { cls: "card" }, [
      head,
      el("p", { cls: "state", text: rv?.note ?? "記録がたまると比べられます" }),
      el("p", { cls: "sub", text: "決裁箱の値付けの知らせで「見直した」「このまま」を押すと、ここに記録がたまります" }),
    ]);
  }
  const cell = (g) => [
    el("dt", { text: `${g.label}（知らせ${g.cards}件）` }),
    el("dd", {
      text: `空いていた部屋×夜 ${g.free_room_nights} → その後に埋まった ${g.filled_room_nights}。1泊あたりの手取り ${g.take_home_per_night == null ? "—" : `約${yen(g.take_home_per_night)}円`}${g.unknown_fee ? `（手数料が分からない予約${g.unknown_fee}件は外しています）` : ""}`,
    }),
  ];
  return el("article", { cls: "card" }, [head, el("dl", { cls: "kv price-kv" }, rv.groups.flatMap(cell)), el("p", { cls: "sub", text: rv.note })]);
}

// 部屋が埋まった割合・1部屋1泊の平均
function kpiFactsCard(d) {
  const prev = d.previous;
  const fact = (label, small, value, unit) =>
    el("div", {}, [el("dt", {}, [label, small ? el("small", { text: small }) : null]), el("dd", {}, value == null ? ["—"] : [value, el("span", { cls: "unit", text: unit })])]);
  return el("article", { cls: "card" }, [
    el("dl", { cls: "facts" }, [
      fact("部屋が埋まった割合", `${d.rooms}部屋×${d.days}日のうち ${d.room_nights}泊`, pct(d.occupancy_pct), "%"),
      fact("1部屋1泊の平均", prev.adr == null ? "" : `${shortMonth(prev.month)}は ${yen(prev.adr)}円`, d.adr == null ? null : yen(d.adr), "円"),
    ]),
    d.cancel_fees > 0 ? el("p", { cls: "sub", text: "キャンセル料は泊まっていない分なので、この2つには入れていません。" }) : null,
  ]);
}

// 照合への案内は1行だけ（入金のずれがあるときだけ目立たせる）
function kpiLinks(d) {
  if (d.open_discrepancies > 0) {
    return [el("div", { cls: "notice warn kpi-link" }, [el("span", { text: `入金のずれが ${d.open_discrepancies}件 あります` }), btn("お金の照合を開く", () => go("money"), "btn small")])];
  }
  if (!d.statements_loaded) {
    return [el("div", { cls: "notice info kpi-link" }, [el("span", { text: "予約サイトの明細を読み込むと、手数料が実際の額になります" }), btn("お金の照合を開く", () => go("money"), "btn small")])];
  }
  return [];
}

// ドーナツの図（どこから予約が入ったか）。色だけで伝えないよう、名前・割合・金額の一覧と表を必ず付ける
function kpiDonut(d) {
  const items = d.by_ota
    .map((o) => ({ name: OTA[o.ota] ?? o.ota, value: o.sales + o.cancel_fees, nights: o.room_nights }))
    .filter((o) => o.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!items.length) return null;
  let slices = items;
  if (items.length >= 4) {
    const rest = items.slice(2);
    slices = [...items.slice(0, 2), { name: "そのほか", value: rest.reduce((t, o) => t + o.value, 0), nights: rest.reduce((t, o) => t + o.nights, 0) }];
  }
  const sum = slices.reduce((t, o) => t + o.value, 0);
  const share = (v) => Math.round((v / sum) * 100);
  const C = 2 * Math.PI * 48;
  let off = 0;
  const circles = slices.map((s, i) => {
    const len = (s.value / sum) * C;
    const c = svg("circle", { cx: 60, cy: 60, r: 48, "stroke-width": 22, class: `c${i + 1}`, "stroke-dasharray": `${len} ${C}`, "stroke-dashoffset": -off });
    off += len;
    return c;
  });
  const chart = svg("svg", { class: "donut", viewBox: "0 0 120 120", role: "img", "aria-label": slices.map((s) => `${s.name} ${share(s.value)}%`).join("、") }, [
    svg("g", { transform: "rotate(-90 60 60)" }, circles),
    svg("text", { x: 60, y: 66, "text-anchor": "middle" }, ["売上"]),
  ]);
  const legend = el(
    "ul",
    { cls: "legend" },
    slices.map((s, i) =>
      el("li", {}, [
        el("span", { cls: `sw c${i + 1}`, attrs: { "aria-hidden": "true" } }),
        el("span", { cls: "lg-name", text: s.name }),
        el("span", { cls: "lg-pct", text: `${share(s.value)}%` }),
        el("span", { cls: "lg-amt" }, [el("span", { text: `${s.nights}泊` }), el("span", { text: `${yen(s.value)}円` })]),
      ]),
    ),
  );
  return el("div", { cls: "donut-wrap" }, [chart, legend]);
}

function kpiOtaCard(d) {
  const feeText = (o) => (o.fee == null ? "分からない" : `${yen(o.fee)}${o.fee_estimate > 0 ? "（見込み）" : ""}`);
  const tbody = el("tbody");
  for (const o of d.by_ota) {
    tbody.append(
      el("tr", {}, [
        el("td", { text: OTA[o.ota] ?? o.ota }),
        el("td", { cls: "n", text: `${o.room_nights}泊` }),
        el("td", { cls: "n", text: yen(o.sales + o.cancel_fees) }),
        el("td", { cls: "n", text: feeText(o) }),
        el("td", { cls: "n", text: o.net == null ? "—" : yen(o.net) }),
      ]),
    );
  }
  tbody.append(
    el("tr", { cls: "total" }, [
      el("td", { text: "合計" }),
      el("td", { cls: "n", text: `${d.room_nights}泊` }),
      el("td", { cls: "n", text: yen(d.total) }),
      el("td", { cls: "n", text: d.fee == null ? "分からない" : yen(d.fee) }),
      el("td", { cls: "n", text: d.net == null ? "—" : yen(d.net) }),
    ]),
  );
  const head = el("tr", {}, ["予約サイト", "泊数", "売上（円）", "手数料（円）", "手取り（円）"].map((t, i) => el("th", { cls: i ? "n" : "", text: t, attrs: { scope: "col" } })));
  const rows = [["予約サイト", "この月の泊数", "売上（円）", "手数料（円）", "手数料の出どころ", "手取り（円）"]];
  for (const o of d.by_ota) rows.push([OTA[o.ota] ?? o.ota, o.room_nights, o.sales + o.cancel_fees, o.fee ?? "分からない", o.ota === "direct" ? "かからない" : o.fee_estimate > 0 ? "見込みを含む" : "明細", o.net ?? ""]);
  rows.push(["合計", d.room_nights, d.total, d.fee ?? "分からない", "", d.net ?? ""]);
  return el("article", { cls: "card" }, [
    el("h2", { cls: "card-title", text: "どこから予約が入ったか" }),
    kpiDonut(d),
    el("details", {}, [
      el("summary", { text: "予約サイトごとの表を開く（手数料・手取りも）" }),
      el("div", { cls: "table-wrap" }, [el("table", {}, [el("thead", {}, [head]), tbody])]),
      el("div", { cls: "btns" }, [btn("CSVを保存", () => downloadCsv(`今月の数字_${d.month}.csv`, rows))]),
    ]),
  ]);
}

function kpiCountryCard(d) {
  const total = d.nationalities.reduce((t, n) => t + n.persons, 0);
  const list = el("ul", { cls: "kpi-countries" });
  for (const n of d.nationalities) {
    list.append(el("li", {}, [el("span", { text: COUNTRY[n.code] ?? n.code }), el("strong", { text: `${n.persons}人` })]));
  }
  return el("article", { cls: "card" }, [
    el("h2", { text: "ゲストの国・地域" }),
    el("p", { cls: "lead", text: `この月に泊まったゲスト ${total}人（月をまたぐ予約は両方の月に入ります）` }),
    list,
  ]);
}

// ---- 宿泊税 ----

async function showTax() {
  const p = $("panel-tax");
  p.replaceChildren(loading("プログラムが数えています"));
  try {
    const d = await api(`/api/tax?month=${encodeURIComponent(state.taxMonth)}`);
    p.replaceChildren(taxCard(d), taxBreakdown(d));
  } catch (err) {
    p.replaceChildren(errorBox(err, showTax));
  }
}

// 集計表と申告書で同じ月を使う（どちらかで変えたら、もう一方も次に開いたときその月になる）
function taxMonthPicker(rules, { id = "tax-month", onChange = showTax } = {}) {
  const start = (rules.tax_start_date ?? "2026-07-01").slice(0, 7);
  const last = state.today.slice(0, 7);
  const sel = el("select", { attrs: { id } });
  for (let m = last; m >= start; m = addMonths(m, -1)) {
    sel.append(el("option", { text: jpMonth(m), attrs: { value: m, selected: m === state.taxMonth } }));
    if (m === start) break;
  }
  sel.addEventListener("change", () => {
    state.taxMonth = sel.value;
    state.loaded.tax = false;
    onChange();
  });
  return el("div", { cls: "pick" }, [el("label", { text: "月", attrs: { for: id } }), sel]);
}

function taxCard(d) {
  // 分からない分があるだけなら「差」は灰色のまま（黄色は下の注意文だけ）。理由は箱の中に小さく書く
  const diffCls = d.diff < 0 ? "is-danger" : d.diff > 0 ? "is-warn" : d.unknown_tax > 0 ? "" : "is-ok";
  const diffSub = d.unknown_tax > 0 ? `分からない ${yen(d.unknown_tax)}円 は除く` : "";
  const card = el("article", { cls: "card" }, [
    el("div", { cls: "card-head" }, [
      el("div", {}, [
        el("h2", { text: `${jpMonth(d.month)}の宿泊税の集計表` }),
        el("p", { cls: "lead", text: `1人1泊 ${yen(d.rules.tax_rate)}円。人数×泊数（人泊）をプログラムが数えています` }),
      ]),
      taxMonthPicker(d.rules),
    ]),
    // 主の数字は「宿泊税」1つだけ大きく。ほかの3つは下に小さく並べる
    el("div", { cls: "tax-hero" }, [
      el("p", { cls: "hero-label", text: "納める宿泊税" }),
      el("p", { cls: "hero" }, [yen(d.tax_amount), el("span", { cls: "unit", text: "円" })]),
    ]),
    el("dl", { cls: "nums nums-sm" }, [
      num("人泊", d.person_nights, "人泊"),
      num("預かった額", yen(d.collected_amount), "円"),
      num(d.diff < 0 ? "足りない" : "差", yen(Math.abs(d.diff)), "円", diffCls, diffSub),
    ]),
  ]);
  if (d.diff < 0) card.append(el("p", { cls: "notice danger", text: `預かった額が ${yen(-d.diff)}円 足りません。下の内訳で予約を確かめてください` }));
  else if (d.diff === 0 && !d.unknown_tax) card.append(el("p", { cls: "notice ok", text: "宿泊税と預かった額が合っています" }));
  if (d.unknown_tax > 0) {
    card.append(el("p", { cls: "notice warn", text: `預かった額が分からない予約があります（宿泊税 ${yen(d.unknown_tax)}円 分）。予約サイトの明細で確かめてください。差には入れていません` }));
  }
  if (d.refund_needed > 0) card.append(el("p", { cls: "notice warn", text: `宿泊税がかからないのに預かっている額が ${yen(d.refund_needed)}円 あります。返金が要るか確かめてください` }));
  if (d.nights_before_tax_start > 0) {
    card.append(el("p", { cls: "notice info", text: `${jpDate(d.rules.tax_start_date, false)}より前の ${d.nights_before_tax_start}泊 は、宿泊税が始まる前なので数えていません` }));
  }
  const rows = [["予約", "予約サイト", "この月の泊数", "人泊", "宿泊税（円）", "預かった額（円）", "メモ"]];
  for (const b of d.breakdown) rows.push([b.reservation_id, OTA[b.ota] ?? b.ota, b.nights_in_month, b.person_nights, b.tax, b.collected ?? "分からない", b.note ?? ""]);
  rows.push(["合計", "", "", d.person_nights, d.tax_amount, d.collected_amount, d.unknown_tax ? `分からない分 ${d.unknown_tax}円` : ""]);
  card.append(
    el("div", { cls: "btns" }, [
      btn("申告書をつくる（印刷・PDF）", () => go("taxreturn"), "btn primary"),
      btn("CSVをつくる", () => downloadCsv(`宿泊税_集計表_${d.month}.csv`, rows), "btn"),
    ]),
  );
  return card;
}

// ---- 宿泊税の納入申告書（宮崎市 様式第10号）：印刷・PDFにする画面。AIは使わない ----
// 数字は集計表と同じ（人泊×税率）。注意は画面だけに出し、印刷には出さない。申告書を出すのはオーナー本人

async function showTaxReturn() {
  const p = $("panel-taxreturn");
  p.replaceChildren(loading("申告書をつくっています"));
  try {
    const d = await api(`/api/tax/return?month=${encodeURIComponent(state.taxMonth)}`);
    p.replaceChildren(taxReturnTools(d), taxReturnSheet(d));
  } catch (err) {
    p.replaceChildren(errorBox(err, showTaxReturn));
  }
}

function taxReturnTools(d) {
  // danger（来ていない月・税率が様式とちがう）のときは印刷のボタンを止める
  const blocked = d.warnings.some((w) => w.level === "danger");
  const order = { danger: 0, warn: 1, info: 2 };
  const notes = [...d.warnings].sort((a, b) => order[a.level] - order[b.level]).map((w) => el("p", { cls: `notice ${w.level}`, text: w.text }));
  const buttons = [
    blocked
      ? el("button", { cls: "btn primary", text: "このままでは印刷できません", attrs: { type: "button", disabled: true } })
      : btn("印刷する（PDFにもできます）", () => window.print(), "btn primary"),
    btn("集計表に戻る", () => go("tax"), "btn"),
  ];
  if (d.missing.length) buttons.push(btn("設定で空いている欄を入れる", () => go("settings"), "btn"));
  return el("article", { cls: "card no-print" }, [
    el("div", { cls: "card-head" }, [
      el("div", {}, [
        el("h2", { text: `${jpMonth(d.month)}分の宿泊税納入申告書` }),
        el("p", { cls: "lead", text: "宮崎市の様式第10号と同じ形です。印刷するか PDF にして、オーナーご本人が市に出してください（番頭は出しません）" }),
      ]),
      taxMonthPicker(d.rules, { id: "taxreturn-month", onChange: showTaxReturn }),
    ]),
    ...notes,
    notes.length ? el("p", { cls: "sub", text: "上の注意は画面だけに出ます。印刷には出ません。日付は今日の日付です（出す日に合わせて手で直せます）" }) : null,
    el("div", { cls: "btns" }, buttons),
  ]);
}

// 市の様式と同じ並び。設定が空の欄は空けたまま（手で書けるように）
function taxReturnSheet(d) {
  const f = d.form;
  const v = (x) => x ?? "";
  const th = (text, opts = {}) => el("th", { text, attrs: { scope: opts.scope ?? null, colspan: opts.colspan ?? null, rowspan: opts.rowspan ?? null }, cls: opts.cls });
  const td = (text, opts = {}) => el("td", { text, attrs: { colspan: opts.colspan ?? null, rowspan: opts.rowspan ?? null }, cls: opts.cls });
  const head2 = (a, b) => el("th", { attrs: { colspan: "2" } }, [a, b ? el("small", { text: b }) : null]);

  // 列の幅は市の様式に合わせる（表の幅に対する割合）
  // 列の幅（%）。画面の決まり（CSP）で style 属性は使えないので、app.css の .w数字 で幅を付ける
  const cols = (...w) => el("colgroup", {}, w.map((x) => el("col", { cls: `w${x}` })));
  const facility = el("table", { cls: "tr-table tr-facility" }, [
    cols(14, 14, 32, 14, 26),
    el("tbody", {}, [
      el("tr", {}, [th("宿泊施設", { rowspan: "4", cls: "tr-group", scope: "rowgroup" }), th("所在地", { scope: "row" }), td(v(f.facility.address), { colspan: "3" })]),
      el("tr", {}, [th("名称", { scope: "row" }), td(v(f.facility.name), { colspan: "3" })]),
      el("tr", {}, [th("電話番号", { scope: "row" }), td(v(f.facility.phone), { cls: "tr-nowrap" }), th("施設番号", { scope: "row" }), td(v(f.facility.facility_no), { cls: "tr-nowrap" })]),
      el("tr", {}, [
        th("担当者", { scope: "row" }),
        el("td", { attrs: { colspan: "2" } }, [
          el("span", { cls: "tr-contact", text: v(f.facility.contact_name) }),
          el("span", { cls: "tr-tel", text: `（℡ ${v(f.facility.contact_phone)}${f.facility.contact_phone ? "" : "　　　　　"} ）` }),
        ]),
        el("td", { cls: "tr-none" }),
      ]),
    ]),
  ]);

  // 1行目にこの月を書く。2・3行目（特例）は空のまま
  const amount = (filled) =>
    el("table", { cls: "tr-table tr-amount" }, [
      cols(19, 17, 7, 17, 33, 7),
      el("tbody", {}, [
        el("tr", {}, [
          el("td", { cls: "tr-period", attrs: { rowspan: "2" } }, [
            el("span", { text: filled ? `令和${f.period.era_year}年度　${f.period.month}月分` : "　　年度　　月分" }),
            filled ? null : el("strong", { text: "※特例の場合のみ記入" }),
          ]),
          head2("宿泊数　①", filled ? "（１人１泊につき２００円）" : ""),
          th("税率　②"),
          head2("納入すべき税額", "①×②"),
        ]),
        el("tr", {}, [
          td(filled ? yen(f.nights) : "", { cls: "n" }),
          td("泊", { cls: "tr-unit" }),
          td("２００円", { cls: "tr-rate" }),
          td(filled ? yen(f.tax) : "", { cls: "n tr-shade" }),
          td("円", { cls: "tr-unit" }),
        ]),
      ]),
    ]);

  const total = el("table", { cls: "tr-table tr-total" }, [
    cols(52, 36, 12),
    el("tbody", {}, [el("tr", {}, [th("納入すべき金額　合計", { scope: "row" }), td(yen(f.total), { cls: "n" }), td("円", { cls: "tr-unit" })])]),
  ]);

  return el("div", { cls: "tr-wrap" }, [
    el("div", { cls: "tr-sheet", attrs: { role: "document", "aria-label": "宿泊税納入申告書（印刷される部分）" } }, [
      el("div", { cls: "tr-top" }, [
        el("p", { text: "様式第１０号（規則第７条関係）" }),
        el("p", { cls: "tr-date", text: `令和${f.date.era_year}年${f.date.month}月${f.date.day}日` }),
      ]),
      el("p", { text: "（宛先）宮崎市長" }),
      el("dl", { cls: "tr-collector" }, [
        el("p", { text: "（特別徴収義務者）" }),
        el("div", {}, [el("dt", { text: "住　所（所在地）" }), el("dd", { text: v(f.collector.address) })]),
        el("div", {}, [el("dt", { text: "氏　名（名称）" }), el("dd", { text: v(f.collector.name) })]),
        el("div", {}, [el("dt", { text: "法人番号" }), el("dd", { text: v(f.collector.corporate_no) })]),
      ]),
      el("h3", { cls: "tr-title", text: "宿泊税納入申告書" }),
      el("p", { cls: "tr-lead", text: "宿泊税の納入について、宮崎市宿泊税条例第１１条第１項の規定により、次のとおり申告します。" }),
      facility,
      amount(true),
      amount(false),
      amount(false),
      total,
      el("div", { cls: "tr-notes" }, [
        el("p", { text: "備考" }),
        el("p", { text: "１　納入すべき金額が０円の場合でも申告書の提出が必要です。" }),
        el("p", { text: "２　特例適用に当たっては、宿泊税納入期限等特例承認申請書（様式第１１号）の提出後に市の承認が必要です。" }),
      ]),
    ]),
  ]);
}

function taxBreakdown(d) {
  const cell = (label, value) =>
    el("td", { cls: "n" }, [el("span", { cls: "cell-label", attrs: { "aria-hidden": "true" }, text: label }), el("span", { cls: "cell-num", text: value })]);
  const tbody = el("tbody");
  for (const b of d.breakdown) {
    tbody.append(
      el("tr", {}, [
        // スマホ幅では「予約サイト」の列を隠し、予約番号の下に小さく出す（金額の2列を画面に収めるため）
        el("td", {}, [el("span", { text: b.reservation_id }), el("span", { cls: "sub-ota", text: OTA[b.ota] ?? b.ota })]),
        el("td", { cls: "c-ota", text: OTA[b.ota] ?? b.ota }),
        // スマホ幅では表をやめ、予約ごとに「見出し＋数字」の縦並びにする（横にずらさず読めるように）
        cell("泊数", `${b.nights_in_month}泊`),
        cell("人泊", `${b.person_nights}人泊`),
        cell("宿泊税", `${yen(b.tax)}円`),
        cell("預かった額", b.collected == null ? "分からない" : `${yen(b.collected)}円`),
      ]),
    );
    // メモは狭い「予約」の欄に入れず、その行の下に表の幅いっぱいで出す（スマホで1文字ずつ縦に並ばないように）
    if (b.note) tbody.append(el("tr", { cls: "note-row" }, [el("td", { cls: "note", text: b.note, attrs: { colspan: "6" } })]));
  }
  const head = el("tr", {}, ["予約", "予約サイト", "泊数", "人泊", "宿泊税", "預かった額"].map((h, i) => el("th", { cls: i >= 2 ? "n" : i === 1 ? "c-ota" : "", text: h })));
  return el("article", { cls: "card" }, [
    el("h2", { text: "内訳（予約ごと）" }),
    el("p", { cls: "lead", text: d.breakdown.length ? "月をまたぐ予約は、この月の夜だけを数えています" : "" }),
    d.breakdown.length
      ? el("div", { cls: "table-wrap" }, [el("table", { cls: "tax-table" }, [el("thead", {}, [head]), tbody])])
      : el("p", { cls: "state", text: "この月の予約はまだありません。別の月を選んでください" }),
  ]);
}

// ---- 民泊の手続き（180日・定期報告） ----

async function showMinpaku() {
  const p = $("panel-minpaku");
  p.replaceChildren(loading("プログラムが数えています"));
  try {
    const [c, r] = await Promise.all([api("/api/minpaku/counter"), api(`/api/minpaku/report?period=${encodeURIComponent(state.period)}`)]);
    p.replaceChildren(counterCard(c), reportCard(r));
  } catch (err) {
    p.replaceChildren(errorBox(err, showMinpaku));
  }
}

function counterCard(c) {
  const lvl = c.level === "over" ? "over" : c.level === "warn" ? "warn" : "";
  const remCls = c.level === "over" ? "is-danger" : c.level === "warn" ? "is-warn" : "is-ok";
  const card = el("article", { cls: "card" }, [
    el("h2", { text: `${c.fiscal_year}年度の営業日数` }),
    el("p", { cls: "lead", text: `上限は1年に${c.limit}日。${jpDate(c.period.from, false)}正午から1年。使った日・予約済みの日・残りを数えています` }),
    el("dl", { cls: "nums" }, [
      num("使った日", c.used_days, "日"),
      num("予約済みの日", c.booked_days, "日"),
      num("残り", c.remaining_days, "日", remCls),
    ]),
    el("div", { cls: `meter ${lvl}` }, [
      el("progress", { attrs: { max: c.limit, value: Math.min(c.total_days, c.limit), "aria-label": `${c.limit}日のうち ${c.total_days}日` } }),
      el("p", { text: `${c.limit}日のうち ${c.total_days}日（予約済みを含む）` }),
    ]),
    el("p", { cls: "notice info", text: c.how }),
  ]);
  if (c.level === "over") card.append(el("p", { cls: "notice danger", text: `上限を ${-c.remaining_days}日 こえています。予約を確かめてください` }));
  else if (c.level === "warn") card.append(el("p", { cls: "notice warn", text: `残りが ${c.remaining_days}日 です。これからの予約の受け方を決めておきましょう` }));
  return card;
}

function periodPicker() {
  // 今日の期間と、その前の3期間
  const cur = state.today.slice(0, 7);
  const opts = [];
  let m = Number(cur.slice(5, 7)) % 2 === 1 ? addMonths(cur, -1) : cur;
  for (let i = 0; i < 4; i++) {
    opts.push(`${m}_${addMonths(m, 1).slice(5, 7)}`);
    m = addMonths(m, -2);
  }
  const sel = el("select", { attrs: { id: "period" } });
  for (const o of opts) sel.append(el("option", { text: jpPeriod(o), attrs: { value: o, selected: o === state.period } }));
  sel.addEventListener("change", () => {
    state.period = sel.value;
    showMinpaku();
  });
  return el("div", { cls: "pick" }, [el("label", { text: "期間", attrs: { for: "period" } }), sel]);
}

function reportCard(r) {
  const left = r.days_left;
  const dueCls = left < 0 ? "danger" : left <= 7 ? "warn" : "";
  const nat = Object.entries(r.nationality).sort((a, b) => b[1] - a[1]);
  const card = el("article", { cls: "card" }, [
    el("div", { cls: "card-head" }, [
      el("div", {}, [
        // 見出しにかっこを入れない（スマホで「（2026年8月・／9月）」と割れるため）
        el("h2", { text: `${jpPeriod(r.period)}の定期報告` }),
        el("p", { cls: "lead" }, [
          `報告の期限：${jpDate(r.due_date)} `,
          left == null ? null : el("span", { cls: `pill ${dueCls}`, text: left < 0 ? `${-left}日 過ぎています` : left === 0 ? "今日まで" : `あと${left}日` }),
        ]),
      ]),
      periodPicker(),
    ]),
    el("dl", { cls: "nums" }, [num("宿泊日数", r.stay_days, "日"), num("宿泊者数", r.guests, "人"), num("延べ宿泊者数", r.guest_nights, "人")]),
    el("h3", { cls: "draft-label", text: "国籍別の宿泊者数" }),
    nat.length
      ? el("dl", { cls: "kv" }, nat.flatMap(([k, v]) => [el("dt", { text: COUNTRY[k] ?? k }), el("dd", { text: `${v}人` })]))
      : el("p", { cls: "state", text: "この期間の宿泊はまだありません" }),
    el("details", {}, [el("summary", { text: "数え方" }), el("p", { cls: "notice info", text: r.breakdown.how })]),
  ]);
  if (nat.some(([k]) => k === "UNKNOWN")) card.append(el("p", { cls: "notice warn", text: "国籍が分からない人がいます。予約サイトの情報で確かめてから報告してください" }));
  const rows = [["項目", "値"], ["期間", jpPeriod(r.period)], ["宿泊日数", r.stay_days], ["宿泊者数", r.guests], ["延べ宿泊者数", r.guest_nights]];
  for (const [k, v] of nat) rows.push([`国籍：${COUNTRY[k] ?? k}`, v]);
  const result = el("div", { attrs: { "aria-live": "polite" } });
  card.append(
    el("p", { cls: "notice info", text: "報告は、民泊制度運営システムでご本人が行います。この画面からは送りません" }),
    el("div", { cls: "btns" }, [
      btn("提出用のCSVをつくる", () => submissionCsvDownload(r.period, result), "btn primary"),
      btn("集計表のCSVをつくる", () => downloadCsv(`定期報告_集計表_${r.period}.csv`, rows), "btn"),
    ]),
    result,
    el("details", {}, [
      el("summary", { text: "提出用のCSVの形" }),
      el("p", {
        cls: "notice info",
        text: "1行目は見出し、2行目に「届出番号、期間、宿泊日数、宿泊者数、延べ宿泊者数、国籍22か国、泊まった日」。観光庁の資料は改訂されることがあり、資料によって見出しの有無もちがいます。初めて出すときは、アップロードのあとの「正常件数」が1件になったか確かめてください。集計表のCSVは見て確かめる用で、提出には使いません",
      }),
    ]),
  );
  return card;
}

// 提出用のCSV：数えるのも並べるのもサーバー（プログラム）。足りないものがあれば、つくらずに直す所を出す
async function submissionCsvDownload(period, box) {
  box.replaceChildren(loading("つくっています…"));
  let res;
  try {
    res = await fetch(`/api/minpaku/report.csv?period=${encodeURIComponent(period)}`);
  } catch {
    box.replaceChildren(el("p", { cls: "notice warn", text: "つくれませんでした。少し待ってから、もう一度押してください" }));
    return;
  }
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const parts = [el("p", { text: body.error ?? "つくれませんでした" })];
    if (body.fix === "settings") parts.push(el("a", { cls: "btn", text: "宿と部屋の設定を開く", attrs: { href: "#settings" } }));
    if (body.reservations?.length) {
      parts.push(
        el("ul", {}, body.reservations.map((x) =>
          el("li", {}, [
            `${jpDate(x.checkin_date)}に着く予約：${x.missing}人分　`,
            btn("この予約を直す", () => {
              state.ledgerEdit = x.reservation_id;
              state.loaded.ledger = false;
              go("ledger");
            }, "btn small"),
          ]),
        )),
      );
    }
    box.replaceChildren(el("div", { cls: "notice warn" }, parts));
    return;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    box.replaceChildren(el("p", { cls: "notice warn", text: errorText(new ApiError(res.status, body)) }));
    return;
  }
  const name = decodeURIComponent(res.headers.get("x-filename") ?? "report.csv");
  const url = URL.createObjectURL(await res.blob());
  const a = el("a", { attrs: { href: url, download: name } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  box.replaceChildren(el("p", { cls: "notice info", text: `${name} をつくりました。民泊制度運営システムの「CSVで一括報告」から、ご本人が出してください` }));
}

// ---- 清掃が必要な日（M18）：見るだけ。プログラムが台帳から数える ----

// 部屋の名前：宿と部屋の設定（/api/settings）から読む。読めないときは「部屋A」のように記号から作る
const ROOM_NAMES = new Map([["A", "部屋A"], ["B", "部屋B"]]);
const roomName = (room) => (room == null ? "部屋未定" : ROOM_NAMES.get(room) ?? `部屋${room}`);
const learnRooms = (list) => {
  for (const r of list ?? []) ROOM_NAMES.set(r.code, r.name);
};
// 部屋の色：並びの1番目は紺、2番目は水色、3番目からは灰色（色だけに頼らず、名前でも出す）
const roomTone = (rooms, room) => {
  const i = rooms.indexOf(room);
  return room == null ? "unknown" : i === 1 ? "b" : i >= 2 ? "c" : "a";
};

function daysFrom(today, iso) {
  const t = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(iso) - t(today)) / 86400000);
}
const whenText = (n) => (n === 0 ? "今日" : n === 1 ? "明日" : `あと${n}日`);

async function showCleaning() {
  const p = $("panel-cleaning");
  p.replaceChildren(loading("プログラムが数えています"));
  try {
    renderCleaning(await api("/api/cleaning"));
  } catch (err) {
    p.replaceChildren(errorBox(err, showCleaning));
  }
}

// 清掃の画面：日ごとに担当を選び、担当の人あての文面をコピーする（送るのはオーナー本人）
function renderCleaning(d) {
  const p = $("panel-cleaning");
  const problems = el("div", { attrs: { "aria-live": "polite" } });
  const send = async (path, body, done, ctl) => {
    if (ctl) ctl.disabled = true;
    try {
      const r = await api(path, { method: "POST", body });
      renderCleaning(r);
      toast(done(r));
    } catch (err) {
      if (ctl) ctl.disabled = false;
      problems.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
      problems.scrollIntoView({ block: "nearest" });
    }
  };
  p.replaceChildren(cleaningCard(d, send, problems), cleanersCard(d, send));
}

function cleaningCard(d, send, problems) {
  const w = d.window;
  const turnovers = d.items.filter((i) => i.turnover).length;
  const open = d.items.filter((i) => i.cleaner_id == null).length;
  const active = d.cleaners.filter((c) => c.active);
  const card = el("article", { cls: "card" }, [
    el("h2", { text: "清掃が必要な日（今日から3週間）" }),
    el("p", { cls: "lead" }, [
      `${jpDate(d.from)}〜${jpDate(d.to)}　`,
      el("b", { text: `${d.items.length}件` }),
      turnovers ? `（うち入れ替え ${turnovers}件）` : "",
      d.items.length && active.length ? `　担当まだ ${open}件` : "",
    ]),
  ]);
  if (!d.items.length) {
    card.append(el("p", { cls: "state", text: "この3週間に清掃の日はありません" }));
  } else {
    if (!active.length) card.append(el("p", { cls: "notice info", text: "下の「担当の人」で名前を登録すると、日ごとに担当を選べます" }));
    card.append(el("ul", { cls: "clean-list" }, d.items.map((i) => cleanItem(d, i, active, send))));
  }
  card.append(
    problems,
    el("details", {}, [el("summary", { text: "数え方" }), el("p", { cls: "notice info", text: d.how })]),
    el("p", { cls: "notice info", text: `清掃できる時間は ${w.checkout}〜${w.checkin}（宿の設定）。担当の人あての文面は、コピーしてご本人が送ってください。番頭は送りません` }),
  );
  return card;
}

function cleanItem(d, i, active, send) {
  const w = d.window;
  const n = daysFrom(d.today, i.date);
  const body = [
    el("p", { cls: "clean-room" }, [el("b", { text: i.room ? roomName(i.room) : "部屋が決まっていません" }), `${OTA[i.ota] ?? i.ota ?? ""}のお客様がチェックアウト`]),
    i.turnover
      ? el("p", { cls: "clean-turn" }, [el("span", { cls: "pill warn", text: "入れ替え" }), `チェックアウト〜チェックインの間（${w.checkout}〜${w.checkin}）に清掃`])
      : el("p", { cls: "clean-sub", text: `${w.checkout}以降に清掃（この日、同じ部屋のチェックインはありません）` }),
    i.check_room ? el("p", { cls: "notice warn", text: "同じ日にチェックインがあります。部屋を確かめてください" }) : null,
  ];
  // 担当を選ぶ（止めた人が担当のままなら、その人も選択肢に残す）
  const choices = [...active];
  if (i.cleaner_id != null && !i.cleaner_active) choices.push({ id: i.cleaner_id, name: `${i.cleaner_name}（止めた人）` });
  if (choices.length) {
    const id = `clean-who-${i.reservation_id}`;
    const sel = el("select", { attrs: { id } }, [
      el("option", { text: "まだ決めていない", attrs: { value: "" } }),
      ...choices.map((c) => el("option", { text: `${c.name}さん`, attrs: { value: String(c.id) } })),
    ]);
    sel.value = i.cleaner_id == null ? "" : String(i.cleaner_id);
    sel.addEventListener("change", () => {
      const cid = sel.value === "" ? null : Number(sel.value);
      const who = choices.find((c) => c.id === cid)?.name;
      send("/api/cleaning/assign", { reservation_id: i.reservation_id, cleaner_id: cid }, () => (cid == null ? "担当を「まだ決めていない」に戻しました" : `${who}さんを担当にしました`), sel);
    });
    body.push(el("div", { cls: "field clean-who" }, [el("label", { text: `${jpDate(i.date)}の担当`, attrs: { for: id } }), sel]));
  }
  if (i.reassign) {
    const what = i.reassign_reason === "room" ? "部屋" : "チェックアウトの日";
    body.push(el("p", { cls: "notice warn", text: `${what}が変わったので、前に決めた担当は外しました。選び直してください（前に送った文面とちがいます）` }));
  }
  if (i.cleaner_id != null && !i.cleaner_active) body.push(el("p", { cls: "notice warn", text: `${i.cleaner_name}さんは止めています。担当を替えてください` }));
  if (i.same_day >= 2) body.push(el("p", { cls: "notice warn", text: `${i.cleaner_name}さんは、この日${i.same_day}部屋の担当です。時間が足りるか確かめてください` }));
  if (i.message) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(i.message);
        toast("コピーしました。送るのはご本人です");
      } catch {
        toast("コピーできませんでした。下の文面を長押しして写してください");
      }
    };
    body.push(
      el("div", { cls: "btns" }, [btn("文面をコピー", copy, "btn small")]),
      el("details", {}, [el("summary", { text: `${i.cleaner_name}さんあての文面を見る` }), el("p", { cls: "draft-text", text: i.message })]),
    );
  }
  return el("li", { cls: i.turnover ? "is-turnover" : "" }, [
    el("div", { cls: "clean-date" }, [el("b", { text: jpDate(i.date) }), el("span", { text: whenText(n) })]),
    el("div", { cls: "clean-body" }, body),
  ]);
}

function cleanersCard(d, send) {
  const items = d.cleaners.map((c) => {
    const id = `cleaner-${c.id}`;
    const name = el("input", { cls: "text-in", attrs: { id, type: "text", maxlength: "20", autocomplete: "off" } });
    name.value = c.name;
    return el("li", { cls: `room-item${c.active ? "" : " is-off"}` }, [
      el("div", { cls: "field" }, [el("label", { text: "名前", attrs: { for: id } }), name]),
      el("p", { cls: "room-facts" }, [
        el("span", { cls: c.active ? "pill ok" : "pill", text: c.active ? "頼んでいる" : "止めている" }),
        c.upcoming ? `この3週間の担当 ${c.upcoming}件` : "この3週間の担当はありません",
      ]),
      el("div", { cls: "btns" }, [
        btn("名前を保存", () => send(`/api/cleaners/${c.id}`, { name: name.value }, () => "名前を保存しました"), "btn small"),
        c.active
          ? btn("この人を止める", () => send(`/api/cleaners/${c.id}`, { active: false }, () => `${c.name}さんを止めました`), "btn small")
          : btn("また頼む", () => send(`/api/cleaners/${c.id}`, { active: true }, () => `${c.name}さんをまた選べるようにしました`), "btn small"),
      ]),
    ]);
  });
  const addName = el("input", { cls: "text-in", attrs: { id: "cleaner-new", type: "text", maxlength: "20", autocomplete: "off", placeholder: "例：山田さん" } });
  const canAdd = d.cleaners.length < d.max_cleaners;
  return el("article", { cls: "card" }, [
    el("h2", { text: "担当の人" }),
    el("p", { cls: "lead", text: "清掃をお願いしている人の名前を登録します。登録した人を、上の日ごとに選べます" }),
    items.length ? el("ul", { cls: "room-list" }, items) : el("p", { cls: "state", text: "まだ登録されていません" }),
    canAdd
      ? el("div", { cls: "room-add" }, [
          el("div", { cls: "field" }, [el("label", { text: "担当の人を足す（名前）", attrs: { for: "cleaner-new" } }), addName]),
          el("div", { cls: "btns" }, [btn("担当の人を足す", () => send("/api/cleaners", { name: addName.value }, () => "担当の人を足しました"), "btn primary")]),
        ])
      : el("p", { cls: "notice info", text: `担当の人は${d.max_cleaners}人までです` }),
    el("p", { cls: "notice info", text: "番頭が預かるのは名前だけです（電話番号などの連絡先は入れません）。呼び名でも登録できます。止めた人は、これまでの記録のために残ります。名前を消したいときは「元担当1」などに書き替えてください。この3週間の担当がある人は、先に担当を替えるまで止められません" }),
  ]);
}

// ---- 宿泊カレンダー（M21）：見るだけ。プログラムが台帳から並べる ----
// 1か月を7列の表で出す（横スクロールなし）。日を押すと、その日の部屋ごとの様子を下に出す。
// 部屋は色だけでなく「A」「B」の文字で出す。宿泊者の名前は出さない（サーバーも読まない）

// カレンダーに並べる部屋（記号）。開いた月の答え（rooms）で入れ替える
let CAL_LIST = ["A", "B"];

async function showCalendar() {
  const p = $("panel-calendar");
  const head = [el("h2", { cls: "h2", text: "宿泊カレンダー" }), calMonths()];
  p.replaceChildren(...head, loading("プログラムが数えています"));
  try {
    const d = await api(`/api/calendar?month=${encodeURIComponent(state.calMonth)}`);
    learnRooms(d.room_list);
    CAL_LIST = d.rooms;
    if (!d.days.some((x) => x.date === state.calDay)) {
      const first = d.days.find((x) => x.is_today) ?? d.days.find((x) => x.stays.length || x.departures.length) ?? d.days[0];
      state.calDay = first.date;
    }
    p.replaceChildren(...head, calCard(d));
  } catch (err) {
    p.replaceChildren(...head, errorBox(err, showCalendar));
  }
}

// 月の切り替え：3か月前から、半年先まで
function calMonths() {
  const now = state.today.slice(0, 7);
  const cur = state.calMonth;
  const prev = addMonths(cur, -1);
  const next = addMonths(cur, 1);
  const move = (m) => () => {
    state.calMonth = m;
    showCalendar();
  };
  const back = btn(`◀ ${shortMonth(prev)}`, move(prev), "btn small");
  back.disabled = prev < addMonths(now, -3);
  back.setAttribute("aria-label", `前の月（${jpMonth(prev)}）を見る`);
  const fwd = btn(`${shortMonth(next)} ▶`, move(next), "btn small");
  fwd.disabled = next > addMonths(now, 6);
  fwd.setAttribute("aria-label", `次の月（${jpMonth(next)}）を見る`);
  const label = el("p", { cls: "now", attrs: { "aria-live": "polite" } }, [jpMonth(cur), cur === now ? el("small", { text: "今月" }) : null]);
  return el("div", { cls: "months" }, [back, label, fwd]);
}

// 見かたは2つ：「週」（部屋ごとの横の帯。入る日の午後から、出る日の午前まで。1か月を横にずらして見る）と「月」（7列の表。文字なしで泊まりと清掃の日だけ）
const CAL_VIEWS = [
  ["bar", "週で見る"],
  ["month", "月で見る"],
];
const dayNo = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const sameRoom = (a, b) => (a ?? null) === (b ?? null);

// その月に関わる予約（月の1日に出ていく予約も入れる）。同じ部屋で重なる予約は段を分ける
function calBookings(d) {
  const seen = new Map();
  for (const day of d.days) for (const r of [...day.stays, ...day.departures]) if (!seen.has(r.reservation_id)) seen.set(r.reservation_id, r);
  const list = [...seen.values()].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date) || String(a.reservation_id).localeCompare(String(b.reservation_id)));
  const lanes = new Map();
  return list.map((r) => {
    const key = r.room ?? "none";
    const ends = lanes.get(key) ?? [];
    let lane = ends.findIndex((end) => end <= r.checkin_date);
    if (lane < 0) lane = ends.push("") - 1;
    ends[lane] = r.checkout_date;
    lanes.set(key, ends);
    const over = list.some((o) => o !== r && sameRoom(o.room, r.room) && o.checkin_date < r.checkout_date && r.checkin_date < o.checkout_date);
    const turn = list.some((o) => o !== r && r.room && o.room === r.room && o.checkin_date === r.checkout_date);
    return { r, lane, over, turn, key, lanes: () => lanes.get(key).length };
  });
}

function calCard(d) {
  const s = d.summary;
  const view = state.calView === "month" ? "month" : "bar";
  const books = calBookings(d);
  const hasUnknown = books.some((b) => !b.r.room);
  const hasOver = books.some((b) => b.over);
  const hasTurn = books.some((b) => b.turn);
  // 開いたとき最初に見えるのはカレンダー。月の合計は、カレンダーの下に細い1列で出す
  const card = el("article", { cls: "card cal-card" });
  const totals = el("dl", { cls: "nums cal-totals", attrs: { "aria-label": `${shortMonth(d.month)}の合計` } }, [
    ...CAL_LIST.map((code) => num(roomName(code), s.nights[code] ?? 0, "泊")),
    s.nights.unknown ? num("部屋未定", s.nights.unknown, "泊", "is-warn") : null,
    num("チェックアウト", s.departures, "件"),
  ]);
  if (!s.reservations) card.append(el("p", { cls: "state", text: `${shortMonth(d.month)}に泊まる予約はまだありません` }));
  if (d.overlaps.length) {
    const where = d.overlaps.map((o) => `${jpDate(o.date, false)}（${o.rooms.map(roomName).join("・")}）`).join("、");
    card.append(el("p", { cls: "notice danger", text: `同じ部屋に2つの予約が重なっている夜があります：${where}。台帳を確かめてください` }));
  }

  // 見かたの切り替え（押すと、このカードだけ描き直す）
  const views = el(
    "div",
    { cls: "cal-views", attrs: { role: "group", "aria-label": "見かたの切り替え" } },
    CAL_VIEWS.map(([v, label]) => {
      const b = btn(label, () => {
        if (v === view) return;
        state.calView = v;
        const next = calCard(d);
        card.replaceWith(next);
        next.querySelector('.cal-views [aria-pressed="true"]')?.focus();
      }, "btn small");
      b.setAttribute("aria-pressed", String(v === view));
      return b;
    }),
  );
  card.append(views);

  // 押したもの（日 or 予約）の中身を下に出す
  const detail = el("div", { cls: "cal-detail", attrs: { "aria-live": "polite" } });
  const pickOf = () => (state.calStay && books.some((b) => b.r.reservation_id === state.calStay) ? `s:${state.calStay}` : `d:${state.calDay}`);
  const show = () => {
    const pick = pickOf();
    for (const b of card.querySelectorAll("[data-pick]")) b.setAttribute("aria-pressed", String(b.dataset.pick === pick));
    if (pick.startsWith("s:")) {
      const b = books.find((x) => x.r.reservation_id === state.calStay);
      detail.replaceChildren(...calStayDetail(d, b));
    } else {
      detail.replaceChildren(...calDetail(d, d.days.find((x) => x.date === state.calDay)));
    }
  };
  const pickDay = (day) => () => {
    state.calDay = day.date;
    state.calStay = null;
    show();
  };
  const pickStay = (b) => () => {
    state.calStay = b.r.reservation_id;
    show();
  };
  card.append(
    view === "bar" ? calTimeline(d, books, pickDay, pickStay) : calMonthGrid(d, pickDay, hasUnknown),
    calLegend(view, { hasUnknown, hasOver, hasTurn }),
    totals,
    detail,
  );
  show();
  card.append(
    el("details", {}, [el("summary", { text: "数え方" }), el("p", { cls: "notice info", text: d.how })]),
    el("p", { cls: "notice info", text: "この画面は見るだけです。予約は「予約の台帳」、清掃の担当は「清掃」の画面で決めます" }),
  );
  return card;
}

// 清掃の担当（清掃の画面で決めたもの）。止めた人は「決まっていない」とみなす
const cleanAssigned = (r) => Boolean(r.cleaner_name && r.cleaner_active);
// その日のチェックアウトすべてに担当が決まっていれば、印にチェックを付ける
const cleanDone = (day) => day.departures.length > 0 && day.departures.every(cleanAssigned);
function cleanWhoLabel(day) {
  const n = day.departures.filter(cleanAssigned).length;
  if (n === day.departures.length) return "担当は決まっています";
  return n ? `担当は${day.departures.length}件のうち${n}件決まっています` : "担当はまだ決まっていません";
}
// 予約の詳細で使う：その予約の、出る日のチェックアウト（担当つき）
const calOut = (d, r) => d.days.find((x) => x.date === r.checkout_date)?.departures.find((o) => o.reservation_id === r.reservation_id) ?? null;
function cleanWhoLine(r) {
  if (!r) return null;
  if (cleanAssigned(r)) return el("p", { cls: "cal-sub", text: `清掃の担当：${r.cleaner_name}さん` });
  if (r.cleaner_name) return el("p", { cls: "notice warn", text: `清掃の担当（${r.cleaner_name}さん）は止めた人です。「清掃」の画面で選び直してください` });
  return el("p", { cls: "cal-sub", text: "清掃の担当：まだ決めていません" });
}

// 見かたの説明（色だけで伝えない。言葉を添える）
function calLegend(view, f) {
  const sw = (cls) => el("span", { cls: `sw ${cls}`, attrs: { "aria-hidden": "true" } });
  const items =
    view === "bar"
      ? [
          el("li", {}, [sw("bar"), "泊まり（入る日の午後〜出る日の午前）"]),
          f.hasUnknown ? el("li", {}, [sw("bar unknown"), "部屋が決まっていない予約"]) : null,
          f.hasOver ? el("li", {}, [sw("bar over"), "同じ部屋で重なっている予約"]) : null,
          el("li", {}, [sw("clean"), "清掃の日（チェックアウトの日）"]),
          el("li", {}, [sw("clean done"), "清掃の担当が決まった日"]),
          f.hasTurn ? el("li", {}, [sw("clean turn"), "入れ替え（同じ日に次の人が入る）"]) : null,
        ]
      : [
          ...CAL_LIST.map((room, i) => el("li", {}, [sw(`lane ${roomTone(CAL_LIST, room)}`), `上から${i + 1}本目：${roomName(room)}の泊まり`])),
          f.hasUnknown ? el("li", {}, [sw("lane unknown"), "部屋未定の泊まり"]) : null,
          el("li", {}, [sw("clean"), "清掃の日"]),
          el("li", {}, [sw("clean done"), "清掃の担当が決まった日"]),
          f.hasTurn ? el("li", {}, [sw("clean turn"), "入れ替えの日"]) : null,
        ];
  return el("ul", { cls: "cal-legend", attrs: { "aria-label": "見かた" } }, items);
}

// 週で見る：部屋ごとの行 × 日（1日を午前・午後の2つに分ける）。いつも1か月を横1列。入りきらない画面では横にずらす（部屋の名前の列は左に止まる）
function calTimeline(d, books, pickDay, pickStay) {
  const first = dayNo(d.days[0].date);
  const last = dayNo(d.days[d.days.length - 1].date);
  const scroller = el(
    "div",
    { cls: "tl-scroll", attrs: { role: "region", tabindex: "0", "aria-label": `${jpMonth(d.month)}の宿泊の帯。横にずらせます。帯を押すと予約の中身、日付を押すとその日の様子が下に出ます` } },
    [calBlock(d, books, first, d.days.length, first, last, pickDay, pickStay)],
  );
  const hint = el("p", { cls: "tl-hint", text: "横にずらせます", attrs: { "aria-hidden": "true" } });
  const wrap = el("div", { cls: "tl" }, [hint, scroller]);
  // 画面に出たあと：入りきらないときだけ案内を出し、選んでいる日（ふだんは今日）が左のほうに来るようにずらす
  let tries = 0;
  const settle = () => {
    if (!scroller.isConnected) {
      if (++tries < 30) setTimeout(settle, 30);
      return;
    }
    if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
    wrap.classList.add("can-scroll");
    const day = scroller.querySelector(`.tl-day[data-pick="d:${state.calDay}"]`) ?? scroller.querySelector('.tl-day[aria-current="date"]');
    const lab = scroller.querySelector(".tl-labbg");
    if (day && lab) scroller.scrollLeft = Math.max(0, day.offsetLeft - lab.offsetWidth - day.offsetWidth);
  };
  setTimeout(settle, 0);
  return wrap;
}

// 1段ぶん（start の日から n 日）。first〜last はその月の範囲（月の外は描かない）
function calBlock(d, books, start, n, first, last, pickDay, pickStay) {
  const byNo = new Map(d.days.map((x) => [dayNo(x.date), x]));
  const lo = Math.max(start, first);
  const hi = Math.min(start + n - 1, last);
  const rooms = CAL_LIST.map((code) => [code, roomName(code)]);
  if (books.some((b) => !b.r.room)) rooms.push(["none", "未定"]);
  const laneCount = (key) => Math.max(1, ...books.filter((b) => b.key === key).map((b) => b.lanes()));
  const rowOf = new Map();
  let row = 2;
  for (const [key] of rooms) {
    rowOf.set(key, row);
    row += laneCount(key);
  }
  const cleanRow = row;
  const grid = el("div", { cls: `tl-grid n${n}` });
  const put = (node, col, r) => {
    node.style.gridColumn = col;
    node.style.gridRow = r;
    grid.append(node);
    return node;
  };
  const colOf = (no) => 2 + 2 * (no - start);

  // 左の列の下じき（横にずらしたとき、帯や土日の色がこの下を通る）
  put(el("span", { cls: "tl-labbg", attrs: { "aria-hidden": "true" } }), "1", `1 / ${cleanRow + 1}`);
  // 日付・曜日の見出しの帯（本体の行と分けて見せる）。左上の角も同じ色にそろえる
  put(el("span", { cls: "tl-head", attrs: { "aria-hidden": "true" } }), "2 / -1", "1");
  put(el("span", { cls: "tl-corner", attrs: { "aria-hidden": "true" } }), "1", "1");
  // 日付の見出しと、背景（土日・今日）
  for (let no = start; no < start + n; no++) {
    const day = byNo.get(no);
    if (!day) continue;
    const wd = new Date(no * 86400000).getUTCDay();
    const tone = [wd === 0 ? "is-sun" : wd === 6 ? "is-sat" : "", day.is_today ? "is-today" : ""].filter(Boolean).join(" ");
    put(el("span", { cls: `tl-bg ${tone}`, attrs: { "aria-hidden": "true" } }), `${colOf(no)} / span 2`, `1 / ${cleanRow + 1}`);
    put(
      el(
        "button",
        {
          cls: `tl-day ${tone}`,
          attrs: { type: "button", "data-pick": `d:${day.date}`, "aria-label": calDayLabel(day), "aria-current": day.is_today ? "date" : null },
          on: { click: pickDay(day) },
        },
        [el("span", { cls: "n", text: Number(day.date.slice(8)) }), el("span", { cls: "w", text: WD[wd] })],
      ),
      `${colOf(no)} / span 2`,
      "1",
    );
  }
  // 部屋の名前（行の見出し）
  for (const [key, label] of rooms) put(el("span", { cls: `tl-room${key === "none" ? " is-warn" : ""}`, text: label }), "1", `${rowOf.get(key)} / span ${laneCount(key)}`);
  put(el("span", { cls: "tl-room", text: "清掃" }), "1", String(cleanRow));

  // 泊まりの帯：入る日の午後から、出る日の午前まで
  for (const b of books) {
    const ci = dayNo(b.r.checkin_date);
    const co = dayNo(b.r.checkout_date);
    if (co < lo || ci > hi) continue;
    const s = ci >= lo ? colOf(ci) + 1 : colOf(lo);
    const e = co <= hi ? colOf(co) + 1 : colOf(hi) + 2;
    const cls = ["tl-bar", b.r.room ? `room-${roomTone(CAL_LIST, b.r.room)}` : "", !b.r.room ? "unknown" : "", b.over ? "over" : "", ci < lo ? "cont-l" : "", co > hi ? "cont-r" : ""].filter(Boolean).join(" ");
    const label = `${roomName(b.r.room)}：${OTA[b.r.ota] ?? b.r.ota ?? "予約"}、${jpDate(b.r.checkin_date, false)}から${jpDate(b.r.checkout_date, false)}まで${b.r.nights}泊（${PEOPLE(b.r)}）${b.over ? "。重なりあり" : ""}`;
    // 月の境目で切れた短い切れ端（1日半より短い）は文字を出さない。読み上げ用の説明は残す
    put(
      el("button", { cls, text: e - s >= 3 ? `${b.r.nights}泊` : "", attrs: { type: "button", "data-pick": `s:${b.r.reservation_id}`, "aria-label": label }, on: { click: pickStay(b) } }),
      `${s} / ${e}`,
      String(rowOf.get(b.key) + b.lane),
    );
  }
  // 清掃の印：チェックアウトの日
  for (let no = lo; no <= hi; no++) {
    const day = byNo.get(no);
    if (!day?.departures.length) continue;
    const turn = day.departures.some((r) => r.room && day.stays.some((st) => st.arrives && st.room === r.room));
    const done = cleanDone(day);
    put(
      el("button", {
        cls: `tl-clean${turn ? " turn" : ""}${done ? " done" : ""}`,
        attrs: { type: "button", "data-pick": `d:${day.date}`, "aria-label": `${jpDate(day.date)}：清掃${turn ? "（入れ替え）" : ""}。チェックアウト${day.departures.length}件。${cleanWhoLabel(day)}` },
        on: { click: pickDay(day) },
      }),
      `${colOf(no)} / span 2`,
      String(cleanRow),
    );
  }
  return grid;
}

// 月で見る：7列の表。文字は日付だけ。線＝泊まった夜（午前・午後に分ける）、四角い印＝清掃の日
function calMonthGrid(d, pickDay, hasUnknown) {
  const grid = el("div", { cls: "cal cal-min", attrs: { role: "group", "aria-label": `${jpMonth(d.month)}の宿泊カレンダー。日を押すと、その日の部屋の様子が下に出ます` } });
  for (const w of WD) grid.append(el("span", { cls: "cal-wd", text: w, attrs: { "aria-hidden": "true" } }));
  for (let i = 0; i < d.first_weekday; i++) grid.append(el("span", { cls: "cal-blank", attrs: { "aria-hidden": "true" } }));
  const lanes = hasUnknown ? [...CAL_LIST, null] : CAL_LIST;
  for (const day of d.days) {
    const lane = (room) => {
      const am = day.departures.some((r) => sameRoom(r.room, room)) || day.stays.some((st) => sameRoom(st.room, room) && !st.arrives);
      const pm = day.stays.filter((st) => sameRoom(st.room, room)).length;
      const cls = ["mn-lane", roomTone(CAL_LIST, room), pm > 1 ? "over" : ""].filter(Boolean).join(" ");
      return el("span", { cls, attrs: { "aria-hidden": "true" } }, [el("span", { cls: am ? "h on" : "h" }), el("span", { cls: pm ? "h on" : "h" })]);
    };
    const turn = day.departures.some((r) => r.room && day.stays.some((st) => st.arrives && st.room === r.room));
    const cls = ["cal-day", day.is_today ? "is-today" : "", day.overlap_rooms.length ? "is-overlap" : ""].filter(Boolean).join(" ");
    grid.append(
      el(
        "button",
        { cls, attrs: { type: "button", "data-pick": `d:${day.date}`, "aria-label": calDayLabel(day), "aria-current": day.is_today ? "date" : null }, on: { click: pickDay(day) } },
        [
          el("span", { cls: "n", text: Number(day.date.slice(8)) }),
          el("span", { cls: "mn-lanes" }, lanes.map(lane)),
          day.departures.length ? el("span", { cls: `mn-clean${turn ? " turn" : ""}${cleanDone(day) ? " done" : ""}`, attrs: { "aria-hidden": "true" } }) : null,
        ],
      ),
    );
  }
  return grid;
}

// 下の欄：押した予約の中身（名前は出さない）
function calStayDetail(d, b) {
  const { r } = b;
  const w = d.window;
  const lines = [
    el("p", {}, [el("span", { cls: "pill ok", text: "チェックイン" }), `${jpDate(r.checkin_date)} ${w.checkin}から`]),
    el("p", {}, [el("span", { cls: "pill out", text: "チェックアウト" }), `${jpDate(r.checkout_date)} ${w.checkout}まで`]),
    el("p", { text: `${r.nights}泊・${PEOPLE(r)}` }),
    b.turn
      ? el("p", { cls: "clean-turn" }, [el("span", { cls: "pill warn", text: "入れ替え" }), `${jpDate(r.checkout_date, false)}の${w.checkout}〜${w.checkin}の間に清掃（同じ日に次の人が入ります）`])
      : el("p", { cls: "cal-sub", text: `清掃：${jpDate(r.checkout_date, false)}の${w.checkout}以降` }),
    cleanWhoLine(calOut(d, r)),
    !r.room ? el("p", { cls: "notice warn", text: "部屋が決まっていない予約です。台帳で部屋を確かめてください" }) : null,
    b.over ? el("p", { cls: "notice danger", text: `${roomName(r.room)}で別の予約と重なっています。台帳を確かめてください` }) : null,
  ];
  const out = [
    el("h3", { cls: "cal-detail-h", text: `${OTA[r.ota] ?? r.ota ?? ""}の予約` }),
    el("ul", { cls: "cal-rooms" }, [calRoomCard(roomName(r.room), `${r.nights}泊`, true, lines)]),
  ];
  const n = daysFrom(d.today, r.checkout_date);
  if (n >= 0 && n < 21) out.push(el("div", { cls: "btns" }, [btn("清掃が必要な日を開く", () => go("cleaning"), "btn small")]));
  return out;
}

// 部屋のカード：上に見出しの帯（部屋名と様子）、下に中身
function calRoomCard(name, state, busy, lines) {
  const body = lines.filter(Boolean);
  return el("li", { cls: busy ? "is-busy" : "" }, [
    el("div", { cls: "cal-room-head" }, [el("p", { cls: "cal-room", text: name }), el("span", { cls: "cal-room-state", text: state })]),
    body.length ? el("div", { cls: "cal-room-body" }, body) : null,
  ]);
}

// 読み上げ用：その日の様子を言葉で
function calDayLabel(day) {
  const parts = CAL_LIST.map((room) => {
    const n = day.stays.filter((s) => s.room === room).length;
    return `${roomName(room)} ${n > 1 ? `${n}件重なり` : n ? "泊まり" : "空き"}`;
  });
  const unknown = day.stays.filter((s) => !s.room).length;
  if (unknown) parts.push(`部屋未定 ${unknown}件`);
  if (day.departures.length) parts.push(`チェックアウト ${day.departures.length}件（清掃。${cleanWhoLabel(day)}）`);
  return `${jpDate(day.date)}${day.is_today ? "・今日" : ""}：${parts.join("、")}`;
}

// 下の欄：選んだ日の、部屋ごとの様子
function calDetail(d, day) {
  const w = d.window;
  const items = [];
  for (const room of [...CAL_LIST, null]) {
    const stays = day.stays.filter((s) => s.room === room);
    const outs = day.departures.filter((r) => r.room === room);
    if (room === null && !stays.length && !outs.length) continue;
    const lines = [];
    for (const r of outs) lines.push(el("p", {}, [el("span", { cls: "pill out", text: "チェックアウト" }), `${OTA[r.ota] ?? r.ota ?? ""}（${PEOPLE(r)}）`]), cleanWhoLine(r));
    for (const st of stays) {
      lines.push(
        el("p", {}, [
          el("span", { cls: st.arrives ? "pill ok" : "pill", text: st.arrives ? "チェックイン" : "泊まり" }),
          `${OTA[st.ota] ?? st.ota ?? ""}（${PEOPLE(st)}）`,
          el("span", { cls: "cal-sub", text: st.arrives ? `${st.nights}泊の1泊目` : `${st.nights}泊のうち${st.night_no}泊目` }),
        ]),
      );
    }
    if (outs.length) {
      const turnover = room && stays.some((st) => st.arrives);
      lines.push(
        turnover
          ? el("p", { cls: "clean-turn" }, [el("span", { cls: "pill warn", text: "入れ替え" }), `${w.checkout}〜${w.checkin}の間に清掃`])
          : el("p", { cls: "cal-sub", text: room ? `${w.checkout}以降に清掃（この夜は空きます）` : `${w.checkout}以降に清掃` }),
      );
    }
    if (room === null) lines.push(el("p", { cls: "notice warn", text: "部屋が決まっていない予約です。台帳で部屋を確かめてください" }));
    if (room && stays.length > 1) lines.push(el("p", { cls: "notice danger", text: `${roomName(room)}に${stays.length}つの予約が重なっています。台帳を確かめてください` }));
    const state = stays.length > 1 ? "重なり" : stays.length ? "泊まりあり" : "空き";
    items.push(calRoomCard(roomName(room), state, stays.length > 0, lines));
  }
  const out = [el("h3", { cls: "cal-detail-h", text: `${jpDate(day.date)}${day.is_today ? "・今日" : ""}` }), el("ul", { cls: "cal-rooms" }, items)];
  const n = daysFrom(d.today, day.date);
  if (day.departures.length && n >= 0 && n < 21) out.push(el("div", { cls: "btns" }, [btn("清掃が必要な日を開く", () => go("cleaning"), "btn small")]));
  return out;
}

// ---- 宿と部屋の設定：オーナーが入れる。AIは使わない ----
// 届出番号は定期報告のCSVに、清掃の時間はカレンダーと清掃の画面に、部屋はカレンダー・清掃・値付けの知らせに使う

const INN_FORM = [
  ["name", "宿の名前", "text", { maxlength: "40", required: true }],
  ["address", "住所（任意）", "text", { maxlength: "100" }],
  ["notification_no", "届出番号（定期報告のCSVに入ります）", "text", { maxlength: "30", inputmode: "latin", placeholder: "例：M000000000" }],
  ["cleaning_checkout_time", "チェックアウトの時刻", "time", {}],
  ["cleaning_checkin_time", "チェックインの時刻", "time", {}],
  ["cleaning_fee", "清掃1回の費用（円・任意）", "text", { inputmode: "numeric", maxlength: "9" }],
  ["min_price", "1泊のいちばん安い値段（円・任意）", "text", { inputmode: "numeric", maxlength: "9" }],
  ["price_l1", "料金のレベル1（円・空きやすい日）", "text", { inputmode: "numeric", maxlength: "9" }],
  ["price_l2", "料金のレベル2（円・ふだんの日）", "text", { inputmode: "numeric", maxlength: "9" }],
  ["price_l3", "料金のレベル3（円・混む日）", "text", { inputmode: "numeric", maxlength: "9" }],
  ["price_l4", "料金のレベル4（円・年末年始・お盆）", "text", { inputmode: "numeric", maxlength: "9" }],
];

// 宿泊税の申告書（宮崎市 様式第10号）に書くこと。どれも任意。空なら申告書のその欄は空けて出す
const INN_TAX_FORM = [
  ["collector_address", "特別徴収義務者の住所（所在地）", "text", { maxlength: "100", autocomplete: "off" }],
  ["collector_name", "特別徴収義務者の氏名（名称）", "text", { maxlength: "60", autocomplete: "off" }],
  ["corporate_no", "法人番号（13けた・個人の方は空のまま）", "text", { inputmode: "numeric", maxlength: "20", autocomplete: "off" }],
  ["inn_phone", "宿の電話番号", "tel", { maxlength: "20", placeholder: "例：0985-00-0000", autocomplete: "off" }],
  ["facility_no", "施設番号（市から知らされた番号）", "text", { maxlength: "20", inputmode: "latin", autocomplete: "off" }],
  ["contact_name", "担当者", "text", { maxlength: "30", autocomplete: "off" }],
  ["contact_phone", "担当者の電話番号", "tel", { maxlength: "20", placeholder: "例：090-0000-0000", autocomplete: "off" }],
];

async function showSettings() {
  const p = $("panel-settings");
  p.replaceChildren(loading("読み込んでいます"));
  try {
    renderSettings(await api("/api/settings"));
  } catch (err) {
    p.replaceChildren(errorBox(err, showSettings));
  }
}

// 設定が変わったら、ほかの画面は次に開いたときに読み直す
function settingsChanged(d) {
  learnRooms(d.rooms);
  $("inn-name").textContent = d.inn.name ?? "宿の名前が未設定です";
  state.loaded = { settings: true };
}

function renderSettings(d) {
  $("panel-settings").replaceChildren(el("h2", { cls: "h2", text: "宿と部屋の設定" }), innCard(d), roomsCard(d));
}

function innCard(d) {
  const inputs = {};
  const problems = el("div", { attrs: { "aria-live": "polite" } });
  const row = ([k, label, type, extra]) => {
    const i = el("input", { cls: "text-in", attrs: { id: `set-${k}`, type, ...extra } });
    i.value = d.inn[k] ?? "";
    inputs[k] = i;
    return el("div", { cls: "field" }, [el("label", { text: label, attrs: { for: `set-${k}` } }), i]);
  };
  const save = async () => {
    // 変えた項目だけ送る
    const patch = {};
    for (const [k, i] of Object.entries(inputs)) if (i.value !== String(d.inn[k] ?? "")) patch[k] = i.value;
    if (!Object.keys(patch).length) {
      problems.replaceChildren(el("p", { cls: "notice info", text: "変わったところはありません" }));
      return;
    }
    try {
      const r = await api("/api/settings/inn", { method: "POST", body: patch });
      settingsChanged(r);
      renderSettings(r);
      toast("宿の設定を保存しました");
    } catch (err) {
      problems.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  };
  return el("article", { cls: "card" }, [
    el("h2", { text: "宿の設定" }),
    el("div", { cls: "fields" }, INN_FORM.map(row)),
    el("h3", { cls: "set-sub", text: "宿泊税の申告書に書くこと（任意）" }),
    el("p", { cls: "sub", text: "宿泊税の画面の「申告書をつくる」で、宮崎市の様式に入ります。空の欄は、申告書でも空けたままにします（手で書けます）" }),
    el("div", { cls: "fields" }, INN_TAX_FORM.map(row)),
    problems,
    el("div", { cls: "btns" }, [btn("保存する", save, "btn primary")]),
  ]);
}

function roomsCard(d) {
  const problems = el("div", { attrs: { "aria-live": "polite" } });
  const send = async (path, body, done) => {
    try {
      const r = await api(path, { method: "POST", body });
      settingsChanged(r);
      renderSettings(r);
      toast(done);
    } catch (err) {
      problems.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  };
  const items = d.rooms.map((room) => {
    const name = el("input", { cls: "text-in", attrs: { id: `room-${room.code}`, type: "text", maxlength: "20" } });
    name.value = room.name;
    const facts = [
      el("span", { cls: room.active ? "pill ok" : "pill", text: room.active ? "使っている" : "止めている" }),
      room.upcoming ? `これからの予約 ${room.upcoming}件` : "これからの予約はありません",
    ];
    return el("li", { cls: `room-item${room.active ? "" : " is-off"}` }, [
      el("div", { cls: "field" }, [el("label", { text: `部屋の名前（記号 ${room.code}）`, attrs: { for: `room-${room.code}` } }), name]),
      el("p", { cls: "room-facts" }, facts),
      el("div", { cls: "btns" }, [
        btn("名前を保存", () => send(`/api/rooms/${room.code}`, { name: name.value }, "部屋の名前を保存しました"), "btn small"),
        room.active
          ? btn("この部屋を止める", () => send(`/api/rooms/${room.code}`, { active: false }, `${room.name}を止めました`), "btn small")
          : btn("また使う", () => send(`/api/rooms/${room.code}`, { active: true }, `${room.name}をまた使います`), "btn small"),
      ]),
    ]);
  });
  const addName = el("input", { cls: "text-in", attrs: { id: "room-new", type: "text", maxlength: "20", placeholder: "例：離れ（2階）" } });
  const canAdd = d.rooms.length < d.max_rooms;
  return el("article", { cls: "card" }, [
    el("h2", { text: "部屋" }),
    el("p", { cls: "lead", text: "カレンダー・清掃・値付けの知らせは、ここで使っている部屋で数えます" }),
    el("ul", { cls: "room-list" }, items),
    problems,
    canAdd
      ? el("div", { cls: "room-add" }, [
          el("div", { cls: "field" }, [el("label", { text: "部屋を足す（名前）", attrs: { for: "room-new" } }), addName]),
          el("div", { cls: "btns" }, [btn("部屋を足す", () => send("/api/rooms", { name: addName.value }, "部屋を足しました"), "btn primary")]),
        ])
      : el("p", { cls: "notice info", text: `部屋は${d.max_rooms}部屋までです` }),
    el("p", { cls: "notice info", text: "部屋の記号（A・B…）は自動で付き、あとから変わりません。止めた部屋は、過去の予約のために残ります。これからの予約がある部屋は、先に予約の部屋を移すまで止められません" }),
  ]);
}

// ---- 予約の台帳：手で入れる・直す・取り消す（名前は預からない。名簿は別に作る） ----

const OTA_PICK = [["airbnb", "Airbnb"], ["booking", "Booking.com"], ["rakuten", "楽天トラベル"], ["direct", "直接予約"], ["unknown", "そのほか・分からない"]];
const TAX_PICK = [
  ["unknown", "分からない"],
  ["ota", "予約サイトで払い済み"],
  ["included", "宿の料金に入れて受け取った"],
  ["onsite", "チェックインの時に受け取る"],
];
// 定期報告の国籍の欄と同じ並び
const NAT_PICK = ["JP", "KR", "TW", "HK", "CN", "TH", "SG", "MY", "ID", "PH", "VN", "IN", "GB", "DE", "FR", "IT", "ES", "RU", "US", "CA", "AU", "OTHER"];

async function showLedger() {
  const p = $("panel-ledger");
  p.replaceChildren(loading("読み込んでいます"));
  try {
    renderLedger(await api("/api/ledger"));
  } catch (err) {
    p.replaceChildren(errorBox(err, showLedger));
  }
}

// 台帳が変わったら、ほかの画面（カレンダー・数字・定期報告など）は次に開いたときに読み直す
function ledgerChanged(d, note, warn) {
  state.loaded = { ledger: true };
  renderLedger(d, note ? el("p", { cls: `notice ${warn ? "warn" : "ok"}`, text: note }) : null);
}

function renderLedger(d, note = null) {
  learnRooms(d.all_rooms);
  const p = $("panel-ledger");
  const formBox = el("div", { attrs: { id: "ledger-form" } });
  const openForm = (r) => {
    formBox.replaceChildren(resForm(d, r, () => formBox.replaceChildren()));
    formBox.scrollIntoView({ block: "start" });
    formBox.querySelector("select, input")?.focus();
  };
  const live = d.reservations.filter((r) => r.status === "confirmed");
  const ahead = live.filter((r) => r.checkout_date > d.today);
  const past = live.filter((r) => r.checkout_date <= d.today).reverse();
  const cancelled = d.reservations.filter((r) => r.status !== "confirmed").reverse();
  const list = (rows) => el("ul", { cls: "room-list" }, rows.map((r) => ledgerItem(d, r, openForm)));
  const parts = [
    el("h2", { cls: "h2", text: "予約の台帳" }),
    note,
    el("article", { cls: "card" }, [
      el("h2", { text: "予約を手で入れる" }),
      el("p", { cls: "lead", text: "電話や知り合いの予約、メールが読めなかった予約は、ここに入れます。180日・宿泊税・定期報告・カレンダーは、この台帳から数えます" }),
      el("div", { cls: "btns" }, [btn("予約を手で入れる", () => openForm(null), "btn primary")]),
      el("p", { cls: "notice info", text: "番頭は宿泊者の名前を預かりません。宿泊者名簿は、これまでどおり別に作ってください" }),
    ]),
    formBox,
    el("article", { cls: "card" }, [
      el("h2", { text: `これからの予約（${ahead.length}件）` }),
      ahead.length ? list(ahead) : el("p", { cls: "notice info", text: "これからの予約はありません" }),
    ]),
    el("article", { cls: "card" }, [
      el("details", {}, [el("summary", { text: `終わった予約（${past.length}件）` }), past.length ? list(past) : el("p", { cls: "notice info", text: "まだありません" })]),
      el("details", {}, [el("summary", { text: `取り消した予約（${cancelled.length}件）` }), cancelled.length ? list(cancelled) : el("p", { cls: "notice info", text: "ありません" })]),
    ]),
  ];
  p.replaceChildren(...parts.filter(Boolean));
  // 定期報告の画面などから「この予約を直す」で来たとき
  if (state.ledgerEdit) {
    const r = live.find((x) => x.id === state.ledgerEdit);
    state.ledgerEdit = null;
    if (r) openForm(r);
  }
}

function natText(r) {
  const parts = Object.entries(r.nationalities).map(([c, n]) => `${COUNTRY[c] ?? c}${n}人`);
  if (r.unknown_nationality > 0) parts.push(`分からない${r.unknown_nationality}人`);
  return parts.join("・");
}

// 並びの中の文字は1つずつ枠に入れる（文字が続くと1つにくっついて、間が空かないため）
const span = (x) => (typeof x === "string" ? el("span", { text: x }) : x);

function ledgerItem(d, r, openForm) {
  const live = r.status === "confirmed";
  const ota = OTA_PICK.find(([k]) => k === r.ota)?.[1] ?? r.ota;
  const people = [`大人${r.adults}`, r.children ? `子ども${r.children}` : null, r.infants ? `乳幼児${r.infants}` : null].filter(Boolean).join("・");
  const facts = [
    el("span", { cls: live ? "pill" : "pill out", text: live ? ota : "取り消し" }),
    roomName(r.room),
    `${people}（${r.guests}人）`,
    r.amount_gross != null ? `${yen(r.amount_gross)}円` : "売上 未入力",
    r.source === "hand" ? el("span", { cls: "pill", text: "手で入れた" }) : r.source === "mail" ? el("span", { cls: "pill", text: "メールから" }) : null,
  ];
  const warns = [];
  if (live && r.unknown_nationality > 0) warns.push(el("span", { cls: "pill warn", text: `国籍が分からない人 ${r.unknown_nationality}人` }));
  if (live && !r.room) warns.push(el("span", { cls: "pill warn", text: "部屋が決まっていません" }));
  const cancelBox = el("div", { attrs: { "aria-live": "polite" } });
  return el("li", { cls: `room-item${live ? "" : " is-off"}`, attrs: { id: `led-${r.id}` } }, [
    el("p", { cls: "led-when" }, [el("b", { text: `${jpDate(r.checkin_date)}〜${jpDate(r.checkout_date)}` }), `（${r.nights}泊）`]),
    el("p", { cls: "room-facts" }, facts.map(span)),
    el("p", { cls: "room-facts" }, [
      `国籍：${natText(r) || "—"}`,
      `予約番号：${r.ota_reservation_no ?? "なし"}`,
      live ? null : `キャンセル料 ${yen(r.cancel_fee_amount ?? 0)}円`,
    ].map(span)),
    warns.length ? el("p", { cls: "room-facts" }, warns) : null,
    live ? el("div", { cls: "btns" }, [btn("直す", () => openForm(r), "btn small"), btn("取り消す", () => cancelForm(r, cancelBox), "btn small")]) : null,
    cancelBox,
  ]);
}

function cancelForm(r, box) {
  const fee = el("input", { cls: "text-in", attrs: { id: `fee-${r.id}`, type: "text", inputmode: "numeric", maxlength: "9", placeholder: "なければ空のまま" } });
  const problems = el("div", { attrs: { "aria-live": "polite" } });
  const go = async () => {
    try {
      const res = await api(`/api/ledger/${r.id}/cancel`, { method: "POST", body: { cancel_fee_amount: toInt(fee.value) } });
      ledgerChanged(res.ledger, res.note);
      toast("取り消しにしました");
    } catch (err) {
      problems.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  };
  box.replaceChildren(
    el("div", { cls: "notice warn" }, [
      el("p", { text: `${jpDate(r.checkin_date)}に着く予約を取り消します。180日・宿泊税・定期報告の数から外れます。予約サイトでの取り消しは、ご本人が行ってください` }),
      el("div", { cls: "field" }, [el("label", { text: "キャンセル料（円）", attrs: { for: `fee-${r.id}` } }), fee]),
      problems,
      el("div", { cls: "btns" }, [btn("取り消しを決める", go, "btn primary"), btn("やめる", () => box.replaceChildren(), "btn small")]),
    ]),
  );
  fee.focus();
}

// 全角の数字・カンマ・「円」はそのまま受ける。空は「入れていない」。数字でなければそのまま送り、サーバーの言葉で返す
function toInt(s) {
  const t = String(s ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，円\s]/g, "");
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : t;
}

function resForm(d, r, close) {
  const v = r ?? { ota: "direct", adults: 2, children: 0, infants: 0, cosleep_free: 0, room: null, nationalities: {}, tax_collection: "unknown", language: null };
  const inputs = {};
  const field = (key, label, control) => {
    control.id = `led-f-${key}`;
    inputs[key] = control;
    return el("div", { cls: "field" }, [el("label", { text: label, attrs: { for: control.id } }), control]);
  };
  const pick = (pairs, value) => {
    const s = el("select", {}, pairs.map(([k, t]) => el("option", { text: t, attrs: { value: k } })));
    s.value = value ?? pairs[0][0];
    return s;
  };
  const text = (value, attrs) => {
    const i = el("input", { cls: "text-in", attrs: { type: "text", ...attrs } });
    i.value = value ?? "";
    return i;
  };
  const count = (value) => text(value, { inputmode: "numeric", maxlength: "2" });

  const roomPairs = [["", "部屋未定"], ...d.rooms.map((x) => [x.code, x.name])];
  if (r?.room && !d.rooms.some((x) => x.code === r.room)) roomPairs.push([r.room, `${roomName(r.room)}（止めている部屋）`]);

  // 国籍：国と人数の組を足していく
  const natRows = el("ul", { cls: "nat-rows" });
  const addNat = (code = "JP", n = "") => {
    const s = pick(NAT_PICK.map((c) => [c, COUNTRY[c] ?? c]), code);
    s.setAttribute("aria-label", "国籍");
    const i = count(n);
    i.setAttribute("aria-label", "人数");
    const li = el("li", { cls: "nat-row" }, [s, i, el("span", { text: "人" }), btn("消す", () => li.remove(), "btn small")]);
    natRows.append(li);
    return i;
  };
  for (const [c, n] of Object.entries(v.nationalities ?? {})) addNat(c, String(n));

  const problems = el("div", { attrs: { "aria-live": "polite" } });
  const save = async () => {
    const nationalities = {};
    for (const li of natRows.children) {
      const [s, i] = li.querySelectorAll("select, input");
      const n = toInt(i.value);
      if (n === null) continue;
      if (typeof n !== "number") {
        problems.replaceChildren(el("p", { cls: "notice danger", text: "国籍ごとの人数は数字で入れてください" }));
        i.focus();
        return;
      }
      nationalities[s.value] = (nationalities[s.value] ?? 0) + n;
    }
    const body = {
      ota: inputs.ota.value,
      ota_reservation_no: inputs.ota_reservation_no.value.trim() || null,
      checkin_date: inputs.checkin_date.value,
      checkout_date: inputs.checkout_date.value,
      adults: toInt(inputs.adults.value),
      children: toInt(inputs.children.value),
      infants: toInt(inputs.infants.value),
      cosleep_free: toInt(inputs.cosleep_free.value),
      room: inputs.room.value || null,
      nationalities,
      amount_gross: toInt(inputs.amount_gross.value),
      tax_collection: inputs.tax_collection.value,
      language: inputs.language.value || null,
    };
    try {
      const res = await api(r ? `/api/ledger/${r.id}` : "/api/ledger", { method: "POST", body });
      ledgerChanged(res.ledger, res.note, r && res.note !== "直しました");
      toast(r ? "予約を直しました" : "予約を台帳に入れました");
      document.getElementById(`led-${res.id}`)?.scrollIntoView({ block: "center" });
    } catch (err) {
      problems.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
      const f = err.body?.field;
      (f === "nationalities" ? natRows.querySelector("select") : inputs[f])?.focus();
    }
  };

  return el("article", { cls: "card" }, [
    el("h2", { text: r ? `予約を直す（${jpDate(r.checkin_date)}に着く予約）` : "予約を手で入れる" }),
    r ? el("p", { cls: "lead", text: "着く日・出る日・人数を変えると、前に作ったゲスト画面のURLは止まります。到着前の案内も作り直してください" }) : null,
    el("div", { cls: "fields" }, [
      field("ota", "予約の入り口", pick(OTA_PICK, v.ota)),
      field("ota_reservation_no", "予約番号（任意）", text(v.ota_reservation_no, { maxlength: "40", inputmode: "latin" })),
      field("checkin_date", "着く日", text(v.checkin_date, { type: "date" })),
      field("checkout_date", "出る日", text(v.checkout_date, { type: "date" })),
      field("room", "部屋", pick(roomPairs, v.room ?? "")),
    ]),
    el("div", { cls: "fields" }, [
      field("adults", "大人", count(v.adults)),
      field("children", "子ども", count(v.children)),
      field("infants", "乳幼児", count(v.infants)),
      field("cosleep_free", "うち添い寝（料金なし）", count(v.cosleep_free)),
    ]),
    el("div", { cls: "field nat-field" }, [
      el("p", { cls: "nat-label", text: "国籍と人数（定期報告に入ります。分からない人は入れなくてかまいません）" }),
      natRows,
      el("div", { cls: "btns" }, [btn("＋ 国を足す", () => addNat().focus(), "btn small")]),
    ]),
    el("div", { cls: "fields" }, [
      field("amount_gross", "売上（円・任意）", text(v.amount_gross, { inputmode: "numeric", maxlength: "12" })),
      field("tax_collection", "宿泊税の受け取り方", pick(TAX_PICK, v.tax_collection)),
      field("language", "案内の言葉", pick([["", "まだ決めていない"], ...Object.entries(LANG)], v.language ?? "")),
    ]),
    problems,
    el("div", { cls: "btns" }, [btn(r ? "直した内容で保存" : "台帳に入れる", save, "btn primary"), btn("やめる", close, "btn small")]),
  ]);
}

// ---- ゲスト連絡 ----

async function showGuest() {
  const p = $("panel-guest");
  p.replaceChildren(loading("予約を読んでいます"));
  try {
    const d = await api("/api/reservations");
    const list = el("div", { cls: "res-list" });
    const holder = el("div", { attrs: { id: "draft-holder" } });
    const card = el("article", { cls: "card" }, [
      el("h2", { text: "これからの予約" }),
      el("p", { cls: "lead", text: "到着案内の下書きをチームがつくります。送るのはご本人です" }),
      list,
    ]);
    if (!d.reservations.length) list.append(el("p", { cls: "state", text: "これからの予約はまだありません。予約が入ったら、ここに出ます" }));
    for (const r of d.reservations) list.append(resRow(r));
    p.replaceChildren(card, holder);
    if (state.selectedRes) openDraft(state.selectedRes);
  } catch (err) {
    p.replaceChildren(errorBox(err, showGuest));
  }
}

function resRow(r) {
  const st = STATUS[r.draft_status] ?? STATUS.null;
  const n = nightsBetween(r.checkin_date, r.checkout_date);
  const row = el("div", { cls: `res${state.selectedRes === r.id ? " selected" : ""}`, attrs: { "data-id": r.id } }, [
    el("div", { cls: "res-main" }, [
      el("p", { cls: "res-date" }, [
        el("span", { text: `${jpDate(r.checkin_date)} →` }), " ",
        // 「（3泊）」だけが次の行に落ちないよう、終わりの日と1つのかたまりにする
        el("span", { text: `${jpDate(r.checkout_date)}（${n}泊）` }),
      ]),
      el("p", { cls: "res-sub", text: `${r.guests}人・${LANG[r.language] ?? r.language}・${OTA[r.ota] ?? r.ota}` }),
    ]),
    el("span", { cls: `pill ${st.cls}`, text: `案内：${st.label}` }),
    r.draft_status
      ? btn("開く", () => openDraft(r.id, true), "btn small")
      : btn("案内をつくる", () => makeDraft(r.id), "btn small"),
  ]);
  return row;
}

function markSelected(id) {
  state.selectedRes = id;
  for (const row of document.querySelectorAll(".res")) row.classList.toggle("selected", row.dataset.id === id);
}

async function openDraft(id, scroll = false) {
  markSelected(id);
  const holder = $("draft-holder");
  holder.replaceChildren(loading("下書きを読んでいます"));
  try {
    const d = await api(`/api/drafts?reservation_id=${encodeURIComponent(id)}`);
    if (!d.drafts.length) {
      holder.replaceChildren(
        el("article", { cls: "card" }, [
          el("p", { cls: "state", text: "この予約の案内はまだありません" }),
          el("div", { cls: "btns" }, [btn("案内をつくる", () => makeDraft(id), "btn primary")]),
        ]),
      );
      return;
    }
    holder.replaceChildren(draftCard(d.drafts[0]));
    // 一覧で「開く」を押したときは、下書きの見出しと OK が見える所まで動かす
    if (scroll) holder.scrollIntoView({ behavior: "smooth", block: "start" });
    holder.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    holder.replaceChildren(errorBox(err, () => openDraft(id)));
  }
}

let teamTimer = null;
const DRAFT_STEPS = [
  [["banto"], "番頭が予約と宿の決まりをまとめています"],
  [["shukuhaku"], "宿泊担当が到着案内の下書きを書いています"],
  [["kansa"], "監査役とプログラムが、数字と決まりに合っているか確かめています"],
];
function teamWorking(onStep, steps = DRAFT_STEPS) {
  let i = 0;
  const show = () => {
    team(...steps[i]);
    onStep?.(steps[i][1]);
  };
  show();
  watchTeam(true);
  teamTimer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    show();
  }, 2500);
}
function teamDone(note) {
  clearInterval(teamTimer);
  watchTeam(false);
  team([], note);
}

async function makeDraft(id) {
  markSelected(id);
  const holder = $("draft-holder");
  for (const b of document.querySelectorAll(".res .btn")) b.disabled = true;
  holder.scrollIntoView({ behavior: "smooth", block: "start" });
  teamWorking((note) => holder.replaceChildren(loading(`${note}（全部で10〜20秒ほど）`)));
  try {
    const d = await api("/api/drafts", { method: "POST", body: { reservation_id: id } });
    teamDone(d.source === "ai" ? `下書きができました（確かめた回数：${d.attempts ?? 1}回）。内容を見て OK を押してください` : "AIが使えなかったので、決まった文で下書きしました。内容を見て OK を押してください");
    await showGuest();
  } catch (err) {
    teamDone();
    for (const b of document.querySelectorAll(".res .btn")) b.disabled = false;
    holder.replaceChildren(errorBox(err, () => makeDraft(id)));
  }
}

// 伏せた暗証番号だけ色を変えて見せる（文は textContent のまま）
function maskedText(text, cls = "draft-text") {
  const pre = el("div", { cls, attrs: { tabindex: "0" } });
  const parts = String(text ?? "").split(MASK);
  parts.forEach((part, i) => {
    pre.append(document.createTextNode(part));
    if (i < parts.length - 1) pre.append(el("span", { cls: "pill mask", text: "暗証番号（コピー時に入ります）" }));
  });
  return pre;
}

function draftCard(d) {
  const st = STATUS[d.status] ?? STATUS.draft;
  const isAi = d.source === "ai";
  const isEvac = d.kind === "evacuation";
  const card = el("article", { cls: `card${isEvac ? " evac" : ""}`, attrs: { id: `draft-${d.id}` } });
  const body = el("div");
  const actions = el("div", { cls: "btns" });

  card.append(
    el("div", { cls: "card-head" }, [
      el("div", {}, [
        el("h2", { text: `${isEvac ? "避難の案内（訓練）" : "到着案内"}（${LANG[d.language] ?? d.language}）` }),
        // 誰が書き、誰が確かめたかを上の帯と同じ形の札で見せる
        isAi
          ? el("p", { cls: "credits", attrs: { "aria-label": "宿泊担当が書き、監査役とプログラムが確かめた下書きです" } }, [
              el("span", { cls: "credit" }, [el("span", { text: "書いた" }), el("span", { cls: "role-pill", text: "宿泊担当" })]),
              el("span", { cls: "credit" }, [el("span", { text: "確かめた" }), el("span", { cls: "role-pill", text: "監査役" }), el("span", { text: "とプログラム" })]),
            ])
          : el("p", { cls: "lead", text: "決まった文の下書きです" }),
      ]),
      el("span", { cls: `pill ${st.cls}`, text: st.label }),
    ]),
  );
  if (d.needs_owner_check) {
    card.append(el("p", { cls: "notice warn", text: "「【オーナー確認】」が残っています。宿泊税の行を「直す」で書き直してから OK を押してください" }));
  }
  card.append(actions, body);

  function viewMode() {
    // 読むときは OK・コピーを下書きの上に置く（長い文の下に埋もれないように）
    body.before(actions);
    body.replaceChildren(maskedText(d.text));
    if (d.language !== "ja" && d.ja_text) body.append(el("details", {}, [el("summary", { text: "日本語の意味" }), maskedText(d.ja_text)]));
    if (d.back_translation) body.append(el("details", {}, [el("summary", { text: "日本語に訳し戻した文（意味がずれていないか）" }), maskedText(d.back_translation)]));
    if (d.checks?.length) {
      body.append(
        el("details", {}, [
          el("summary", { text: `チームの確かめ（${Math.max(...d.checks.map((c) => c.attempt))}回）` }),
          el(
            "ul",
            { cls: "checks" },
            d.checks.map((c) =>
              el("li", {}, [
                el("span", { cls: "by", text: `${c.attempt}回目・${c.by === "kansa" ? "監査役" : "プログラム"}` }),
                c.problems?.length ? `直す点：${c.problems.join("／")}` : "問題なし",
              ]),
            ),
          ),
        ]),
      );
    }
    const canOk = d.status === "draft";
    const canCopy = d.status === "ok" || d.status === "copied";
    actions.replaceChildren(
      btn("OK", () => doOk(), canOk ? "btn primary" : "btn"),
      btn("直す", () => editMode()),
      btn("コピー", () => doCopy(), canCopy ? "btn primary" : "btn"),
      // 避難の案内は、ゲスト用URLとは関係がないのでボタンを出さない
      ...(isEvac ? [] : [btn("ゲスト用URLをつくる", () => doLink(), "btn")]),
    );
    actions.children[0].disabled = !canOk;
    actions.children[2].disabled = !canCopy;
    if (!canCopy) actions.append(el("p", { cls: "lead", text: "コピーは、OK を押して「確認済み」にしてからできます" }));
  }

  function editMode() {
    const ta = el("textarea", { attrs: { "aria-label": "案内の文", maxlength: "8000" } });
    ta.value = d.text;
    const problems = el("div");
    // 直すときは、書き終えた所で押せるよう文の下に置く
    body.after(actions);
    body.replaceChildren(
      el("p", {
        cls: "notice info",
        text: isEvac
          ? "避難先の名前・距離・地図のリンクは、プログラムが入れた正しい値です。変えないでください"
          : `「${MASK}」の所に、コピーのとき暗証番号が入ります。消さないでください。暗証番号そのものは書かないでください`,
      }),
      ta,
      problems,
    );
    actions.replaceChildren(
      btn("直す", async () => {
        const template = ta.value.replaceAll(MASK, "{DOOR_CODE}");
        try {
          d = await api(`/api/drafts/${d.id}`, { method: "POST", body: { action: "edit", draft_template: template } });
          toast("直しました。もう一度読んで OK を押してください");
          refresh();
        } catch (err) {
          const list = err.body?.problems;
          problems.replaceChildren(el("p", { cls: "notice danger", text: list?.length ? list.join("／") : errorText(err) }));
        }
      }, "btn primary"),
      btn("やめる", () => viewMode()),
    );
    ta.focus();
  }

  async function doOk() {
    try {
      d = await api(`/api/drafts/${d.id}`, { method: "POST", body: { action: "ok" } });
      toast("確認済みにしました。次は「コピー」して、予約サイトのメッセージに貼ってください");
      refresh();
    } catch (err) {
      toast(errorText(err));
    }
  }

  async function doCopy() {
    // 押した瞬間にコピーを予約し、中身は後から渡す（取りに行く間に「押した直後」でなくなるブラウザがあるため）
    const req = api(`/api/drafts/${d.id}/copy`, { method: "POST", body: {} });
    const canPromise = Boolean(window.ClipboardItem && navigator.clipboard?.write);
    try {
      if (canPromise) {
        const blob = req.then((x) => new Blob([x.text], { type: "text/plain" }));
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      }
      const r = await req;
      if (!canPromise) await navigator.clipboard.writeText(r.text);
      const miss = [!r.door_code_set && "暗証番号", !r.address_set && "住所"].filter(Boolean);
      toast(isEvac ? "コピーしました。送るのはご本人です（訓練の案内です）" : miss.length ? `コピーしました。ただし${miss.join("と")}が設定されていないので「未設定」と入っています` : "コピーしました（暗証番号も入っています）。送るのはご本人です");
      d = { ...d, status: "copied" };
      refresh();
    } catch (err) {
      const apiErr = await req.then(() => null, (e) => e);
      toast(apiErr ? errorText(apiErr) : "コピーできませんでした。もう一度押してください");
    }
  }

  async function doLink() {
    try {
      const r = await api("/api/guest-links", { method: "POST", body: { reservation_id: d.reservation_id } });
      const url = `${location.origin}${r.path}`;
      const box = el("div", { cls: "url-box" }, [
        el("p", { text: "ゲスト用URL（この画面を閉じると、もう表示できません）" }),
        qrSvg(url),
        el("p", { text: url }),
        el("p", { cls: "lead", text: `期限：${jpDate(r.expires_at)} 正午まで。暗証番号はチェックイン当日から表示されます` }),
        el("div", { cls: "btns" }, [
          btn("コピー", async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast("URLをコピーしました。送るのはご本人です");
            } catch {
              toast("コピーできませんでした。もう一度押してください");
            }
          }, "btn small primary"),
        ]),
      ]);
      actions.after(box);
    } catch (err) {
      toast(errorText(err));
    }
  }

  function refresh() {
    const next = draftCard(d);
    card.replaceWith(next);
    // 一覧の札もそろえる
    if (!isEvac) showGuestListOnly();
  }

  viewMode();
  return card;
}

async function showGuestListOnly() {
  try {
    const d = await api("/api/reservations");
    const list = document.querySelector("#panel-guest .res-list");
    if (list) list.replaceChildren(...d.reservations.map(resRow));
  } catch {
    // 一覧の札が古いままでも、下書きの操作はできる
  }
}

// ---- 予約メール（M17） ----
// 貼り付ける → 伏せてから番頭が書き写す → プログラムが本文・台帳と照らす → オーナーが OK／直す／捨てる。
// 台帳を書きかえるのは OK のときだけ。

const KIND = { new: "新しい予約", change: "予約の変更", cancel: "キャンセル", unknown: "種類が分からない" };
const OTA_ALL = { ...OTA, unknown: "分からない" };
const MASKED_JA = { name: "名前", email: "メール", phone: "電話", address: "住所", passport: "旅券番号", url: "リンク" };
const READ_STEPS = [
  [["banto"], "名前や連絡先を伏せてから、番頭がメールを読んでいます"],
  [["kansa"], "監査役とプログラムが、本文と台帳に合っているか確かめています"],
];

// 年が今年でなければ年も出す
function jpDateY(iso) {
  if (!iso) return "空";
  const y = iso.slice(0, 4);
  return `${state.today && y !== state.today.slice(0, 4) ? `${Number(y)}年` : ""}${jpDate(iso)}`;
}
const people = (f) => {
  if (f.adults == null && f.children == null && f.infants == null) return "空";
  const parts = [`大人${f.adults ?? "？"}人`];
  if (f.children) parts.push(`子ども${f.children}人`);
  if (f.infants) parts.push(`乳幼児${f.infants}人`);
  return parts.join("・");
};
const money = (n) => (n == null ? "空" : `${yen(n)}円`);

async function showMail() {
  const p = $("panel-mail");
  p.replaceChildren(loading("予約メールを読んでいます"));
  try {
    const [pending, done] = await Promise.all([api("/api/booking-emails"), api("/api/booking-emails?status=done")]);
    const hasPending = pending.emails.length > 0;
    const list = el("div", { cls: "mail-list" });
    if (!hasPending) list.append(el("p", { cls: "state", text: "確認待ちの予約メールはありません。上に貼り付けると、ここに出ます" }));
    pending.emails.forEach((m, i) => list.append(mailCard(m, i === 0)));
    p.replaceChildren(
      pasteCard(!hasPending),
      el("article", { cls: "card" }, [
        el("h2", { text: `確認待ち（${pending.emails.length}件）` }),
        el("p", { cls: "lead", text: "番頭が書き写した内容です。OK を押すまで、台帳は変わりません" }),
        list,
      ]),
      doneCard(done.emails),
    );
  } catch (err) {
    p.replaceChildren(errorBox(err, showMail));
  }
}

function pasteCard(primary) {
  const subject = el("input", { cls: "text-in", attrs: { type: "text", maxlength: "300", "aria-label": "件名", placeholder: "件名（なくても読めます）" } });
  const body = el("textarea", { cls: "mail-body", attrs: { "aria-label": "メールの本文", maxlength: "12000", placeholder: "予約サイトから届いたメールの本文を、ここに貼り付けてください" } });
  const msg = el("div");
  const pick = el("div", { cls: "pick demo-pick", attrs: { hidden: true } });
  const go = btn("番頭に読ませる", read, primary ? "btn primary" : "btn");

  // デモのときだけ、見本のメールを選べる
  api("/api/booking-emails/samples")
    .then((d) => {
      const sel = el("select", { attrs: { id: "mail-sample" } }, [el("option", { text: "選んでください", attrs: { value: "" } })]);
      for (const s of d.samples) sel.append(el("option", { text: s.label, attrs: { value: s.key } }));
      sel.addEventListener("change", () => {
        const s = d.samples.find((x) => x.key === sel.value);
        if (!s) return;
        subject.value = s.subject;
        body.value = s.body;
      });
      pick.replaceChildren(el("label", { text: "見本を入れる（デモ）", attrs: { for: "mail-sample" } }), sel);
      pick.hidden = false;
    })
    .catch(() => {});

  async function read() {
    if (!body.value.trim()) {
      msg.replaceChildren(el("p", { cls: "notice warn", text: "メールの本文を貼り付けてください" }));
      body.focus();
      return;
    }
    go.disabled = true;
    teamWorking((note) => msg.replaceChildren(loading(`${note}（10秒ほど）`)), READ_STEPS);
    try {
      const m = await api("/api/booking-emails", { method: "POST", body: { subject: subject.value, body: body.value } });
      teamDone(m.read_by === "ai" ? "番頭が読みました。内容を見て OK を押してください" : "番頭（AI）が使えなかったので、「直す」で入れてください");
      await showMail();
      document.querySelector("#panel-mail .mail-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      teamDone();
      go.disabled = false;
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  }

  return el("article", { cls: "card" }, [
    el("h2", { text: "予約メールを貼り付ける" }),
    el("p", { cls: "lead", text: "名前・メール・電話・住所・リンクは、番頭が読む前に伏せます。伏せる前の本文は保存しません" }),
    pick,
    subject,
    body,
    msg,
    el("div", { cls: "btns" }, [go]),
  ]);
}

function mailCard(m, primary) {
  const f = m.fields;
  const card = el("article", { cls: "mail-card", attrs: { id: `mail-${m.id}` } });
  const body = el("div");
  const actions = el("div", { cls: "btns" });
  const msg = el("div");
  card.append(body, actions, msg);

  function viewMode() {
    msg.replaceChildren();
    const head = el("div", { cls: "card-head" }, [
      el("h3", { text: `${KIND[f.kind]}・${OTA_ALL[f.ota] ?? f.ota}` }),
      m.blocked
        ? el("span", { cls: "pill danger", text: "このままでは入れられません" })
        : el("span", { cls: "pill warn", text: "確認待ち" }),
    ]);
    const nights = m.nights != null ? `（${m.nights}泊）` : "";
    const kv = el("dl", { cls: "kv" }, [
      el("dt", { text: "予約番号" }), el("dd", { text: f.reservation_no ?? "空" }),
      el("dt", { text: "日程" }), el("dd", { text: `${jpDateY(f.checkin_date)} → ${jpDateY(f.checkout_date)}${nights}` }),
      el("dt", { text: "人数" }), el("dd", { text: people(f) }),
      el("dt", { text: "金額（参考）" }), el("dd", { text: money(f.amount) }),
    ]);
    const parts = [head, kv];
    if (m.current) parts.push(beforeAfter(m));
    else if (m.after && f.kind === "new") parts.push(el("p", { cls: "notice info", text: "OK を押すと、台帳に1行増えます" }));
    parts.push(checkList(m));
    if (m.masked_counts) {
      const c = Object.entries(m.masked_counts).filter(([, n]) => n > 0).map(([k, n]) => `${MASKED_JA[k] ?? k}${n}`);
      if (c.length) parts.push(el("p", { cls: "mail-masked", text: `番頭が読む前に伏せたもの：${c.join("・")}` }));
    }
    if (m.masked_body) {
      parts.push(el("details", {}, [el("summary", { text: "番頭が読んだ文（伏せたあと）" }), el("div", { cls: "draft-text", text: m.masked_body })]));
    }
    body.replaceChildren(...parts);
    const ok = btn("OK", doOk, primary ? "btn primary" : "btn");
    ok.disabled = !!m.blocked;
    actions.replaceChildren(ok, btn("直す", editMode), btn("捨てる", doReject));
  }

  function editMode() {
    const inputs = {};
    const sel = (k, map) => {
      const s = el("select", { attrs: { id: `f-${m.id}-${k}` } });
      for (const [v, label] of Object.entries(map)) s.append(el("option", { text: label, attrs: { value: v, selected: f[k] === v } }));
      return (inputs[k] = s);
    };
    const inp = (k, type, extra = {}) => {
      const i = el("input", { cls: "text-in", attrs: { id: `f-${m.id}-${k}`, type, ...extra } });
      i.value = f[k] ?? "";
      return (inputs[k] = i);
    };
    const row = (k, label, control) => el("div", { cls: "field" }, [el("label", { text: label, attrs: { for: `f-${m.id}-${k}` } }), control]);
    const problems = el("div");
    body.replaceChildren(
      el("h3", { text: "番頭が書き写した内容を直す" }),
      el("p", { cls: "lead", text: "空のままの項目は、空のままになります。直したあと、もう一度確かめてから OK を押します" }),
      el("div", { cls: "fields" }, [
        row("kind", "種類", sel("kind", KIND)),
        row("ota", "予約サイト", sel("ota", { airbnb: OTA.airbnb, booking: OTA.booking, rakuten: OTA.rakuten, direct: OTA.direct, unknown: OTA_ALL.unknown })),
        row("reservation_no", "予約番号", inp("reservation_no", "text", { maxlength: "40" })),
        row("checkin_date", "チェックイン", inp("checkin_date", "date")),
        row("checkout_date", "チェックアウト", inp("checkout_date", "date")),
        row("adults", "大人", inp("adults", "number", { min: "0", max: "50", inputmode: "numeric" })),
        row("children", "子ども", inp("children", "number", { min: "0", max: "50", inputmode: "numeric" })),
        row("infants", "乳幼児", inp("infants", "number", { min: "0", max: "50", inputmode: "numeric" })),
        row("amount", "金額（参考・円）", inp("amount", "number", { min: "0", inputmode: "numeric" })),
      ]),
      problems,
    );
    actions.replaceChildren(
      btn("直す", async () => {
        const fields = {};
        for (const [k, i] of Object.entries(inputs)) fields[k] = i.value;
        try {
          const r = await api(`/api/booking-emails/${m.id}/edit`, { method: "POST", body: { fields } });
          toast("直しました。もう一度見て OK を押してください");
          m = r.email;
          Object.assign(f, m.fields);
          viewMode();
          card.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
          problems.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
        }
      }, "btn primary"),
      btn("やめる", viewMode),
    );
    inputs.kind.focus();
  }

  async function doOk() {
    for (const b of actions.querySelectorAll("button")) b.disabled = true;
    try {
      const r = await api(`/api/booking-emails/${m.id}/confirm`, { method: "POST", body: {} });
      // 台帳が変わったので、ほかのタブは次に開いたときに読み直す
      state.loaded = { mail: true };
      toast(r.note);
      await showMail();
    } catch (err) {
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
      for (const b of actions.querySelectorAll("button")) b.disabled = false;
    }
  }

  async function doReject() {
    for (const b of actions.querySelectorAll("button")) b.disabled = true;
    try {
      await api(`/api/booking-emails/${m.id}/reject`, { method: "POST", body: {} });
      toast("捨てました。台帳は変えていません");
      await showMail();
    } catch (err) {
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
      for (const b of actions.querySelectorAll("button")) b.disabled = false;
    }
  }

  viewMode();
  return card;
}

// 変更・キャンセル：台帳のいまと、OK のあと
function beforeAfter(m) {
  const c = m.current;
  const a = m.after;
  if (m.fields.kind === "cancel") {
    return el("p", { cls: "notice info", text: `OK を押すと、台帳の予約（${jpDateY(c.checkin_date)} → ${jpDateY(c.checkout_date)}・${people(c)}）をキャンセルにします` });
  }
  const rows = [
    ["日程", `${jpDateY(c.checkin_date)} → ${jpDateY(c.checkout_date)}（${c.nights}泊）`, a ? `${jpDateY(a.checkin_date)} → ${jpDateY(a.checkout_date)}（${nightsBetween(a.checkin_date, a.checkout_date)}泊）` : "—"],
    ["人数", people(c), a ? people(a) : "—"],
    ["金額", money(c.amount_gross), a ? money(a.amount_gross) : "—"],
  ];
  return el("div", { cls: "table-wrap" }, [
    el("table", {}, [
      el("thead", {}, [el("tr", {}, [el("th", { text: "" }), el("th", { text: "台帳のいま" }), el("th", { text: "OK のあと" })])]),
      el("tbody", {}, rows.map(([k, x, y]) => el("tr", { cls: x !== y && a ? "changed" : "" }, [el("th", { text: k }), el("td", { text: x }), el("td", { text: y })]))),
    ]),
  ]);
}

function checkList(m) {
  const items = [...(m.ledger ?? []), ...(m.checks ?? [])];
  if (!items.length) return el("p", { cls: "notice ok", text: "本文と台帳で確かめました。おかしな所はありません" });
  const mark = { block: "✖", warn: "⚠️", info: "✎" };
  return el(
    "ul",
    { cls: "checks" },
    items.map((i) => el("li", { cls: `chk-${i.level}` }, [el("span", { cls: "by", text: mark[i.level] ?? "・" }), i.text])),
  );
}

function doneCard(emails) {
  const rows = emails.slice(0, 10).map((m) => {
    const f = m.fields;
    const ok = m.status === "ok";
    return el("div", { cls: "res" }, [
      el("div", { cls: "res-main" }, [
        el("p", { cls: "res-date", text: `${KIND[f.kind]}・${OTA_ALL[f.ota] ?? f.ota}` }),
        el("p", { cls: "res-sub", text: `予約番号 ${f.reservation_no ?? "空"}・${jpDateY(f.checkin_date)} → ${jpDateY(f.checkout_date)}` }),
      ]),
      el("span", { cls: `pill ${ok ? "ok" : ""}`, text: ok ? "台帳に入れた" : "捨てた" }),
    ]);
  });
  return el("article", { cls: "card" }, [
    el("h2", { text: "決めたもの" }),
    el("p", { cls: "lead", text: "伏せた本文は、受け取ってから30日で消えます。書き写した内容は残ります" }),
    rows.length ? el("div", { cls: "res-list" }, rows) : el("p", { cls: "state", text: "まだありません" }),
  ]);
}

// ---- お金の照合（M1〜M4） ----
// 明細を選ぶ → 経理担当が列の対応の案をつくる → オーナーが OK → プログラムが突き合わせる
// → ずれごとに、経理担当が理由の候補を出し、プログラムが計算で確かめ、監査役が見直す → オーナーが OK／直した。

const STMT_KIND = { airbnb: "Airbnb", booking: "Booking.com", rakuten: "楽天トラベル", bank: "通帳" };
const STMT_ORDER = ["airbnb", "booking", "bank"];
const REASON_JA = {
  fee: "手数料", cancel_fee: "キャンセル料", lodging_tax: "宿泊税", timing: "入金の時期", discount: "割引",
  refund: "返金", transfer_fee: "振込手数料", missing_line: "明細の抜け", other: "そのほか",
};
const CONF = { high: { label: "確か", cls: "ok" }, mid: { label: "たぶん", cls: "warn" }, low: { label: "確かめて", cls: "danger" } };
const DISC_STATUS = { open: { label: "確認待ち", cls: "warn" }, ok: { label: "このままでOK", cls: "ok" }, fixed: { label: "直した", cls: "ok" } };
// ゲストが入れた人数のずれは、決めた中身が違うので札も変える
const GUEST_STATUS = { open: DISC_STATUS.open, ok: { label: "台帳に入れた", cls: "ok" }, fixed: { label: "台帳のまま", cls: "ok" } };
const MAX_FILE_BYTES = 2_000_000;
const MAP_STEPS = [
  [["keiri"], "経理担当が列の見出しを読んでいます（中身は伏せてあります）"],
  [[], "プログラムが、日付や金額として読めるか確かめています"],
];
const REASON_STEPS = [
  [["keiri"], "経理担当が、ずれの理由を考えています"],
  [["kansa"], "プログラムが計算で確かめ、監査役が見直しています"],
];

const signedYen = (n) => (n === 0 ? "0円" : `${n > 0 ? "＋" : "−"}${yen(Math.abs(n))}円`);

function toBase64(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function showMoney() {
  const p = $("panel-money");
  p.replaceChildren(loading("読み込んだ明細を確かめています"));
  try {
    const [s, d] = await Promise.all([api("/api/statements"), api("/api/discrepancies")]);
    const loaded = s.statements.length;
    const importPrimary = loaded < STMT_ORDER.length;
    p.replaceChildren(importCard(s.statements, importPrimary), el("div", { attrs: { id: "map-holder" } }), resultCard(s.statements, d.discrepancies, !importPrimary));
  } catch (err) {
    p.replaceChildren(errorBox(err, showMoney));
  }
}

function importCard(statements, primary) {
  const byKind = Object.fromEntries(statements.map((s) => [s.kind, s]));
  const kinds = [...new Set([...STMT_ORDER, ...statements.map((s) => s.kind)])];
  const status = el(
    "ul",
    { cls: "stmt-list", attrs: { "aria-label": "読み込んだ明細" } },
    kinds.map((k) => {
      const s = byKind[k];
      return el("li", {}, [el("span", { cls: `pill ${s ? "ok" : ""}`, text: `${STMT_KIND[k] ?? k}：${s ? `読み込み済み（${s.row_count}行）` : "まだ"}` })]);
    }),
  );
  const kindSel = el("select", { attrs: { id: "stmt-kind" } }, [el("option", { text: "自動で見分ける", attrs: { value: "" } })]);
  for (const [v, label] of Object.entries(STMT_KIND)) kindSel.append(el("option", { text: label, attrs: { value: v } }));
  const fileIn = el("input", { cls: "file-in", attrs: { type: "file", id: "stmt-file", accept: ".csv,.tsv,.txt,text/csv" } });
  const pick = el("div", { cls: "pick demo-pick", attrs: { hidden: true } });
  const msg = el("div");
  const go = btn("経理担当に列を見てもらう", read, primary ? "btn primary" : "btn");
  let samples = [];
  let sampleSel = null;

  // デモのときだけ、見本の明細を選べる
  api("/api/statements/samples")
    .then((d) => {
      samples = d.samples;
      sampleSel = el("select", { attrs: { id: "stmt-sample" } }, [el("option", { text: "選んでください", attrs: { value: "" } })]);
      for (const s of samples) sampleSel.append(el("option", { text: s.label, attrs: { value: s.key } }));
      sampleSel.addEventListener("change", () => {
        const s = samples.find((x) => x.key === sampleSel.value);
        if (!s) return;
        fileIn.value = "";
        kindSel.value = s.kind;
      });
      pick.replaceChildren(el("label", { text: "見本を使う（デモ）", attrs: { for: "stmt-sample" } }), sampleSel);
      pick.hidden = false;
    })
    .catch(() => {});
  fileIn.addEventListener("change", () => {
    if (sampleSel) sampleSel.value = "";
  });

  async function read() {
    let file = null;
    const sample = samples.find((x) => x.key === sampleSel?.value);
    if (sample) {
      file = { text: sample.text, name: sample.filename };
    } else if (fileIn.files?.[0]) {
      const f = fileIn.files[0];
      if (f.size > MAX_FILE_BYTES) {
        msg.replaceChildren(el("p", { cls: "notice warn", text: "ファイルが大きすぎます（2MBまで）。月ごとに分けて読み込んでください" }));
        return;
      }
      file = { base64: toBase64(await f.arrayBuffer()), name: f.name };
    } else {
      msg.replaceChildren(el("p", { cls: "notice warn", text: "CSVのファイルを選んでください" }));
      return;
    }
    go.disabled = true;
    teamWorking((note) => msg.replaceChildren(loading(`${note}（10秒ほど）`)), MAP_STEPS);
    try {
      const up = await api("/api/uploads", { method: "POST", body: { kind: kindSel.value || null, text: file.text, base64: file.base64 } });
      teamDone(up.source === "ai" ? "経理担当が列の対応の案をつくりました。見て OK を押してください" : "列の対応を出しました。見て OK を押してください");
      msg.replaceChildren();
      go.disabled = false;
      // 塗りのボタンは画面に1つだけ（いまは対応表の OK）
      for (const b of $("panel-money").querySelectorAll(".btn.primary")) b.className = "btn";
      const holder = $("map-holder");
      holder.replaceChildren(mapCard(up, file));
      holder.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      teamDone();
      go.disabled = false;
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  }

  return el("article", { cls: "card" }, [
    el("h2", { text: "明細を読み込む" }),
    el("p", { cls: "lead", text: "予約サイトの明細と通帳のCSVを読み込みます。どの列が何かは経理担当が案をつくり、決めるのはご本人です" }),
    status,
    el("div", { cls: "fields" }, [
      el("div", { cls: "field" }, [el("label", { text: "明細の種類", attrs: { for: "stmt-kind" } }), kindSel]),
      el("div", { cls: "field" }, [el("label", { text: "CSVのファイル", attrs: { for: "stmt-file" } }), fileIn]),
    ]),
    pick,
    msg,
    el("div", { cls: "btns" }, [go]),
  ]);
}

function mapCard(up, file) {
  const kindName = STMT_KIND[up.kind] ?? up.kind;
  const sels = {};
  const msg = el("div");
  const head =
    up.source === "ai"
      ? el("p", { cls: "credits", attrs: { "aria-label": "経理担当が案をつくり、プログラムが確かめた対応表です" } }, [
          el("span", { cls: "credit" }, [el("span", { text: "案をつくった" }), el("span", { cls: "role-pill", text: "経理担当" })]),
          el("span", { cls: "credit" }, [el("span", { text: "確かめた" }), el("span", { text: "プログラム" })]),
        ])
      : el("p", { cls: "lead", text: up.source === "saved" ? "前に OK した対応表と同じ形の明細です" : "見出しの言葉から、プログラムが見当をつけました" });

  const fields = up.fields.map(({ field, label }) => {
    const id = `map-${field}`;
    const sel = el("select", { attrs: { id } }, [el("option", { text: "使わない", attrs: { value: "" } })]);
    for (const c of up.columns) {
      const ex = c.samples.length ? `（例：${c.samples.slice(0, 2).join("・")}）` : "";
      sel.append(
        el("option", {
          text: c.sensitive ? `${c.header}（名前・残高などの列なので読みません）` : `${c.header}${ex}`,
          attrs: { value: String(c.index), disabled: c.sensitive, selected: up.mapping[field] === c.index },
        }),
      );
    }
    sels[field] = sel;
    const conf = CONF[up.confidence?.[field]];
    return el("div", { cls: "field" }, [
      el("label", { attrs: { for: id } }, [label, conf ? el("span", { cls: `pill ${conf.cls}`, text: conf.label }) : null]),
      sel,
    ]);
  });

  const notes = (up.notes ?? []).map((n) => el("p", { cls: `notice ${n.includes("確かめてください") ? "warn" : "info"}`, text: n }));
  const problems = up.problems?.length ? [el("p", { cls: "notice warn", text: up.problems.join("／") })] : [];
  const hidden = up.columns.filter((c) => c.sensitive).map((c) => c.header);

  const ok = btn("OK", doOk, "btn primary");
  const card = el("article", { cls: "card", attrs: { id: "map-card" } }, [
    el("div", { cls: "card-head" }, [
      el("div", {}, [el("h2", { text: `${kindName}の明細：列の対応` }), head]),
      el("span", { cls: "pill warn", text: "確認待ち" }),
    ]),
    el("p", { cls: "lead", text: `${up.row_count}行あります。違っている所は選び直してください。OK を押すまで、何も読み込みません` }),
    ...notes,
    ...problems,
    el("div", { cls: "fields" }, fields),
    hidden.length ? el("p", { cls: "notice info", text: `名前・残高・口座などの列は読みません：${hidden.join("・")}` }) : null,
    msg,
    el("div", { cls: "btns" }, [ok, btn("やめる", () => card.remove())]),
  ]);

  async function doOk() {
    const mapping = {};
    for (const [f, s] of Object.entries(sels)) mapping[f] = s.value === "" ? null : Number(s.value);
    ok.disabled = true;
    msg.replaceChildren(loading("プログラムが全部の行を読み込んでいます"));
    try {
      const r = await api(`/api/uploads/${up.upload_id}/confirm`, { method: "POST", body: { mapping, text: file.text, base64: file.base64 } });
      const parts = [r.read.lines && `明細 ${r.read.lines}行`, r.read.payouts && `振込 ${r.read.payouts}件`, r.read.deposits && `入出金 ${r.read.deposits}件`].filter(Boolean);
      state.moneySummary = null;
      toast(`${STMT_KIND[r.kind] ?? r.kind}の明細を読み込みました（${parts.join("・")}）。全部そろったら「照合する」を押してください`);
      await showMoney();
    } catch (err) {
      ok.disabled = false;
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  }
  return card;
}

function resultCard(statements, discs, primary) {
  const s = state.moneySummary;
  const open = discs.filter((d) => d.status === "open").length;
  const go = btn("照合する", reconcile, primary ? "btn primary" : "btn");
  go.disabled = !statements.length;
  const msg = el("div");
  const card = el("article", { cls: "card" }, [
    el("h2", { text: "照合の結果" }),
    el("p", { cls: "lead", text: "台帳・予約サイトの明細・通帳を、プログラムが突き合わせます（数えるのはAIではありません）" }),
    // 押すボタンは結果より上に置く（結果を読んでから下までさがして押す形にしない）
    el("div", { cls: "btns" }, [go]),
    msg,
  ]);
  if (s) {
    card.append(
      el("dl", { cls: "nums" }, [
        num("突き合わせた", s.total, "件"),
        num("合っている", s.matched, "件", "is-ok"),
        num("ずれ", s.total - s.matched, "件", s.total > s.matched ? "is-warn" : "is-ok", open ? `確認待ち ${open}件` : ""),
      ]),
      el("dl", { cls: "kv" }, Object.values(s.byKind).flatMap((k) => [el("dt", { text: k.label }), el("dd", { text: `${k.total}件のうち ずれ ${k.total - k.matched}件` })])),
      ...s.info.map((t) => el("p", { cls: "notice info", text: t })),
    );
  } else if (discs.length) {
    card.append(el("dl", { cls: "nums" }, [num("ずれ", discs.length, "件", "is-warn"), num("確認待ち", open, "件", open ? "is-warn" : "is-ok")]));
  } else if (!statements.length) {
    card.append(el("p", { cls: "state", text: "まだ明細がありません。上で明細を読み込んでから照合してください" }));
  } else {
    card.append(el("p", { cls: "state", text: "明細を読み込みました。「照合する」を押すと、プログラムが突き合わせます" }));
  }
  if (s && s.total === s.matched) card.append(el("p", { cls: "notice ok", text: "台帳・明細・通帳がすべて合っています" }));
  if (discs.length) {
    card.append(
      el("h3", { cls: "draft-label", text: "ずれ（1件ずつ確かめてください）" }),
      el("div", { cls: "mail-list" }, discs.map(discCard)),
    );
  }

  async function reconcile() {
    go.disabled = true;
    team([], "プログラムが突き合わせています");
    msg.replaceChildren(loading("プログラムが突き合わせています"));
    try {
      const r = await api("/api/reconcile", { method: "POST", body: {} });
      state.moneySummary = r.summary;
      const n = r.summary.total - r.summary.matched;
      teamDone(n ? `ずれが ${n}件 ありました。「理由の候補をつくる」で、チームに理由を考えてもらえます` : "すべて合っていました");
      await showMoney();
    } catch (err) {
      teamDone();
      go.disabled = false;
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  }
  return card;
}

function discCard(d) {
  const st = (d.kind === "guest_count" ? GUEST_STATUS : DISC_STATUS)[d.status] ?? DISC_STATUS.open;
  const card = el("article", { cls: "mail-card", attrs: { id: `disc-${d.id}` } });
  const reasonBox = el("div");
  const msg = el("div");
  const sub = [d.kind_label, d.reservation_id ? `予約 ${d.reservation_id}` : null].filter(Boolean).join("・");
  const isGuest = d.kind === "guest_count";

  card.append(
    el("div", { cls: "card-head" }, [el("h3", { text: d.title }), el("span", { cls: `pill ${st.cls}`, text: st.label })]),
    el("p", { cls: "lead", text: isGuest ? sub : `${sub}　ずれ ${signedYen(d.diff)}` }),
    reasonBox,
  );

  if (isGuest) {
    // ゲストが入れた人数は、AIに理由を考えさせない。台帳とゲストの数を並べるだけ
    reasonBox.append(...guestCountView(d));
  } else if (!d.reasons) {
    const make = btn("理由の候補をつくる", makeReasons, "btn small");
    reasonBox.append(el("div", { cls: "btns" }, [make]));
  } else {
    reasonBox.append(...reasonView(d));
  }

  // オーナーの判断
  const note = el("textarea", { cls: "text-in note-in", attrs: { "aria-label": "メモ（なくてもよい）", maxlength: "500", placeholder: "メモ（なくてもよい）" } });
  note.value = d.owner_note ?? "";
  // 人数のずれは一度決めたら戻せない（OK のとき台帳をもう直しているため）
  const acts =
    d.status === "open"
      ? isGuest
        ? [btn("OK（ゲストの人数を台帳に入れる）", () => resolve("ok"), "btn small"), btn("台帳のままにする", () => resolve("fixed"), "btn small")]
        : [btn("OK（このずれで正しい）", () => resolve("ok"), "btn small"), btn("直した", () => resolve("fixed"), "btn small")]
      : isGuest
        ? []
        : [btn("確認待ちに戻す", () => resolve("open"), "btn small")];
  if (d.status === "open") card.append(note);
  else if (d.owner_note) card.append(el("p", { cls: "lead", text: `メモ：${d.owner_note}` }));
  card.append(msg, el("div", { cls: "btns" }, acts));

  async function makeReasons() {
    for (const b of card.querySelectorAll("button")) b.disabled = true;
    teamWorking((t) => reasonBox.replaceChildren(loading(`${t}（30秒ほど）`)), REASON_STEPS);
    try {
      const nd = await api(`/api/discrepancies/${d.id}/reasons`, { method: "POST", body: {} });
      const r = nd.reasons;
      teamDone(
        r?.source !== "ai"
          ? "AIが使えなかったので、プログラムが数字から分かる候補だけを出しました"
          : nd.audit?.manual
            ? "チームで決めきれませんでした。手で確認してください"
            : `理由の候補ができました（確かめた回数：${nd.audit?.attempts ?? 1}回）。見て OK か「直した」を押してください`,
      );
      card.replaceWith(discCard(nd));
    } catch (err) {
      teamDone();
      for (const b of card.querySelectorAll("button")) b.disabled = false;
      reasonBox.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }), el("div", { cls: "btns" }, [btn("理由の候補をつくる", makeReasons, "btn small")]));
    }
  }

  async function resolve(action) {
    for (const b of card.querySelectorAll("button")) b.disabled = true;
    try {
      const nd = await api(`/api/discrepancies/${d.id}`, { method: "POST", body: { action, note: action === "open" ? d.owner_note : note.value } });
      toast(
        isGuest && action === "ok"
          ? "ゲストの人数を台帳に入れました。宿泊税と定期報告は、この人数で計算し直されます"
          : isGuest && action === "fixed"
            ? "台帳の人数のままにしました"
            : action === "ok"
              ? "このずれは正しい、と記録しました"
              : action === "fixed"
                ? "直した、と記録しました"
                : "確認待ちに戻しました",
      );
      card.replaceWith(discCard(nd));
    } catch (err) {
      for (const b of card.querySelectorAll("button")) b.disabled = false;
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  }
  return card;
}

const PEOPLE = (p) => [`大人${p.adults}`, p.children ? `子ども${p.children}` : null, p.infants ? `乳幼児${p.infants}` : null].filter(Boolean).join("・");
const NATS = (o) =>
  Object.entries(o ?? {})
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${COUNTRY[c] ?? c}${n}`)
    .join("・") || "なし";

/** ゲストが入れた人数と台帳を並べる（数と国籍だけ。名前は出さない） */
function guestCountView(d) {
  const f = d.facts;
  if (!f?.ledger || !f?.guest) return [];
  const row = (label, p) => el("li", { text: `${label}：${PEOPLE(p)}（${NATS(p.nationalities)}）` });
  const open = d.status === "open";
  const after = {
    open: "OK を押すまで、宿泊税と定期報告は台帳の人数のままです",
    ok: "ゲストが入れた人数を台帳に入れました。宿泊税と定期報告は、この人数で数えています",
    fixed: "台帳の人数のままにしました",
  };
  return [
    el("ul", { cls: "plain-list" }, [row(open ? "台帳" : "決める前の台帳", f.ledger), row("ゲストが入れた数", f.guest)]),
    el("p", { cls: "lead", text: after[d.status] ?? after.open }),
  ];
}

function qrSvg(text) {
  const NS = "http://www.w3.org/2000/svg";
  const m = qrMatrix(text);
  const quiet = 4;
  const n = m.length + quiet * 2;
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x + quiet} ${y + quiet}h1v1h-1z`)));
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("class", "qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "ゲスト用URLのQRコード");
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", n);
  bg.setAttribute("height", n);
  bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(bg, path);
  return svg;
}

function reasonView(d) {
  const r = d.reasons;
  const out = [];
  if (r.source === "ai") {
    out.push(
      el("p", { cls: "credits", attrs: { "aria-label": "経理担当が考え、プログラムと監査役が確かめた候補です" } }, [
        el("span", { cls: "credit" }, [el("span", { text: "考えた" }), el("span", { cls: "role-pill", text: "経理担当" })]),
        el("span", { cls: "credit" }, [el("span", { text: "確かめた" }), el("span", { text: "プログラムと" }), el("span", { cls: "role-pill", text: "監査役" })]),
      ]),
    );
  } else {
    out.push(el("p", { cls: "lead", text: "プログラムが、数字から分かる候補だけを出しました" }));
  }
  if (d.audit?.manual) {
    out.push(el("p", { cls: "notice danger", text: `チームで${d.audit.attempts}回確かめても、決めきれませんでした。下の候補は参考にとどめて、手で確認してください` }));
  }
  if (r.candidates?.length) {
    out.push(
      el(
        "ul",
        { cls: "checks reasons" },
        r.candidates.map((c) => {
          const conf = CONF[c.confidence];
          return el("li", {}, [
            el("span", { cls: "by", text: `${REASON_JA[c.code] ?? c.code}　${signedYen(c.amount)}` }),
            conf ? el("span", { cls: `pill ${conf.cls}`, text: conf.label }) : null,
            el("p", { text: c.basis }),
            c.explains && c.confidence !== "low" ? el("p", { cls: "reason-note", text: "この理由だけで、ずれ全部の説明がつきます" }) : null,
            c.check_note ? el("p", { cls: "reason-note", text: c.check_note }) : null,
          ]);
        }),
      ),
    );
  } else {
    out.push(el("p", { cls: "notice warn", text: "数字から分かる理由は見つかりませんでした。予約サイトの明細と台帳を見比べてください" }));
  }
  if (r.summary) out.push(el("p", { cls: "notice info", text: `確かめること：${r.summary}` }));
  if (r.checks?.length) {
    out.push(
      el("details", {}, [
        el("summary", { text: `チームの確かめ（${Math.max(...r.checks.map((c) => c.attempt))}回）` }),
        el(
          "ul",
          { cls: "checks" },
          r.checks.map((c) =>
            el("li", {}, [
              el("span", { cls: "by", text: `${c.attempt}回目・${c.by === "kansa" ? "監査役" : "プログラム"}` }),
              c.problems?.length ? `直す点：${c.problems.join("／")}` : "問題なし",
            ]),
          ),
        ),
      ]),
    );
  }
  return out;
}

// ---- 訓練（O-5）----
// ボタンを押すと「訓練中」になり、ゲストの画面は災害モード（G-5）になる。もう一度押すと終わる。
// 泊まっているゲストごとに、その人の言葉で避難の案内の下書きをつくる（送るボタンはない）。

const EVAC_STEPS = [
  [["banto"], "番頭が、いま泊まっているゲストと言葉を確かめています"],
  [["shukuhaku"], "宿泊担当が、ゲストの言葉で避難の案内を書いています"],
  [["kansa"], "監査役とプログラムが、避難先と決まりに合っているか確かめています"],
];
const drill = { active: false, busy: false };
let view = "home";

// 訓練のボタンは、どの画面でも同じ場所に出す（押す前は控えめな灰色なので、見出しより目立たない）
function syncDrillBtn() {
  $("drill-btn").hidden = false;
}

async function loadDrill() {
  try {
    renderDrill(await api("/api/drill"));
  } catch {
    // 訓練の状態が読めなくても、ほかの画面は使える
  }
}

function renderDrill(d, working = null) {
  drill.active = Boolean(d.active);
  document.body.classList.toggle("drill", drill.active);
  $("drill-banner").hidden = !drill.active;
  const b = $("drill-btn");
  b.textContent = drill.active ? "訓練を終える" : "津波の避難訓練を始める";
  b.setAttribute("aria-pressed", String(drill.active));
  b.disabled = drill.busy;
  syncDrillBtn();
  const p = $("drill-panel");
  p.hidden = !drill.active;
  if (!drill.active) {
    p.replaceChildren();
    return;
  }
  const head = el("article", { cls: "card" }, [
    el("h2", { text: "避難の案内（訓練）" }),
    el("p", { cls: "lead", text: "いま泊まっているゲストに、その人の言葉で避難の案内を下書きします。避難先と距離はプログラムが入れます。送るボタンはありません。確かめてコピーし、ご本人が送ってください" }),
  ]);
  if (working) {
    head.append(loading(working));
    p.replaceChildren(head);
    return;
  }
  if (!d.staying?.length) head.append(el("p", { cls: "state", text: "いま泊まっているゲストはいません。下書きはつくりませんでした" }));
  else head.append(el("p", { cls: "sub", text: `いま泊まっているゲスト：${d.staying.length}組（${d.staying.map((s) => LANG[s.language] ?? s.language).join("・")}）` }));
  p.replaceChildren(head, ...(d.drafts ?? []).map(draftCard));
}

async function toggleDrill() {
  if (drill.busy) return;
  drill.busy = true;
  try {
    if (drill.active) {
      renderDrill(await api("/api/drill", { method: "POST", body: { action: "end" } }));
      // 訓練の下書きは消えるので、「OK を押してください」の一言も残さず、ふだんの一言に戻す
      team([], null);
      toast("訓練を終えました。ゲストの画面はふだんに戻ります");
      return;
    }
    renderDrill({ active: true }, "下書きをつくっています");
    window.scrollTo(0, 0);
    teamWorking((note) => renderDrill({ active: true }, `${note}（1人10〜20秒ほど）`), EVAC_STEPS);
    const d = await api("/api/drill", { method: "POST", body: { action: "start" } });
    teamDone("避難の案内の下書きができました。内容を見て OK を押してください");
    drill.busy = false;
    renderDrill(d);
  } catch (err) {
    teamDone();
    toast(errorText(err));
    drill.busy = false;
    await loadDrill();
  } finally {
    drill.busy = false;
    $("drill-btn").disabled = false;
  }
}

// ---- チームの成績（O-4-6）：見るだけ。流すのは手元のスクリプトで、社長の OK のあと ----

async function showEval() {
  const p = $("panel-eval");
  p.replaceChildren(loading("成績を読んでいます"));
  try {
    const d = await api("/api/eval/results");
    const head = el("article", { cls: "card" }, [
      el("h2", { text: "チームの成績" }),
      el("p", { cls: "lead", text: `${d.label}です。例題はすべて架空で、本番の予約やお客さまのデータは使っていません` }),
    ]);
    if (d.empty) {
      head.append(
        el("p", { cls: "notice info", text: `${d.message}。例題は${d.case_count || 40}件用意してあります。流すとAIの料金がかかるので、まとめて1回だけ流し、結果をここに出します` }),
      );
      p.replaceChildren(head);
      return;
    }
    // 結論の1文（サーバーが数字から組み立てたもの）を、数字のカードより先に置く
    if (d.headline) {
      head.append(
        el("div", { cls: "eval-headline" }, [
          el("p", { cls: "eval-headline-main", text: d.headline.main }),
          d.headline.sub ? el("p", { cls: "eval-headline-sub", text: d.headline.sub }) : null,
        ]),
      );
    }
    head.append(
      el("p", {
        cls: "sub",
        text: `流した日：${jpTime(d.run_at)}。例題${d.case_count}件を3つのやり方で解かせました。「両方あり」は、手引きと監査役がそろったふだんの形です`,
      }),
    );
    p.replaceChildren(head, evalTotals(d), evalTable(d), evalExamples(d));
  } catch (err) {
    p.replaceChildren(errorBox(err, showEval));
  }
}

const rate = (a, n) => (n ? Math.round((a / n) * 100) : 0);

// やり方ごとの合計
// 上の段＝比べてほしい2つ（止められなかった・人の確認へ）。下の段＝正解・余計な差し戻し（控えめ）
// ラベルは短くし、折れてよい所にだけ「幅のない空白」（​）を入れる。CSS の keep-all で、ほかの所では折れない
function evalTotals(d) {
  return el(
    "div",
    { cls: "eval-grid" },
    d.totals.map((t) =>
      el("article", { cls: `card eval-card${t.variant === "full" ? " is-main" : ""}` }, [
        el("h3", { cls: "card-title", text: t.label }),
        evalCredits(t.variant),
        el("dl", { cls: "nums" }, [
          num("止められ​なかった", t.missed, "件", t.missed ? "is-danger" : "is-ok"),
          num("人の確認へ", t.flagged, "件", t.flagged ? "is-warn" : ""),
          num("正解", `${t.correct}/${t.n}`, "件", "is-minor", `${rate(t.correct, t.n)}%`),
          num("余計な​差し戻し", t.false_alarm, "回", "is-minor"),
        ]),
      ]),
    ),
  );
}

// だれが確かめたかを、上の帯と同じ形の「監査役」の札で見せる。監査役を外したやり方は札を出さない
function evalCredits(variant) {
  if (variant === "no_audit") {
    return el("p", { cls: "credits" }, [el("span", { text: "確かめた" }), el("span", { text: "プログラムだけ" })]);
  }
  return el("p", { cls: "credits", attrs: { "aria-label": "監査役とプログラムが確かめました" } }, [
    el("span", { text: "確かめた" }),
    el("span", { cls: "role-pill", text: "監査役" }),
    el("span", { text: "とプログラム" }),
  ]);
}

// 分野 × やり方の表（正解の数）
// スマホでは列の見出しを隠し、数字の上に同じやり方の名前を出す（pc の列見出し・カードの見出しと同じ言葉）
function evalTable(d) {
  const vlabel = Object.fromEntries(d.variants.map((v) => [v.variant, v.label]));
  const head = el("tr", {}, [el("th", { text: "分野" }), ...d.variants.map((v) => el("th", { cls: "n", text: v.label }))]);
  const rows = d.domains.map((dm) =>
    el("tr", {}, [
      el("th", { attrs: { scope: "row" }, text: dm.label }),
      ...dm.variants.map((c) =>
        el("td", { cls: "n" }, [
          el("span", { cls: "cell-label", attrs: { "aria-hidden": "true" }, text: vlabel[c.variant] || c.variant }),
          el("span", { cls: "cell-num", text: `${c.correct}/${c.n}` }),
          c.missed ? el("span", { cls: "cell-sub danger", text: `止められず${c.missed}` }) : null,
        ]),
      ),
    ]),
  );
  return el("article", { cls: "card" }, [
    el("h3", { cls: "card-title", text: "分野ごとの正解" }),
    el("p", { cls: "lead", text: "手引きや監査役を外すと、どこで間違いが増えるかを比べます" }),
    el("div", { cls: "table-wrap" }, [el("table", { cls: "eval-domains" }, [el("thead", {}, [head]), el("tbody", {}, rows)])]),
  ]);
}

// 監査役が差し戻した例（例題のメモと理由だけ）
// 見出しは「メモ ― 分野」。分野名の後ろのかっこ（「（宿泊税・180日）」など）は落として、かっこが二重にならないようにする
function evalExamples(d) {
  const domainName = (key) => (d.domains.find((m) => m.domain === key)?.label ?? key).replace(/（[^）]*）$/, "");
  const body = d.examples.length
    ? el(
        "ul",
        { cls: "sb-list" },
        d.examples.map((x) =>
          el("li", {}, [
            el("p", { cls: "sb-note", text: `${x.note} ― ${domainName(x.domain)}` }),
            el("p", { cls: "run-reason" }, [el("span", { cls: "role-pill", text: "監査役" }), el("span", { text: x.reason })]),
            el("span", { cls: `pill ${x.fixed ? "ok" : "warn"}`, text: x.fixed ? "直して正解" : "人の確認へ" }),
          ]),
        ),
      )
    : el("p", { cls: "state", text: "監査役の差し戻しはありませんでした" });
  return el("article", { cls: "card" }, [el("h3", { cls: "card-title", text: "監査役が差し戻した例" }), body]);
}

// ---- 決裁箱（M20）----
// チームが自分から見回って（朝7時・メールが届いたとき・ボタン）、オーナーの確認が要るものだけをここに置く。
// OK するまで、台帳も案内も変わらない。題・数字・日付はプログラムが作ったもの（AI の文ではない）

const LEVEL = { urgent: ["急ぎ", "danger"], warn: ["確かめて", "warn"], info: ["お知らせ", "ok"] };
const TRIGGER_JA = { cron: "毎朝の見回り", button: "ボタンで見回り", email: "メールが届いて見回り" };
const OK_LABEL = { booking_email: "OK（台帳に入れる）", arrival_draft: "OK（確認済みにする）" };
const PATROL_STEPS = [
  [["banto"], "番頭が予約・メール・締切を見回っています"],
  [["shukuhaku"], "宿泊担当が、近い到着の案内を下書きしています"],
  [["kansa"], "監査役とプログラムが、下書きを確かめています"],
];
const dx = { busy: false, openKey: "", timer: null };

// サーバーの時刻（世界標準時）を日本時間の「時:分」に
function jstTime(utc) {
  const t = Date.parse(`${String(utc ?? "").replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function patrolText(last) {
  if (!last) return "まだ見回っていません";
  return `最後の見回り ${jstTime(last.finished_at)}（${TRIGGER_JA[last.trigger] ?? "見回り"}）`;
}

async function showDecisions() {
  const p = $("panel-decisions");
  if (!p.childElementCount) p.replaceChildren(loading("決裁箱を読んでいます"));
  try {
    renderDecisions(await api("/api/decisions"));
  } catch (err) {
    p.replaceChildren(errorBox(err, showDecisions));
  }
  watchDecisions();
}

function renderDecisions(d, note = null) {
  const p = $("panel-decisions");
  const msg = el("div", { attrs: { id: "dx-msg", "aria-live": "polite" } }, note);
  const urgent = d.open.filter((x) => x.level === "urgent").length;
  const head = el("article", { cls: "card" }, [
    el("div", { cls: "card-head" }, [
      el("h2", { text: "決裁箱" }),
      el("span", { cls: `pill ${d.open.length ? (urgent ? "danger" : "warn") : "ok"}`, text: d.open.length ? `確認待ち ${d.open.length}件` : "確認待ちなし" }),
    ]),
    el("p", { cls: "lead", text: "チームが自分から見回って、確認してほしいものだけをここに置きます。OKするまで、台帳も案内も変わりません" }),
    el("p", { cls: "dx-last", text: patrolText(d.last_patrol) }),
    el("div", { cls: "btns" }, [btn("いま見回る", (e) => patrolNow(e.currentTarget), "btn")]),
    msg,
  ]);
  // 濃い色のボタンは1画面に1つ：いちばん上の「押せるカード」の OK（または「見直した」）だけ
  const first = d.open.findIndex((x) => x.review || x.can_ok);
  const list = d.open.length
    ? d.open.map((x, i) => decisionCard(x, i === first))
    : [el("article", { cls: "card" }, [el("p", { cls: "state", text: "いま、確認待ちはありません。新しいことがあれば、チームがここに置きます" })])];
  // 決めたものが無いときは何も足さない（null をそのまま渡すと「null」と出る）
  p.replaceChildren(head, ...list, ...[decidedCard(d.done)].filter(Boolean));
  dx.openKey = d.open.map((x) => `${x.id}:${x.can_ok}`).join(",");
}

function decisionCard(d, main = false) {
  const [lv, cls] = LEVEL[d.level] ?? LEVEL.info;
  const msg = el("div", { attrs: { "aria-live": "polite" } });
  if (d.review) return priceCard(d, lv, cls, msg, main);
  const ok = btn(OK_LABEL[d.kind] ?? "OK（見ました）", () => decide(d, msg), main ? "btn primary" : "btn");
  if (!d.can_ok) {
    ok.disabled = true;
    ok.dataset.lock = "1";
  }
  const fixLabel = d.kind in OK_LABEL ? `直す（${TITLE[d.link] ?? "画面"}へ）` : `${TITLE[d.link] ?? "画面"}を見る`;
  // 「書いた人」は下の行（書いた／確かめた）と同じことなので、行が出るときは表に出さない
  const facts = d.by ? d.facts.filter((f) => f.label !== "書いた人") : d.facts;
  // 閉じたカードには大事な1行だけ。残りは「詳しく」を押すと、その場で開く
  const key = keyFact(d, facts);
  const rest = facts.filter((f) => f !== key);
  // 「直す」は決めるボタンの横。ただ画面を見に行くだけのものは文字のリンクにする
  const fix = d.link in SHOW && d.kind in OK_LABEL ? btn(fixLabel, () => openFrom(d), "btn") : null;
  const look = d.link in SHOW && !(d.kind in OK_LABEL) ? btn(`${fixLabel} →`, () => openFrom(d), "btn link") : null;
  return el("article", { cls: `card dx dx-${d.level}` }, [
    el("div", { cls: "card-head" }, [el("span", { cls: `pill ${cls}`, text: lv })]),
    el("h3", { cls: "card-title dx-title" }, keepTogether(d.title)),
    dxCredits(d),
    keyLine(key),
    dxMore(d, "詳しく", [rest.length ? factList(rest, "kv") : null]),
    d.can_ok ? null : el("p", { cls: "notice warn", text: "番頭が決められないことがあるので、まだOKできません。「直す」から直してください" }),
    el("div", { cls: "btns" }, [ok, fix]),
    look,
    msg,
  ]);
}

// 決裁箱のカードの「読んだ／書いた／確かめた」の行（訓練の下書きカードと同じ形）。
// サーバーが入れた by を使う。by の無い古いカードは、種類から決める
function byOf(d) {
  if (Array.isArray(d.by) && d.by.length) return d.by;
  if (d.kind === "arrival_draft") {
    const w = d.facts.find((f) => f.label === "書いた人")?.value ?? "";
    return w.includes("AI") ? [["書いた", "shukuhaku"], ["確かめた", "kansa", "program"]] : [["書いた", "決まった文（AIを使わず）"]];
  }
  if (d.kind === "booking_email") return [["確かめた", "program"]];
  return [[d.review ? "計算した" : "数えた", "program"]];
}

function dxCredits(d) {
  const by = byOf(d);
  const usesAi = by.some(([, ...who]) => who.some((w) => w in TEAM_NAME));
  const parts = [];
  const said = [];
  for (const [verb, ...who] of by) {
    const names = who.filter((w) => w !== "program");
    const prog = who.includes("program");
    // 「数えた プログラム」のひとかたまりは途中で改行しない
    const one = [el("span", { text: verb })];
    for (const w of names) one.push(w in TEAM_NAME ? el("span", { cls: "role-pill", text: TEAM_NAME[w] }) : el("span", { text: w }));
    // AIを使っていないカードは「プログラム（AIなし）」と言い切る
    if (prog) one.push(el("span", { text: names.length ? "とプログラム" : usesAi ? "プログラム" : "プログラム（AIなし）" }));
    parts.push(el("span", { cls: "credit" }, one));
    said.push(`${verb} ${[...names.map((w) => TEAM_NAME[w] ?? w), ...(prog ? ["プログラム"] : [])].join("と")}`);
  }
  parts.push(el("span", { cls: "credit" }, [el("span", { text: "決めるのは" }), el("span", { cls: "role-pill", text: "あなた" })]));
  return el("p", { cls: "credits", attrs: { "aria-label": `${said.join("、")}。決めるのはあなたです` } }, parts);
}

// 日付・金額・「○部屋」は途中で改行しない（「12月／12日」「約／14,500円」を防ぐ）
const KEEP = /\d{1,2}月\d{1,2}日(?:（[^）]{1,2}）)?(?:：\d+部屋(?:（[A-Z]）)?)?|約\s?[\d,]+円|[\d,]+円/g;
function keepTogether(text) {
  const s = String(text ?? "");
  const out = [];
  let i = 0;
  for (const m of s.matchAll(KEEP)) {
    if (m.index > i) out.push(s.slice(i, m.index));
    out.push(el("span", { cls: "nw", text: m[0] }));
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}

// 事実の表。誰が数えたかはカードの「数えた プログラム」の行で言っているので、行ごとにはくり返さない
function factList(facts, cls) {
  return el("dl", { cls }, facts.flatMap((f) => [
    el("dt", {}, keepTogether(f.label)),
    el("dd", {}, f.label === "出典" ? sourceLinks(f.value) : keepTogether(f.value)),
  ]));
}

// 閉じたカードに見せる、いちばん大事な1行（種類ごと）。決まっていない種類は最初の行
const KEY_FACT = { report_due: "締切", discrepancy: "件数", cleaning: "清掃できる時間", price_event: "目安の値段" };
function keyFact(d, facts) {
  return facts.find((f) => f.label === KEY_FACT[d.kind]) ?? facts[0] ?? null;
}
function keyLine(f) {
  if (!f) return null;
  return el("p", { cls: "dx-key" }, [el("span", { cls: "dx-key-label", text: f.label }), el("strong", {}, keepTogether(f.value))]);
}

// 「詳しく」：押すとカードの中でその場で開く。見回りでカードを描き直しても、開いたものは開いたままにする
const dxOpen = new Set();
function dxMore(d, label, children) {
  const kids = children.filter(Boolean);
  if (!kids.length) return null;
  const box = el("details", { cls: "dx-more" }, [el("summary", { text: label }), ...kids]);
  box.open = dxOpen.has(d.id);
  box.addEventListener("toggle", () => (box.open ? dxOpen.add(d.id) : dxOpen.delete(d.id)));
  return box;
}

// 値付けのカードで毎回同じになる説明。カードを短くするため「詳しく」の中へたたむ
const PRICE_DETAIL = new Set(["手取りの目安", "最低価格なら", "目安の元", "180日の方針", "180日の数え方", "決めるのは", "出典"]);

// 「名前 https://…／名前 https://…」を、名前だけの短いリンクにする（URLをそのまま本文に出さない）
function sourceLinks(text) {
  const parts = String(text).split("／").map((s) => s.trim().match(/^(.*?)\s+(https:\/\/\S+)$/));
  if (parts.some((m) => !m)) return [text];
  return parts.flatMap((m, i) => [
    i ? "／" : null,
    el("a", { text: m[1], attrs: { href: m[2], target: "_blank", rel: "noopener" } }),
  ]).filter(Boolean);
}

// 値付けの知らせ：OK の代わりに「見直した／このまま」。押したことを記録するだけで、予約も帳簿も変えない
function priceCard(d, lv, cls, msg, main = false) {
  const facts = d.facts ?? [];
  const key = keyFact(d, facts);
  return el("article", { cls: `card dx dx-${d.level}` }, [
    el("div", { cls: "card-head" }, [el("span", { cls: `pill ${cls}`, text: lv }), el("span", { cls: "pill", text: "値付け" })]),
    el("h3", { cls: "card-title dx-title" }, keepTogether(d.title)),
    dxCredits(d),
    keyLine(key),
    // 空いている夜・手取り・180日・出典は「詳しく」の中。行事の名前が見出しにもう出ているときは、くり返さない
    dxMore(d, "詳しく", [
      factList(facts.filter((f) => f !== key && !PRICE_DETAIL.has(f.label) && !(f.label === "行事" && d.title.includes(f.value))), "kv dx-price"),
      factList(facts.filter((f) => PRICE_DETAIL.has(f.label)), "kv dx-price"),
    ].filter((x) => x.childElementCount)),
    el("p", { cls: "sub", text: "押しても値段は変わりません（記録のみ）" }),
    el("div", { cls: "btns" }, [
      btn("見直した", () => decideReview(d, "reviewed", msg), main ? "btn primary" : "btn"),
      btn("このまま", () => decideReview(d, "kept", msg), "btn"),
    ]),
    // 画面の移動は文字のリンクにして、決めるボタン（見直した・このまま）と分ける
    btn("今月の数字を見る →", () => openFrom(d), "btn link"),
    msg,
  ]);
}

async function decideReview(d, choice, msg) {
  lockDecisions(true);
  msg.replaceChildren(loading("記録しています"));
  try {
    const r = await api(`/api/decisions/${d.id}/review`, { method: "POST", body: { choice } });
    state.loaded = {};
    toast(choice === "reviewed" ? "「見直した」と記録しました" : "「このまま」と記録しました");
    dx.busy = false;
    renderDecisions(r);
  } catch (err) {
    lockDecisions(false);
    msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
}

function decidedCard(done) {
  if (!done.length) return null;
  return el("article", { cls: "card" }, [
    el("h3", { cls: "card-title", text: "さっき決めたもの" }),
    el("ul", { cls: "dx-done" }, done.slice(0, 5).map((x) =>
      el("li", {}, [el("span", { cls: "pill ok", text: x.status === "ok" ? "OK" : "済み" }), " ", el("span", { text: x.title })]),
    )),
  ]);
}

// 「直す」：その画面を開く。到着前案内は、その予約を選んだ状態でゲスト連絡を開く
function openFrom(d) {
  if (d.kind === "arrival_draft") {
    const res = d.facts.find((f) => f.label === "予約");
    if (res) state.selectedRes = res.value;
  }
  state.loaded[d.link] = false;
  go(d.link);
}

function lockDecisions(on) {
  dx.busy = on;
  for (const b of $("panel-decisions").querySelectorAll(".btn")) b.disabled = on || b.dataset.lock === "1";
}

async function decide(d, msg) {
  lockDecisions(true);
  msg.replaceChildren(loading(d.kind === "booking_email" ? "台帳に入れています" : "記録しています"));
  try {
    const r = await api(`/api/decisions/${d.id}/ok`, { method: "POST", body: {} });
    state.loaded = {};
    toast(d.kind === "booking_email" ? "台帳に入れました" : "OKを記録しました");
    dx.busy = false;
    if (r.follow_up_patrol) {
      renderDecisions(r, loading("番頭が続けて見回っています。近い到着なら、案内の下書きをここに置きます"));
      followUp(r.last_patrol?.id ?? 0);
    } else {
      renderDecisions(r);
    }
  } catch (err) {
    lockDecisions(false);
    msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
}

// 予約を台帳に入れたあとの見回り（サーバーが裏で動かす）が終わるのを、少しずつ待つ（最大45秒）
async function followUp(prevId) {
  dx.busy = true;
  teamWorking(null, PATROL_STEPS);
  let d = null;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      d = await api("/api/decisions");
    } catch {
      d = null;
    }
    if (d && (d.last_patrol?.id ?? 0) > prevId) break;
  }
  dx.busy = false;
  teamDone("見回りが終わりました");
  if (view !== "decisions") return;
  if (d) renderDecisions(d);
  else showDecisions();
}

async function patrolNow(b) {
  lockDecisions(true);
  const msg = $("dx-msg");
  teamWorking((note) => msg.replaceChildren(loading(`${note}（10〜30秒ほど）`)), PATROL_STEPS);
  try {
    const r = await api("/api/patrol", { method: "POST", body: {} });
    teamDone("見回りが終わりました");
    dx.busy = false;
    const n = r.patrol?.new_items ?? 0;
    renderDecisions(r, el("p", { cls: `notice ${n ? "warn" : "info"}`, text: n ? `見回りました。新しく${n}件、確認してほしいものがあります` : "見回りました。新しいことはありませんでした" }));
  } catch (err) {
    teamDone("見回りできませんでした");
    lockDecisions(false);
    msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
  }
  b.blur();
}

// 決裁箱を開いている間は、15秒ごとに読み直す（メールが届いたら、そのまま箱に出る）。中身が変わったときだけ描き直す
function watchDecisions() {
  if (dx.timer) return;
  dx.timer = setInterval(async () => {
    if (view !== "decisions") {
      clearInterval(dx.timer);
      dx.timer = null;
      return;
    }
    if (dx.busy || document.hidden) return;
    try {
      const d = await api("/api/decisions");
      const key = d.open.map((x) => `${x.id}:${x.can_ok}`).join(",");
      if (key !== dx.openKey && !dx.busy && view === "decisions") {
        const added = d.open.length - dx.openKey.split(",").filter(Boolean).length;
        renderDecisions(d, added > 0 ? el("p", { cls: "notice warn", text: `新しく${added}件、届きました` }) : null);
      }
    } catch {
      // 読めなかったときは次の回にまかせる
    }
  }, 15000);
}

// ---- ホームと画面の切り替え ----
// アドレスの「#kpi」などで画面を切り替える（ブラウザの戻るボタンでもホームに戻れる）

const SHOW = { decisions: showDecisions, kpi: showKpi, tax: showTax, taxreturn: showTaxReturn, minpaku: showMinpaku, calendar: showCalendar, cleaning: showCleaning, guest: showGuest, mail: showMail, money: showMoney, eval: showEval, settings: showSettings, ledger: showLedger };
const TITLE = { decisions: "決裁箱", kpi: "今月の数字", tax: "宿泊税", taxreturn: "宿泊税の申告書", minpaku: "民泊の手続き", calendar: "宿泊カレンダー", cleaning: "清掃が必要な日", guest: "ゲスト連絡", mail: "予約メール", money: "お金の照合", eval: "チームの成績", settings: "宿と部屋の設定", ledger: "予約の台帳" };

function show(name) {
  if (!(name in SHOW)) name = "home";
  $("panel-home").hidden = name !== "home";
  for (const k of Object.keys(SHOW)) $(`panel-${k}`).hidden = k !== name;
  $("back").hidden = name === "home";
  view = name;
  syncDrillBtn();
  document.title = name === "home" ? "AI番頭" : `${TITLE[name]}｜AI番頭`;
  window.scrollTo(0, 0);
  if (name === "home") {
    loadFacts();
    return;
  }
  // 決裁箱は開くたびに読み直す（見回りやメールで中身が変わるため）。申告書も、集計表で選んだ月と設定を毎回読み直す
  if (name === "decisions" || name === "taxreturn") {
    SHOW[name]();
    return;
  }
  if (!state.loaded[name]) {
    state.loaded[name] = true;
    SHOW[name]();
  }
}

function go(name) {
  if (location.hash.slice(1) === name) show(name);
  else location.hash = name;
}

// ホームの行の数字：プログラムが数えた値だけを出す。読めなかったら説明の言葉のまま
async function loadFacts() {
  const m = state.today.slice(0, 7);
  const mm = shortMonth(m);
  const set = (id, parts) => $(id).replaceChildren(...parts);
  await Promise.allSettled([
    api("/api/decisions").then(fillHero, () => {
      $("hero-num").textContent = "—";
      $("hero-patrol").textContent = "決裁箱を読み込めませんでした。開いて確かめてください";
    }),
    api(`/api/kpis?month=${m}`).then((d) => set("fact-kpi", [`${mm}の売上 `, el("b", { text: `${yen(d.total)}円` })])),
    // 宿泊税は申告する月（先月分）を出す。宿泊税の画面も先月から開く
    api(`/api/tax?month=${state.taxMonth}`).then((d) =>
      set("fact-tax", [`${shortMonth(state.taxMonth)}分　`, el("b", { text: `${d.person_nights}人泊・${yen(d.tax_amount)}円` })]),
    ),
    api("/api/minpaku/counter").then((d) =>
      set("fact-minpaku", d.remaining_days > 0 ? [`${d.limit}日のうち 残り`, el("b", { text: `${d.remaining_days}日` }), miniBar(d)] : [`${d.limit}日の上限に`, el("b", { text: "達しています" }), miniBar(d)]),
    ),
    api(`/api/calendar?month=${m}`).then((d) => {
      const t = d.days.find((x) => x.is_today);
      learnRooms(d.room_list);
      const rooms = t ? d.rooms.filter((r) => t.stays.some((s) => s.room === r)).map(roomName) : [];
      const unknown = t ? t.stays.some((s) => !s.room) : false;
      const tonight = rooms.length ? `${rooms.join("・")}が泊まり` : unknown ? "部屋未定の予約あり" : "空いています";
      // 「10月の／予約3件」と割れないよう、後半は1つのかたまりにする
      set("fact-calendar", ["今夜：", el("b", { text: tonight }), "　", el("span", { cls: "nw", text: `${mm}の予約${d.summary.reservations}件` })]);
    }),
    api("/api/cleaning").then((d) =>
      {
        const open = d.items.filter((i) => i.cleaner_id == null).length;
        const tail = d.cleaners?.some((c) => c.active) && open ? el("span", { cls: "fact-warn nw", text: `　担当まだ${open}件` }) : "";
        set("fact-cleaning", d.items.length ? ["次は ", el("b", { text: jpDate(d.items[0].date) }), "　", el("span", { cls: "nw", text: `この先3週間で${new Set(d.items.map((i) => i.date)).size}日` }), tail] : ["3週間、清掃の日はありません"]);
      }
    ),
  ]);
}

// ホームの決裁箱：数・内訳の札・いちばん上の1件・見回りの時刻。状態は3つ（急ぎあり／ふつう／0件）
function fillHero(d) {
  const open = d.open ?? [];
  const count = (lv) => open.filter((x) => (x.level ?? "info") === lv).length;
  const urgent = count("urgent");
  const empty = open.length === 0;
  const hero = $("hero");
  hero.classList.toggle("is-urgent", urgent > 0);
  hero.classList.toggle("is-empty", empty);
  $("hero-patrol").replaceChildren(...heroPatrolText(d.last_patrol, empty));
  $("hero-count").hidden = empty;
  $("hero-empty").hidden = !empty;
  $("hero-note").hidden = !empty;
  $("hero-num").textContent = String(open.length);
  const tags = [["urgent", "急ぎ"], ["warn", "確かめて"], ["info", "お知らせ"]]
    .map(([lv, ja]) => [lv, ja, count(lv)])
    .filter(([, , n]) => n > 0)
    .map(([lv, ja, n]) => el("li", { cls: `t-${lv}`, text: `${ja} ${n}` }));
  $("hero-tags").replaceChildren(...(empty ? [] : tags));
  // 一覧は急ぎ → 確かめて → お知らせの順で届く。いちばん上の1件だけを出す
  const top = open[0];
  $("hero-top").hidden = !top;
  if (top) {
    $("hero-top-label").textContent = urgent ? "いちばん急ぎ" : "まず見るもの";
    $("hero-top-title").textContent = top.title;
  }
  const btn = $("hero-btn");
  btn.textContent = empty && d.done?.length ? "最近OKしたものを見る" : "決裁箱を開く";
}

// 「番頭がけさ7:00に見回り、確認待ちを最新にしました」。今日でなければ日付を出す。0件なら「気になることはありません」
function heroPatrolText(last, empty = false) {
  if (!last) return ["番頭はまだ見回っていません"];
  const t = Date.parse(`${String(last.finished_at ?? "").replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return [patrolText(last)];
  // 見回りは本当の時計で記録されるので、デモの「今日」ではなく本当の今日と比べる（デモでも「けさ7:00」と読める）
  const j = new Date(t + 9 * 3600000);
  const dayNo = (ms) => Math.floor((ms + 9 * 3600000) / 86400000);
  const ago = dayNo(Date.now()) - dayNo(t);
  const when = ago === 0 ? (j.getUTCHours() < 11 ? "けさ" : "きょう") : ago === 1 ? "きのうの" : `${j.getUTCMonth() + 1}月${j.getUTCDate()}日の`;
  const at = `番頭が${when}${jstTime(last.finished_at)}に`;
  // 「いま気に／なることは」と言葉の途中で割れないよう、後半は1つのかたまりにする
  const nw = (text) => el("span", { cls: "nw", text });
  return empty ? [`${at}見回りました。`, nw("いま気になることはありません")] : [`${at}見回り、`, nw("確認待ちを最新にしました")];
}

// 180日の小さな棒：泊まった日（紺）と予約済みの日（水色）
function miniBar(d) {
  const w = (n) => Math.max(0, Math.min(1000, (n / d.limit) * 1000));
  const used = w(d.used_days);
  const booked = Math.min(w(d.booked_days), 1000 - used);
  return svg("svg", { class: `mini-bar ${d.level ?? ""}`.trim(), viewBox: "0 0 1000 8", preserveAspectRatio: "none", "aria-hidden": "true" }, [
    svg("rect", { x: 0, y: 0, width: 1000, height: 8, class: "rest" }),
    svg("rect", { x: 0, y: 0, width: used, height: 8, class: "used" }),
    svg("rect", { x: used, y: 0, width: booked, height: 8, class: "booked" }),
  ]);
}

async function start() {
  try {
    const d = await api("/api/reservations");
    state.today = d.today;
    $("inn-name").textContent = d.inn_name ?? "宿の名前が未設定です";
    $("today").textContent = jpDate(d.today);
    // 部屋の名前（読めなくても、記号の名前で続ける）
    await api("/api/settings").then((s) => learnRooms(s.rooms)).catch(() => {});
  } catch (err) {
    $("inn-name").textContent = "読み込めませんでした";
    $("panel-home").replaceChildren(errorBox(err, () => location.reload()));
    return;
  }
  // 宿泊税は先月分、定期報告は期限がいちばん近い期間（終わったばかりの期間）を最初に出す
  const month = state.today.slice(0, 7);
  state.kpiMonth = month;
  state.calMonth = month;
  state.calDay = null;
  state.calStay = null;
  state.calView = "bar";
  state.taxMonth = addMonths(month, -1);
  const curStart = Number(month.slice(5, 7)) % 2 === 1 ? addMonths(month, -1) : month;
  const prevStart = addMonths(curStart, -2);
  state.period = `${prevStart}_${addMonths(prevStart, 1).slice(5, 7)}`;
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
  $("drill-btn").addEventListener("click", toggleDrill);
  for (const li of $("team").children) li.querySelector(".chip").addEventListener("click", () => toggleTeamLog(li.dataset.role));
  pullTeam();
  loadDrill();
  setupLogout();
}

start();
