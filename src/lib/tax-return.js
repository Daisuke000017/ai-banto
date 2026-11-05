// 宿泊税の納入申告書（宮崎市 様式第10号）に書く中身をつくる。AIは使わない
// 数字は taxDraft（人泊の集計）の結果をそのまま使う。申告書を出すのはオーナー本人（番頭は出さない）
// 特例（2か月分などをまとめる）の欄は書かない。1か月分を1行目に書く
import { monthOf } from "./dates.js";

// 様式に印刷されている税率（1人1泊）
export const FORM_RATE = 200;

// 令和の年（2019年＝元年）
export function reiwa(year) {
  const n = year - 2018;
  return n === 1 ? "元" : String(n);
}

// 年度（4月はじまり）。2027-01 → 2026年度
export function fiscalYearOf(month) {
  const [y, m] = month.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

// 申告書に書く欄（設定の画面の項目）。法人番号は個人なら空でよいので「足りない」に数えない
const NEEDED = [
  ["collector_address", "特別徴収義務者の住所"],
  ["collector_name", "特別徴収義務者の氏名（名称）"],
  ["address", "宿の住所（所在地）"],
  ["name", "宿の名前（名称）"],
  ["inn_phone", "宿の電話番号"],
  ["facility_no", "施設番号"],
  ["contact_name", "担当者"],
  ["contact_phone", "担当者の電話番号"],
];

const yen = (n) => Number(n).toLocaleString("ja-JP");

/**
 * @param {object} draft taxDraft(...) の結果
 * @param {object} inn 宿の設定（inn_profile の行）
 * @param {string} today 今日（YYYY-MM-DD）。申告書の日付に使う
 * @param {{ownerChecks?: number}} opts ownerChecks：この月の予約で「【オーナー確認】」が残っている下書きの数
 */
export function taxReturn(draft, inn, today, { ownerChecks = 0 } = {}) {
  const month = draft.month;
  const [ty, tm, td] = today.split("-").map(Number);
  const fy = fiscalYearOf(month);
  const filled = (k) => typeof inn[k] === "string" && inn[k].trim() !== "";
  const val = (k) => (filled(k) ? inn[k].trim() : null);

  const form = {
    date: { era_year: reiwa(ty), month: tm, day: td },
    period: { era_year: reiwa(fy), month: Number(month.slice(5)) },
    collector: { address: val("collector_address"), name: val("collector_name"), corporate_no: val("corporate_no") },
    facility: {
      address: val("address"),
      name: val("name"),
      phone: val("inn_phone"),
      facility_no: val("facility_no"),
      contact_name: val("contact_name"),
      contact_phone: val("contact_phone"),
    },
    nights: draft.person_nights,
    rate: draft.rules.tax_rate,
    tax: draft.tax_amount,
    total: draft.tax_amount,
  };

  // 画面にだけ出す注意（印刷には出さない）。danger＝このまま出してはいけない・warn＝確かめてから・info＝知らせ
  const warnings = [];
  const add = (level, text) => warnings.push({ level, text });
  const nowMonth = monthOf(today);
  const startMonth = draft.rules.tax_start_date ? draft.rules.tax_start_date.slice(0, 7) : null;

  if (month > nowMonth) add("danger", "まだ来ていない月です。月が終わってから作ってください");
  else if (month === nowMonth) add("warn", "この月はまだ終わっていません。これから入る予約で数字が変わります。月が終わってから作り直してください");
  if (draft.rules.tax_rate !== FORM_RATE) {
    add("danger", `設定の税率が1人1泊 ${yen(draft.rules.tax_rate)}円 です。宮崎市の様式は ${FORM_RATE}円 なので、このままでは出せません`);
  }
  if (startMonth && month < startMonth) add("info", `宿泊税が始まる前の月です（${draft.rules.tax_start_date} から）`);
  if (ownerChecks > 0) {
    add("warn", `この月の予約のゲスト連絡に「【オーナー確認】」が ${ownerChecks}件 残っています（宿泊税の預かり方）。先に「ゲスト連絡」で直してください`);
  }
  if (draft.unknown_tax > 0) {
    add("warn", `預かった額が分からない予約があります（宿泊税 ${yen(draft.unknown_tax)}円 分）。申告書の税額は人泊×税率で書いていますが、予約サイトの明細で預かりを確かめてください`);
  }
  if (draft.diff < 0) {
    add("warn", `預かった額が ${yen(-draft.diff)}円 足りません。申告書の税額は人泊×税率で書いています。足りない分の扱いは、出す前に市に確かめてください`);
  }
  if (draft.refund_needed > 0) {
    add("warn", `宿泊税がかからないのに預かっている額が ${yen(draft.refund_needed)}円 あります。申告書には入れていません。返金が要るか確かめてください`);
  }
  if (draft.nights_before_tax_start > 0) {
    add("info", `${draft.rules.tax_start_date} より前の ${draft.nights_before_tax_start}泊 は、宿泊税が始まる前なので数えていません`);
  }
  if (draft.tax_amount === 0) add("info", "納める額が0円の月も、申告書を出す必要があります（様式の備考1）");

  const missing = NEEDED.filter(([k]) => !filled(k)).map(([, label]) => label);
  if (missing.length) {
    add("warn", `設定に入っていない欄があります：${missing.join("、")}。その欄は空けて出すので、手で書くか「設定」で入れてください`);
  }

  // rules は画面の「月」の選び方（宿泊税が始まった月から）に使う
  return { month, rules: { tax_rate: draft.rules.tax_rate, tax_start_date: draft.rules.tax_start_date ?? null }, form, warnings, missing };
}
