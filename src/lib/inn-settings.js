// 宿の設定（名前・住所・届出番号・清掃の時間・清掃費・最低価格・料金のレベル・宿泊税の申告書に書くこと）の入力を確かめる。AIは使わない
// 送られてきた項目だけを確かめて、書きこむ値を返す。だめなら最初のまちがいの文を返す
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/g;
export const MAX_YEN = 1_000_000;

function text(v, label, max, { required = false } = {}) {
  if (v == null || v === "") {
    if (required) return { error: `${label}を入れてください` };
    return { value: null };
  }
  if (typeof v !== "string") return { error: `${label}の形が違います` };
  const t = v.replace(CTRL_RE, "").trim();
  if (!t) return required ? { error: `${label}を入れてください` } : { value: null };
  if ([...t].length > max) return { error: `${label}は${max}文字までです` };
  return { value: t };
}

function yen(v, label) {
  if (v == null || v === "") return { value: null };
  const n = typeof v === "string" ? Number(v.replaceAll(",", "").trim()) : v;
  if (!Number.isInteger(n) || n < 0 || n > MAX_YEN) return { error: `${label}は0〜${MAX_YEN.toLocaleString("ja-JP")}円の整数で入れてください` };
  return { value: n };
}

// 全角の数字・ハイフンを半角にそろえる（電話番号・法人番号・施設番号）
const half = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－ー―‐−]/g, "-");

function phone(v, label) {
  const r = text(v, label, 20);
  if (!r.value) return r;
  const t = half(r.value).replace(/\s/g, "");
  const digits = t.replaceAll("-", "");
  if (!/^[0-9-]+$/.test(t) || !/^0\d{9,10}$/.test(digits)) return { error: `${label}は「0985-00-0000」のように、0から始まる10〜11けたの数字で入れてください` };
  return { value: t };
}

function time(v, label) {
  if (typeof v !== "string" || !TIME_RE.test(v)) return { error: `${label}は「10:00」の形で入れてください` };
  return { value: v };
}

/**
 * @param {object} body 画面から送られた項目
 * @param {object} current いまの宿の設定（清掃の時間の前後を確かめるため）
 * @returns {{values: object} | {error: string}}
 */
export function checkInnPatch(body, current = {}) {
  const values = {};
  const steps = [
    ["name", (v) => text(v, "宿の名前", 40, { required: true })],
    ["address", (v) => text(v, "住所", 100)],
    ["notification_no", (v) => {
      const r = text(v, "届出番号", 30);
      if (r.value && !/^[0-9A-Za-z第号][0-9A-Za-z第号-]*$/.test(r.value)) return { error: "届出番号は英数字（例：M012345678）で入れてください" };
      return r;
    }],
    ["cleaning_checkout_time", (v) => time(v, "チェックアウトの時刻")],
    ["cleaning_checkin_time", (v) => time(v, "チェックインの時刻")],
    ["cleaning_fee", (v) => yen(v, "清掃費")],
    ["min_price", (v) => yen(v, "最低価格")],
    // 料金のレベル1〜4（1泊）。金額はオーナーが決める
    ["price_l1", (v) => yen(v, "レベル1の料金")],
    ["price_l2", (v) => yen(v, "レベル2の料金")],
    ["price_l3", (v) => yen(v, "レベル3の料金")],
    ["price_l4", (v) => yen(v, "レベル4の料金")],
    // 宿泊税の申告書（宮崎市 様式第10号）に書くこと。どれも任意
    ["collector_address", (v) => text(v, "特別徴収義務者の住所", 100)],
    ["collector_name", (v) => text(v, "特別徴収義務者の氏名（名称）", 60)],
    ["corporate_no", (v) => {
      const r = text(v, "法人番号", 20);
      if (!r.value) return r;
      const n = half(r.value).replace(/[\s-]/g, "");
      if (!/^\d{13}$/.test(n)) return { error: "法人番号は13けたの数字で入れてください（個人の方は空のままで大丈夫です）" };
      return { value: n };
    }],
    ["inn_phone", (v) => phone(v, "宿の電話番号")],
    ["facility_no", (v) => {
      const r = text(v, "施設番号", 20);
      if (!r.value) return r;
      const t = half(r.value);
      if (!/^[0-9A-Za-z第号][0-9A-Za-z第号-]*$/.test(t)) return { error: "施設番号は英数字で入れてください" };
      return { value: t };
    }],
    ["contact_name", (v) => text(v, "担当者", 30)],
    ["contact_phone", (v) => phone(v, "担当者の電話番号")],
  ];
  for (const [key, check] of steps) {
    if (!(key in body)) continue;
    const r = check(body[key]);
    if (r.error) return { error: r.error };
    values[key] = r.value;
  }
  const out = values.cleaning_checkout_time ?? current.cleaning_checkout_time;
  const inn = values.cleaning_checkin_time ?? current.cleaning_checkin_time;
  if (out && inn && out >= inn) return { error: "チェックアウトの時刻は、チェックインの時刻より前にしてください" };
  // レベルは 1 < 2 < 3 < 4 の順に高くする（入っているものどうしで確かめる）
  const lv = [1, 2, 3, 4].map((n) => {
    const k = `price_l${n}`;
    return { n, v: k in values ? values[k] : (current[k] ?? null) };
  }).filter((x) => x.v != null);
  for (let i = 1; i < lv.length; i++) {
    if (lv[i].v <= lv[i - 1].v) return { error: `レベル${lv[i].n}の料金は、レベル${lv[i - 1].n}より高くしてください` };
  }
  if (!Object.keys(values).length) return { error: "変える項目がありません" };
  return { values };
}
