-- AI番頭：宿・予約・180日・宿泊税・定期報告の表
-- 設計の元：docs/02_データ設計.md（列の追加は §下の「追加した列」を参照）
-- 公開リポジトリのため、ここには表の形だけ。中身は seed/demo.sql（架空データ）だけを入れる。

-- 宿の基本情報（1軒＝1行）
CREATE TABLE inn_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  type TEXT NOT NULL,                      -- 家主不在型 など
  rooms INTEGER NOT NULL DEFAULT 1 CHECK (rooms >= 1),
  address TEXT,                            -- 🚫 ゲスト画面に出さない
  lat REAL,
  lng REAL,
  checkin_method_json TEXT,
  house_rules_json TEXT,
  allowed_promises_json TEXT,
  taxi_info_json TEXT,
  owner_contact_json TEXT,
  fixed_arrival_json TEXT,
  infants_taxable INTEGER NOT NULL DEFAULT 1 CHECK (infants_taxable IN (0, 1)),
  fiscal_year_start TEXT NOT NULL DEFAULT '04-01',
  -- 追加した列（2026-11-03）：宿泊税の数え方の設定
  cosleep_free_exempt INTEGER NOT NULL DEFAULT 0 CHECK (cosleep_free_exempt IN (0, 1)), -- 料金のかからない添い寝の子を外すか
  cancel_fee_treatment TEXT NOT NULL DEFAULT 'penalty' CHECK (cancel_fee_treatment IN ('penalty', 'lodging')),
  tax_start_date TEXT NOT NULL DEFAULT '2026-07-01',
  tax_rate INTEGER NOT NULL DEFAULT 200 CHECK (tax_rate >= 0)
);

-- 予約（予約サイトから取り込んだもの）
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  ota TEXT NOT NULL,                       -- airbnb / booking / direct など
  ota_reservation_no TEXT,
  guest_name TEXT,                         -- 🚫 AIに渡さない
  checkin_date TEXT NOT NULL,
  checkout_date TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights >= 1),
  adults INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 0),
  children INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  infants INTEGER NOT NULL DEFAULT 0 CHECK (infants >= 0),
  language TEXT,
  tax_collection TEXT NOT NULL DEFAULT 'unknown' CHECK (tax_collection IN ('ota', 'included', 'onsite', 'unknown')),
  lodging_tax_collected INTEGER,           -- 預かった宿泊税（円）。分からなければ NULL
  nationalities_json TEXT,                 -- {"JP":2,"TW":1}
  amount_gross INTEGER,
  room TEXT CHECK (room IS NULL OR (length(room) = 1 AND room BETWEEN 'A' AND 'Z')), -- 部屋の記号（rooms 表。2026-11-07 に A・B 固定から広げた）
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  -- 追加した列（2026-11-03）
  cosleep_free INTEGER NOT NULL DEFAULT 0 CHECK (cosleep_free >= 0), -- 子どものうち、料金のかからない添い寝の人数
  cancel_fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (cancel_fee_amount >= 0),
  guest_changes_json TEXT,                 -- 途中で人数が変わったとき [{"from_night":"YYYY-MM-DD","adults":3}]
  CHECK (checkout_date > checkin_date),
  CHECK (cosleep_free <= children)
);
CREATE INDEX idx_reservations_checkin ON reservations (checkin_date);

-- 泊ごとの表（180日と定期報告の元。確定した予約だけ）
CREATE TABLE stay_nights (
  reservation_id TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  night TEXT NOT NULL,                     -- その夜の日付（正午〜翌日正午）
  fiscal_year TEXT NOT NULL,               -- 4月1日はじまりの年度
  guests INTEGER NOT NULL CHECK (guests >= 0),
  PRIMARY KEY (reservation_id, night)
);
CREATE INDEX idx_stay_nights_fy ON stay_nights (fiscal_year, night);

-- 宿泊税の集計表の下書き（毎月）
CREATE TABLE tax_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,                     -- YYYY-MM
  person_nights INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL,
  collected_amount INTEGER NOT NULL,
  diff INTEGER NOT NULL,
  breakdown_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 定期報告の下書き（2か月ごと）
CREATE TABLE minpaku_reports (
  period TEXT PRIMARY KEY,                 -- 2026-08_09
  due_date TEXT NOT NULL,
  stay_days INTEGER NOT NULL,
  guests INTEGER NOT NULL,
  guest_nights INTEGER NOT NULL,
  nationality_json TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
