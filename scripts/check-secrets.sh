#!/bin/bash
# コミット前に、秘密情報らしき文字列・ファイルが含まれていないか確認する。
# 見つかったらコミットを止める（値そのものは表示しない）。
set -u
files=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$files" ] && exit 0

pattern='sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
found=0
for f in $files; do
  base=$(basename "$f")
  case "$base" in
    .dev.vars.example|.env.example) ;;
    .dev.vars|.dev.vars.*|.env|.env.*|*.pem|*.key|*.p12|credentials.json)
      echo "🚫 秘密情報のファイルはコミットできません: $f"; found=1; continue ;;
  esac
  [ "$f" = "scripts/check-secrets.sh" ] && continue
  if git show ":$f" 2>/dev/null | grep -Eq "$pattern"; then
    lines=$(git show ":$f" | grep -En "$pattern" | cut -d: -f1 | tr '\n' ' ')
    echo "🚫 鍵らしき文字列があります: $f（行: $lines）"; found=1
  fi
done
if [ $found -ne 0 ]; then
  echo "→ 鍵は .dev.vars か Cloudflare の Secrets に置いてください。コミットを止めました。"
  exit 1
fi
exit 0
