-- 宿泊税の申告書（宮崎市 様式第10号）に書くこと。オーナーが設定の画面で入れる（どれも任意）
-- 空のままなら、申告書のその欄は空けて出す（手で書いてもらう）
-- 公開のリポジトリには本物を置かない（デモは架空の値）
ALTER TABLE inn_profile ADD COLUMN collector_address TEXT; -- 特別徴収義務者の住所（所在地）
ALTER TABLE inn_profile ADD COLUMN collector_name TEXT;    -- 特別徴収義務者の氏名（名称）
ALTER TABLE inn_profile ADD COLUMN corporate_no TEXT;      -- 法人番号（13桁。個人なら空）
ALTER TABLE inn_profile ADD COLUMN inn_phone TEXT;         -- 宿泊施設の電話番号
ALTER TABLE inn_profile ADD COLUMN facility_no TEXT;       -- 施設番号（市から知らされた番号）
ALTER TABLE inn_profile ADD COLUMN contact_name TEXT;      -- 担当者
ALTER TABLE inn_profile ADD COLUMN contact_phone TEXT;     -- 担当者の電話番号
