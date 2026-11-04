-- M9 成績（O-4-6）
-- 自作の例題（すべて架空）と、それを手元のスクリプト（scripts/run-eval.js）で流した結果。
-- 画面からは流さない（見るだけ）。expected_json（正解）は AI に渡さない。
CREATE TABLE eval_cases (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('keiri', 'tagengo', 'minpaku', 'bus')),
  input_json TEXT NOT NULL,
  expected_json TEXT NOT NULL,             -- 🚫 AI に渡さない
  note TEXT
);

-- variant：full＝手引き（Skill）あり＋監査役あり／no_skill＝手引きなし／no_audit＝監査役なし
-- missed＝間違った答えが、止められずに出た（1/0）
-- false_alarm＝正しい下書きを、監査役が差し戻した回数
CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES eval_cases (id),
  batch_id TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('full', 'no_skill', 'no_audit')),
  model TEXT,
  output_json TEXT,
  correct INTEGER NOT NULL DEFAULT 0 CHECK (correct IN (0, 1)),
  missed INTEGER NOT NULL DEFAULT 0 CHECK (missed IN (0, 1)),
  false_alarm INTEGER NOT NULL DEFAULT 0 CHECK (false_alarm >= 0),
  run_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_eval_runs_batch ON eval_runs (batch_id, variant);
