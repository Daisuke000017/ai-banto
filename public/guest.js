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
    openBus();
  } else {
    $("sos-119").textContent = t.s119;
    $("sos-110").textContent = t.s110;
    $("sos-note").textContent = t.sosNote;
  }
  show("v-panel");
}
$("panel-back").addEventListener("click", () => renderHome());

// ---- バスのタブ（M13）：時刻はサーバーのプログラムが出す。ここは見せるだけ ----
const BT = {
  ja: {
    demo: (d) => `デモ用・${d}改正の時刻表から作成。必ず公式の時刻表で確認してください。`,
    demoPlain: "デモ用の時刻です。必ず公式の時刻表で確認してください。",
    loading: "読み込み中です",
    error: "時刻を読み込めませんでした。もう一度開いてください。",
    stopLabel: "いちばん近いバス停",
    walk: (n) => `宿から歩いて${n}分`,
    kind: { weekday: "平日", sat: "土曜", sun_holiday: "日曜・祝日" },
    now: "いま",
    toward: (x) => `${x} 方面`, sep: "・",
    next: "次のバス", after: "そのあと", last: "今日の最終バス",
    none: "今日のバスは、もうありません。",
    gone: "出ました",
    inMin: (n) => (n <= 0 ? "まもなく" : n >= 60 ? `あと${Math.floor(n / 60)}時間${n % 60}分` : `あと${n}分`),
    arrive: (to, t) => `${to} ${t}着`,
    mapTitle: "路線図（線の太さ＝1日の本数）",
    mapNote: "上り・下りの合計。朝夕は鵜戸神宮を通らない便があります。",
    inn: "宿", walkShort: (n) => `${n}分`, count: (n) => `${n}本`,
    mapAlt: (a) => `路線図。宿から${a}まで歩いて行けます。`,
    rideTitle: "バスの乗り方",
    ride: [
      "後ろのドアから乗り、整理券（番号の紙）を取ります。",
      "降りるバス停の前に、ボタンを押します。",
      "前の運賃表で、整理券の番号の運賃を見ます。",
      "前のドアから降り、運賃と整理券を運賃箱に入れます。",
    ],
    allTitle: "今日の時刻をすべて見る",
    tel: "バスの問い合わせ（お客様バス案内センター）",
    live: "宮交バスどこドコ？？（バスがいまどこにいるか）",
    src: (op) => `出典：${op}の時刻表（PDF）`,
  },
  en: {
    demo: (d) => `For demo use. Made from the timetable revised on ${d}. Always check the official timetable.`,
    demoPlain: "Demo times. Always check the official timetable.",
    loading: "Loading",
    error: "Could not load the times. Please open this page again.",
    stopLabel: "Nearest bus stop",
    walk: (n) => `${n} min walk from your stay`,
    kind: { weekday: "Weekday", sat: "Saturday", sun_holiday: "Sunday/holiday" },
    now: "Now",
    toward: (x) => `To ${x}`, sep: " / ",
    next: "Next bus", after: "After that", last: "Last bus today",
    none: "No more buses today.",
    gone: "Left",
    inMin: (n) => (n <= 0 ? "Now" : n >= 60 ? `in ${Math.floor(n / 60)} h ${n % 60} min` : `in ${n} min`),
    arrive: (to, t) => `arrives ${to} ${t}`,
    mapTitle: "Route map (line width = buses per day)",
    mapNote: "Both directions combined. Some morning and evening buses do not stop at Udo Jingu.",
    inn: "Stay", walkShort: (n) => `${n} min`, count: (n) => `${n}/day`,
    mapAlt: (a) => `Route map. You can walk from your stay to ${a}.`,
    rideTitle: "How to ride",
    ride: [
      "Get on at the back door and take a numbered ticket.",
      "Press the button before your stop.",
      "Find your ticket number on the fare board at the front to see the fare.",
      "Get off at the front door. Put the fare and the ticket in the fare box.",
    ],
    allTitle: "See all of today's departures",
    tel: "Bus information center (Japanese)",
    live: "Where is the bus now? “Miyako Bus Doko Doko” (Japanese site)",
    src: () => "Source: Miyazaki Kotsu timetable (PDF, Japanese)",
  },
  ko: {
    demo: (d) => `데모용. ${d} 개정 시간표로 작성했습니다. 반드시 공식 시간표를 확인해 주세요.`,
    demoPlain: "데모용 시간입니다. 반드시 공식 시간표를 확인해 주세요.",
    loading: "불러오는 중입니다",
    error: "시간을 불러오지 못했습니다. 다시 열어 주세요.",
    stopLabel: "가장 가까운 정류장",
    walk: (n) => `숙소에서 걸어서 ${n}분`,
    kind: { weekday: "평일", sat: "토요일", sun_holiday: "일요일·공휴일" },
    now: "지금",
    toward: (x) => `${x} 방면`, sep: "·",
    next: "다음 버스", after: "그다음", last: "오늘 막차",
    none: "오늘 버스는 더 이상 없습니다.",
    gone: "출발함",
    inMin: (n) => (n <= 0 ? "곧 출발" : n >= 60 ? `${Math.floor(n / 60)}시간 ${n % 60}분 후` : `${n}분 후`),
    arrive: (to, t) => `${to} ${t} 도착`,
    mapTitle: "노선도 (선 굵기 = 하루 운행 수)",
    mapNote: "상행·하행 합계. 아침·저녁에는 우도 신궁을 거치지 않는 버스가 있습니다.",
    inn: "숙소", walkShort: (n) => `${n}분`, count: (n) => `${n}편`,
    mapAlt: (a) => `노선도. 숙소에서 ${a}까지 걸어갈 수 있습니다.`,
    rideTitle: "버스 타는 법",
    ride: [
      "뒷문으로 타고 정리권(번호가 적힌 종이)을 뽑습니다.",
      "내릴 정류장 전에 버튼을 누릅니다.",
      "앞쪽 운임표에서 정리권 번호의 요금을 확인합니다.",
      "앞문으로 내리며 요금과 정리권을 요금함에 넣습니다.",
    ],
    allTitle: "오늘 시간 모두 보기",
    tel: "버스 안내 센터 (일본어)",
    live: "버스가 지금 어디에? ‘미야코 버스 도코도코’ (일본어 사이트)",
    src: () => "출처: 미야자키 교통 시간표 (PDF, 일본어)",
  },
  "zh-TW": {
    demo: (d) => `示範用。依${d}修訂之時刻表製作。請務必確認官方時刻表。`,
    demoPlain: "示範用時刻。請務必確認官方時刻表。",
    loading: "載入中",
    error: "無法載入時刻。請再開啟一次。",
    stopLabel: "最近的公車站",
    walk: (n) => `從住宿步行${n}分鐘`,
    kind: { weekday: "平日", sat: "週六", sun_holiday: "週日・國定假日" },
    now: "現在",
    toward: (x) => `往${x}`, sep: "、",
    next: "下一班", after: "之後", last: "今日末班車",
    none: "今天已無班次。",
    gone: "已發車",
    inMin: (n) => (n <= 0 ? "即將發車" : n >= 60 ? `${Math.floor(n / 60)}小時${n % 60}分鐘後` : `${n}分鐘後`),
    arrive: (to, t) => `${t} 抵達${to}`,
    mapTitle: "路線圖（線的粗細＝每日班次）",
    mapNote: "上下行合計。早晚有不經過鵜戶神宮的班次。",
    inn: "住宿", walkShort: (n) => `${n}分鐘`, count: (n) => `${n}班`,
    mapAlt: (a) => `路線圖。從住宿可步行至${a}。`,
    rideTitle: "搭乘方式",
    ride: [
      "從後門上車，抽取整理券（印有號碼的紙）。",
      "到站前按下車鈴。",
      "看前方的票價表，確認整理券號碼對應的票價。",
      "從前門下車，將車資和整理券投入票箱。",
    ],
    allTitle: "查看今天所有班次",
    tel: "公車服務中心（日語）",
    live: "公車現在在哪裡？「宮交巴士 Doko Doko」（日文網站）",
    src: () => "出處：宮崎交通時刻表（PDF，日文）",
  },
};

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, String(v));
  if (parent) parent.append(el);
  return el;
}
function svgText(parent, x, y, text, cls, anchor = "start") {
  const el = svg("text", { x, y, class: cls, "text-anchor": anchor }, parent);
  el.textContent = text;
  return el;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const paren = (x) => (state.lang === "ja" || state.lang === "zh-TW" ? `（${x}）` : ` (${x})`);

function longDate(iso) {
  const d = new Date(`${iso}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(state.lang, { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }).format(d);
}

const busCache = {};
async function openBus() {
  const b = BT[state.lang];
  $("bus-demo").textContent = b.demoPlain;
  $("bus-tel-label").textContent = b.tel;
  $("bus-live").textContent = b.live;
  $("bus-src").textContent = b.src("");
  $("bus-body").hidden = true;
  $("bus-state").hidden = false;
  $("bus-state").textContent = b.loading;
  try {
    if (!busCache[state.lang]) {
      const qs = new URLSearchParams({ lang: state.lang });
      const t = new URLSearchParams(location.search).get("time"); // デモで時刻を決めて見せるとき
      if (t) qs.set("time", t);
      busCache[state.lang] = await getJson(`${api("bus")}?${qs}`);
    }
  } catch (e) {
    if (e?.gone) return fail(e);
    $("bus-state").textContent = b.error;
    return;
  }
  renderBus(busCache[state.lang]);
}

function busRow(cls, label, d, b) {
  const box = el("div", cls);
  box.append(el("p", "bus-label", label));
  const line = el("p", "bus-line");
  line.append(el("span", "bus-time", d.time));
  line.append(el("span", "bus-in", b.inMin(d.in_minutes)));
  box.append(line);
  box.append(el("p", "bus-arrive", b.arrive(d.to, d.arrive)));
  if (d.note) box.append(el("p", "bus-note", d.note));
  return box;
}

function renderBus(data) {
  const b = BT[state.lang];
  const tt = data.timetable;
  $("bus-demo").textContent = b.demo(longDate(tt.timetable_date));
  $("bus-src").textContent = b.src(tt.operator);
  $("bus-state").hidden = true;

  $("bus-stop-label").textContent = b.stopLabel;
  $("bus-stop-name").textContent = data.stop.name;
  $("bus-walk").textContent = b.walk(data.stop.walk_minutes);
  $("bus-today").textContent = `${fmtDate(data.date)} · ${b.kind[data.day_kind] ?? ""} · ${b.now} ${data.now}`;

  // 方向ごとのカード：次のバス（大きく）→ そのあと2本 → 今日の最終バス
  const dirs = $("bus-dirs");
  dirs.replaceChildren();
  for (const d of data.directions) {
    const card = el("section", "card bus-dir");
    card.append(el("h2", "sub-title", b.toward(d.toward.join(b.sep))));
    if (d.next.length) {
      card.append(busRow("bus-next", b.next, d.next[0], b));
      if (d.next.length > 1) {
        card.append(el("p", "bus-label", b.after));
        const ul = el("ul", "bus-after");
        for (const n of d.next.slice(1)) {
          const li = el("li");
          li.append(el("span", "bus-time-s", n.time));
          li.append(el("span", "bus-after-to", ` ${b.arrive(n.to, n.arrive)}`));
          ul.append(li);
        }
        card.append(ul);
      }
    } else {
      card.append(el("p", "bus-none", b.none));
    }
    if (d.last) {
      const last = busRow("bus-last", b.last, d.last, b);
      if (d.last.in_minutes < 0) {
        last.classList.add("passed");
        last.querySelector(".bus-in").textContent = b.gone;
      }
      card.append(last);
    }
    dirs.append(card);
  }

  drawMap(data, b);
  $("bus-map-title").textContent = b.mapTitle;
  $("bus-map-note").textContent = b.mapNote;

  // 乗り方（しるし＋短い文）
  $("bus-ride-title").textContent = b.rideTitle;
  const ride = $("bus-ride");
  ride.replaceChildren();
  b.ride.forEach((text, i) => {
    const li = el("li");
    li.append(rideIcon(i));
    li.append(el("span", null, text));
    ride.append(li);
  });

  // 今日の時刻をすべて
  $("bus-all-title").textContent = b.allTitle;
  const all = $("bus-all");
  all.replaceChildren();
  for (const d of data.directions) {
    all.append(el("h3", "bus-all-head", b.toward(d.toward.join(b.sep))));
    const ul = el("ul", "bus-all-list");
    for (const a of d.all) {
      const li = el("li", a.passed ? "passed" : null);
      li.append(el("span", "bus-time-s", a.time));
      li.append(el("span", null, ` ${a.to}${a.note ? paren(a.note) : ""}`));
      ul.append(li);
    }
    all.append(ul);
  }

  $("bus-body").hidden = false;
}

// 路線図：宿の最寄り（青島）を真ん中に。線の太さ＝1日の本数（上り・下りの合計）
function drawMap(data, b) {
  const m = $("bus-map");
  m.replaceChildren();
  m.setAttribute("aria-label", b.mapAlt(data.stop.name));
  const seg = Object.fromEntries(data.segments.map((s) => [s.id, s.count]));
  const max = Math.max(1, ...data.segments.map((s) => s.count));
  const w = (n) => (2 + (n / max) * 12).toFixed(1);
  const S = data.stops;
  // 文字どうしが重ならない配置（英語の長い名前「Udo Jingu Shrine」なども320の幅に収まる）
  const A = [90, 120]; // 青島
  const END = [276, 166]; // 青島サンクマール

  svg("path", { d: `M90 28V${A[1]}`, class: "map-line", "stroke-width": w(seg.north) }, m);
  svg("path", { d: `M${A[0]} ${A[1]}V280`, class: "map-line", "stroke-width": w(seg.south_n) }, m);
  svg("path", { d: `M${A[0]} ${A[1]}L${END[0]} ${END[1]}`, class: "map-line", "stroke-width": w(seg.south_a) }, m);
  // 宿から歩く道（点線）
  svg("path", { d: `M256 80L${A[0] + 8} ${A[1] - 4}`, class: "map-walk" }, m);
  svg("path", { d: "M258 82V66l12-10 12 10v16z", class: "map-inn" }, m);
  svgText(m, 270, 104, b.inn, "map-label", "middle");
  svgText(m, 180, 84, b.walkShort(data.stop.walk_minutes), "map-label map-walk-label", "middle");

  for (const [x, y] of [[90, 28], [90, 222], [90, 280], END]) svg("circle", { cx: x, cy: y, r: 7, class: "map-stop" }, m);
  svg("circle", { cx: A[0], cy: A[1], r: 11, class: "map-stop map-here" }, m);

  svgText(m, 106, 33, S.miyazaki_st, "map-label");
  svgText(m, 72, 126, S.aoshima, "map-label map-strong", "end");
  svgText(m, 106, 227, S.udo, "map-label");
  svgText(m, 106, 285, S.obi, "map-label");
  svgText(m, 316, 194, S.sunqmar, "map-label", "end");

  svgText(m, 76, 78, b.count(seg.north), "map-label map-count", "end");
  svgText(m, 76, 180, b.count(seg.south_n), "map-label map-count", "end");
  svgText(m, 185, 133, b.count(seg.south_a), "map-label map-count", "middle");
}

// 乗り方のしるし（後ろから乗る・ボタン・運賃表・運賃箱）
function rideIcon(i) {
  const s = svg("svg", { viewBox: "0 0 48 48", class: "ride-ico", "aria-hidden": "true" });
  const paths = [
    ["M8 42V8h20v34", "M22 25h1", "M34 14h8v12h-8z", "M36 18h4"],
    ["M24 24m-14 0a14 14 0 1 0 28 0a14 14 0 1 0 -28 0", "M24 24m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0"],
    ["M6 10h36v24H6z", "M6 18h36M6 26h36M18 10v24M30 10v24", "M24 34v6"],
    ["M10 22h28v20H10z", "M20 22v-2h8v2", "M24 6v10", "M19 12l5 5 5-5"],
  ][i];
  for (const d of paths) svg("path", { d }, s);
  return s;
}

$("retry").addEventListener("click", () => load());

load();
