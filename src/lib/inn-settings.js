// 宿の設定（名前・住所・届出番号・清掃の時間・清掃費・最低価格）の入力を確かめる。AIは使わない
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
      if (r.value && !/^[0-9A-Za-z第号\-]+$/.test(r.value)) return { error: "届出番号は英数字（例：M012345678）で入れてください" };
      return r;
    }],
    ["cleaning_checkout_time", (v) => time(v, "チェックアウトの時刻")],
    ["cleaning_checkin_time", (v) => time(v, "チェックインの時刻")],
    ["cleaning_fee", (v) => yen(v, "清掃費")],
    ["min_price", (v) => yen(v, "最低価格")],
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
  if (!Object.keys(values).length) return { error: "変える項目がありません" };
  return { values };
}
