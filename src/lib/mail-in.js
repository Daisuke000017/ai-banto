// メールで届いた予約メールを読む（M19）
// Cloudflare のメール受け取り（Email Routing）から Worker に渡された「生のメール」を、件名と本文の文字にする。
// 守ること
// - 送り元は、決めた相手（MAIL_ALLOW_FROM）だけ。それ以外は受け取らない
// - 大きすぎるメールは読まない。添付ファイルは読まない（文字の部分だけ）
// - ここでは保存しない。伏せる・書き写す・確かめるは booking-email.js の intakeBookingEmail が行う

export const MAX_RAW_BYTES = 200_000;
const MAX_PARTS = 20;

/** バイト列を「1バイト＝1文字」の文字列にする（中身をこわさずに見出しを読むため） */
export function bytesToBinary(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

function binaryToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function decodeCharset(bytes, charset) {
  const cs = (charset || "utf-8").toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function base64ToBinary(s) {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    return atob(clean);
  } catch {
    return "";
  }
}

function qpToBinary(s) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** 見出しと本文に分ける。見出しの名前は小文字。折り返しはつなぐ */
export function splitMessage(bin) {
  const m = /\r?\n\r?\n/.exec(bin);
  const head = m ? bin.slice(0, m.index) : bin;
  const body = m ? bin.slice(m.index + m[0].length) : "";
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    (headers[k] ??= []).push(line.slice(i + 1).trim());
  }
  return { headers, body };
}

const first = (h, k) => (h[k] ? h[k][0] : "");

function param(value, name) {
  const m = new RegExp(`;\\s*${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(value);
  return m ? (m[2] ?? m[1]) : null;
}

/** 件名などの =?UTF-8?B?...?= を文字にする */
export function decodeWords(s) {
  return String(s ?? "")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, text) => {
      const bin = enc.toUpperCase() === "B" ? base64ToBinary(text) : qpToBinary(text.replace(/_/g, " "));
      return decodeCharset(binaryToBytes(bin), cs);
    });
}

function decodePart(headers, body) {
  const enc = first(headers, "content-transfer-encoding").toLowerCase();
  const bin = enc === "base64" ? base64ToBinary(body) : enc === "quoted-printable" ? qpToBinary(body) : body;
  return decodeCharset(binaryToBytes(bin), param(first(headers, "content-type"), "charset"));
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n");
}

/** 文字の部分を探す（text/plain を先に。無ければ text/html を文字にする）。添付は読まない */
function findText(headers, body, depth = 0, count = { n: 0 }) {
  if (depth > 5 || ++count.n > MAX_PARTS) return null;
  const type = first(headers, "content-type") || "text/plain";
  const mime = type.split(";")[0].trim().toLowerCase();
  const disp = first(headers, "content-disposition").toLowerCase();
  if (disp.startsWith("attachment")) return null;
  if (mime.startsWith("multipart/")) {
    const boundary = param(type, "boundary");
    if (!boundary) return null;
    const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    let html = null;
    for (const raw of parts) {
      if (!raw.trim()) continue;
      const p = splitMessage(raw);
      const got = findText(p.headers, p.body, depth + 1, count);
      if (!got) continue;
      if (got.kind === "plain") return got;
      html ??= got;
    }
    return html;
  }
  if (mime === "text/plain") return { kind: "plain", text: decodePart(headers, body) };
  if (mime === "text/html") return { kind: "html", text: htmlToText(decodePart(headers, body)) };
  return null;
}

/** 送り元のアドレス（From: の <...> の中、または素のアドレス）を小文字で */
export function addressOf(from) {
  const s = decodeWords(from);
  const m = /<([^>]+)>/.exec(s) ?? /([^\s"<>]+@[^\s"<>]+)/.exec(s);
  return m ? m[1].trim().toLowerCase() : "";
}

/**
 * 生のメールを読む。返すのは件名・本文・送り元・Message-ID・認証の結果だけ
 * auth：メールを受け取った側（Cloudflare）が付けた結果に dkim=pass か spf=pass があれば true、fail なら false、書いていなければ null
 */
export function parseRawEmail(bin) {
  const { headers, body } = splitMessage(bin);
  const got = findText(headers, body);
  const auth = [...(headers["authentication-results"] ?? []), ...(headers["arc-authentication-results"] ?? [])].join(" ").toLowerCase();
  return {
    subject: decodeWords(first(headers, "subject")).slice(0, 300),
    text: (got?.text ?? "").replace(/\r\n/g, "\n").trim(),
    from: addressOf(first(headers, "from")),
    message_id: first(headers, "message-id").slice(0, 300),
    auth: /\b(dkim|spf)=pass\b/.test(auth) ? true : /\b(dkim|spf|dmarc)=fail\b/.test(auth) ? false : null,
  };
}

/** 決めた相手からか。allow は「a@example.com,example.org」のようにアドレスかドメインをカンマで並べる */
export function senderAllowed(address, allow) {
  const a = String(address ?? "").toLowerCase();
  if (!a.includes("@")) return false;
  const domain = a.split("@").pop();
  const list = String(allow ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.some((x) => (x.includes("@") ? x === a : x === domain));
}

/** 同じメールを二度読まないための鍵（Message-ID が無ければ件名＋本文から） */
export async function messageKeyOf(parsed) {
  const src = parsed.message_id || `${parsed.from}\n${parsed.subject}\n${parsed.text}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
