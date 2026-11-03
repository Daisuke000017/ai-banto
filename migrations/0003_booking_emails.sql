-- AI番頭：予約メール（M17）の表
-- 設計の元：docs/02_データ設計.md（booking_emails）
-- 🚫 伏せる前の本文は入れない。名前・メール・電話・住所・旅券番号・URL は伏せてから入れる。
-- 伏せた本文（masked_body）は expires_at（受け取ってから30日）を過ぎたら消す。書き写した項目と検査結果は残す。

CREATE TABLE booking_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,              -- ISO（UTC）。デモでは DEMO_TODAY の時刻
  source TEXT NOT NULL DEFAULT 'paste' CHECK (source IN ('paste', 'email')),
  ota TEXT NOT NULL DEFAULT 'unknown' CHECK (ota IN ('airbnb', 'booking', 'rakuten', 'direct', 'unknown')),
  kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('new', 'change', 'cancel', 'unknown')),
  reservation_no TEXT,                     -- 書き写した予約番号（検査を通ったものだけ。重複の確認に使う）
  extracted_json TEXT,                     -- 書き写した項目（本文に無かったものは空に戻したあと）
  check_result_json TEXT,                  -- プログラムの検査結果
  read_by TEXT NOT NULL DEFAULT 'ai' CHECK (read_by IN ('ai', 'none')), -- none＝AIが使えず、手で入れる
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'rejected')),
  reservation_id TEXT REFERENCES reservations (id) ON DELETE SET NULL,
  masked_body TEXT,                        -- 🎭 伏せたあとの件名と本文だけ
  sender_domain TEXT,                      -- M17-2 だけ
  auth_pass INTEGER CHECK (auth_pass IN (0, 1)), -- M17-2 だけ
  decided_at TEXT,
  expires_at TEXT NOT NULL                 -- ISO（UTC）。受け取ってから30日
);
CREATE INDEX idx_booking_emails_status ON booking_emails (status, id);
CREATE INDEX idx_booking_emails_resno ON booking_emails (reservation_no);

-- 同じ予約番号の予約を二度入れない（「新しい予約」を二回OKしても、2件目は入らない）
CREATE UNIQUE INDEX idx_reservations_ota_no ON reservations (ota_reservation_no) WHERE ota_reservation_no IS NOT NULL;
