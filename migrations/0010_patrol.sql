-- 朝の見回り（M19）と決裁箱（M20）
-- 見回り：決まった時刻（定期ジョブ）か「いま見回る」ボタンで、番頭が台帳・予約メール・期限を見て回る。
-- 決裁箱：見回りで見つけたことを、オーナーの「OK」か「直す」を待つ箱に入れる。
-- 🚫 宿泊者の名前・本文そのものは入れない。数字と日付はプログラムが入れたものだけ。

-- 見回りの記録（いつ・何がきっかけで・何件見つけたか）
CREATE TABLE patrol_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'button', 'email')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  new_items INTEGER NOT NULL DEFAULT 0,
  ai_drafts INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT                         -- 見た項目ごとの件数（数字だけ）
);

-- 決裁箱。ref_key で同じことを二度入れない（例：booking_email:12、cleaning:2026-10-11:A）
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('booking_email', 'arrival_draft', 'cleaning', 'pace', 'report_due', 'discrepancy')),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('urgent', 'warn', 'info')),
  title TEXT NOT NULL,                      -- プログラムが組み立てた見出し
  facts_json TEXT NOT NULL,                 -- 画面に出す事実（数字・日付だけ）
  target_id TEXT,                           -- 予約メールの id・下書きの id など
  link TEXT,                                -- 「直す」で開く画面（#mail など）
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ok', 'closed')),
  patrol_run_id INTEGER REFERENCES patrol_runs (id),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_decisions_status ON decisions (status, id);

-- メールで届いた予約メール：同じメールを二度読まない（Message-ID のハッシュ）
ALTER TABLE booking_emails ADD COLUMN message_key TEXT;
CREATE UNIQUE INDEX idx_booking_emails_msgkey ON booking_emails (message_key) WHERE message_key IS NOT NULL;
