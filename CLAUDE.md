# ai-banto 開発ルール

- 公開リポジトリ。APIキー・パスワード・実在の顧客/宿泊者データは**絶対にコミットしない**
  - 手元の鍵は `.dev.vars`（Git対象外）、本番は `wrangler secret put` で Workers の Secrets へ
  - コミット前に `scripts/check-secrets.sh` が自動で走る（`core.hooksPath=.githooks`）。止められたら回避せず原因を直す
- 構成は固定：Cloudflare Workers / D1 / R2。これ以外を使うときは社長に確認
- AIは当社名義の Anthropic API 契約のみ
- `wrangler deploy` は社長が指示したときだけ
- 仕様書：Obsidian `30_Areas/Claudeハッカソン2026/AI番頭_仕様書v1（ハッカソン）.md`
