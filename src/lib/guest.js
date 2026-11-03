// ゲスト画面（M12）の決まりごと。AIは出てこない。
// - URLが使えるかを、開くたびに確かめる（期限・取り消し・予約が確定のままか・日付が同じか）
// - ゲストが入れた人数・国籍を確かめ、台帳と違えば「ずれ」の候補にする（台帳は書きかえない）
// 🚫 名前・旅券番号・写真は受け取らない。

import { ARRIVAL_LANGS } from "./arrival.js";

export const GUEST_LANGS = ARRIVAL_LANGS; // ja / en / ko / zh-TW
// 国籍の一覧（定期報告で数える国＋その他）。この一覧にないコードは受け付けない
export const COUNTRY_CODES = ["KR", "TW", "HK", "CN", "JP", "US", "AU", "GB", "FR", "DE", "SG", "TH", "OTHER"];
export const MAX_PER_KIND = 20;

export class GuestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** URLの期限：チェックアウト日の正午（日本時間）。2026-11-04 社長決定 */
export const expiresAtFor = (checkoutDate) => `${checkoutDate}T12:00:00+09:00`;

/**
 * URLが使えるか。使えなければ理由（画面には出さない。ゲストには同じ文だけを見せる）
 * @returns {null|"not_found"|"revoked"|"expired"|"not_confirmed"|"dates_changed"}
 */
export function linkProblem(link, reservation, nowIso) {
  if (!link) return "not_found";
  if (link.revoked) return "revoked";
  if (Date.parse(nowIso) >= Date.parse(link.expires_at)) return "expired";
  if (!reservation || reservation.status !== "confirmed") return "not_confirmed";
  // 日付が台帳と違えば止める（予約メールの変更で台帳が変わったのに、取り消しが漏れた場合の守り）
  if (link.checkin_date !== reservation.checkin_date || link.checkout_date !== reservation.checkout_date) return "dates_changed";
  if (link.expires_at !== expiresAtFor(reservation.checkout_date)) return "dates_changed";
  return null;
}

/** 住所と暗証番号を出してよいか：チェックインの日の0時（日本時間）から。2026-11-04 社長決定 */
export const canShowSecrets = (today, checkinDate) => today >= checkinDate;

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * ゲストが入れた人数・国籍を確かめる。
 * @param body {language, adults, children, infants, nationalities:{"TW":2}}
 */
export function validateProfile(body) {
  const problems = [];
  const language = GUEST_LANGS.includes(body?.language) ? body.language : null;
  if (!language) problems.push("language");
  const adults = body?.adults;
  const children = body?.children ?? 0;
  const infants = body?.infants ?? 0;
  if (!intIn(adults, 1, MAX_PER_KIND)) problems.push("adults");
  if (!intIn(children, 0, MAX_PER_KIND)) problems.push("children");
  if (!intIn(infants, 0, MAX_PER_KIND)) problems.push("infants");

  const nat = body?.nationalities;
  const nationalities = {};
  if (!nat || typeof nat !== "object" || Array.isArray(nat)) {
    problems.push("nationalities");
  } else {
    for (const [code, n] of Object.entries(nat)) {
      if (!COUNTRY_CODES.includes(code) || !intIn(n, 0, MAX_PER_KIND * 3)) {
        problems.push("nationalities");
        break;
      }
      if (n > 0) nationalities[code] = n;
    }
  }
  if (!problems.length) {
    const total = adults + children + infants;
    const natTotal = Object.values(nationalities).reduce((a, b) => a + b, 0);
    if (natTotal !== total) problems.push("nationalities_total");
  }
  if (problems.length) {
    const e = new GuestError("入力を確かめてください");
    e.problems = [...new Set(problems)];
    throw e;
  }
  return { language, adults, children, infants, nationalities };
}

const parseNat = (s) => {
  try {
    const o = typeof s === "string" ? JSON.parse(s) : s;
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
};

/** 国籍の人数を、0を除いて並べそろえた形にする（比べるため） */
function normNat(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) if (Number(o[k]) > 0) out[k] = Number(o[k]);
  return JSON.stringify(out);
}

/**
 * ゲストが入れた数と台帳を比べる。違えば「ずれ」に入れる中身を返す（同じなら null）
 * facts は数と日付と予約サイトだけ（名前は入れない）
 */
export function guestCountDiscrepancy(profile, r) {
  const ledger = {
    adults: Number(r.adults ?? 0),
    children: Number(r.children ?? 0),
    infants: Number(r.infants ?? 0),
    nationalities: parseNat(r.nationalities_json),
  };
  const guest = {
    adults: profile.adults,
    children: profile.children,
    infants: profile.infants,
    nationalities: parseNat(profile.nationalities ?? profile.nationalities_json),
  };
  const sameCount = ledger.adults === guest.adults && ledger.children === guest.children && ledger.infants === guest.infants;
  const sameNat = normNat(ledger.nationalities) === normNat(guest.nationalities);
  if (sameCount && sameNat) return null;
  const expected = ledger.adults + ledger.children + ledger.infants;
  const actual = guest.adults + guest.children + guest.infants;
  return {
    kind: "guest_count",
    reservation_id: r.id,
    expected,
    actual,
    diff: actual - expected,
    facts: {
      ota: r.ota,
      checkin_date: r.checkin_date,
      checkout_date: r.checkout_date,
      problem: sameCount ? "nationality" : "count",
      ledger,
      guest,
    },
  };
}

const PEOPLE_JA = (p) => [`大人${p.adults}`, p.children ? `子ども${p.children}` : null, p.infants ? `乳幼児${p.infants}` : null].filter(Boolean).join("・");

/** オーナー画面の「ずれ」の見出し */
export function describeGuestCount(d) {
  const f = d.facts;
  if (f.problem === "nationality") return "ゲストが入れた国籍が、台帳と違います";
  return `ゲストが入れた人数（${PEOPLE_JA(f.guest)}）が、台帳（${PEOPLE_JA(f.ledger)}）と違います`;
}

/**
 * オーナーが「ゲストの人数でOK」と決めたときだけ、台帳の人数・国籍を直し、泊ごとの表を作り直す。
 * ゲストの入力は、オーナーが確かめるまで宿泊税・定期報告に入らない（docs/02）。
 * ずれを作ったあとで台帳が変わっていたら（予約メールの変更など）、止めて「もう一度確かめて」と返す。
 * @returns {Array} db.batch に入れる文（呼ぶ側で、ずれの状態の更新と一緒に実行する）
 */
export async function guestCountApplyStatements(db, d, stayNightRows) {
  const r = await db
    .prepare("SELECT id, ota, checkin_date, checkout_date, adults, children, infants, cosleep_free, nationalities_json, status, guest_changes_json FROM reservations WHERE id = ?")
    .bind(d.reservation_id)
    .first();
  if (!r || r.status !== "confirmed") throw new GuestError("この予約は取り消されています", 409);
  const f = d.facts;
  const same =
    r.checkin_date === f.checkin_date &&
    r.checkout_date === f.checkout_date &&
    Number(r.adults) === f.ledger.adults &&
    Number(r.children) === f.ledger.children &&
    Number(r.infants) === f.ledger.infants &&
    normNat(parseNat(r.nationalities_json)) === normNat(f.ledger.nationalities);
  if (!same) throw new GuestError("このずれを見つけたあとで、台帳が変わりました。ゲストの画面をもう一度開いてもらってください", 409);
  const g = f.guest;
  const next = {
    ...r,
    adults: g.adults,
    children: g.children,
    infants: g.infants,
    cosleep_free: Math.min(Number(r.cosleep_free ?? 0), g.children),
    guest_changes_json: null, // 泊ごとの人数の変更は、ゲストの入れた人数で置きかえる
    nationalities_json: JSON.stringify(g.nationalities),
  };
  const stmts = [
    db
      .prepare(
        `UPDATE reservations SET adults = ?, children = ?, infants = ?, cosleep_free = ?, guest_changes_json = NULL, nationalities_json = ?
         WHERE id = ? AND status = 'confirmed'`,
      )
      .bind(next.adults, next.children, next.infants, next.cosleep_free, next.nationalities_json, r.id),
    db.prepare("DELETE FROM stay_nights WHERE reservation_id = ?").bind(r.id),
  ];
  for (const s of stayNightRows([next])) {
    stmts.push(
      db.prepare("INSERT INTO stay_nights (reservation_id, night, fiscal_year, guests) VALUES (?, ?, ?, ?)").bind(s.reservation_id, s.night, s.fiscal_year, s.guests),
    );
  }
  return stmts;
}
