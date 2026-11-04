-- M15 訓練ボタン・災害モード（O-5・G-5）
-- 宿に1行だけ（id = 1）。active＝1 のあいだ、ゲスト画面は災害モード（訓練）になる。
-- draft_from_id：訓練を始めたときの guest_drafts の最大の id。
--   これより大きい id の避難の案内（kind = 'evacuation'）が「今回の訓練」の下書き。
--   （guest_drafts.created_at は本当の時刻、started_at はデモの日付なので、時刻では比べない）
CREATE TABLE drill_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  scenario TEXT NOT NULL DEFAULT 'tsunami_advisory' CHECK (scenario IN ('tsunami_advisory')),
  started_at TEXT,
  ended_at TEXT,
  draft_from_id INTEGER NOT NULL DEFAULT 0
);

INSERT INTO drill_state (id) VALUES (1);
