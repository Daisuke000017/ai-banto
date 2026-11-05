// 予約の手入力・直す・取り消す（オーナーが台帳を自分で書く）
// - 入力を確かめるのはここ（プログラムだけ。AIは使わない）
// - 宿泊者の名前は預からない（名簿は別に作る）
import { OTAS } from "./booking-email.js";
import { NATIONALITY_COLUMNS } from "./report-csv.js";
import { daysBetween, parseDate } from "./dates.js";
import { isRoomCode } from "./rooms.js";

export const TAX_COLLECTIONS = ["ota", "included", "onsite", "unknown"];
export const LANGS = ["ja", "en", "ko", "zh-TW"];
export const NATIONALITY_CODES = NATIONALITY_COLUMNS.map(([code]) => code);
export const MAX_NIGHTS = 60;
export const MAX_PER_KIND = 20;
export const MAX_AMOUNT = 10_000_000;
const NO_RE = /^[0-9A-Za-z_-]{1,40}$/;

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// 空欄（null・空文字）は「入れていない」とみなす
const blank = (v) => v === undefined || v === null || v === "";

const isDate = (s) => {
  try {
    parseDate(s);
    return s >= "2020-01-01" && s <= "2039-12-31";
  } catch {
    return false;
  }
};

/**
 * 手で入れた予約を確かめる。
 * @param input 画面から来た値
 * @param {{rooms: string[]}} opts 使っている部屋の記号（直すときは、いまの部屋も含めて渡す）
 * @returns {{values}|{error, field}}
 */
export function checkReservationInput(input, { rooms = [] } = {}) {
  const bad = (field, error) => ({ error, field });
  const v = input ?? {};

  if (!OTAS.includes(v.ota)) return bad("ota", "予約の入り口（Airbnb・直接など）を選んでください");
  let no = null;
  if (!blank(v.ota_reservation_no)) {
    no = String(v.ota_reservation_no).trim();
    if (!NO_RE.test(no)) return bad("ota_reservation_no", "予約番号は、英数字と - _ だけで40文字までです");
  }

  if (!isDate(v.checkin_date)) return bad("checkin_date", "着く日を入れてください");
  if (!isDate(v.checkout_date)) return bad("checkout_date", "出る日を入れてください");
  if (v.checkout_date <= v.checkin_date) return bad("checkout_date", "出る日は、着く日より後にしてください");
  const nights = daysBetween(v.checkin_date, v.checkout_date);
  if (nights > MAX_NIGHTS) return bad("checkout_date", `1つの予約は${MAX_NIGHTS}泊までです`);

  const adults = v.adults;
  const children = blank(v.children) ? 0 : v.children;
  const infants = blank(v.infants) ? 0 : v.infants;
  const cosleep = blank(v.cosleep_free) ? 0 : v.cosleep_free;
  if (!intIn(adults, 0, MAX_PER_KIND)) return bad("adults", `大人の人数は0〜${MAX_PER_KIND}で入れてください`);
  if (!intIn(children, 0, MAX_PER_KIND)) return bad("children", `子どもの人数は0〜${MAX_PER_KIND}で入れてください`);
  if (!intIn(infants, 0, MAX_PER_KIND)) return bad("infants", `乳幼児の人数は0〜${MAX_PER_KIND}で入れてください`);
  const heads = adults + children + infants;
  if (heads < 1) return bad("adults", "泊まる人を1人以上入れてください");
  if (!intIn(cosleep, 0, children)) return bad("cosleep_free", "添い寝（料金なし）は、子どもの人数までです");

  let room = null;
  if (!blank(v.room)) {
    if (!isRoomCode(v.room) || !rooms.includes(v.room)) return bad("room", "部屋を選び直してください");
    room = v.room;
  }

  const nat = blank(v.nationalities) ? {} : v.nationalities;
  if (typeof nat !== "object" || Array.isArray(nat)) return bad("nationalities", "国籍の形が違います");
  const nationalities = {};
  for (const [code, n] of Object.entries(nat)) {
    if (!NATIONALITY_CODES.includes(code)) return bad("nationalities", "国籍を選び直してください");
    if (!intIn(n, 0, MAX_PER_KIND * 3)) return bad("nationalities", "国籍ごとの人数は0以上の整数で入れてください");
    if (n > 0) nationalities[code] = (nationalities[code] ?? 0) + n;
  }
  const natTotal = Object.values(nationalities).reduce((a, b) => a + b, 0);
  if (natTotal > heads) return bad("nationalities", `国籍の人数（${natTotal}人）が、泊まる人（${heads}人）より多くなっています`);

  let amount = null;
  if (!blank(v.amount_gross)) {
    if (!intIn(v.amount_gross, 0, MAX_AMOUNT)) return bad("amount_gross", "売上は0円〜1,000万円の整数で入れてください");
    amount = v.amount_gross;
  }

  const tax = blank(v.tax_collection) ? "unknown" : v.tax_collection;
  if (!TAX_COLLECTIONS.includes(tax)) return bad("tax_collection", "宿泊税の預かり方を選び直してください");
  let taxCollected = null;
  if (!blank(v.lodging_tax_collected)) {
    if (!intIn(v.lodging_tax_collected, 0, 1_000_000)) return bad("lodging_tax_collected", "預かった宿泊税は0以上の整数で入れてください");
    taxCollected = v.lodging_tax_collected;
  }

  let language = null;
  if (!blank(v.language)) {
    if (!LANGS.includes(v.language)) return bad("language", "案内の言葉を選び直してください");
    language = v.language;
  }

  return {
    values: {
      ota: v.ota,
      ota_reservation_no: no,
      checkin_date: v.checkin_date,
      checkout_date: v.checkout_date,
      nights,
      adults,
      children,
      infants,
      cosleep_free: cosleep,
      room,
      nationalities,
      unknown_nationality: heads - natTotal,
      amount_gross: amount,
      tax_collection: tax,
      lodging_tax_collected: taxCollected,
      language,
    },
  };
}

/** 同じ部屋で、泊まる夜が重なる予約（取り消したもの・自分は除く）。部屋が未定なら見ない */
export function roomClash(values, others, selfId = null) {
  if (!values.room) return null;
  return (
    others.find(
      (o) =>
        o.id !== selfId &&
        o.status === "confirmed" &&
        o.room === values.room &&
        o.checkin_date < values.checkout_date &&
        values.checkin_date < o.checkout_date,
    ) ?? null
  );
}

/** 同じ入り口・同じ予約番号の予約（二重に入れないため） */
export function sameNumber(values, others, selfId = null) {
  if (!values.ota_reservation_no) return null;
  return others.find((o) => o.id !== selfId && o.ota === values.ota && o.ota_reservation_no === values.ota_reservation_no) ?? null;
}

/** 日付か人数が変わったか（変わったら、ゲスト画面のURLを止めて、案内を作り直してもらう） */
export function partyChanged(cur, next) {
  return ["checkin_date", "checkout_date", "adults", "children", "infants"].some((k) => cur[k] !== next[k]);
}

/** 取り消しのキャンセル料（空欄は0円） */
export function checkCancelFee(v) {
  if (blank(v)) return { fee: 0 };
  if (!intIn(v, 0, MAX_AMOUNT)) return { error: "キャンセル料は0円〜1,000万円の整数で入れてください" };
  return { fee: v };
}
