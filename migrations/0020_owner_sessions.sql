-- オーナーのログイン
-- owner_sessions：ログインの鍵。Cookie の中身そのものは置かず、sha256 と期限（ミリ秒）だけ
CREATE TABLE owner_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX owner_sessions_expires ON owner_sessions (expires_at);

-- owner_login_failures：パスワードをまちがえた時刻（ミリ秒）と、送ってきた相手の印
-- 15分のうちに、同じ相手から5回、または全体で50回まちがえたら断る
-- who は IP アドレスそのものではなく、Secret を混ぜた sha256（IP を置かない）
-- （試している途中の1行も入る。合っていたら全部消す。15分より古い行は、次に試したときに消す）
CREATE TABLE owner_login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  who TEXT NOT NULL DEFAULT ''
);
CREATE INDEX owner_login_failures_at ON owner_login_failures (at);
CREATE INDEX owner_login_failures_who ON owner_login_failures (who, at);
