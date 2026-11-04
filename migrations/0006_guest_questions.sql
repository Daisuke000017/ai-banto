-- M14 行って戻れるか（G-4）
-- 1問1答。前の質問はAIに渡さない。30日たったら消す（質問を受けるたびに古いものを消す）
-- 1日10回の数は guest_links.ai_calls_today／ai_calls_date（0002 で用意済み）を使う

-- 質問と答え（質問は伏せたあとの文だけ。伏せる前の文は保存しない）
CREATE TABLE IF NOT EXISTS guest_questions (
  id TEXT PRIMARY KEY,
  guest_link_id INTEGER NOT NULL REFERENCES guest_links (id) ON DELETE CASCADE,
  question_masked TEXT,              -- 伏せた質問（200文字まで）。行き先ボタンのときは NULL
  parsed_json TEXT,                  -- {destination, back_by, day}
  judgment TEXT NOT NULL CHECK (judgment IN ('ok', 'tight', 'ng', 'walk', 'unknown', 'safety', 'limit')),
  plan_json TEXT,                    -- プログラムが選んだ行きの便・帰りの便・最終バス
  answer_template TEXT,              -- 説明の文（差し込み記号入り）
  answer_source TEXT,                -- ai／fixed
  answer_lang TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_questions_created ON guest_questions (created_at);
