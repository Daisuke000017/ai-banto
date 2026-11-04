// 成績（M9）：自作の例題40件（すべて架空）を流して採点し、手元のデータベースに入れる SQL を書き出す。
// - 画面からは流さない。社長の OK をもらってから、手元で流す（API の料金がかかる：最大で約240回）
// - 使い方：
//     node --env-file=.dev.vars scripts/run-eval.js            … 3つのやり方 × 40件
//     node scripts/run-eval.js --cases-only                     … 例題だけ（AI を使わない・料金なし）
//     node --env-file=.dev.vars scripts/run-eval.js --only=bus --variants=full   … 一部だけ
//   書き出した SQL を、wrangler d1 execute DB --local --file <SQL> で入れる
// - 鍵は表示しない。AI の答え（output_json）には架空の例題の中身しか入らない
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EVAL_CASES } from "../src/lib/eval-cases.js";
import { runCase, VARIANTS } from "../src/lib/eval.js";
import { makeClient } from "../src/lib/anthropic.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const casesOnly = args["cases-only"] === true;
const variants = args.variants ? String(args.variants).split(",") : Object.keys(VARIANTS);
for (const v of variants) if (!VARIANTS[v]) throw new Error(`知らないやり方：${v}`);
const cases = EVAL_CASES.filter((c) => !args.only || String(args.only).split(",").includes(c.domain));
const PARALLEL = Math.max(1, Math.min(6, Number(args.parallel ?? 4)));

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const lines = [];
for (const c of EVAL_CASES) {
  lines.push(
    `INSERT INTO eval_cases (id, domain, input_json, expected_json, note) VALUES (${q(c.id)}, ${q(c.domain)}, ${q(JSON.stringify(c.input))}, ${q(JSON.stringify(c.expected))}, ${q(c.note)})` +
      ` ON CONFLICT (id) DO UPDATE SET domain = excluded.domain, input_json = excluded.input_json, expected_json = excluded.expected_json, note = excluded.note;`,
  );
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const batch = `b${stamp}`;
let failed = 0;

if (!casesOnly) {
  const client = makeClient({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
  const jobs = variants.flatMap((variant) => cases.map((c) => ({ c, variant })));
  console.log(`流す数：${jobs.length}（例題 ${cases.length} 件 × やり方 ${variants.join("・")}）`);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { c, variant } = jobs[next++];
      try {
        const r = await runCase({ client, c, variant });
        lines.push(
          `INSERT INTO eval_runs (id, case_id, batch_id, variant, model, output_json, correct, missed, false_alarm) VALUES (` +
            [q(`${batch}-${variant}-${c.id}`), q(c.id), q(batch), q(variant), q(r.model), q(JSON.stringify(r.output)), r.correct, r.missed, r.false_alarm].join(", ") +
            `);`,
        );
        console.log(`${++done}/${jobs.length} ${variant} ${c.id} ${r.correct ? "○" : r.missed ? "×（止められず）" : "△（人の確認へ）"}${r.false_alarm ? ` 余計な差し戻し${r.false_alarm}` : ""}`);
      } catch (e) {
        failed++;
        console.log(`${++done}/${jobs.length} ${variant} ${c.id} 失敗：${e instanceof Error ? e.name : "unknown"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

const out = join(process.env.TMPDIR ?? tmpdir(), `ai-banto-eval-${casesOnly ? "cases" : batch}.sql`);
writeFileSync(out, lines.join("\n") + "\n");
console.log(`書き出し：${out}`);
if (failed) console.log(`失敗：${failed} 件（成績には入れていません）`);
