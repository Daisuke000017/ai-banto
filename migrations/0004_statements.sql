-- AI番頭：お金の照合（M1〜M4）の表
-- 設計の元：docs/02_データ設計.md §2-1（uploads / column_maps / ota_lines / ota_payouts / bank_deposits / discrepancies）
-- 🚫 元のファイルは保存しない。対応表をOKしたときに画面がもう一度送り、読んだ行だけをここに入れる。
-- 🚫 名前の列・口座番号・残高は読まない（対応表で選ばれなかった列は捨てる）。
-- 🎭 通帳の摘要は、予約サイトの名前でなければ伏せてから入れる（個人の振込名義が入るため）。
-- 軽い版：同じ種類のファイルをもう一度読み込んだら、その種類の前の行は入れ替える。

CREATE TABLE column_maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('airbnb', 'booking', 'rakuten', 'bank')),
  header_hash TEXT NOT NULL,              -- 見出し行の指紋（同じ形式か見分ける）
  mapping_json TEXT NOT NULL,             -- {"line_date": 0, "gross": 13, ...}（列は0から数える）
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('ai', 'program', 'owner')),
  confirmed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_column_maps_hash ON column_maps (kind, header_hash);

CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('airbnb', 'booking', 'rakuten', 'bank')),
  header_hash TEXT NOT NULL,
  column_map_id INTEGER REFERENCES column_maps (id),
  map_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (map_confirmed IN (0, 1)),
  proposal_json TEXT,                     -- 対応表の案（列見出し・伏せたサンプル・自信）。元の値は入れない
  row_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE ota_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  ota TEXT NOT NULL,
  payout_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payout_ref TEXT
);

CREATE TABLE ota_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  ota TEXT NOT NULL,
  ota_reservation_no TEXT,
  reservation_id TEXT REFERENCES reservations (id) ON DELETE SET NULL,
  payout_id INTEGER REFERENCES ota_payouts (id) ON DELETE SET NULL,
  line_date TEXT NOT NULL,
  checkin_date TEXT,
  line_type TEXT NOT NULL CHECK (line_type IN ('reservation', 'refund', 'fee', 'adjustment')),
  payment_channel TEXT NOT NULL CHECK (payment_channel IN ('ota', 'property')), -- ota＝予約サイトが集めて振り込む／property＝宿が直接受け取る
  gross INTEGER,
  fee INTEGER,
  lodging_tax INTEGER,
  net INTEGER
  -- guest_name_raw は作らない（名前の列は読まない）
);
CREATE INDEX idx_ota_lines_no ON ota_lines (ota, ota_reservation_no);

CREATE TABLE bank_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  deposit_date TEXT NOT NULL,
  amount INTEGER NOT NULL,                -- 入金は＋、出金は−
  description TEXT,                       -- 🎭 予約サイトの名前でなければ伏せたもの
  ota_hint TEXT,                          -- 摘要から分かった予約サイト（airbnb／booking／rakuten／空）
  payout_id INTEGER REFERENCES ota_payouts (id) ON DELETE SET NULL
);

CREATE TABLE discrepancies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('ledger_vs_ota', 'payout_vs_bank', 'tax_collected', 'guest_count')),
  reservation_id TEXT REFERENCES reservations (id) ON DELETE SET NULL,
  payout_id INTEGER REFERENCES ota_payouts (id) ON DELETE SET NULL,
  deposit_id INTEGER REFERENCES bank_deposits (id) ON DELETE SET NULL,
  expected INTEGER,
  actual INTEGER,
  diff_amount INTEGER NOT NULL,
  facts_json TEXT NOT NULL,               -- AIに渡してよい事実だけ（予約番号・金額・日付・予約サイト・差・人数の数）。名前・摘要は入れない
  reason_candidates_json TEXT,            -- 経理担当（AI）またはプログラムの理由の候補と、計算で確かめた結果
  confidence TEXT CHECK (confidence IN ('high', 'mid', 'low')),
  audit_json TEXT,                        -- 監査役の判定・差し戻しの回数
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ok', 'fixed')),
  owner_note TEXT,                        -- 🚫 AIには渡さない
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_discrepancies_status ON discrepancies (status, id);
