// バスのタブ（M13・G-3）。次のバス・今日の最終バス・線の太さ（1日の本数）を、時刻表からプログラムだけで出す。
// 時刻表・停留所はAIに渡さない。画面には必ず「◯年◯月◯日改正の時刻表より」と添える。
import { busStops, busStopTimes, innAccess, stopPoles, timetable } from "../../seed/demo-bus.js";
import { dayKind } from "./dates.js";

const NAME_KEY = { ja: "name_ja", en: "name_en", ko: "name_ko", "zh-TW": "name_zh_hant" };
const STOPS = new Map(busStops.map((s) => [s.id, s]));

/**
 * 乗り場を Google マップで開くリンク（キー不要の公開URL）。乗り場の位置だけを開き、いまいる場所からの道順は出さない
 */
export function poleMapUrl(dir) {
  const p = stopPoles[dir];
  if (!p) return null;
  const q = new URLSearchParams({ api: "1", query: `${p.lat},${p.lng}`, query_place_id: p.place_id });
  return `https://www.google.com/maps/search/?${q}`;
}

/**
 * 停留所の名前。その言語の名前がなければ「日本語名 (英語名)」。
 * 訳を作り足さないのは、まちがった名前を出さないため。日本語名はバス停の看板と見比べられるように残す
 */
export function stopName(id, lang) {
  const s = STOPS.get(id);
  if (!s) return id;
  const own = s[NAME_KEY[lang] ?? "name_en"];
  if (own) return own;
  return s.name_en ? `${s.name_ja} (${s.name_en})` : s.name_ja;
}

// 便の注意書き（表に書いてあるもの）の訳。ここに無いものは日本語のまま出す
const NOTE_TR = {
  木花台経由: { en: "via Kibanadai", ko: "기바나다이 경유", "zh-TW": "經木花台" },
  休養村経由: { en: "via Kyuyomura", ko: "규요무라 경유", "zh-TW": "經休養村" },
  "堀切トンネル経由・鵜戸神宮を通らない": {
    en: "via Horikiri Tunnel, does not stop at Udo Jingu",
    ko: "호리키리 터널 경유, 우도 신궁 미경유",
    "zh-TW": "經堀切隧道，不經過鵜戶神宮",
  },
  鵜戸神宮を通らない: { en: "does not stop at Udo Jingu", ko: "우도 신궁 미경유", "zh-TW": "不經過鵜戶神宮" },
};
const noteText = (note, lang) => (note ? (lang === "ja" ? note : NOTE_TR[note]?.[lang] ?? note) : null);

const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** "HH:MM" を分に。形が違えば null */
export function parseClock(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** その日に走る便（trip_id ごとに、停留所を走る順に並べたもの） */
export function tripsOn(date) {
  const kind = dayKind(date);
  const dayType = kind === "weekday" ? "weekday" : "holiday";
  const trips = new Map();
  for (const row of busStopTimes) {
    if (row.day_type !== dayType) continue;
    if (row.only && row.only !== kind) continue;
    if (!trips.has(row.trip_id)) trips.set(row.trip_id, []);
    trips.get(row.trip_id).push(row);
  }
  return [...trips.values()].map((rows) => rows.sort((a, b) => a.seq - b.seq));
}

// 線の区間：宿の最寄り（青島）から3方向。1日の本数は上り・下りの合計
const SEGMENTS = [
  { id: "north", from: "aoshima", to: "miyazaki_st", reach: ["miyazaki_st"] },
  { id: "south_a", from: "aoshima", to: "sunqmar", reach: ["shirahama", "sunqmar"], route: "aoshima" },
  { id: "south_n", from: "aoshima", to: "obi", reach: ["michinoeki", "udo", "fukige", "obi"], route: "nichinan" },
];

/**
 * バスのタブに出すもの。
 * @param {{date:string, minutes:number, lang:string}} p minutes は「いま」（0時からの分）
 */
export function busBoard({ date, minutes, lang }) {
  const stopId = innAccess.stop_id;
  const trips = tripsOn(date);

  // 最寄りのバス停から出る便（そこが終点の便は除く）
  const deps = [];
  for (const rows of trips) {
    const i = rows.findIndex((r) => r.stop_id === stopId);
    if (i < 0 || i === rows.length - 1) continue;
    const last = rows[rows.length - 1];
    deps.push({
      direction: rows[0].direction,
      time: rows[i].time,
      min: toMin(rows[i].time),
      to_id: last.stop_id,
      to: stopName(last.stop_id, lang),
      arrive: last.time,
      note: noteText(rows[0].note, lang),
    });
  }
  deps.sort((a, b) => a.min - b.min);

  const view = (d) => ({ time: d.time, to: d.to, to_id: d.to_id, arrive: d.arrive, note: d.note, in_minutes: d.min - minutes });
  const directions = ["up", "down"].map((dir) => {
    const all = deps.filter((d) => d.direction === dir);
    const ahead = all.filter((d) => d.min >= minutes);
    // 行き先は本数の多い順
    const counts = new Map();
    for (const d of all) counts.set(d.to_id, (counts.get(d.to_id) ?? 0) + 1);
    const toward = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => stopName(id, lang));
    return {
      direction: dir,
      toward,
      map_url: poleMapUrl(dir),
      next: ahead.slice(0, 3).map(view),
      last: all.length ? view(all[all.length - 1]) : null,
      all: all.map((d) => ({ time: d.time, to: d.to, note: d.note, passed: d.min < minutes })),
    };
  });

  const segments = SEGMENTS.map((s) => ({
    id: s.id,
    from: stopName(s.from, lang),
    to: stopName(s.to, lang),
    count: trips.filter(
      (rows) => (!s.route || rows[0].route_id === s.route) && rows.some((r) => r.stop_id === s.from) && rows.some((r) => s.reach.includes(r.stop_id)),
    ).length,
  }));

  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return {
    date,
    day_kind: dayKind(date),
    now: `${hh}:${mm}`,
    stop: { id: stopId, name: stopName(stopId, lang), walk_minutes: innAccess.walk_minutes },
    stops: Object.fromEntries(["miyazaki_st", "aoshima", "shirahama", "sunqmar", "udo", "obi"].map((id) => [id, stopName(id, lang)])),
    directions,
    segments,
    timetable: {
      operator: timetable.operator,
      title: timetable.title,
      timetable_date: timetable.timetable_date,
      url: timetable.url,
      contact_tel: timetable.contact_tel,
      live_url: timetable.live_url,
    },
  };
}
