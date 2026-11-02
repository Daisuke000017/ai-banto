// AI番頭 Worker（いまは「数える」部分の確認用の最小版）
// - /api/tax?month=YYYY-MM          宿泊税の集計表（下書き）
// - /api/minpaku/counter            180日カウンター
// - /api/minpaku/report?period=     定期報告の4項目（例：2026-08_09）
// ⚠️ オーナー画面の鍵（Cloudflare Access）を付けるまでは、手元（localhost）以外からは開けない。

import { dayCounter, minpakuReport, reportPeriodOf, rulesFromInnProfile, taxDraft } from "./lib/counting.js";
import { monthOf, todayJst } from "./lib/dates.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

async function loadRules(env) {
  const row = await env.DB.prepare("SELECT * FROM inn_profile WHERE id = 1").first();
  return rulesFromInnProfile(row ?? {});
}

// 宿泊者の名前はここで読まない（数えるのに要らないため）
const RES_SELECT = `SELECT id, ota, checkin_date, checkout_date, adults, children, infants, cosleep_free,
  tax_collection, lodging_tax_collected, nationalities_json, status, cancel_fee_amount, guest_changes_json
  FROM reservations ORDER BY checkin_date, id`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!LOCAL_HOSTS.has(url.hostname)) return json({ error: "この画面はまだ公開していません" }, 403);
    if (request.method !== "GET") return json({ error: "読むだけの画面です" }, 405);

    const today = todayJst(env.DEMO_TODAY);
    try {
      if (url.pathname === "/api/tax") {
        const month = url.searchParams.get("month") ?? monthOf(today);
        if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: "month は YYYY-MM で指定してください" }, 400);
        const rules = await loadRules(env);
        const { results } = await env.DB.prepare(RES_SELECT).all();
        return json({ today, ...taxDraft(results, month, rules) });
      }
      if (url.pathname === "/api/minpaku/counter") {
        const rules = await loadRules(env);
        const { results } = await env.DB.prepare("SELECT night, fiscal_year FROM stay_nights").all();
        return json({ today, ...dayCounter(results, today, rules) });
      }
      if (url.pathname === "/api/minpaku/report") {
        const period = url.searchParams.get("period") ?? reportPeriodOf(monthOf(today));
        const { results } = await env.DB.prepare(RES_SELECT).all();
        return json({ today, ...minpakuReport(results, period, today) });
      }
      return json({ error: "見つかりません" }, 404);
    } catch (e) {
      // 入力の誤り（日付の形など）は日本語で返す。中身の詳しい情報は出さない
      return json({ error: e instanceof Error ? e.message : "うまく数えられませんでした" }, 400);
    }
  },
};
