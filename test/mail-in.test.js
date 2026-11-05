// メールで届いた予約メールを読む（M19）の自動テスト。使い方：npm test
// 生のメールから、件名・本文・送り元・Message-ID・認証の結果だけを取り出せるか。添付は読まないか。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawEmail, senderAllowed, decodeWords, addressOf, bytesToBinary, messageKeyOf } from "../src/lib/mail-in.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const bin = (s) => bytesToBinary(new TextEncoder().encode(s));

test("件名の =?UTF-8?B?...?= を日本語にもどす（2つに分かれていてもつなぐ）", () => {
  const a = `=?UTF-8?B?${b64("【Booking.com】")}?=`;
  const b = `=?UTF-8?B?${b64("新しい予約")}?=`;
  assert.equal(decodeWords(`${a} ${b}`), "【Booking.com】新しい予約");
  assert.equal(decodeWords("=?UTF-8?Q?caf=C3=A9_au_lait?="), "café au lait");
  assert.equal(decodeWords("ふつうの件名"), "ふつうの件名");
  assert.equal(decodeWords(null), "");
});

test("送り元のアドレスを小文字で取り出す", () => {
  assert.equal(addressOf("Booking Demo <Reservations@OTA-Demo.example>"), "reservations@ota-demo.example");
  assert.equal(addressOf("reservations@ota-demo.example"), "reservations@ota-demo.example");
  assert.equal(addressOf("名前だけ"), "");
});

test("base64 の本文（UTF-8）を読み、見出しを取り出す", () => {
  const body = "Booking.com から新しい予約のお知らせです。\nチェックイン: 2026-10-12\n";
  const raw = [
    "From: Booking Demo <reservations@ota-demo.example>",
    "To: banto@inn-demo.example",
    `Subject: =?UTF-8?B?${b64("【Booking.com】新しい予約")}?=`,
    "Message-ID: <demo-1@ota-demo.example>",
    "Authentication-Results: mx.example; dkim=pass header.d=ota-demo.example; spf=pass",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(body),
    "",
  ].join("\r\n");
  const p = parseRawEmail(bin(raw));
  assert.equal(p.subject, "【Booking.com】新しい予約");
  assert.equal(p.text, body.trim());
  assert.equal(p.from, "reservations@ota-demo.example");
  assert.equal(p.message_id, "<demo-1@ota-demo.example>");
  assert.equal(p.auth, true);
});

test("認証が fail なら false、書いていなければ null", () => {
  const base = ["From: a@ota-demo.example", "Subject: x", "Content-Type: text/plain; charset=UTF-8"];
  assert.equal(parseRawEmail(bin([...base, "Authentication-Results: mx; dkim=fail; spf=fail", "", "本文"].join("\r\n"))).auth, false);
  assert.equal(parseRawEmail(bin([...base, "", "本文"].join("\r\n"))).auth, null);
});

test("multipart：text/plain を先に読み、添付ファイルは読まない", () => {
  const raw = [
    "From: a@ota-demo.example",
    "Subject: test",
    'Content-Type: multipart/mixed; boundary="XYZ"',
    "",
    "--XYZ",
    'Content-Type: multipart/alternative; boundary="ALT"',
    "",
    "--ALT",
    "Content-Type: text/html; charset=UTF-8",
    "",
    "<p>HTMLの本文</p>",
    "--ALT",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "=E6=96=87=E5=AD=97=E3=81=AE=E6=9C=AC=E6=96=87",
    "--ALT--",
    "--XYZ",
    "Content-Type: text/plain; charset=UTF-8",
    'Content-Disposition: attachment; filename="secret.txt"',
    "",
    "添付の中身",
    "--XYZ--",
    "",
  ].join("\r\n");
  const p = parseRawEmail(bin(raw));
  assert.equal(p.text, "文字の本文");
  assert.ok(!p.text.includes("添付の中身"));
});

test("text/html しかなければ、タグを外して文字にする（script は捨てる）", () => {
  const raw = [
    "From: a@ota-demo.example",
    "Subject: html",
    "Content-Type: text/html; charset=UTF-8",
    "",
    "<div>チェックイン: 2026-10-12</div><script>alert(1)</script><p>大人2名 &amp; 子ども0名</p>",
  ].join("\r\n");
  const p = parseRawEmail(bin(raw));
  assert.ok(p.text.includes("チェックイン: 2026-10-12"));
  assert.ok(p.text.includes("大人2名 & 子ども0名"));
  assert.ok(!p.text.includes("alert"));
});

test("送り元の許可：アドレス一致かドメイン一致だけ。空の設定ならだれも通さない", () => {
  const allow = "reservations@ota-demo.example, booking-demo.example";
  assert.equal(senderAllowed("reservations@ota-demo.example", allow), true);
  assert.equal(senderAllowed("RESERVATIONS@OTA-DEMO.EXAMPLE", allow), true);
  assert.equal(senderAllowed("other@ota-demo.example", allow), false);
  assert.equal(senderAllowed("anyone@booking-demo.example", allow), true);
  assert.equal(senderAllowed("x@evil-booking-demo.example", allow), false);
  assert.equal(senderAllowed("reservations@ota-demo.example", ""), false);
  assert.equal(senderAllowed("reservations@ota-demo.example", undefined), false);
  assert.equal(senderAllowed("not-an-address", allow), false);
});

test("同じメールは同じ鍵、ちがうメールはちがう鍵", async () => {
  const a = await messageKeyOf({ message_id: "<a@x>", from: "", subject: "", text: "" });
  const a2 = await messageKeyOf({ message_id: "<a@x>", from: "y", subject: "z", text: "w" });
  const b = await messageKeyOf({ message_id: "<b@x>", from: "", subject: "", text: "" });
  assert.equal(a, a2);
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});
