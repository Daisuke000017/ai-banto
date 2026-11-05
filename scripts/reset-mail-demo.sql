-- メールで届いたデモ予約（送り元 ota-demo.example）を「届く前」に戻す。撮影の前に使う
-- 手元だけ：npx wrangler d1 execute ai-banto --local --file scripts/reset-mail-demo.sql
-- 消すのは、そのメール・そこから入った予約・その予約の案内と決裁箱の札だけ。ほかの予約には触らない

DELETE FROM decisions WHERE kind = 'arrival_draft' AND target_id IN (
  SELECT CAST(g.id AS TEXT) FROM guest_drafts g WHERE g.reservation_id IN (
    SELECT reservation_id FROM booking_emails WHERE sender_domain = 'ota-demo.example' AND reservation_id IS NOT NULL));

DELETE FROM decisions WHERE kind = 'booking_email' AND target_id IN (
  SELECT CAST(id AS TEXT) FROM booking_emails WHERE sender_domain = 'ota-demo.example');

DELETE FROM guest_drafts WHERE reservation_id IN (
  SELECT reservation_id FROM booking_emails WHERE sender_domain = 'ota-demo.example' AND reservation_id IS NOT NULL);
DELETE FROM guest_links WHERE reservation_id IN (
  SELECT reservation_id FROM booking_emails WHERE sender_domain = 'ota-demo.example' AND reservation_id IS NOT NULL);
DELETE FROM guest_profiles WHERE reservation_id IN (
  SELECT reservation_id FROM booking_emails WHERE sender_domain = 'ota-demo.example' AND reservation_id IS NOT NULL);
DELETE FROM stay_nights WHERE reservation_id IN (
  SELECT reservation_id FROM booking_emails WHERE sender_domain = 'ota-demo.example' AND reservation_id IS NOT NULL);
DELETE FROM reservations WHERE id IN (
  SELECT reservation_id FROM booking_emails WHERE sender_domain = 'ota-demo.example' AND reservation_id IS NOT NULL);

DELETE FROM booking_emails WHERE sender_domain = 'ota-demo.example';
