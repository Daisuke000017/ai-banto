// QRコードを作る（外の部品を使わない。ゲスト用URLを画面に出すためだけ）
// 決まり：バイトモード・誤り訂正 M（約15%まで汚れても読める）・型番 1〜10（213バイトまで）
// 作り方は QR コードの規格（JIS X 0510）どおり。読めるかはブラウザの読み取り機能で確かめた。

// 型番ごとの [誤り訂正の語数, [ブロックごとのデータ語数...]]（誤り訂正 M）
const BLOCKS_M = [
  null,
  [10, [16]],
  [16, [28]],
  [26, [44]],
  [18, [32, 32]],
  [24, [43, 43]],
  [16, [27, 27, 27, 27]],
  [18, [31, 31, 31, 31]],
  [22, [38, 38, 39, 39]],
  [22, [36, 36, 36, 37, 37]],
  [26, [43, 43, 43, 43, 44]],
];
// 位置合わせの印の場所
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_VERSION = 10;

const dataCapacity = (v) => BLOCKS_M[v][1].reduce((a, b) => a + b, 0);
const countBits = (v) => (v <= 9 ? 8 : 16);

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}

function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}

/** 文字列を UTF-8 のバイト列に */
const utf8 = (s) => Array.from(new TextEncoder().encode(s));

/**
 * QRコードの白黒の表を返す（true＝黒）。入りきらなければ Error
 * @returns {boolean[][]} [行][列]
 */
export function qrMatrix(text) {
  const bytes = utf8(text);
  let version = 1;
  while (version <= MAX_VERSION && 4 + countBits(version) + bytes.length * 8 > dataCapacity(version) * 8) version++;
  if (version > MAX_VERSION) throw new Error("QRコードに入りきりません");

  // 1) データのビット列
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  const capBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCapacity(version); pad ^= 0xec ^ 0x11) data.push(pad);

  // 2) ブロックに分けて誤り訂正を付け、交互に並べる
  const [ecLen, sizes] = BLOCKS_M[version];
  const div = rsDivisor(ecLen);
  const blocks = [];
  let k = 0;
  for (const n of sizes) {
    const d = data.slice(k, k + n);
    k += n;
    blocks.push({ d, e: rsRemainder(d, div) });
  }
  const words = [];
  const maxD = Math.max(...sizes);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) words.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) words.push(b.e[i]);

  // 3) 印（四隅・タイミング・位置合わせ・形式・型番）を描く
  const size = version * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    mod[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
  }
  const al = ALIGN[version];
  const last = al.length - 1;
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (mask) => {
    const v = (0b00 << 3) | mask; // 誤り訂正 M は 00
    let rem = v;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((v << 10) | rem) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // 場所を取っておく
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vb >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // 4) データを右下からジグザグに置く
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < words.length * 8) {
          mod[y][x] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1;
          bi++;
        }
      }
  }

  // 5) 8種類の模様をかけて、いちばん読みやすいものを選ぶ
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty(mod);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
    applyMask(m); // もとに戻す（2回かけると戻る）
  }
  applyMask(best);
  drawFormat(best);
  return mod;
}

/** 読みにくさの点数（規格の4つの決まり） */
function penalty(m) {
  const n = m.length;
  let s = 0;
  const line = (get) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) s += run - 2;
          run = 1;
        }
      }
      // 四隅の印に似た並び（1:1:3:1:1 と白4つ）
      for (let b = 0; b + 10 < n; b++) {
        const p = [];
        for (let t = 0; t < 11; t++) p.push(get(a, b + t) ? 1 : 0);
        const str = p.join("");
        if (str === "10111010000" || str === "00001011101") s += 40;
      }
    }
  };
  line((r, c) => m[r][c]);
  line((c, r) => m[r][c]);
  for (let y = 0; y + 1 < n; y++)
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) s += 3;
    }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = n * n;
  s += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return s;
}
