// AI番頭 オーナー画面。
// 約束：AI・ゲスト由来の文は textContent だけで出す（innerHTML を使わない）。暗証番号は画面に出さない。
// 決めごとは docs/DESIGN.md

const MASK = "●●●●（コピー時に入ります）";
const LANG = { ja: "日本語", en: "英語", ko: "韓国語", "zh-TW": "繁体字中国語" };
const OTA = { airbnb: "Airbnb", booking: "Booking.com", direct: "直接予約", rakuten: "楽天トラベル", jalan: "じゃらん" };
const COUNTRY = {
  JP: "日本", KR: "韓国", TW: "台湾", CN: "中国", HK: "香港", US: "アメリカ", AU: "オーストラリア",
  GB: "イギリス", FR: "フランス", DE: "ドイツ", SG: "シンガポール", TH: "タイ", UNKNOWN: "分からない",
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

function team(roles, note) {
  for (const li of $("team").children) li.classList.toggle("working", roles.includes(li.dataset.role));
  $("team-note").textContent = note ?? "数字はプログラムが数え、文はチームが下書きします。";
}

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
const diffYen = (a, b) => (a === b ? "同じ" : `${a > b ? "＋" : "−"}${yen(Math.abs(a - b))}円`);

async function showKpi() {
  const p = $("panel-kpi");
  p.replaceChildren(loading("プログラムが数えています"));
  try {
    const d = await api(`/api/kpis?month=${encodeURIComponent(state.kpiMonth)}`);
    if (d.total === 0 && d.room_nights === 0) {
      p.replaceChildren(kpiEmpty(d));
      return;
    }
    p.replaceChildren(kpiCard(d), kpiOtaCard(d), kpiCountryCard(d));
  } catch (err) {
    p.replaceChildren(errorBox(err, showKpi));
  }
}

function kpiMonthPicker() {
  const now = state.today.slice(0, 7);
  const sel = el("select", { attrs: { id: "kpi-month" } });
  // これからの2か月（予約が入っている分）から、半年前まで
  for (let i = 2; i >= -6; i--) {
    const m = addMonths(now, i);
    sel.append(el("option", { text: m === now ? `${jpMonth(m)}（今月）` : jpMonth(m), attrs: { value: m, selected: m === state.kpiMonth } }));
  }
  sel.addEventListener("change", () => {
    state.kpiMonth = sel.value;
    showKpi();
  });
  return el("div", { cls: "pick" }, [el("label", { text: "月", attrs: { for: "kpi-month" } }), sel]);
}

function kpiHead(d, lead) {
  return el("div", { cls: "card-head" }, [
    el("div", {}, [el("h2", { text: `${jpMonth(d.month)}の数字` }), el("p", { cls: "lead", text: lead })]),
    kpiMonthPicker(),
  ]);
}

function kpiEmpty(d) {
  return el("article", { cls: "card" }, [
    kpiHead(d, "泊まった日で数えています"),
    el("p", { cls: "state", text: "この月に泊まる予約はまだありません" }),
    el("div", { cls: "btns" }, [btn("予約メールを開く", () => selectTab("mail"))]),
  ]);
}

function kpiCard(d) {
  const ahead = d.sales_upcoming > 0;
  const estimated = d.fee_estimate > 0;
  const netLabel = ahead || estimated ? "手取り（見込み）" : "手取り";
  const netSub = d.fee == null ? "手数料が分からない予約があります" : `売上 ${yen(d.total)}円 − 手数料 ${yen(d.fee)}円${estimated ? "（見込みを含む）" : ""}`;
  const prev = d.previous;
  const card = el("article", { cls: "card" }, [
    kpiHead(d, "泊まった日で数えています。月をまたぐ予約は、泊まった夜の分だけこの月に入れます"),
    el("dl", { cls: "nums kpi-nums" }, [
      num(netLabel, d.net == null ? "—" : yen(d.net), d.net == null ? "" : "円", "kpi-main", netSub),
      num("売上", yen(d.total), "円", "", `${jpMonth(prev.month)}より ${diffYen(d.total, prev.total)}`),
      num("部屋が埋まった割合", pct(d.occupancy_pct), "%", "", `${d.rooms}部屋×${d.days}日のうち ${d.room_nights}泊分`),
      num("1部屋1泊の平均", d.adr == null ? "—" : yen(d.adr), d.adr == null ? "" : "円", "", prev.adr == null ? "" : `${jpMonth(prev.month)} ${yen(prev.adr)}円`),
    ]),
  ]);

  // 泊まり済み／これから（今日より前の夜＝泊まり済み）
  if (d.sales > 0) {
    const bar = el("progress", { attrs: { max: d.sales, value: d.sales_stayed, "aria-label": "売上のうち泊まり済みの分" } });
    card.append(
      el("div", { cls: "meter kpi-meter" }, [
        bar,
        el("p", { text: ahead ? `泊まり済み ${yen(d.sales_stayed)}円 ／ これから ${yen(d.sales_upcoming)}円（${jpDate(d.today, false)}より後の夜）` : `すべて泊まり済みです（${yen(d.sales_stayed)}円）` }),
      ]),
    );
  }
  if (d.cancel_fees > 0) card.append(el("p", { cls: "notice info", text: `売上のうち ${yen(d.cancel_fees)}円 はキャンセル料です（泊まっていないので、埋まった割合と平均には入れていません）` }));

  // 手数料の出どころ
  if (d.fee == null) {
    card.append(el("p", { cls: "notice warn", text: "手数料が分からない予約があります。お金の照合で予約サイトの明細を読み込むと出ます" }));
  } else if (estimated) {
    const rates = Object.entries(d.fee_rates).map(([k, v]) => `${OTA[k] ?? k} ${pct(v)}%`).join("・");
    card.append(el("p", { cls: "notice info", text: `手数料の一部は、明細がまだ無いので見込みです（これまでの明細の割合：${rates}）` }));
  }
  if (d.unknown_tax_included > 0) card.append(el("p", { cls: "notice warn", text: `宿泊税の預かった額が分からない予約が ${d.unknown_tax_included}件 あります。その分は宿泊税を引かずに売上に入れています` }));
  card.append(el("p", { cls: "notice info", text: `宿泊税 ${yen(d.lodging_tax)}円 は売上に入れていません（ゲストから預かったお金です）` }));

  // 照合は1行だけ（入金のずれがあるときだけ目立たせる）
  if (d.open_discrepancies > 0) {
    card.append(el("div", { cls: "notice warn kpi-link" }, [el("span", { text: `入金のずれが ${d.open_discrepancies}件 あります` }), btn("お金の照合を開く", () => selectTab("money"), "btn small")]));
  } else if (!d.statements_loaded) {
    card.append(el("div", { cls: "notice info kpi-link" }, [el("span", { text: "予約サイトの明細を読み込むと、手数料が実際の額になります" }), btn("お金の照合を開く", () => selectTab("money"), "btn small")]));
  }
  return card;
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
    el("h2", { text: "予約サイトごと" }),
    el("p", { cls: "lead", text: "どこから来た予約が、いくら残ったか" }),
    el("div", { cls: "table-wrap" }, [el("table", {}, [el("thead", {}, [head]), tbody])]),
    el("div", { cls: "btns" }, [btn("CSVを保存", () => downloadCsv(`今月の数字_${d.month}.csv`, rows))]),
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
  teamTimer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    show();
  }, 2500);
}
function teamDone(note) {
  clearInterval(teamTimer);
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
  const card = el("article", { cls: "card", attrs: { id: `draft-${d.id}` } });
  const body = el("div");
  const actions = el("div", { cls: "btns" });

  card.append(
    el("div", { cls: "card-head" }, [
      el("div", {}, [
        el("h2", { text: `到着案内（${LANG[d.language] ?? d.language}）` }),
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
      btn("ゲスト用URLをつくる", () => doLink(), "btn"),
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
      el("p", { cls: "notice info", text: `「${MASK}」の所に、コピーのとき暗証番号が入ります。消さないでください。暗証番号そのものは書かないでください` }),
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
      toast(miss.length ? `コピーしました。ただし${miss.join("と")}が設定されていないので「未設定」と入っています` : "コピーしました（暗証番号も入っています）。送るのはご本人です");
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
    showGuestListOnly();
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
  const st = DISC_STATUS[d.status] ?? DISC_STATUS.open;
  const card = el("article", { cls: "mail-card", attrs: { id: `disc-${d.id}` } });
  const reasonBox = el("div");
  const msg = el("div");
  const sub = [d.kind_label, d.reservation_id ? `予約 ${d.reservation_id}` : null].filter(Boolean).join("・");

  card.append(
    el("div", { cls: "card-head" }, [el("h3", { text: d.title }), el("span", { cls: `pill ${st.cls}`, text: st.label })]),
    el("p", { cls: "lead", text: `${sub}　ずれ ${signedYen(d.diff)}` }),
    reasonBox,
  );

  if (!d.reasons) {
    const make = btn("理由の候補をつくる", makeReasons, "btn small");
    reasonBox.append(el("div", { cls: "btns" }, [make]));
  } else {
    reasonBox.append(...reasonView(d));
  }

  // オーナーの判断
  const note = el("textarea", { cls: "text-in note-in", attrs: { "aria-label": "メモ（なくてもよい）", maxlength: "500", placeholder: "メモ（なくてもよい）" } });
  note.value = d.owner_note ?? "";
  const acts =
    d.status === "open"
      ? [btn("OK（このずれで正しい）", () => resolve("ok"), "btn small"), btn("直した", () => resolve("fixed"), "btn small")]
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
      toast(action === "ok" ? "このずれは正しい、と記録しました" : action === "fixed" ? "直した、と記録しました" : "確認待ちに戻しました");
      card.replaceWith(discCard(nd));
    } catch (err) {
      for (const b of card.querySelectorAll("button")) b.disabled = false;
      msg.replaceChildren(el("p", { cls: "notice danger", text: errorText(err) }));
    }
  }
  return card;
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

// ---- タブ ----

const SHOW = { kpi: showKpi, tax: showTax, minpaku: showMinpaku, guest: showGuest, mail: showMail, money: showMoney };

function selectTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === name));
  for (const k of Object.keys(SHOW)) $(`panel-${k}`).hidden = k !== name;
  if (!state.loaded[name]) {
    state.loaded[name] = true;
    SHOW[name]();
  }
}

async function start() {
  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => selectTab(t.dataset.tab));
  try {
    const d = await api("/api/reservations");
    state.today = d.today;
    $("inn-name").textContent = d.inn_name ?? "宿の名前が未設定です";
    $("today").textContent = jpDate(d.today);
  } catch (err) {
    $("inn-name").textContent = "読み込めませんでした";
    $("panel-kpi").replaceChildren(errorBox(err, () => location.reload()));
    return;
  }
  // 宿泊税は先月分、定期報告は期限がいちばん近い期間（終わったばかりの期間）を最初に出す
  const month = state.today.slice(0, 7);
  state.kpiMonth = month;
  state.taxMonth = addMonths(month, -1);
  const curStart = Number(month.slice(5, 7)) % 2 === 1 ? addMonths(month, -1) : month;
  const prevStart = addMonths(curStart, -2);
  state.period = `${prevStart}_${addMonths(prevStart, 1).slice(5, 7)}`;
  selectTab("kpi");
}

start();
