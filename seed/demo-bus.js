// バスの時刻（実在のデータ）。宮崎交通「2-9 日南、青島、ANAホリデイ・イン リゾート宮崎、木花台方面」2026年10月1日改正
//   https://www.miyakoh.co.jp/rosen/0_jikoku/2-09_20261001.pdf
// 元の表は「主な停留所のみ」。ここには、青島を通る便のうち、表から読み取って確かめた停留所の時刻だけを入れた。
// 青島まで行かない便（東宮団地止まり・正蓮寺止まり）は入れていない。
//
// 決めごと
// - 時刻はAIに渡さない。画面にはプログラムがこの表から出し、必ず「2026年10月1日改正の時刻表より」と添える。
// - 時刻は改正のたびに変わる。最新はバス会社の時刻表・お客様バス案内センター（0570-039-385）で確かめてもらう。
// - day_type：weekday＝平日、holiday＝土日祝。only：sat＝土曜のみ（表の▲）、sun_holiday＝日曜・祝日のみ（表の◎）。
// - 便の書き方：[停留所, "時:分"] を走る順に並べる。宮崎駅は下りなら発車、上りなら到着の時刻。

export const timetable = {
  operator: "宮崎交通",
  title: "日南、青島、ANAホリデイ・イン リゾート宮崎、木花台方面",
  timetable_date: "2026-10-01",
  url: "https://www.miyakoh.co.jp/rosen/0_jikoku/2-09_20261001.pdf",
  contact: "お客様バス案内センター 0570-039-385",
};

export const busRoutes = [
  { id: "aoshima", name: "青島方面（宮崎駅〜青島・白浜）", operator: "宮崎交通" },
  { id: "nichinan", name: "日南線（宮崎駅〜鵜戸神宮・飫肥）", operator: "宮崎交通" },
];

// 翻訳がはっきりしない名前は null（画面では日本語名を出す）
export const busStops = [
  { id: "miyazaki_st", name_ja: "宮崎駅", name_en: "Miyazaki Station", name_ko: "미야자키역", name_zh_hant: "宮崎站" },
  { id: "aoshima", name_ja: "青島", name_en: "Aoshima", name_ko: "아오시마", name_zh_hant: "青島" },
  { id: "shirahama", name_ja: "白浜入口", name_en: "Shirahama Iriguchi", name_ko: null, name_zh_hant: null },
  { id: "sunqmar", name_ja: "青島サンクマール", name_en: "Aoshima Sunqmar", name_ko: null, name_zh_hant: null },
  { id: "michinoeki", name_ja: "道の駅フェニックス", name_en: "Michi-no-Eki Phoenix", name_ko: null, name_zh_hant: null },
  { id: "udo", name_ja: "鵜戸神宮", name_en: "Udo Jingu Shrine", name_ko: "우도 신궁", name_zh_hant: "鵜戶神宮" },
  { id: "fukige", name_ja: "吹毛井", name_en: "Fukige", name_ko: null, name_zh_hant: null },
  { id: "obi", name_ja: "飫肥", name_en: "Obi", name_ko: "오비", name_zh_hant: "飫肥" },
];

// 表の注意書き（プログラムがそのまま出す）
export const timetableNotes = [
  "鵜戸神宮：朝夕は鵜戸神宮を通らない便があります",
  "主な停留所の時刻のみ載せています",
];

const A = "aoshima";
const N = "nichinan";

// ---- 平日・下り（宮崎駅 → 青島・その先） ----
const weekdayDown = [
  [A, [["miyazaki_st", "7:45"], ["aoshima", "8:25"], ["shirahama", "8:29"]]],
  [A, [["miyazaki_st", "9:22"], ["aoshima", "10:08"], ["shirahama", "10:12"], ["sunqmar", "10:16"]], "休養村経由"],
  [N, [["miyazaki_st", "9:40"], ["aoshima", "10:33"], ["michinoeki", "10:40"], ["udo", "11:07"], ["obi", "11:49"]]],
  [A, [["miyazaki_st", "10:43"], ["aoshima", "11:31"]]],
  [N, [["miyazaki_st", "11:10"], ["aoshima", "12:03"], ["udo", "12:37"], ["obi", "13:19"]]],
  [N, [["miyazaki_st", "13:30"], ["aoshima", "14:23"], ["udo", "14:57"], ["obi", "15:39"]]],
  [A, [["miyazaki_st", "14:32"], ["aoshima", "15:20"]]],
  [N, [["miyazaki_st", "15:20"], ["aoshima", "16:13"], ["udo", "16:47"], ["obi", "17:29"]]],
  [A, [["miyazaki_st", "16:00"], ["aoshima", "16:48"], ["shirahama", "16:52"]]],
  [A, [["miyazaki_st", "17:00"], ["aoshima", "17:48"]]],
  [A, [["miyazaki_st", "17:33"], ["aoshima", "18:21"]]],
  [N, [["miyazaki_st", "17:37"], ["aoshima", "18:30"], ["fukige", "19:02"], ["obi", "19:43"]], "鵜戸神宮を通らない"],
  [A, [["miyazaki_st", "18:05"], ["aoshima", "18:53"]]],
  [A, [["miyazaki_st", "18:30"], ["aoshima", "19:18"], ["shirahama", "19:22"]]],
  [N, [["miyazaki_st", "18:50"], ["aoshima", "19:43"], ["obi", "20:56"]], "堀切トンネル経由・鵜戸神宮を通らない"],
  [A, [["miyazaki_st", "19:30"], ["aoshima", "20:18"], ["shirahama", "20:22"]]],
  [A, [["miyazaki_st", "20:00"], ["aoshima", "20:48"]]],
];

// ---- 平日・上り（→ 宮崎駅） ----
const weekdayUp = [
  [A, [["shirahama", "6:21"], ["aoshima", "6:25"], ["miyazaki_st", "7:19"]], "木花台経由"],
  [A, [["shirahama", "7:06"], ["aoshima", "7:10"], ["miyazaki_st", "8:16"]]],
  [A, [["shirahama", "7:32"], ["aoshima", "7:36"], ["miyazaki_st", "8:41"]]],
  [N, [["obi", "6:45"], ["aoshima", "7:58"], ["miyazaki_st", "8:52"]], "堀切トンネル経由・鵜戸神宮を通らない"],
  [A, [["shirahama", "8:45"], ["aoshima", "8:49"], ["miyazaki_st", "9:37"]]],
  [N, [["obi", "7:50"], ["udo", "8:32"], ["aoshima", "9:06"], ["miyazaki_st", "10:00"]]],
  [A, [["aoshima", "10:30"], ["miyazaki_st", "11:18"]]],
  [A, [["sunqmar", "10:39"], ["shirahama", "10:43"], ["aoshima", "10:47"], ["miyazaki_st", "11:33"]], "休養村経由"],
  [N, [["obi", "10:20"], ["udo", "11:02"], ["aoshima", "11:36"], ["miyazaki_st", "12:30"]]],
  [A, [["aoshima", "12:07"], ["miyazaki_st", "12:55"]]],
  [N, [["obi", "12:20"], ["udo", "13:02"], ["aoshima", "13:36"], ["miyazaki_st", "14:30"]]],
  [A, [["shirahama", "14:43"], ["aoshima", "14:47"], ["miyazaki_st", "15:41"]]],
  [A, [["aoshima", "15:17"], ["miyazaki_st", "16:03"]], "休養村経由"],
  [A, [["aoshima", "15:57"], ["miyazaki_st", "16:45"]]],
  [N, [["obi", "14:45"], ["udo", "15:27"], ["aoshima", "16:01"], ["miyazaki_st", "16:55"]]],
  [N, [["obi", "15:50"], ["udo", "16:32"], ["aoshima", "17:06"], ["miyazaki_st", "18:00"]]],
  [A, [["aoshima", "18:10"], ["miyazaki_st", "18:58"]]],
];

// ---- 土日祝・下り ----
const holidayDown = [
  [A, [["miyazaki_st", "7:40"], ["aoshima", "8:28"], ["shirahama", "8:32"]]],
  [A, [["miyazaki_st", "9:22"], ["aoshima", "10:08"], ["shirahama", "10:12"], ["sunqmar", "10:16"]], "休養村経由"],
  [N, [["miyazaki_st", "9:40"], ["aoshima", "10:33"], ["udo", "11:07"], ["obi", "11:49"]]],
  [A, [["miyazaki_st", "10:43"], ["aoshima", "11:31"]]],
  [N, [["miyazaki_st", "11:10"], ["aoshima", "12:03"], ["udo", "12:37"], ["obi", "13:19"]]],
  [A, [["miyazaki_st", "12:20"], ["aoshima", "13:06"], ["shirahama", "13:10"], ["sunqmar", "13:14"]], "休養村経由"],
  [N, [["miyazaki_st", "13:30"], ["aoshima", "14:23"], ["udo", "14:57"], ["obi", "15:39"]]],
  [A, [["miyazaki_st", "14:32"], ["aoshima", "15:20"]]],
  [A, [["miyazaki_st", "15:10"], ["aoshima", "15:56"], ["shirahama", "16:00"], ["sunqmar", "16:04"]], "休養村経由"],
  [A, [["miyazaki_st", "16:32"], ["aoshima", "17:20"]]],
  [N, [["miyazaki_st", "17:37"], ["aoshima", "18:30"], ["fukige", "19:02"], ["obi", "19:43"]], "鵜戸神宮を通らない"],
  [A, [["miyazaki_st", "18:10"], ["aoshima", "18:58"]]],
  [A, [["miyazaki_st", "18:30"], ["aoshima", "19:18"], ["shirahama", "19:22"]], null, "sat"],
  [A, [["miyazaki_st", "18:30"], ["aoshima", "19:18"]], null, "sun_holiday"],
  [N, [["miyazaki_st", "18:50"], ["aoshima", "19:43"], ["obi", "20:56"]], "堀切トンネル経由・鵜戸神宮を通らない"],
  [A, [["miyazaki_st", "19:00"], ["aoshima", "19:48"]]],
  [A, [["miyazaki_st", "19:30"], ["aoshima", "20:18"]]],
  [A, [["miyazaki_st", "20:00"], ["aoshima", "20:48"]]],
];

// ---- 土日祝・上り ----
const holidayUp = [
  [A, [["shirahama", "7:06"], ["aoshima", "7:10"], ["miyazaki_st", "7:58"]]],
  [N, [["obi", "6:45"], ["aoshima", "7:58"], ["miyazaki_st", "8:52"]], "鵜戸神宮を通らない"],
  [N, [["obi", "7:50"], ["udo", "8:32"], ["aoshima", "9:06"], ["miyazaki_st", "10:00"]]],
  [A, [["shirahama", "9:09"], ["aoshima", "9:13"], ["miyazaki_st", "10:01"]], null, "sat"],
  [A, [["shirahama", "9:23"], ["aoshima", "9:27"], ["miyazaki_st", "10:15"]], null, "sun_holiday"],
  [A, [["sunqmar", "10:39"], ["shirahama", "10:43"], ["aoshima", "10:47"], ["miyazaki_st", "11:33"]], "休養村経由"],
  [N, [["obi", "10:20"], ["udo", "11:02"], ["aoshima", "11:36"], ["miyazaki_st", "12:30"]]],
  [A, [["aoshima", "12:07"], ["miyazaki_st", "12:55"]]],
  [A, [["sunqmar", "13:35"], ["shirahama", "13:39"], ["aoshima", "13:43"], ["miyazaki_st", "14:29"]], "休養村経由"],
  [A, [["aoshima", "15:57"], ["miyazaki_st", "16:45"]]],
  [N, [["obi", "14:45"], ["udo", "15:27"], ["aoshima", "16:01"], ["miyazaki_st", "16:55"]]],
  [A, [["sunqmar", "16:19"], ["shirahama", "16:23"], ["aoshima", "16:27"], ["miyazaki_st", "17:13"]], "休養村経由"],
  [N, [["obi", "15:50"], ["udo", "16:32"], ["aoshima", "17:06"], ["miyazaki_st", "18:00"]]],
  [A, [["aoshima", "17:40"], ["miyazaki_st", "18:20"]]],
  [A, [["aoshima", "19:20"], ["miyazaki_st", "20:05"]]],
];

const hhmm = (t) => t.padStart(5, "0");

/** 便の一覧を bus_stop_times の行（docs/02_データ設計.md §2-6）に広げる */
function expand(list, dayType, direction) {
  const rows = [];
  list.forEach(([route, stops, note = null, only = null], k) => {
    const trip = `${dayType === "weekday" ? "WD" : "HD"}-${direction === "down" ? "D" : "U"}${String(k + 1).padStart(2, "0")}`;
    stops.forEach(([stop, time], seq) => {
      rows.push({ route_id: route, trip_id: trip, direction, stop_id: stop, seq: seq + 1, time: hhmm(time), day_type: dayType, only, note, timetable_date: timetable.timetable_date });
    });
  });
  return rows;
}

export const busStopTimes = [
  ...expand(weekdayDown, "weekday", "down"),
  ...expand(weekdayUp, "weekday", "up"),
  ...expand(holidayDown, "holiday", "down"),
  ...expand(holidayUp, "holiday", "up"),
];
