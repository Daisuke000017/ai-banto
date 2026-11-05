// 部屋の一覧（宿の設定で登録する）。プログラムだけで扱う（AIは使わない）
// - 部屋の「記号」（A, B, C…）はプログラムが付ける。予約の room 欄にはこの記号が入る
// - 画面に出すのは、オーナーが付けた「名前」（例：和室・2階の部屋）
// - 部屋は消さずに「使わない」にする（過去の予約が部屋を指しているため）
export const DEFAULT_ROOMS = ["A", "B"];
export const MAX_ROOMS = 26;
export const ROOM_NAME_MAX = 20;

const CODE_RE = /^[A-Z]$/;

/** 予約の部屋の記号として正しい形か */
export const isRoomCode = (v) => typeof v === "string" && CODE_RE.test(v);

/**
 * 部屋の記号の並びにそろえる。
 * - 配列（記号の文字列、または {code} の行）ならその順
 * - 数なら A から順にその数だけ（古い呼び方との互換）
 */
export function roomCodes(rooms) {
  if (Array.isArray(rooms)) return rooms.map((r) => (typeof r === "string" ? r : r.code)).filter(isRoomCode);
  const n = Number(rooms);
  if (!Number.isInteger(n) || n < 1) return [];
  return Array.from({ length: Math.min(n, MAX_ROOMS) }, (_, i) => String.fromCharCode(65 + i));
}

/** まだ使っていない次の記号（A から順）。26部屋を超えたら null */
export function nextRoomCode(existing) {
  const used = new Set(roomCodes(existing));
  for (let i = 0; i < MAX_ROOMS; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  return null;
}

/** 画面や知らせに出す部屋の名前。名前が無ければ「部屋A」の形 */
export function roomLabel(list, code) {
  if (!code) return "部屋未定";
  const hit = Array.isArray(list) ? list.find((r) => r && r.code === code) : null;
  return hit?.name || `部屋${code}`;
}

/** 部屋の名前の入力を確かめる。正しければ整えた名前、だめならエラーの文 */
export function checkRoomName(v) {
  if (typeof v !== "string") return { error: "部屋の名前を入れてください" };
  const name = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) return { error: "部屋の名前を入れてください" };
  if ([...name].length > ROOM_NAME_MAX) return { error: `部屋の名前は${ROOM_NAME_MAX}文字までです` };
  return { name };
}
