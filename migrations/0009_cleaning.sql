-- M18 清掃が必要な日：清掃できる時間（チェックアウト〜チェックイン）を宿の設定に持つ
-- 入れ替えの日は、この間に清掃する。宿ごとに変えられる（"HH:MM"）
ALTER TABLE inn_profile ADD COLUMN cleaning_checkout_time TEXT NOT NULL DEFAULT '10:00';
ALTER TABLE inn_profile ADD COLUMN cleaning_checkin_time TEXT NOT NULL DEFAULT '15:00';
