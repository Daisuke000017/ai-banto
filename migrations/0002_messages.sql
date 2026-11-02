-- AI番頭：ゲストへの案内（下書き）・ゲスト画面の鍵・AIの働きの記録の表
-- 設計の元：docs/02_データ設計.md（guest_links / guest_drafts / agent_runs）
-- 公開リポジトリのため、ここには表の形だけ。
-- 🚫 暗証番号（ドアのコード）はどの表にも入れない。コピーするときだけ Secrets（env.DOOR_CODE）から差し込む。

-- ゲスト画面（QR）の鍵。URLの合言葉そのものは保存せず、ハッシュだけを持つ
CREATE TABLE guest_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,         -- 🚫 合言葉そのものは入れない（SHA-256 のハッシュだけ）
  expires_at TEXT NOT NULL,                -- チェックアウト日の正午（日本時間）
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  ai_calls_today INTEGER NOT NULL DEFAULT 0 CHECK (ai_calls_today >= 0), -- 1日10回まで（「10未満なら1足す」を1回の更新で行う）
  ai_calls_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ゲストへの案内の下書き（AIが書き、オーナーが確認してコピーする）
CREATE TABLE guest_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('arrival', 'evacuation', 'reply')),
  language TEXT NOT NULL,
  draft_template TEXT NOT NULL,            -- {DOOR_CODE} などの差し込み口のまま保存する（🚫 中身を入れない）
  ja_text TEXT,                            -- オーナー確認用の日本語
  back_translation TEXT,                   -- 日本語の元を見せずに訳し戻した文
  checks_json TEXT,                        -- プログラムの確認結果
  audit_json TEXT,                         -- 監査役の判定
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'fixed')), -- 追加した列：fixed＝AIが使えず決まった文にした
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ok', 'copied')),
  source_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_guest_drafts_res ON guest_drafts (reservation_id, kind, status);

-- AIの働きの記録（画面の「誰が何をしたか」と、使いすぎ止めの数え元）
-- 🚫 個人情報・AIに送った文そのものは入れない。要約は差し込み前の文から作る
CREATE TABLE agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL CHECK (agent IN ('banto', 'keiri', 'kansa', 'shukuhaku', 'keiei')),
  task TEXT NOT NULL,                      -- draft / translate_back / audit / column_map など
  status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'done', 'sent_back', 'failed')),
  parent_run_id INTEGER REFERENCES agent_runs (id),
  sent_back_reason TEXT,
  input_summary TEXT,
  output_summary TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX idx_agent_runs_created ON agent_runs (created_at);
