# POI COGP のホスティング（Cloudflare R2 ほか）
labels: infra

## なぜ検討が必要か
公開サンプル（cogp-demo.spatialty.io）は CORS がオリジン許可制で、自分の公開ページからは読めない。
また他人の配信に Range リクエストを大量に投げ続けるのは行儀が悪い。CORS / Range / Cache-Control を自分で管理したい。

## 現在わかっていること
- ファイルは 2.1 GiB（2,244,348,968 バイト）。footer 読みは 512 KiB・2 リクエスト、表示範囲ごとに数〜十数 MiB の Range
- 転送量の 9 割が `tags` カラム（Parquet のページ粒度のため、狭い範囲ほど 1 件あたりコストが悪化）
- Cloudflare R2 無料枠: 10 GB ストレージ、Class B 操作（GET）1,000 万/月、egress 無料。Range GET も Class B 1 回
- R2 は CORS 設定・カスタムドメイン・Cache 制御に対応

## 未決事項
- R2 直配信か、Workers 経由（アクセス制御・計測を挟む）か
- 全世界 2.1 GiB をそのまま置くか、日本域に切り出した COGP を作るか（後者は cogp-rs の converter が必要）
- `tags` を分類カラムに展開した独自スキーマにするか（転送量が桁で変わる見込み。ただし「OSM タグをそのまま JEV で評価する」本プロジェクトの趣旨と要調整）
- Cache-Control の値（ファイルは不変なので長期キャッシュ + ETag で足りるはず）

## 結論
（議論後に記載）
