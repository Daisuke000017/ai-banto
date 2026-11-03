// ゲスト画面（M12）：言語を選ぶ → 人数・国籍を1回入れる → ホーム
// 🔒 文はすべて textContent で出す。名前・旅券番号・写真は聞かない。

const LANGS = ["ko", "zh-TW", "en", "ja"]; // 画面に並べる順（G-1）
const LANG_NAME = { ko: "한국어", "zh-TW": "繁體中文", en: "English", ja: "日本語" };
const MAX = 20;

const T = {
  ja: {
    suggest: "この端末の言語",
    pTitle: "何人で泊まりますか",
    reason: "宿泊税と、法律で決まった報告の人数を数えるためです。名前・パスポートの番号・写真はお聞きしません。",
    adults: "大人", children: "子ども", infants: "乳幼児",
    minus: "減らす", plus: "増やす",
    nTitle: "国籍（1人ずつ）",
    person: (n) => `${n}人目`,
    choose: "選んでください",
    save: "これで送る",
    saving: "送っています",
    chooseAll: "国籍を、全員分選んでください。",
    saveError: "送れませんでした。もう一度押してください。",
    back: "← 戻る",
    arrival: "到着案内", bus: "バス", sos: "もしものとき",
    people: "人数を直す",
    done: "人数を受け取りました。ありがとうございます。",
    checked: "宿のオーナーが確かめた案内です。",
    busSoon: "バスの案内は、いま準備しています。",
    s119: "火事・救急車", s110: "警察",
    sosNote: "押すと電話がかかります。",
    foot: "デモのデータはすべて架空です。",
    dates: (a, b) => `${a} 〜 ${b}`,
  },
  en: {
    suggest: "Your phone's language",
    pTitle: "How many people are staying?",
    reason: "We use this only to count guests for the accommodation tax and the report required by law. We never ask for names, passport numbers or photos.",
    adults: "Adults", children: "Children", infants: "Infants",
    minus: "Fewer", plus: "More",
    nTitle: "Nationality (one per person)",
    person: (n) => `Person ${n}`,
    choose: "Please choose",
    save: "Send",
    saving: "Sending",
    chooseAll: "Please choose a nationality for everyone.",
    saveError: "Could not send. Please press again.",
    back: "← Back",
    arrival: "Arrival guide", bus: "Bus", sos: "Emergency",
    people: "Change number of guests",
    done: "Thank you. We received the number of guests.",
    checked: "This guide was checked by your host.",
    busSoon: "The bus guide is being prepared.",
    s119: "Fire / Ambulance", s110: "Police",
    sosNote: "Tap to make a phone call.",
    foot: "All data in this demo is fictional.",
    dates: (a, b) => `${a} – ${b}`,
  },
  ko: {
    suggest: "휴대폰 언어",
    pTitle: "몇 분이 숙박하시나요?",
    reason: "숙박세와 법으로 정해진 보고의 인원을 세기 위한 것입니다. 이름·여권 번호·사진은 묻지 않습니다.",
    adults: "성인", children: "어린이", infants: "영유아",
    minus: "줄이기", plus: "늘리기",
    nTitle: "국적 (한 분씩)",
    person: (n) => `${n}번째 분`,
    choose: "선택하세요",
    save: "보내기",
    saving: "보내는 중",
    chooseAll: "모든 분의 국적을 선택해 주세요.",
    saveError: "보내지 못했습니다. 다시 눌러 주세요.",
    back: "← 뒤로",
    arrival: "도착 안내", bus: "버스", sos: "긴급 시",
    people: "인원 수정",
    done: "인원을 받았습니다. 감사합니다.",
    checked: "숙소 호스트가 확인한 안내입니다.",
    busSoon: "버스 안내는 지금 준비 중입니다.",
    s119: "화재·구급차", s110: "경찰",
    sosNote: "누르면 전화가 걸립니다.",
    foot: "이 데모의 데이터는 모두 가상입니다.",
    dates: (a, b) => `${a} ~ ${b}`,
  },
  "zh-TW": {
    suggest: "您手機的語言",
    pTitle: "請問幾位入住？",
    reason: "僅用於計算住宿稅及法律規定之申報人數。不會詢問姓名、護照號碼或照片。",
    adults: "成人", children: "兒童", infants: "嬰幼兒",
    minus: "減少", plus: "增加",
    nTitle: "國籍（每人一項）",
    person: (n) => `第${n}位`,
    choose: "請選擇",
    save: "送出",
    saving: "送出中",
    chooseAll: "請選擇每一位的國籍。",
    saveError: "無法送出。請再按一次。",
    back: "← 返回",
    arrival: "抵達指南", bus: "公車", sos: "緊急時",
    people: "修改人數",
    done: "已收到人數，謝謝您。",
    checked: "此指南已由屋主確認。",
    busSoon: "公車指南正在準備中。",
    s119: "火災・救護車", s110: "警察",
    sosNote: "按下即可撥打電話。",
    foot: "此示範的資料皆為虛構。",
    dates: (a, b) => `${a} ～ ${b}`,
  },
};

// 国籍の一覧（サーバーの COUNTRY_CODES と同じ並び）
const COUNTRIES = [
  ["KR", "韓国", "South Korea", "한국", "韓國"],
  ["TW", "台湾", "Taiwan", "대만", "台灣"],
  ["HK", "香港", "Hong Kong", "홍콩", "香港"],
  ["CN", "中国", "China", "중국", "中國大陸"],
  ["JP", "日本", "Japan", "일본", "日本"],
  ["US", "アメリカ", "United States", "미국", "美國"],
  ["AU", "オーストラリア", "Australia", "호주", "澳洲"],
  ["GB", "イギリス", "United Kingdom", "영국", "英國"],
  ["FR", "フランス", "France", "프랑스", "法國"],
  ["DE", "ドイツ", "Germany", "독일", "德國"],
  ["SG", "シンガポール", "Singapore", "싱가포르", "新加坡"],
  ["TH", "タイ", "Thailand", "태국", "泰國"],
  ["OTHER", "その他", "Other", "기타", "其他"],
];
const COL = { ja: 1, en: 2, ko: 3, "zh-TW": 4 };

const $ = (id) => document.getElementById(id);
const token = (location.pathname.match(/^\/g\/([A-Za-z0-9_-]{20,100})$/) ?? [])[1];
const api = (action) => `/api/g/${token}/${action}`;

const state = { data: null, lang: "en", counts: { adults: 1, children: 0, infants: 0 }, nats: [], justSaved: false };

function show(id) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id;
  $("foot").hidden = ["v-loading", "v-gone", "v-error"].includes(id);
  window.scrollTo(0, 0);
}

function setLang(lang) {
  state.lang = T[lang] ? lang : "en";
  document.documentElement.lang = state.lang;
  $("foot").textContent = T[state.lang].foot;
}

/** スマホの言語設定から最初の候補を選ぶ */
function phoneLang() {
  for (const l of navigator.languages ?? [navigator.language]) {
    const s = String(l).toLowerCase();
    if (s.startsWith("ko")) return "ko";
    if (s.startsWith("zh")) return "zh-TW";
    if (s.startsWith("ja")) return "ja";
    if (s.startsWith("en")) return "en";
  }
  return "en";
}

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 404) {
    const e = new Error("gone");
    e.gone = true;
    throw e;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error("http");
    e.body = body;
    throw e;
  }
  return body;
}
const postJson = (action, body) =>
  getJson(api(action), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function fail(e) {
  show(e?.gone ? "v-gone" : "v-error");
}

// ---- 読み込み ----
async function load() {
  show("v-loading");
  if (!token) return show("v-gone");
  try {
    state.data = await getJson(api("home"));
  } catch (e) {
    return fail(e);
  }
  const d = state.data;
  setLang(d.language);
  if (!d.language_chosen) return renderLang();
  if (!d.profile) return renderProfile(false);
  renderHome();
}

// ---- G-1 言語 ----
function renderLang() {
  const list = $("lang-list");
  list.replaceChildren();
  const sug = phoneLang();
  for (const l of [sug, ...LANGS.filter((x) => x !== sug)]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lang" + (l === sug ? " suggest" : "");
    b.lang = l;
    const name = document.createElement("span");
    name.textContent = LANG_NAME[l];
    b.append(name);
    if (l === sug) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = T[l].suggest;
      b.append(hint);
    }
    b.addEventListener("click", () => chooseLang(l));
    list.append(b);
  }
  show("v-lang");
}

async function chooseLang(l) {
  for (const b of document.querySelectorAll(".lang")) b.disabled = true;
  try {
    await postJson("language", { language: l });
    // 案内の文を選んだ言語で取り直す
    state.data = await getJson(api("home"));
  } catch (e) {
    return fail(e);
  }
  setLang(state.data.language);
  if (!state.data.profile) return renderProfile(false);
  renderHome();
}

// ---- G-2 人数・国籍 ----
function natList(obj) {
  const out = [];
  for (const [code] of COUNTRIES) for (let i = 0; i < Number(obj?.[code] ?? 0); i++) out.push(code);
  return out;
}

function renderProfile(editing) {
  const t = T[state.lang];
  const src = state.data.profile ?? state.data.booked;
  state.counts = {
    adults: Math.min(MAX, Math.max(1, Number(src.adults) || 1)),
    children: Math.min(MAX, Math.max(0, Number(src.children) || 0)),
    infants: Math.min(MAX, Math.max(0, Number(src.infants) || 0)),
  };
  state.nats = natList(src.nationalities);
  $("p-title").textContent = t.pTitle;
  $("p-reason").textContent = t.reason;
  $("n-title").textContent = t.nTitle;
  $("p-save").textContent = t.save;
  $("p-save").disabled = false;
  $("p-msg").hidden = true;
  const back = $("profile-back");
  back.hidden = !editing;
  back.textContent = t.back;
  for (const el of document.querySelectorAll(".stepper")) buildStepper(el);
  renderNats();
  show("v-profile");
}

function buildStepper(el) {
  const t = T[state.lang];
  const kind = el.dataset.kind;
  const min = kind === "adults" ? 1 : 0;
  el.replaceChildren();
  const label = document.createElement("span");
  label.className = "label";
  label.id = `lbl-${kind}`;
  label.textContent = t[kind];
  const minus = document.createElement("button");
  minus.type = "button";
  minus.textContent = "−";
  minus.setAttribute("aria-label", `${t[kind]} ${t.minus}`);
  const count = document.createElement("output");
  count.className = "count";
  count.setAttribute("aria-labelledby", label.id);
  const plus = document.createElement("button");
  plus.type = "button";
  plus.textContent = "+";
  plus.setAttribute("aria-label", `${t[kind]} ${t.plus}`);
  const sync = () => {
    count.textContent = String(state.counts[kind]);
    minus.disabled = state.counts[kind] <= min;
    plus.disabled = state.counts[kind] >= MAX;
  };
  minus.addEventListener("click", () => {
    state.counts[kind] = Math.max(min, state.counts[kind] - 1);
    sync();
    renderNats();
  });
  plus.addEventListener("click", () => {
    state.counts[kind] = Math.min(MAX, state.counts[kind] + 1);
    sync();
    renderNats();
  });
  sync();
  el.append(label, minus, count, plus);
}

const total = () => state.counts.adults + state.counts.children + state.counts.infants;

function renderNats() {
  const t = T[state.lang];
  const n = total();
  // 人数が増えたら、1人目と同じ国を仮に入れておく（選び直せる）
  while (state.nats.length < n) state.nats.push(state.nats[0] ?? "");
  state.nats.length = n;
  const list = $("n-list");
  list.replaceChildren();
  state.nats.forEach((code, i) => {
    const row = document.createElement("div");
    row.className = "nat-row";
    const id = `nat-${i}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = t.person(i + 1);
    const sel = document.createElement("select");
    sel.id = id;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = t.choose;
    sel.append(blank);
    for (const c of COUNTRIES) {
      const o = document.createElement("option");
      o.value = c[0];
      o.textContent = c[COL[state.lang]];
      sel.append(o);
    }
    sel.value = code;
    sel.addEventListener("change", () => {
      state.nats[i] = sel.value;
      sel.classList.toggle("bad", !sel.value);
    });
    row.append(label, sel);
    list.append(row);
  });
}

$("p-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const t = T[state.lang];
  const msg = $("p-msg");
  msg.hidden = true;
  const missing = state.nats.findIndex((c) => !c);
  if (missing >= 0) {
    for (const [i, c] of state.nats.entries()) $(`nat-${i}`).classList.toggle("bad", !c);
    msg.textContent = t.chooseAll;
    msg.hidden = false;
    $(`nat-${missing}`).focus();
    return;
  }
  const nationalities = {};
  for (const c of state.nats) nationalities[c] = (nationalities[c] ?? 0) + 1;
  const btn = $("p-save");
  btn.disabled = true;
  btn.textContent = t.saving;
  try {
    const res = await postJson("profile", { language: state.lang, ...state.counts, nationalities });
    state.data.profile = res.profile;
  } catch (e) {
    if (e?.gone) return fail(e);
    btn.disabled = false;
    btn.textContent = t.save;
    msg.textContent = t.saveError;
    msg.hidden = false;
    return;
  }
  state.justSaved = true;
  renderHome();
});

$("profile-back").addEventListener("click", () => renderHome());

// ---- G-3 ホーム ----
function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(state.lang, { month: "short", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" }).format(d);
}

function renderHome() {
  const t = T[state.lang];
  const d = state.data;
  $("h-inn").textContent = d.inn_name;
  $("h-dates").textContent = t.dates(fmtDate(d.checkin), fmtDate(d.checkout));
  $("t-arrival").textContent = t.arrival;
  $("t-bus").textContent = t.bus;
  $("t-sos").textContent = t.sos;
  $("h-people").textContent = t.people;
  const done = $("h-done");
  done.textContent = t.done;
  done.hidden = !state.justSaved;
  state.justSaved = false;
  show("v-home");
}

for (const tile of document.querySelectorAll(".tile")) tile.addEventListener("click", () => openPanel(tile.dataset.open));
$("h-people").addEventListener("click", () => renderProfile(true));
$("h-lang").addEventListener("click", () => renderLang());

function openPanel(which) {
  const t = T[state.lang];
  $("panel-back").textContent = t.back;
  $("pn-title").textContent = t[which];
  for (const p of ["arrival", "bus", "sos"]) $(`pn-${p}`).hidden = p !== which;
  if (which === "arrival") {
    $("pn-text").textContent = state.data.text;
    $("pn-src").textContent = t.checked;
    $("pn-src").hidden = state.data.source !== "owner_checked";
  } else if (which === "bus") {
    $("pn-bus-text").textContent = t.busSoon;
  } else {
    $("sos-119").textContent = t.s119;
    $("sos-110").textContent = t.s110;
    $("sos-note").textContent = t.sosNote;
  }
  show("v-panel");
}
$("panel-back").addEventListener("click", () => renderHome());

$("retry").addEventListener("click", () => load());

load();
