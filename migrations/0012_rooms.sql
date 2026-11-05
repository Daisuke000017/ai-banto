-- 部屋の登録（2026-11-07）：部屋の数と名前を、オーナーが画面で登録する
-- 記号（A, B, C…）はプログラムが付ける。予約の room 欄にはこの記号が入る
-- 部屋は消さずに「使わない」（active = 0）にする。過去の予約が部屋を指しているため
CREATE TABLE rooms (
  code TEXT PRIMARY KEY CHECK (length(code) = 1 AND code BETWEEN 'A' AND 'Z'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 民泊の届出番号（定期報告のファイルに入れる）。分からなければ空のまま
ALTER TABLE inn_profile ADD COLUMN notification_no TEXT CHECK (notification_no IS NULL OR length(notification_no) <= 30);
