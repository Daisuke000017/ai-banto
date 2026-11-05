// デモ用の架空データ（実在の宿・宿泊者ではありません）
// 「しおさいの家」＝宮崎市の一軒家・2部屋・家主不在型、という設定。
// 採点カード A〜D（ガッツさんヒアリング用）もこの中に入っている：
//   A＝R04（添い寝の子）／B＝R18（3月31日をまたぐ）／C＝R06（途中で1人増える）／D＝R08（キャンセル料あり）

export const DEMO_TODAY = "2026-10-10";

export const innProfile = {
  id: 1,
  name: "しおさいの家（架空）",
  type: "家主不在型",
  rooms: 2,
  address: "宮崎県宮崎市青島（架空の住所）",
  lat: 31.803, // 青島の実在の地点（津波の浸水想定 約3.8m の区域）。宿そのものは架空
  lng: 131.469,
  checkin_method_json: JSON.stringify({ type: "keybox", code_ref: "SECRET:KEYBOX_CODE" }),
  house_rules_json: JSON.stringify(["22時以降は静かに", "室内禁煙", "ごみは分別して玄関の箱へ"]),
  allowed_promises_json: JSON.stringify(["タオルの追加", "チェックアウト後の荷物預かり（12時まで）"]),
  taxi_info_json: JSON.stringify({ name: "架空タクシー", note: "電話番号は画面に出さない" }),
  owner_contact_json: JSON.stringify({ channel: "airbnb_message" }),
  fixed_arrival_json: null,
  infants_taxable: 1,
  fiscal_year_start: "04-01",
  cosleep_free_exempt: 0,
  cancel_fee_treatment: "penalty",
  tax_start_date: "2026-07-01",
  tax_rate: 200,
  // 清掃できる時間（M18）：チェックアウト〜チェックイン
  cleaning_checkout_time: "10:00",
  cleaning_checkin_time: "15:00",
  // 値付けの助言（経営企画）：清掃費1回いくら・最低価格（これ以下では売らない）。架空の値
  cleaning_fee: 5000,
  min_price: 9000,
  // 宿泊税の申告書（宮崎市 様式第10号）に書くこと。すべて架空。法人番号は本物と重ならないよう空（個人の宿として扱う）
  collector_address: "宮崎県宮崎市青島（架空の住所）",
  collector_name: "青島 しおさい（架空）",
  corporate_no: null,
  inn_phone: "0985-00-0000",
  facility_no: "DEMO-001",
  contact_name: "青島 しおさい（架空）",
  contact_phone: "090-0000-0000",
  // 民泊の届出番号（定期報告のファイルに入る）。架空の番号（M＋数字9けたの形だけ合わせた）
  notification_no: "M000000000",
};

// 部屋（宿の設定で登録する）。記号はプログラムが付け、名前はオーナーが付ける
export const rooms = [
  { code: "A", name: "部屋A", sort_order: 1 },
  { code: "B", name: "部屋B", sort_order: 2 },
];

// 清掃の担当（架空の人。名前だけ）。10/12 は「さくら」さんに決めてあり、10/26 はまだ決めていない
export const cleaners = [
  { id: 1, name: "さくら（架空）", sort_order: 1 },
  { id: 2, name: "みなと（架空）", sort_order: 2 },
];
export const cleaningAssignments = [{ reservation_id: "R14", date: "2026-10-12", room: "A", cleaner_id: 1 }];

const g = (n) => `架空ゲスト${n}`;

// 基本は 部屋A。lodging_tax_collected：予約サイトや宿が預かった宿泊税（円）。null＝分からない
export const reservations = [
  // ---- 宿泊税が始まる前（2026年6月まで） ----
  { id: "R01", ota: "airbnb", checkin_date: "2026-04-29", checkout_date: "2026-05-02", adults: 2, language: "ja", tax_collection: "unknown", lodging_tax_collected: null, nationalities_json: { JP: 2 }, amount_gross: 54000 },
  { id: "R02", ota: "booking", checkin_date: "2026-05-03", checkout_date: "2026-05-05", adults: 4, language: "zh-TW", tax_collection: "unknown", lodging_tax_collected: null, nationalities_json: { TW: 4 }, amount_gross: 48000 },
  { id: "R20", ota: "airbnb", checkin_date: "2026-06-13", checkout_date: "2026-06-15", adults: 2, language: "ko", tax_collection: "unknown", lodging_tax_collected: null, nationalities_json: { KR: 2 }, amount_gross: 30000 },

  // ---- 7月1日をまたぐ：7/1の夜だけ宿泊税（2人×1泊＝400円） ----
  { id: "R03", ota: "airbnb", checkin_date: "2026-06-30", checkout_date: "2026-07-02", adults: 2, language: "ja", tax_collection: "ota", lodging_tax_collected: 400, nationalities_json: { JP: 2 }, amount_gross: 32000 },

  // ---- カードA：大人2・子ども2（うち1人は料金のかからない添い寝）・3泊 ----
  //   宿泊税＝4人×3泊×200円＝2,400円（添い寝を外す設定なら 3人×3泊＝1,800円）
  { id: "R04", ota: "airbnb", checkin_date: "2026-07-18", checkout_date: "2026-07-21", adults: 2, children: 2, cosleep_free: 1, language: "ja", tax_collection: "ota", lodging_tax_collected: 2400, nationalities_json: { JP: 4 }, amount_gross: 66000 },

  // ---- 月をまたぐ：7/31の夜は7月分（800円）、8/1・8/2の夜は8月分（1,600円） ----
  { id: "R05", ota: "booking", checkin_date: "2026-07-31", checkout_date: "2026-08-03", adults: 4, language: "en", tax_collection: "included", lodging_tax_collected: 2400, nationalities_json: { US: 2, AU: 2 }, amount_gross: 84000 },

  // ---- カードC：2泊目から1人増える（1泊目2人・2泊目3人＝5人泊＝1,000円）。預かりは800円で200円不足 ----
  { id: "R06", ota: "airbnb", checkin_date: "2026-08-08", checkout_date: "2026-08-10", adults: 2, guest_changes_json: [{ from_night: "2026-08-09", adults: 3 }], language: "ja", tax_collection: "ota", lodging_tax_collected: 800, nationalities_json: { JP: 3 }, amount_gross: 40000 },
  // 同じ8/8に部屋Bにも予約（180日では8/8は1日だけ）
  { id: "R07", ota: "direct", room: "B", checkin_date: "2026-08-08", checkout_date: "2026-08-09", adults: 1, language: "ja", tax_collection: "onsite", lodging_tax_collected: 200, nationalities_json: { JP: 1 }, amount_gross: 9000 },

  // ---- カードD：取り消し。キャンセル料30,000円。予約サイトが宿泊税800円を前もって預かっていた ----
  //   既定（違約金として扱う）＝宿泊税0円・180日0日・800円は返金が必要
  { id: "R08", ota: "airbnb", status: "cancelled", cancel_fee_amount: 30000, checkin_date: "2026-08-14", checkout_date: "2026-08-16", adults: 2, language: "en", tax_collection: "ota", lodging_tax_collected: 800, nationalities_json: { SG: 2 }, amount_gross: 30000 },

  // ---- 乳幼児も数える：大人3・乳幼児1・3泊＝12人泊＝2,400円。予約サイトの預かりは1,800円（乳幼児分が抜けている） ----
  { id: "R09", ota: "airbnb", checkin_date: "2026-08-22", checkout_date: "2026-08-25", adults: 3, infants: 1, language: "zh-TW", tax_collection: "ota", lodging_tax_collected: 1800, nationalities_json: { TW: 4 }, amount_gross: 72000 },

  // ---- 9月 ----
  { id: "R10", ota: "booking", checkin_date: "2026-09-05", checkout_date: "2026-09-07", adults: 2, language: "en", tax_collection: "included", lodging_tax_collected: 800, nationalities_json: { GB: 2 }, amount_gross: 36000 },
  { id: "R19", ota: "booking", status: "cancelled", cancel_fee_amount: 0, checkin_date: "2026-09-12", checkout_date: "2026-09-13", adults: 2, language: "ko", tax_collection: "unknown", lodging_tax_collected: null, nationalities_json: { KR: 2 }, amount_gross: 0 },
  { id: "R11", ota: "airbnb", checkin_date: "2026-09-19", checkout_date: "2026-09-22", adults: 3, language: "ko", tax_collection: "ota", lodging_tax_collected: 1800, nationalities_json: { KR: 3 }, amount_gross: 63000 },
  // 預かったか分からない予約（予約サイトの明細で確認が必要）
  { id: "R12", ota: "direct", checkin_date: "2026-09-26", checkout_date: "2026-09-27", adults: 2, language: "ja", tax_collection: "unknown", lodging_tax_collected: null, nationalities_json: null, amount_gross: 18000 },

  // ---- 10月（デモの「今日」＝10/10） ----
  { id: "R13", ota: "airbnb", checkin_date: "2026-10-02", checkout_date: "2026-10-04", adults: 2, language: "en", tax_collection: "ota", lodging_tax_collected: 800, nationalities_json: { FR: 2 }, amount_gross: 34000 },
  { id: "R14", ota: "booking", checkin_date: "2026-10-09", checkout_date: "2026-10-12", adults: 2, children: 1, language: "zh-TW", tax_collection: "included", lodging_tax_collected: 1800, nationalities_json: { TW: 3 }, amount_gross: 60000 },
  { id: "R15", ota: "airbnb", checkin_date: "2026-10-24", checkout_date: "2026-10-26", adults: 4, language: "ja", tax_collection: "ota", lodging_tax_collected: 1600, nationalities_json: { JP: 4 }, amount_gross: 52000 },
  { id: "R16", ota: "airbnb", checkin_date: "2026-11-03", checkout_date: "2026-11-05", adults: 2, language: "en", tax_collection: "ota", lodging_tax_collected: 800, nationalities_json: { US: 2 }, amount_gross: 36000 },

  // ---- 年をまたぐ：12/29〜1/2（定期報告は 12_01 の期間） ----
  { id: "R17", ota: "booking", checkin_date: "2026-12-29", checkout_date: "2027-01-02", adults: 2, language: "ja", tax_collection: "included", lodging_tax_collected: 1600, nationalities_json: { JP: 2 }, amount_gross: 96000 },

  // ---- カードB：3月31日の夜は2026年度、4月1日の夜は2027年度。大人2・子ども1・2泊＝1,200円 ----
  { id: "R18", ota: "airbnb", checkin_date: "2027-03-31", checkout_date: "2027-04-02", adults: 2, children: 1, language: "ja", tax_collection: "ota", lodging_tax_collected: 1200, nationalities_json: { JP: 3 }, amount_gross: 42000 },
].map((r, i) => ({
  ota_reservation_no: `DEMO-${String(i + 1).padStart(4, "0")}`,
  guest_name: g(r.id.replace("R", "")),
  room: "A",
  status: "confirmed",
  children: 0,
  infants: 0,
  cosleep_free: 0,
  cancel_fee_amount: 0,
  ...r,
  nationalities_json: r.nationalities_json == null ? null : JSON.stringify(r.nationalities_json),
  guest_changes_json: r.guest_changes_json == null ? null : JSON.stringify(r.guest_changes_json),
}));
