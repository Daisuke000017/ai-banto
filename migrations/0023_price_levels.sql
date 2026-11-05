-- 0023 料金のレベル（経営企画・2026-11-06）
-- 金額はオーナーが決める。はっきりした日（年末年始・お盆・連休・行事）のレベルはプログラムが決める。
-- グレーな日だけ、経営企画（AI）がレベルを選んで理由を書き、監査役が点検する。決めて予約サイトに入れるのはオーナー。

-- 宿の設定：レベル1〜4の1泊の料金（オーナーが決める。空なら「未設定」）
ALTER TABLE inn_profile ADD COLUMN price_l1 INTEGER CHECK (price_l1 IS NULL OR price_l1 >= 0);
ALTER TABLE inn_profile ADD COLUMN price_l2 INTEGER CHECK (price_l2 IS NULL OR price_l2 >= 0);
ALTER TABLE inn_profile ADD COLUMN price_l3 INTEGER CHECK (price_l3 IS NULL OR price_l3 >= 0);
ALTER TABLE inn_profile ADD COLUMN price_l4 INTEGER CHECK (price_l4 IS NULL OR price_l4 >= 0);

-- 宮崎市内の行事の候補。AIが市の観光のページなどから拾う（found_by='ai'）か、デモの見本（'sample'）
-- オーナーが OK した候補だけが「上げどき」に使われる
CREATE TABLE price_event_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_day TEXT NOT NULL,                 -- YYYY-MM-DD
  end_day TEXT NOT NULL,                   -- YYYY-MM-DD（1日だけなら start_day と同じ）
  place TEXT,
  source_url TEXT,
  source_title TEXT,
  crowd TEXT CHECK (crowd IS NULL OR crowd IN ('large', 'medium', 'small')),
  note TEXT,
  found_by TEXT NOT NULL CHECK (found_by IN ('ai', 'sample')),
  run_id INTEGER REFERENCES agent_runs (id),
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'ok', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  CHECK (end_day >= start_day),
  UNIQUE (name, start_day)
);
CREATE INDEX idx_price_event_candidates_status ON price_event_candidates (status, start_day);

-- 料金のレベルの案（夜ごと）。plan_json は [{night, level, by:'program'|'ai', reason}]
CREATE TABLE price_level_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_night TEXT NOT NULL,
  to_night TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  summary TEXT,
  run_id INTEGER REFERENCES agent_runs (id),
  audit_run_id INTEGER REFERENCES agent_runs (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ok')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE INDEX idx_price_level_plans_created ON price_level_plans (id);
