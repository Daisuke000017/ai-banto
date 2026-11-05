-- 清掃の担当（オーナーが画面で登録する）
-- cleaners：名前だけ。電話番号・住所・連絡先は預からない（知らせを送るのはオーナー本人）
-- 人は消さずに「止める」にする（過去の割り当てが人を指しているため）
CREATE TABLE cleaners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX cleaners_name ON cleaners (name);

-- cleaning_assignments：清掃の割り当て。チェックアウトする予約ごとに1人
-- date・room は割り当てたときの清掃の日と部屋。予約の出る日か部屋が変わったら、その割り当ては使わない（画面で選び直してもらう）
CREATE TABLE cleaning_assignments (
  reservation_id TEXT PRIMARY KEY REFERENCES reservations (id) ON DELETE CASCADE,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  room TEXT,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners (id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX cleaning_assignments_cleaner ON cleaning_assignments (cleaner_id, date);
