// 津波の避難先（実在のデータ）。宿・宿泊者は架空のまま。
//
// 出典（どちらも CC BY 4.0＝出典を書けば利用できる。画面にも必ず出典を出す）
//   ・宮崎市「宮崎市の津波避難ビル一覧」「宮崎市の指定避難所一覧」（R8.4.28時点）
//     https://data.bodik.jp/dataset/452017_hinanbldg ／ https://data.bodik.jp/dataset/452017_hinanjo
//   ・宮崎県「津波浸水想定（南海トラフ巨大地震等・南トラR7）」10mメッシュ
//     https://data.bodik.jp/dataset/450006_1081
//
// 決めごと
// - 入れたのは「災害種別_津波」に印がある施設だけ。印がない施設（青島地区交流センター・青島浄化センター・巖泉寺など）は
//   津波のときの避難先ではないので、わざと入れていない。
// - 宿（架空）の場所から直線で2.7km以内。距離はプログラムが毎回計算する（AIには名前も距離も渡さない）。
// - 2013年の紙のハザードマップ（青島地区）に載っていた「青島グランドホテル」「橘3号館」「青島シルバー苑・青島クリニック」は、
//   2026年4月の市の一覧に無い（2026-11-03 確認）。古い地図は使わず、市の最新の一覧を正とする。
// - 浸水深は、宮崎県のデータを scripts/tsunami-depth.py で宿の地点について読み取った値（2026-11-03）。

export const hazardSources = {
  shelters: { name: "宮崎市 津波避難ビル一覧・指定避難所一覧", date: "2026-04-28", license: "CC BY 4.0", url: "https://data.bodik.jp/dataset/452017_hinanbldg" },
  inundation: { name: "宮崎県 津波浸水想定（南海トラフ巨大地震等・南トラR7）", date: "2025-11-13", license: "CC BY 4.0", url: "https://data.bodik.jp/dataset/450006_1081" },
  latest: { name: "宮崎市 WEB版ハザードマップ", url: "https://webgis.alandis.jp/miyazaki45/portal/consent03_2.html" },
};

// 宿（架空）の場所の想定浸水深（最大）。10m四方のメッシュの値
export const innHazard = { tsunami_max_depth_m: 3.8, mesh_m: 10, source: "inundation" };

// 市のハザードマップ（青島地区）にある呼びかけ。画面ではプログラムがこの文をそのまま出す（AIに書かせない）
export const cityAdvice = "強い揺れを感じたら、浸水が予想される区域外、もしくは、最寄りの高台、津波避難ビル、避難所に避難しましょう。";

// kind：tsunami_building＝津波避難ビル／shelter＝指定避難所（津波に対応）。capacity＝市が想定する収容人数
export const shelters = [
  { id: "B156", kind: "tsunami_building", name: "ロコビーチ", address: "宮崎県宮崎市青島1-75", lat: 31.803277, lng: 131.46482, capacity: 40 },
  { id: "B035", kind: "tsunami_building", name: "ラメールブルー", address: "宮崎県宮崎市青島西2-2-7", lat: 31.80134872, lng: 131.4637383, capacity: 200 },
  { id: "B250", kind: "tsunami_building", name: "青島地域総合センター", address: "宮崎県宮崎市青島西2-1", lat: 31.801717, lng: 131.462231, capacity: 540 },
  { id: "B022", kind: "tsunami_building", name: "介護老人保健施設あおしまのいえ", address: "宮崎県宮崎市青島4-6-3", lat: 31.79612, lng: 131.469279, capacity: 150 },
  { id: "B214", kind: "tsunami_building", name: "ANA ホリデイ・イン リゾート 宮崎", address: "宮崎県宮崎市青島1-16-1", lat: 31.80610061, lng: 131.4610538, capacity: 100 },
  { id: "B034", kind: "tsunami_building", name: "ドルフィン", address: "宮崎県宮崎市青島西1-6-13", lat: 31.80453433, lng: 131.4586429, capacity: 150 },
  { id: "B033", kind: "tsunami_building", name: "グランマリン", address: "宮崎県宮崎市青島西1-6-15", lat: 31.80470233, lng: 131.4583782, capacity: 150 },
  { id: "B244", kind: "tsunami_building", name: "あおしま優亜館(新館)", address: "宮崎県宮崎市大字加江田4910", lat: 31.812875, lng: 131.454521, capacity: 68 },
  { id: "S127", kind: "shelter", name: "宮崎市立青島中学校", address: "宮崎県宮崎市大字折生迫4828", lat: 31.78651566, lng: 131.4691743, capacity: 1069 },
  { id: "S119", kind: "shelter", name: "宮崎市自然休養村センター", address: "宮崎県宮崎市大字加江田6896", lat: 31.80536843, lng: 131.4487142, capacity: 28 },
  { id: "B007", kind: "tsunami_building", name: "ゴールデンレイク", address: "宮崎県宮崎市大字加江田4514-2", lat: 31.81151862, lng: 131.4451344, capacity: 100 },
  { id: "B273", kind: "tsunami_building", name: "ホテル青島サンクマール", address: "宮崎市大字折生迫字戸崎7408番地1", lat: 31.787132, lng: 131.487645, capacity: 192 },
  { id: "S124", kind: "shelter", name: "宮崎県青島青少年自然の家", address: "宮崎県宮崎市大字熊野字藤兵衛中洲", lat: 31.819646, lng: 131.449613, capacity: 498 },
];
