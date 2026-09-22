# COGP 読み取りパイプライン（リーダー調達・LOD 選択・Worker 構成）
labels: design, frontend, cogp

## なぜ検討が必要か
表示範囲の POI を COGP から取る部分は Lens 以前の土台で、リーダーの取り込み方・LOD の選び方・スレッド構成で
転送量・件数・応答時間が決まる。公式 `cogp-js` は npm 未公開なので調達方法も決める必要がある。

## 現在わかっていること
- `cogp-js`（パッケージ名 `cogp` v1.0.0、MIT）は monorepo の一部で npm 未公開、`dist` も未コミット。ソース 7 ファイル・約 32 KB、依存は `hyparquet` + `hyparquet-compressors` のみ
- API: `CogpReader.open(url)` → `selectLevel(targetResolution)` → `readRows({ maxLevel, bbox, columns, maxRows, maxGeometryBytes })`。Range 合体・64 MiB Range キャッシュ・PageIndex 絞り込み・WKB 遅延デコードを内蔵
- 公式デモは Vite + MapLibre + Web Worker（`cogp-worker.ts`）。メインスレッドは bbox と解像度を送り、Worker が GeoJSON を返す
- 東京駅周辺 z14: L12 で約 4,300 件 / 13 MiB、L13 で約 8,800 件（`tags` 込み。転送量の 9 割が `tags`）

## 決定（2026-09-22）
- **リーダーは `v1.0.0` タグ固定で vendor 取り込み**（`src/vendor/cogp/` に src 7 ファイル + LICENSE）。更新はタグ指定の取り込みスクリプトで行う。submodule（postinstall で tsc が必要）と自前実装（PageIndex / Range 合体の再実装）は不採用
- 公式デモの Worker 構成は踏襲するが、コードは本プロジェクトの要件（タグ抽出・許可リスト・Lens 反映）に合わせて書き起こす

## 未決事項
- LOD レベルの選び方（緯度補正の有無、整数ズームが境界のすぐ下に落ちる問題）
- Lens 適用前の POI の見え方（全件同じ点か、許可リスト通過タグを持つものだけか）
- 1 回の読み取りの上限（`maxRows`）と、上限に当たったときの表示

## 結論
（議論中）
