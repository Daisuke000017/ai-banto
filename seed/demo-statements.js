// お金の照合（M1〜M4）のデモ用の明細。中身はすべて架空。
// 予約番号は seed/demo-reservations.js の ota_reservation_no（DEMO-0006 など）と合わせてある。
//
// わざと入れてある「ずれ」（デモで見せる所）
// - R08（DEMO-0009）：台帳はキャンセル料 30,000円、明細は 15,000円（キャンセル料が半分）
// - R10（DEMO-0011）：台帳は 36,000円、明細は 34,200円（5%の割引）
// - R09（DEMO-0010）：振込 71,640円の予定が、通帳は 71,200円（440円少ない）
// - R11（DEMO-0013）：9/29 の振込が、9/30 までの通帳にまだ無い（入金待ち）
// - R06（DEMO-0007）：予約サイトが集めた宿泊税 800円、計算では 1,000円（途中で1人増えた）
// - R09（DEMO-0010）：予約サイトが集めた宿泊税 1,800円、計算では 2,400円（乳幼児の分）
// 名前・口座・残高の列も入れてある（読まない列として外れることを見せるため）。

const airbnb = [
  "Date,Type,Confirmation Code,Start Date,Nights,Guest,Listing,Details,Reference Code,Currency,Amount,Paid Out,Service Fee,Gross Earnings,Occupancy Taxes",
  "08/09/2026,Payout,,,,,,Transfer to ****0000,PO-DEMO-0809,JPY,,39600,,,",
  "08/09/2026,Reservation,DEMO-0007,08/08/2026,2,架空 太郎,デモの宿,,,JPY,39600,,1200,40000,800",
  "08/15/2026,Payout,,,,,,Transfer to ****0000,PO-DEMO-0815,JPY,,14550,,,",
  "08/15/2026,Cancellation Fee,DEMO-0009,08/14/2026,2,Demo Guest,デモの宿,Guest cancelled,,JPY,14550,,450,15000,0",
  "08/23/2026,Payout,,,,,,Transfer to ****0000,PO-DEMO-0823,JPY,,71640,,,",
  "08/23/2026,Reservation,DEMO-0010,08/22/2026,3,架空 花子,デモの宿,,,JPY,71640,,2160,72000,1800",
  "09/29/2026,Payout,,,,,,Transfer to ****0000,PO-DEMO-0929,JPY,,62910,,,",
  "09/29/2026,Reservation,DEMO-0013,09/19/2026,3,架空 四郎,デモの宿,,,JPY,62910,,1890,63000,1800",
].join("\n");

const booking = [
  "Reservation number,Guest name,Check-in,Check-out,Status,Original amount,Final amount,Commission amount,Currency",
  "DEMO-0006,Alex Demo,2026-07-31,2026-08-03,ok,84000,84000,12600,JPY",
  "DEMO-0011,Demo Guest,2026-09-05,2026-09-07,ok,36000,34200,5130,JPY",
  "DEMO-0012,架空 三郎,2026-09-12,2026-09-13,cancelled_by_guest,24000,0,0,JPY",
].join("\n");

// 1行目は口座の情報（読まない）。残高の列も読まない。
const bank = [
  "口座,普通 0000000（架空）",
  "日付,摘要,お引出し,お預入れ,残高",
  "2026/08/11,振込 AIRBNB PAYMENTS,,\"39,600\",\"539,600\"",
  "2026/08/17,振込 AIRBNB PAYMENTS,,\"14,550\",\"554,150\"",
  "2026/08/20,口座振替 ﾃﾞﾝｷﾘﾖｳｷﾝ,\"8,450\",,\"545,700\"",
  "2026/08/25,振込 AIRBNB PAYMENTS,,\"71,200\",\"616,900\"",
  "2026/08/27,振込 BOOKING.COM,\"12,600\",,\"604,300\"",
  "2026/09/25,ﾌﾘｺﾐ ｶｸｳ ｻﾌﾞﾛｳ,,\"18,000\",\"622,300\"",
  "2026/09/28,振込 BOOKING.COM,\"5,130\",,\"617,170\"",
  "2026/09/30,口座振替 ｽｲﾄﾞｳﾘﾖｳｷﾝ,\"3,200\",,\"613,970\"",
].join("\n");

export const sampleStatements = [
  { key: "airbnb", kind: "airbnb", label: "Airbnb の入金明細（8〜9月）", filename: "airbnb_demo_2026-08_09.csv", text: airbnb },
  { key: "booking", kind: "booking", label: "Booking.com の予約明細（7〜9月）", filename: "booking_demo_2026-07_09.csv", text: booking },
  { key: "bank", kind: "bank", label: "通帳の明細（8〜9月）", filename: "bank_demo_2026-08_09.csv", text: bank },
];
