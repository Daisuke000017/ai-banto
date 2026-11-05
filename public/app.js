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
};
const STATUS = {
  null: { label: "まだ", cls: "" },
  draft: { label: "下書き", cls: "warn" },
  ok: { label: "確認済み", cls: "ok" },
  copied: { label: "コピー済み", cls: "ok" },
};
const WD = ["日", "月", "火", "水", "木", "金", "土"];

const state = { today: null, kpiMonth: null, taxMonth: null, period: null, selectedRes: null, loaded: {} };

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
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
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
    : el("p", { cls: "state", text: a.agent === "keiei" ? "経営企画は、AIを使わずに働いています（値付けの目安・180日のペースはプログラムが計算して、今月の数字と決裁箱に出します）" : "まだ仕事の記録がありません" });
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
// AIは使わない。数字と文はプログラムが決まった形で作る。値段を決めて予約サイトに入れるのはオーナー

function kpiPricing(d) {
  const pr = d.pricing;
  if (!pr) return [];
  return [kpiPriceCard(d, pr), kpiReviewCard(pr.reviews)];
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
    el("p", { cls: "sub", text: `宿の設定：${set.join("・")}。上げどきの夜や、1泊だけ空いた夜は、決裁箱でお知らせします。値段を決めて予約サイトに入れるのはオーナーです（番頭は予約も帳簿も変えません。AIは使わず、プログラムが計算しています）` }),
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

function taxMonthPicker(rules) {
  const start = (rules.tax_start_date ?? "2026-07-01").slice(0, 7);
  const last = state.today.slice(0, 7);
  const sel = el("select", { attrs: { id: "tax-month" } });
  for (let m = last; m >= start; m = addMonths(m, -1)) {
    sel.append(el("option", { text: jpMonth(m), attrs: { value: m, selected: m === state.taxMonth } }));
    if (m === start) break;
  }
  sel.addEventListener("change", () => {
    state.taxMonth = sel.value;
    showTax();
  });
  return el("div", { cls: "pick" }, [el("label", { text: "月", attrs: { for: "tax-month" } }), sel]);
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
    el("dl", { cls: "nums" }, [
      num("人泊", d.person_nights, "人泊"),
      num("宿泊税", yen(d.tax_amount), "円"),
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
  card.append(el("div", { cls: "btns" }, [btn("CSVをつくる", () => downloadCsv(`宿泊税_集計表_${d.month}.csv`, rows), "btn primary")]));
  return card;
}

function taxBreakdown(d) {
  const tbody = el("tbody");
  for (const b of d.breakdown) {
    tbody.append(
      el("tr", {}, [
        // スマホ幅では「予約サイト」の列を隠し、予約番号の下に小さく出す（金額の2列を画面に収めるため）
        el("td", {}, [el("span", { text: b.reservation_id }), el("span", { cls: "sub-ota", text: OTA[b.ota] ?? b.ota })]),
        el("td", { cls: "c-ota", text: OTA[b.ota] ?? b.ota }),
        el("td", { cls: "n", text: `${b.nights_in_month}泊` }),
        el("td", { cls: "n", text: b.person_nights }),
        el("td", { cls: "n", text: `${yen(b.tax)}円` }),
        el("td", { cls: "n", text: b.collected == null ? "分からない" : `${yen(b.collected)}円` }),
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
      ? el("div", { cls: "table-wrap" }, [el("table", {}, [el("thead", {}, [head]), tbody])])
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
    el("h2", { text: `${c.fiscal_year}年度の営業日数（上限 ${c.limit}日）` }),
    el("p", { cls: "lead", text: `${jpDate(c.period.from, false)}正午から1年。使った日・予約済みの日・残りを数えています` }),
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
        el("h2", { text: `定期報告の集計表（${jpPeriod(r.period)}）` }),
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
  card.append(
    el("p", { cls: "notice info", text: "報告は、民泊制度運営システムでご本人が行います。この画面からは送りません" }),
    el("div", { cls: "btns" }, [btn("CSVをつくる", () => downloadCsv(`定期報告_集計表_${r.period}.csv`, rows), "btn primary")]),
  );
  return card;
}

// ---- 清掃が必要な日（M18）：見るだけ。プログラムが台帳から数える ----

const ROOM = { A: "部屋A", B: "部屋B" };

function daysFrom(today, iso) {
  const t = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(iso) - t(today)) / 86400000);
}
const whenText = (n) => (n === 0 ? "今日" : n === 1 ? "明日" : `あと${n}日`);

async function showCleaning() {
  const p = $("panel-cleaning");
  p.replaceChildren(loading("プログラムが数えています"));
  try {
    p.replaceChildren(cleaningCard(await api("/api/cleaning")));
  } catch (err) {
    p.replaceChildren(errorBox(err, showCleaning));
  }
}

function cleaningCard(d) {
  const w = d.window;
  const turnovers = d.items.filter((i) => i.turnover).length;
  const card = el("article", { cls: "card" }, [
    el("h2", { text: "清掃が必要な日（今日から3週間）" }),
    el("p", { cls: "lead" }, [
      `${jpDate(d.from)}〜${jpDate(d.to)}　`,
      el("b", { text: `${d.items.length}件` }),
      turnovers ? `（うち入れ替え ${turnovers}件）` : "",
    ]),
  ]);
  if (!d.items.length) {
    card.append(el("p", { cls: "state", text: "この3週間に清掃の日はありません" }));
  } else {
    card.append(
      el(
        "ul",
        { cls: "clean-list" },
        d.items.map((i) => {
          const n = daysFrom(d.today, i.date);
          return el("li", { cls: i.turnover ? "is-turnover" : "" }, [
            el("div", { cls: "clean-date" }, [el("b", { text: jpDate(i.date) }), el("span", { text: whenText(n) })]),
            el("div", { cls: "clean-body" }, [
              el("p", { cls: "clean-room" }, [el("b", { text: ROOM[i.room] ?? "部屋が決まっていません" }), `${OTA[i.ota] ?? i.ota ?? ""}のお客様がチェックアウト`]),
              i.turnover
                ? el("p", { cls: "clean-turn" }, [el("span", { cls: "pill warn", text: "入れ替え" }), `チェックアウト〜チェックインの間（${w.checkout}〜${w.checkin}）に清掃`])
                : el("p", { cls: "clean-sub", text: `${w.checkout}以降に清掃（この日、同じ部屋のチェックインはありません）` }),
              i.check_room ? el("p", { cls: "notice warn", text: "同じ日にチェックインがあります。部屋を確かめてください" }) : null,
            ]),
          ]);
        }),
      ),
    );
  }
  card.append(
    el("details", {}, [el("summary", { text: "数え方" }), el("p", { cls: "notice info", text: d.how })]),
    el("p", { cls: "notice info", text: `清掃できる時間は ${w.checkout}〜${w.checkin}（宿の設定）。この画面は見るだけです。清掃の担当を決める・知らせることはしません` }),
  );
  return card;
}

// ---- 宿泊カレンダー（M21）：見るだけ。プログラムが台帳から並べる ----
// 1か月を7列の表で出す（横スクロールなし）。日を押すと、その日の部屋ごとの様子を下に出す。
// 部屋は色だけでなく「A」「B」の文字で出す。宿泊者の名前は出さない（サーバーも読まない）

const CAL_ROOMS = ["A", "B", null];
const roomName = (room) => ROOM[room] ?? "部屋未定";

async function showCalendar() {
  const p = $("panel-calendar");
  const head = [el("h2", { cls: "h2", text: "宿泊カレンダー" }), calMonths()];
  p.replaceChildren(...head, loading("プログラムが数えています"));
  try {
    const d = await api(`/api/calendar?month=${encodeURIComponent(state.calMonth)}`);
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

// 見かたは2つ：「帯」（部屋ごとの横の帯。入る日の午後から、出る日の午前まで）と「月」（7列の表。文字なしで泊まりと清掃の日だけ）
const CAL_VIEWS = [
  ["bar", "帯で見る"],
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
    num("部屋A", s.nights.A, "泊"),
    num("部屋B", s.nights.B, "泊"),
    s.nights.unknown ? num("部屋未定", s.nights.unknown, "泊", "is-warn") : null,
    num("チェックアウト", s.departures, "件"),
  ]);
  if (!s.reservations) card.append(el("p", { cls: "state", text: `${shortMonth(d.month)}に泊まる予約はまだありません` }));
  if (d.overlaps.length) {
    const where = d.overlaps.map((o) => `${jpDate(o.date, false)}（${o.rooms.map((r) => ROOM[r]).join("・")}）`).join("、");
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
    el("p", { cls: "notice info", text: "この画面は見るだけです。予約を入れる・変える、清掃の担当を決めることはしません" }),
  );
  return card;
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
          f.hasTurn ? el("li", {}, [sw("clean turn"), "入れ替え（同じ日に次の人が入る）"]) : null,
        ]
      : [
          el("li", {}, [sw("lane a"), "上の線：部屋Aの泊まり"]),
          el("li", {}, [sw("lane b"), "下の線：部屋Bの泊まり"]),
          f.hasUnknown ? el("li", {}, [sw("lane unknown"), "部屋未定の泊まり"]) : null,
          el("li", {}, [sw("clean"), "清掃の日"]),
          f.hasTurn ? el("li", {}, [sw("clean turn"), "入れ替えの日"]) : null,
        ];
  return el("ul", { cls: "cal-legend", attrs: { "aria-label": "見かた" } }, items);
}

// 帯で見る：部屋ごとの行 × 日（1日を午前・午後の2つに分ける）。いつも1か月を横1列。入りきらない画面では横にずらす（部屋の名前の列は左に止まる）
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
  const rooms = [
    ["A", "部屋A"],
    ["B", "部屋B"],
  ];
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
    const cls = ["tl-bar", b.r.room === "B" ? "room-b" : "", !b.r.room ? "unknown" : "", b.over ? "over" : "", ci < lo ? "cont-l" : "", co > hi ? "cont-r" : ""].filter(Boolean).join(" ");
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
    put(
      el("button", {
        cls: `tl-clean${turn ? " turn" : ""}`,
        attrs: { type: "button", "data-pick": `d:${day.date}`, "aria-label": `${jpDate(day.date)}：清掃${turn ? "（入れ替え）" : ""}。チェックアウト${day.departures.length}件` },
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
  const lanes = hasUnknown ? ["A", "B", null] : ["A", "B"];
  for (const day of d.days) {
    const lane = (room) => {
      const am = day.departures.some((r) => sameRoom(r.room, room)) || day.stays.some((st) => sameRoom(st.room, room) && !st.arrives);
      const pm = day.stays.filter((st) => sameRoom(st.room, room)).length;
      const cls = ["mn-lane", room === "A" ? "a" : room === "B" ? "b" : "unknown", pm > 1 ? "over" : ""].filter(Boolean).join(" ");
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
          day.departures.length ? el("span", { cls: `mn-clean${turn ? " turn" : ""}`, attrs: { "aria-hidden": "true" } }) : null,
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
  const parts = ["A", "B"].map((room) => {
    const n = day.stays.filter((s) => s.room === room).length;
    return `${ROOM[room]} ${n > 1 ? `${n}件重なり` : n ? "泊まり" : "空き"}`;
  });
  const unknown = day.stays.filter((s) => !s.room).length;
  if (unknown) parts.push(`部屋未定 ${unknown}件`);
  if (day.departures.length) parts.push(`チェックアウト ${day.departures.length}件（清掃）`);
  return `${jpDate(day.date)}${day.is_today ? "・今日" : ""}：${parts.join("、")}`;
}

// 下の欄：選んだ日の、部屋ごとの様子
function calDetail(d, day) {
  const w = d.window;
  const items = [];
  for (const room of CAL_ROOMS) {
    const stays = day.stays.filter((s) => s.room === room);
    const outs = day.departures.filter((r) => r.room === room);
    if (room === null && !stays.length && !outs.length) continue;
    const lines = [];
    for (const r of outs) lines.push(el("p", {}, [el("span", { cls: "pill out", text: "チェックアウト" }), `${OTA[r.ota] ?? r.ota ?? ""}（${PEOPLE(r)}）`]));
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
    if (room && stays.length > 1) lines.push(el("p", { cls: "notice danger", text: `${ROOM[room]}に${stays.length}つの予約が重なっています。台帳を確かめてください` }));
    const state = stays.length > 1 ? "重なり" : stays.length ? "泊まりあり" : "空き";
    items.push(calRoomCard(roomName(room), state, stays.length > 0, lines));
  }
  const out = [el("h3", { cls: "cal-detail-h", text: `${jpDate(day.date)}${day.is_today ? "・今日" : ""}` }), el("ul", { cls: "cal-rooms" }, items)];
  const n = daysFrom(d.today, day.date);
  if (day.departures.length && n >= 0 && n < 21) out.push(el("div", { cls: "btns" }, [btn("清掃が必要な日を開く", () => go("cleaning"), "btn small")]));
  return out;
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
        el("span", { text: jpDate(r.checkout_date) }),
        el("span", { text: `（${n}泊）` }),
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
              el("span", { text: "書いた" }),
              el("span", { cls: "role-pill", text: "宿泊担当" }),
              el("span", { text: "確かめた" }),
              el("span", { cls: "role-pill", text: "監査役" }),
              el("span", { text: "とプログラム" }),
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
  const pick = el("div", { cls: "pick", attrs: { hidden: true } });
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
  const pick = el("div", { cls: "pick", attrs: { hidden: true } });
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
          el("span", { text: "案をつくった" }),
          el("span", { cls: "role-pill", text: "経理担当" }),
          el("span", { text: "確かめた" }),
          el("span", { text: "プログラム" }),
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
  card.append(msg, el("div", { cls: "btns" }, [go]));
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
        el("span", { text: "考えた" }),
        el("span", { cls: "role-pill", text: "経理担当" }),
        el("span", { text: "確かめた" }),
        el("span", { text: "プログラムと" }),
        el("span", { cls: "role-pill", text: "監査役" }),
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

// 「チームの成績」では赤いボタンが見出しより先に目に入るので、訓練していないときは出さない。
// 訓練中は「訓練を終える」が押せるよう、どの画面でも出す
function syncDrillBtn() {
  $("drill-btn").hidden = view === "eval" && !drill.active;
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
  b.textContent = drill.active ? "訓練を終える" : "訓練：津波注意報";
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
    el("div", { cls: "btns" }, [btn("いま見回る", (e) => patrolNow(e.currentTarget), "btn primary")]),
    msg,
  ]);
  const list = d.open.length
    ? d.open.map(decisionCard)
    : [el("article", { cls: "card" }, [el("p", { cls: "state", text: "いま、確認待ちはありません。新しいことがあれば、チームがここに置きます" })])];
  p.replaceChildren(head, ...list, decidedCard(d.done));
  dx.openKey = d.open.map((x) => `${x.id}:${x.can_ok}`).join(",");
}

function decisionCard(d) {
  const [lv, cls] = LEVEL[d.level] ?? LEVEL.info;
  const msg = el("div", { attrs: { "aria-live": "polite" } });
  if (d.review) return priceCard(d, lv, cls, msg);
  const ok = btn(OK_LABEL[d.kind] ?? "OK（見ました）", () => decide(d, msg), "btn");
  if (!d.can_ok) {
    ok.disabled = true;
    ok.dataset.lock = "1";
  }
  const fixLabel = d.kind in OK_LABEL ? `直す（${TITLE[d.link] ?? "画面"}へ）` : `${TITLE[d.link] ?? "画面"}を見る`;
  return el("article", { cls: `card dx dx-${d.level}` }, [
    el("div", { cls: "card-head" }, [el("span", { cls: `pill ${cls}`, text: lv })]),
    el("h3", { cls: "card-title dx-title", text: d.title }),
    el("dl", { cls: "kv" }, d.facts.flatMap((f) => [el("dt", { text: f.label }), el("dd", { text: f.value })])),
    d.can_ok ? null : el("p", { cls: "notice warn", text: "番頭が決められないことがあるので、まだOKできません。「直す」から直してください" }),
    el("div", { cls: "btns" }, [ok, d.link in SHOW ? btn(fixLabel, () => openFrom(d), "btn") : null]),
    msg,
  ]);
}

// 値付けの知らせ：OK の代わりに「見直した／このまま」。押したことを記録するだけで、予約も帳簿も変えない
function priceCard(d, lv, cls, msg) {
  return el("article", { cls: `card dx dx-${d.level}` }, [
    el("div", { cls: "card-head" }, [el("span", { cls: `pill ${cls}`, text: lv }), el("span", { cls: "pill", text: "値付け" })]),
    el("h3", { cls: "card-title dx-title", text: d.title }),
    el("dl", { cls: "kv dx-price" }, d.facts.flatMap((f) => [el("dt", { text: f.label }), el("dd", { text: f.value })])),
    el("p", { cls: "sub", text: "予約サイトで値段や条件を見直したら「見直した」、そのままにするなら「このまま」を押してください。押したことを記録して、あとで今月の数字で比べます" }),
    el("div", { cls: "btns" }, [
      btn("見直した", () => decideReview(d, "reviewed", msg), "btn primary"),
      btn("このまま", () => decideReview(d, "kept", msg), "btn"),
      btn("今月の数字を見る", () => openFrom(d), "btn"),
    ]),
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

const SHOW = { decisions: showDecisions, kpi: showKpi, tax: showTax, minpaku: showMinpaku, calendar: showCalendar, cleaning: showCleaning, guest: showGuest, mail: showMail, money: showMoney, eval: showEval };
const TITLE = { decisions: "決裁箱", kpi: "今月の数字", tax: "宿泊税", minpaku: "民泊の手続き", calendar: "宿泊カレンダー", cleaning: "清掃が必要な日", guest: "ゲスト連絡", mail: "予約メール", money: "お金の照合", eval: "チームの成績" };

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
  // 決裁箱は開くたびに読み直す（見回りやメールで中身が変わるため）
  if (name === "decisions") {
    showDecisions();
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
    api("/api/decisions").then((d) => {
      const urgent = d.open.filter((x) => x.level === "urgent").length;
      set("fact-decisions", d.open.length
        ? ["確認待ち ", el("b", { text: `${d.open.length}件` }), urgent ? `（急ぎ${urgent}件）` : "", `　${patrolText(d.last_patrol)}`]
        : ["確認待ちはありません", `　${patrolText(d.last_patrol)}`]);
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
      const rooms = t ? ["A", "B"].filter((r) => t.stays.some((s) => s.room === r)).map((r) => ROOM[r]) : [];
      const unknown = t ? t.stays.some((s) => !s.room) : false;
      const tonight = rooms.length ? `${rooms.join("・")}が泊まり` : unknown ? "部屋未定の予約あり" : "空いています";
      set("fact-calendar", ["今夜：", el("b", { text: tonight }), `　${mm}の予約${d.summary.reservations}件`]);
    }),
    api("/api/cleaning").then((d) =>
      set("fact-cleaning", d.items.length ? ["次は ", el("b", { text: jpDate(d.items[0].date) }), `　3週間で${new Set(d.items.map((i) => i.date)).size}日`] : ["3週間、清掃の日はありません"]),
    ),
  ]);
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
}

start();
