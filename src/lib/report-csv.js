// 定期報告（2か月ごと）を、民泊制度運営システムの「CSVで一括報告」に出すファイルとして書き出す。
// 形は観光庁の「電子宿泊者名簿」ソフトが作る定期報告ファイルに合わせた
// （同ソフトの操作説明書 v2.0〈2025-09〉の 図2-40 と、観光庁の定期報告のページ）：
//   見出しの行なし・UTF-8・行の終わりは CRLF・1つの届出につき1行
//   届出番号, 報告期間（例 2026_8-9）, 宿泊日数, 宿泊者数, 延べ宿泊者数, 国籍22列, 宿泊した日（yyyy/MM/dd を1日1列）
// 注意：民泊制度運営システムの操作マニュアル v1.7（2023-03）4-2 には、見出しの行あり・「第…号」・
//   「20××年度××月～××月」・日付を「;」でつなぐ、という古い形が載っている。こちらには合わせていない。
// AIは使わない。数はすべて counting.js の minpakuReport が数えたもの。
import { periodMonths } from "./counting.js";

/** 国籍の列（並びはマニュアルの順）。ISO の国コード → 列。ここに無い国は「その他」 */
export const NATIONALITY_COLUMNS = [
  ["JP", "日本"], ["KR", "韓国"], ["TW", "台湾"], ["HK", "香港"], ["CN", "中国"], ["TH", "タイ"],
  ["SG", "シンガポール"], ["MY", "マレーシア"], ["ID", "インドネシア"], ["PH", "フィリピン"], ["VN", "ベトナム"],
  ["IN", "インド"], ["GB", "英国"], ["DE", "ドイツ"], ["FR", "フランス"], ["IT", "イタリア"], ["ES", "スペイン"],
  ["RU", "ロシア"], ["US", "米国"], ["CA", "カナダ"], ["AU", "オーストラリア"], ["OTHER", "その他"],
];
const LISTED = new Set(NATIONALITY_COLUMNS.map(([c]) => c));

export class ReportCsvError extends Error {
  constructor(message, { fix = null, reservations = [] } = {}) {
    super(message);
    this.fix = fix; // "settings"（宿と部屋の設定）／"nationality"（予約の国籍）
    this.reservations = reservations; // 国籍を入れる予約 [{reservation_id, checkin_date, missing}]
  }
}

/**
 * "2026-08_09" → { year: 2026, label: "2026_8-9" }（年は期間の最初の月の年）
 * 💭 要確認：公式ソフトは「年度」を選んでから月を選ぶので、2〜3月期（例 2027年2〜3月）は
 *   年度の「2026_2-3」と書く可能性がある。今は暦の年で「2027_2-3」と書く。窓口か試しの提出で確かめてから直す
 */
export function periodLabel(period) {
  const [first, last] = periodMonths(period);
  const year = Number(first.slice(0, 4));
  return { year, label: `${year}_${Number(first.slice(5, 7))}-${Number(last.slice(5, 7))}` };
}

/** 国籍の数を22列に並べる。表に無い国は「その他」にまとめる。分からない人がいれば null */
export function nationalityRow(nationality) {
  if ((nationality.UNKNOWN ?? 0) > 0) return null;
  const cols = Object.fromEntries(NATIONALITY_COLUMNS.map(([c]) => [c, 0]));
  for (const [code, n] of Object.entries(nationality)) {
    const key = LISTED.has(code) ? code : "OTHER";
    cols[key] += Number(n) || 0;
  }
  return NATIONALITY_COLUMNS.map(([c]) => cols[c]);
}

/**
 * 提出用のCSV（1行）とファイル名をつくる。
 * report は minpakuReport の結果（nights：期間内に泊まった夜の一覧 を含む）。
 * 届出番号が無い・国籍が分からない人がいるときは ReportCsvError（何を直せばよいかを書く）
 */
export function submissionCsv(report, notificationNo) {
  const no = String(notificationNo ?? "").trim();
  if (!no) throw new ReportCsvError("届出番号が入っていません。「宿と部屋の設定」で届出番号を入れてください", { fix: "settings" });
  if (!/^[0-9A-Za-z第号\-]{1,30}$/.test(no)) throw new ReportCsvError("届出番号の形が違います。「宿と部屋の設定」で確かめてください", { fix: "settings" });
  const nat = nationalityRow(report.nationality);
  if (!nat) {
    const reservations = (report.breakdown?.reservations ?? [])
      .filter((r) => r.unknown_nationality > 0)
      .map((r) => ({ reservation_id: r.reservation_id, checkin_date: r.checkin_date, missing: r.unknown_nationality }));
    throw new ReportCsvError(
      `国籍が分からない人が${report.nationality.UNKNOWN}人います。下の「この予約を直す」から国籍を入れてから、もう一度つくってください`,
      { fix: "nationality", reservations },
    );
  }
  const { year, label } = periodLabel(report.period);
  const dates = [...(report.nights ?? [])].sort().map((d) => d.replaceAll("-", "/"));
  const row = [no, label, report.stay_days, report.guests, report.guest_nights, ...nat, ...dates];
  const [, m1, m2] = /_(\d+)-(\d+)$/.exec(label);
  return {
    filename: `${no}_${year}_${m1}-${m2}.csv`,
    text: row.join(",") + "\r\n",
  };
}
