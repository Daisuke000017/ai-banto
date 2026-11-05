// オーナーのパスワードから、Secret「OWNER_PASSWORD_HASH」に入れる文字列を作る
// 使い方：node scripts/hash-password.js
//   → パスワードを2回きかれる（画面には出ない）→ 出てきた1行を、次のコマンドで貼る
//      npx wrangler secret put OWNER_PASSWORD_HASH        （本番）
//      手元で試すときは .dev.vars に OWNER_PASSWORD_HASH=... と書く（Git には入らない）
//   画面に出るのは、出てきた1行（標準出力）だけ。問いかけと案内は標準エラーに出す
// パスワードはコマンドの引数では受け取らない（履歴に残るため）。echo でつなぐのも履歴に残るので使わない
//   （標準入力がキーボードでないときは、1行目だけ読む）
// パスワードを変えたら、出ているログインも全部切る（盗まれた Cookie を使えなくする）：
//      npx wrangler d1 execute ai-banto --remote --command "DELETE FROM owner_sessions"
import { createInterface } from "node:readline";
import { hashPassword } from "../src/lib/auth.js";

const MIN_LEN = 12;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    // 打った文字を画面に出さない
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stderr.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

async function readFirstLine() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.includes("\n")) break;
  }
  return text.split(/\r?\n/)[0];
}

async function main() {
  if (process.argv.length > 2) {
    console.error("パスワードは引数で渡さないでください（履歴に残ります）。何も付けずに実行してください");
    process.exit(1);
  }
  let password;
  if (process.stdin.isTTY) {
    password = await askHidden("パスワード：");
    const again = await askHidden("もう一度：");
    if (password !== again) {
      console.error("2回の入力が同じではありません");
      process.exit(1);
    }
  } else {
    password = await readFirstLine();
  }
  if (password.length < MIN_LEN) {
    console.error(`パスワードは${MIN_LEN}文字以上にしてください`);
    process.exit(1);
  }
  if (password.length > 200) {
    console.error("パスワードは200文字までにしてください");
    process.exit(1);
  }
  console.error("Secret に入れる文字列（この1行だけを貼ってください）：");
  console.log(await hashPassword(password));
}

main();
