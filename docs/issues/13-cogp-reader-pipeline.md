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
- **LOD 選択は「緯度補正した度/px × 0.999」を `selectLevel` に渡す**。COGP の換算近似（1 度 = 111,320 m）と MapLibre の度/px の 0.0005% のずれで整数ズームが境界のすぐ下に落ちる問題を余裕で吸収し、日本でも赤道付近でも安定して L = z − 1（z14 → L13、東京駅周辺で約 8,800 件）になる。開発パネルに **手動 ±1 の調整**を残し、件数差が Lens の見え方に与える影響をその場で比較できるようにする

- **Lens 適用前は全 POI を同じ小さな点で表示する**（色・大きさ一律の「無地の地図」）。許可リスト外の 1%（`office=yes` 等）も点として残し、Lens では常に中立。Popup で名前とタグを見せる。種別ごとの初期配色は Lens の色と意味が二重になるため不採用
- **読み取り上限は `maxRows: 20000` で開始**。z14 の都心（約 8,800 件）では余裕、z13 以下では上限に当たる見込みなので「表示範囲の一部しか読めていない」ことを画面に出す。低ズーム時の Lens 無効化（#10）と合わせて後で調整

## 未決事項
- なし（実装しながら見直す）

## 結論
上記「決定」のとおり。
