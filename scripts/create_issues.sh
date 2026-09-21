#!/usr/bin/env bash
# docs/issues/*.md を GitHub Issues に一括登録する。
# 1 行目 = "# タイトル"、2 行目 = "labels: a, b"、3 行目以降 = 本文。
# ラベルは存在しなければ作る（gh issue create はラベル未定義だと失敗するため）。
set -euo pipefail
cd "$(dirname "$0")/.."
repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

for f in docs/issues/[0-9]*.md; do
  title="$(sed -n '1s/^# //p' "$f")"
  labels="$(sed -n '2s/^labels: *//p' "$f" | tr -d ' ')"
  body="$(tail -n +3 "$f")"
  IFS=',' read -ra arr <<< "$labels"
  for l in "${arr[@]}"; do
    gh label create "$l" --repo "$repo" --force >/dev/null 2>&1 || true
  done
  gh issue create --repo "$repo" --title "$title" --label "$labels" --body "$body"
done
