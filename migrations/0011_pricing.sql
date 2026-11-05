-- 0011 値付けの助言（経営企画・2026-11-05）
-- AIは使わない。数字と文はプログラムが決まった形で作る。値段を決めて予約サイトに入れるのはオーナー。

-- 宿の設定：清掃費1回いくら・最低価格（これ以下では売らない）。空なら「未設定」
ALTER TABLE inn_profile ADD COLUMN cleaning_fee INTEGER CHECK (cleaning_fee IS NULL OR cleaning_fee >= 0);
ALTER TABLE inn_profile ADD COLUMN min_price INTEGER CHECK (min_price IS NULL OR min_price >= 0);

-- 決裁箱に「値付け」の種類を足す（SQLite は CHECK を変えられないので、作り直して中身を移す）
CREATE TABLE decisions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('booking_email', 'arrival_draft', 'cleaning', 'pace', 'report_due', 'discrepancy', 'price_event', 'price_gap')),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('urgent', 'warn', 'info')),
  title TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  target_id TEXT,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ok', 'closed')),
  patrol_run_id INTEGER REFERENCES patrol_runs (id),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
INSERT INTO decisions_new (id, ref_key, kind, level, title, facts_json, target_id, link, status, patrol_run_id, created_at, decided_at)
  SELECT id, ref_key, kind, level, title, facts_json, target_id, link, status, patrol_run_id, created_at, decided_at FROM decisions;
DROP TABLE decisions;
ALTER TABLE decisions_new RENAME TO decisions;
CREATE INDEX idx_decisions_status ON decisions (status, id);

-- 「見直した／このまま」の記録。押したときに、その夜がもう埋まっていた予約の番号を残す
-- （あとから入った予約だけを「その後に埋まった」と数えるため）
CREATE TABLE price_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL,
  ref_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('price_event', 'price_gap')),
  room TEXT CHECK (room IS NULL OR (length(room) = 1 AND room BETWEEN 'A' AND 'Z')),
  nights_json TEXT NOT NULL,                -- 対象の夜（日付の並び）
  before_json TEXT NOT NULL,                -- 押したときに、もう入っていた予約の番号
  free_room_nights INTEGER NOT NULL,        -- 押したときに空いていた「部屋×夜」の数
  choice TEXT NOT NULL CHECK (choice IN ('reviewed', 'kept')),
  decided_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_price_reviews_decision ON price_reviews (decision_id);
