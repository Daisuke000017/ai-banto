// AIを呼ぶ共通の部分（Anthropic 公式SDK）
// 守ること（docs/03 §0・§4）
// - 答えは決まった形（JSON）だけ。形が違えば1回だけやり直す
// - AIに渡す文は JSON の値として渡す（外から来た文を「指示」として読ませない）
// - 1回ごとに max_tokens を付ける＋アプリ全体で1日の上限（DAILY_AI_CALL_LIMIT）
// - 働きの記録（agent_runs）には、個人情報やAIに送った文そのものは入れない
// - サーバー側の予備（fallbacks）を有効にしている：指定のモデルが混み合っているときは、Anthropic 側で同等のモデルに切り替わることがある

import Anthropic from "@anthropic-ai/sdk";
import { DAILY_AI_CALL_LIMIT } from "./models.js";

/** AIが使えないとき（このときは決まった文に切り替える） */
export class AiUnavailable extends Error {
  /** @param {"no_key"|"daily_limit"|"refusal"|"bad_output"|"api_error"} code */
  constructor(code, message) {
    super(message);
    this.name = "AiUnavailable";
    this.code = code;
  }
}

export function makeClient(env, fetchImpl) {
  if (!env?.ANTHROPIC_API_KEY) throw new AiUnavailable("no_key", "AIの鍵が設定されていません");
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 1,
    timeout: 60_000,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

// 日本時間の「今日」に呼んだ回数（AIを実際に呼んだ行＝model が入っている行だけ数える）
const COUNT_TODAY_SQL = `SELECT COUNT(*) AS n FROM agent_runs
  WHERE model IS NOT NULL AND created_at >= datetime('now', '+9 hours', 'start of day', '-9 hours')`;

export async function aiCallsToday(db) {
  const row = await db.prepare(COUNT_TODAY_SQL).first();
  return row?.n ?? 0;
}

async function startRun(db, { agent, task, parentRunId, inputSummary, model }) {
  if (!db) return null;
  const row = await db
    .prepare(
      "INSERT INTO agent_runs (agent, task, status, parent_run_id, input_summary, model) VALUES (?, ?, 'working', ?, ?, ?) RETURNING id",
    )
    .bind(agent, task, parentRunId ?? null, inputSummary ?? null, model)
    .first();
  return row?.id ?? null;
}

async function finishRun(db, id, { status, outputSummary, model, tokensIn, tokensOut, sentBackReason }) {
  if (!db || id == null) return;
  await db
    .prepare(
      `UPDATE agent_runs SET status = ?, output_summary = ?, model = ?, tokens_in = ?, tokens_out = ?,
       sent_back_reason = ?, finished_at = datetime('now') WHERE id = ?`,
    )
    .bind(status, outputSummary ?? null, model, tokensIn ?? null, tokensOut ?? null, sentBackReason ?? null, id)
    .run();
}

/** 監査役が差し戻したとき、その下書きの記録に「差し戻し」と理由を付ける */
export async function markSentBack(db, runId, reason) {
  if (!db || runId == null) return;
  await db
    .prepare("UPDATE agent_runs SET status = 'sent_back', sent_back_reason = ? WHERE id = ?")
    .bind(String(reason).slice(0, 300), runId)
    .run();
}

// SDKのエラーを、画面に出せる日本語にする（鍵や中身は出さない）
function describeApiError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "AIの鍵が正しくありません";
  if (e instanceof Anthropic.PermissionDeniedError) return "AIを使う権限がありません";
  if (e instanceof Anthropic.RateLimitError) return "AIが混み合っています（少し待ってからもう一度）";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "AIの返事が時間内に来ませんでした";
  if (e instanceof Anthropic.APIConnectionError) return "AIにつながりませんでした";
  if (e instanceof Anthropic.NotFoundError) return "AIのモデル名が見つかりません";
  if (e instanceof Anthropic.BadRequestError) return "AIへの頼み方に誤りがありました";
  if (e instanceof Anthropic.InternalServerError) return "AI側で一時的な障害が起きています";
  if (e instanceof Anthropic.APIError) return `AIの呼び出しに失敗しました（${e.status ?? "不明"}）`;
  return "AIの呼び出しに失敗しました";
}

function textOf(msg) {
  return (msg.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * AIを1回呼んで、決まった形のJSONを受け取る。
 * - validate(obj) が理由の配列を返したら（空でなければ）形が違うとみなし、1回だけやり直す
 * - 断られた（refusal）・2回とも形が違う・API の失敗 → AiUnavailable
 * @returns {Promise<{data: any, runId: number|null, model: string}>}
 */
export async function callJson({
  client,
  db,
  agent,
  task,
  model,
  system,
  input,
  schema,
  validate = () => [],
  maxTokens = 2000,
  effort = "low",
  parentRunId = null,
  inputSummary = null,
}) {
  if (db && (await aiCallsToday(db)) >= DAILY_AI_CALL_LIMIT) {
    throw new AiUnavailable("daily_limit", "今日のAIの上限に達しました（明日また使えます）");
  }
  const runId = await startRun(db, { agent, task, parentRunId, inputSummary, model });
  const userText = JSON.stringify(input);
  let lastProblem = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let usedModel = model;

  for (let attempt = 0; attempt < 2; attempt++) {
    let msg;
    try {
      msg = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: "user",
            content: attempt === 0 ? userText : `${userText}\n\n前回の答えは形が違いました：${lastProblem}。決まった形のJSONだけで答えてください。`,
          },
        ],
        output_config: { format: { type: "json_schema", schema }, effort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (e) {
      const message = describeApiError(e);
      await finishRun(db, runId, { status: "failed", outputSummary: message, model: usedModel, tokensIn, tokensOut });
      throw new AiUnavailable("api_error", message);
    }

    tokensIn += msg.usage?.input_tokens ?? 0;
    tokensOut += msg.usage?.output_tokens ?? 0;
    usedModel = msg.model ?? model;

    if (msg.stop_reason === "refusal") {
      const category = msg.stop_details?.category ?? "不明";
      await finishRun(db, runId, { status: "failed", outputSummary: `AIが応じませんでした（${category}）`, model: usedModel, tokensIn, tokensOut });
      throw new AiUnavailable("refusal", "AIがこの依頼に応じませんでした");
    }
    if (msg.stop_reason === "max_tokens") {
      lastProblem = "途中で切れました。もっと短く書いてください";
      continue;
    }
    let data;
    try {
      data = JSON.parse(textOf(msg));
    } catch {
      lastProblem = "JSONとして読めませんでした";
      continue;
    }
    const problems = validate(data);
    if (problems.length) {
      lastProblem = problems.join("／");
      continue;
    }
    await finishRun(db, runId, { status: "done", outputSummary: "決まった形で受け取りました", model: usedModel, tokensIn, tokensOut });
    return { data, runId, model: usedModel };
  }

  await finishRun(db, runId, { status: "failed", outputSummary: `形が違いました：${lastProblem}`.slice(0, 300), model: usedModel, tokensIn, tokensOut });
  throw new AiUnavailable("bad_output", "AIの答えが決まった形になりませんでした");
}

/**
 * AIにネットで調べてもらい、文の答えと「実際に見たページ」の一覧を受け取る（形はまだ決めない）。
 * - 見てよいサイトは allowedDomains だけ（公式のサイトに絞る）
 * - 検索が長くて途中で止まった（pause_turn）ときは、同じ会話を送り直して続けてもらう（最大3回）
 * - 見たページ（urls）はAIの答えではなく、検索の結果そのものから集める。あとでプログラムが「出典が本当に見たページか」を確かめる
 * @returns {Promise<{text: string, urls: {url: string, title: string}[], runId: number|null, model: string}>}
 */
// ネット検索は何度もページを見るので、ふつうの60秒では足りない（2026-11-06 本物で試して時間切れ）。
// 1回を長めに待ち、やり直しはしない（やり直すと検索の料金が2回かかるため）
export const SEARCH_REQUEST_OPTIONS = { timeout: 180_000, maxRetries: 0 };

export async function callSearch({
  client,
  db,
  agent,
  task,
  model,
  system,
  input,
  allowedDomains,
  maxUses = 5,
  maxTokens = 4000,
  parentRunId = null,
  inputSummary = null,
}) {
  if (db && (await aiCallsToday(db)) >= DAILY_AI_CALL_LIMIT) {
    throw new AiUnavailable("daily_limit", "今日のAIの上限に達しました（明日また使えます）");
  }
  const runId = await startRun(db, { agent, task, parentRunId, inputSummary, model });
  const messages = [{ role: "user", content: JSON.stringify(input) }];
  const tools = [{
    type: "web_search_20260209",
    name: "web_search",
    max_uses: maxUses,
    allowed_domains: allowedDomains,
    user_location: { type: "approximate", city: "Miyazaki", region: "Miyazaki", country: "JP", timezone: "Asia/Tokyo" },
  }];
  let tokensIn = 0;
  let tokensOut = 0;
  let usedModel = model;
  const urls = new Map();
  let text = "";

  for (let turn = 0; turn < 4; turn++) {
    let msg;
    try {
      msg = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }, SEARCH_REQUEST_OPTIONS);
    } catch (e) {
      const message = describeApiError(e);
      await finishRun(db, runId, { status: "failed", outputSummary: message, model: usedModel, tokensIn, tokensOut });
      throw new AiUnavailable("api_error", message);
    }
    tokensIn += msg.usage?.input_tokens ?? 0;
    tokensOut += msg.usage?.output_tokens ?? 0;
    usedModel = msg.model ?? model;
    for (const b of msg.content ?? []) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r?.type === "web_search_result" && r.url) urls.set(r.url, { url: r.url, title: r.title ?? "" });
      }
    }
    text += textOf(msg);
    if (msg.stop_reason === "refusal") {
      await finishRun(db, runId, { status: "failed", outputSummary: "AIが応じませんでした", model: usedModel, tokensIn, tokensOut });
      throw new AiUnavailable("refusal", "AIがこの依頼に応じませんでした");
    }
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    await finishRun(db, runId, { status: "done", outputSummary: `ネットで調べました（見たページ ${urls.size}件）`, model: usedModel, tokensIn, tokensOut });
    return { text, urls: [...urls.values()], runId, model: usedModel };
  }
  await finishRun(db, runId, { status: "failed", outputSummary: "検索が終わりませんでした", model: usedModel, tokensIn, tokensOut });
  throw new AiUnavailable("bad_output", "AIの検索が時間内に終わりませんでした");
}
