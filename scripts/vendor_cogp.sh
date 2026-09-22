#!/usr/bin/env bash
# COGP リーダー(cogp-js)を src/vendor/cogp/ に取り込む。
# なぜ vendor か: npm 未公開かつ dist 未コミットのため、submodule だと postinstall で
# tsc が必要になる。タグ固定でソースを置けば依存は hyparquet だけで済む（docs/issues/13）。
# 使い方: scripts/vendor_cogp.sh [タグ]   例: scripts/vendor_cogp.sh v1.0.0
set -euo pipefail

TAG="${1:-v1.0.0}"
REPO="Kanahiro/cloud-optimized-geoparquet"
BASE="https://raw.githubusercontent.com/${REPO}/${TAG}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src/vendor/cogp"

mkdir -p "$DEST"
for f in bbox.ts coalescing-buffer.ts index.ts level.ts meta.ts range-cache.ts reader.ts; do
  curl -fsSL "${BASE}/cogp-js/src/${f}" -o "${DEST}/${f}"
  echo "  src/${f}"
done
curl -fsSL "${BASE}/LICENSE" -o "${DEST}/LICENSE"
echo "  LICENSE"

# 取り込み元を記録する。手で編集しないことと、更新方法を同じ場所に残すため。
cat > "${DEST}/VENDOR.md" <<VENDOR
# vendored: cogp-js

- 取り込み元: https://github.com/${REPO}
- タグ: ${TAG}
- パッケージ: \`cogp\` (MIT)
- 取り込み日: $(date +%Y-%m-%d)

このディレクトリは \`scripts/vendor_cogp.sh ${TAG}\` が生成する。手で編集しない。
更新するときはタグを指定して再実行する。
VENDOR
echo "cogp-js ${TAG} を ${DEST} に取り込んだ"
