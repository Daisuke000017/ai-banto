-- AI番頭：ゲスト画面（M12）
-- 設計の元：docs/02_データ設計.md（guest_links / guest_profiles）
-- 🚫 名前・旅券番号・写真は持たない。人数と国籍ごとの人数だけ。

-- URLを作ったときの泊まりの日付。開くたびに台帳と見比べ、違えば使えなくする
ALTER TABLE guest_links ADD COLUMN checkin_date TEXT;
ALTER TABLE guest_links ADD COLUMN checkout_date TEXT;
-- ゲストが選んだ言語（このURLの中だけで覚える）
ALTER TABLE guest_links ADD COLUMN language TEXT;
CREATE INDEX idx_guest_links_res ON guest_links (reservation_id, revoked);

-- ゲストが入れた人数・国籍。台帳（reservations）は書きかえず、違えば「ずれ」の候補にする
CREATE TABLE guest_profiles (
  reservation_id TEXT PRIMARY KEY REFERENCES reservations (id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  adults INTEGER NOT NULL CHECK (adults BETWEEN 1 AND 20),
  children INTEGER NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 20),
  infants INTEGER NOT NULL DEFAULT 0 CHECK (infants BETWEEN 0 AND 20),
  nationalities_json TEXT NOT NULL,        -- 国籍ごとの人数（例：{"TW":2}）
  submitted_at TEXT NOT NULL
);
