# POI COGP のホスティング（Cloudflare R2 ほか）
labels: infra

## なぜ検討が必要か
公開サンプル（cogp-demo.spatialty.io）は CORS がオリジン許可制で、自分の公開ページからは読めない。
また他人の配信に Range リクエストを大量に投げ続けるのは行儀が悪い。CORS / Range / Cache-Control を自分で管理したい。

## 現在わかっていること
- ファイルは 2.1 GiB（2,244,348,968 バイト）。footer 読みは 512 KiB・2 リクエスト、表示範囲ごとに数〜十数 MiB の Range
- 読み取り 1 回は **13〜14 MiB で、表示件数にほとんど依存しない**（[実験 05](../../experiments/05-transfer-size/README.md)）。
  内訳は辞書ページ 9.3 MiB（71%）とデータページ 3.6 MiB。狭い範囲ほど 1 件あたりコストが
  悪化するのは、辞書が固定費だから（z16 では 711 件に 14.3 MiB）
- `tags` は読む量の 59%。`id`（int64・ほぼ一意）にも 3.36 MiB の辞書が付いていて、ほぼ無駄
- **ただし辞書は Range キャッシュに残るので、払うのは 1 セッションに 1 回。**
  2 回目以降のパンは 0〜1 MiB。転送量を削って効くのは初回表示だけで、
  **#5 をやる理由は性能ではなく「公開できるようにする」こと**（CORS）
- Cloudflare R2 無料枠: 10 GB ストレージ、Class B 操作（GET）1,000 万/月、egress 無料。Range GET も Class B 1 回
- R2 は CORS 設定・カスタムドメイン・Cache 制御に対応
- **公開 URL は 2 通り**（2026-09-22 に公式ドキュメントで確認）
  - `r2.dev` サブドメイン: 公開アクセスを ON にすると**自動で付く**。DNS もカスタムドメインも要らない。
    ただし「rate-limited and should only be used for development purposes」「intended for
    non-production traffic」と明記されていて、キャッシュ・アクセス管理・bot 管理は使えない。
    ここへ CNAME を張るのは非サポート
  - カスタムドメイン: 本番向け。**jumboly.jp の DNS を Cloudflare が持っていることが前提**
  - S3 API の `<account>.r2.cloudflarestorage.com` は SigV4 署名が要るので**ブラウザからは使えない**
- **リーダーはまず HEAD でファイル長を取ってから Range GET する**（`hyparquet/src/utils.js`）。
  CORS で `GET` だけ許可しても動かない。要るのは許可メソッド `GET` / `HEAD`、
  許可リクエストヘッダ `range`、公開レスポンスヘッダ `content-length` / `content-range` /
  `accept-ranges` / `etag`
- 負荷の目安（実験 05 の実測）: 1 セッションあたり Range 200〜300 回、初回 13.6 MiB。
  r2.dev のレート制限は毎秒数百リクエスト水準なので個人デモなら届かないはずだが、
  リーダーは Range をまとめて投げるので瞬間的には burst する

## 未決事項
- **`r2.dev` で CORS が効くか（次にやること）。** 検索結果の要約は「CORS はカスタムドメインでのみ、
  r2.dev では使えない」と言うが、公式ページ本文では r2.dev と CORS の関係に触れていない。**確証がない。**
  ここが効けば DNS を一切触らずに公開でき、「公開 URL をどうするか」も「DNS がどこにあるか」も
  決めなくて済む（Worker も `*.workers.dev` の自動採番で足りる。CORS はコードで付けるため）。
  DNS を触るのは GitHub Pages に当てる `www.jumboly.jp` だけになる。
  **バケットを作って公開 ON → CORS ポリシー投入 → localhost から HEAD と Range GET** で白黒つく
- R2 直配信か、Workers 経由（アクセス制御・計測を挟む）か
  - Worker 経由にすると Range 1 回ごとに Worker の呼び出しになり、無料プランの
    1 日 10 万リクエストが 1 日 330 セッションで頭打ちになる（#4）。直配信が既定
- **作り直すなら何を変えるか**（実験 05 の結論。どれも辞書を小さくする方向）
  - 日本域に切り出す → 辞書が世界中の値ではなく日本のタグ値だけになる
  - row group を小さくする → 1 本あたりの辞書が小さくなる（候補本数は増えるので要実測）
  - `id` を落とす / `id` の辞書を切る → それだけで 3.4 MiB。ただし OSM への参照と
    #11 の第 2 段評価で要るかもしれない
- 全世界 2.1 GiB をそのまま置くか、日本域に切り出した COGP を作るか（後者は cogp-rs の converter が必要）
- `tags` を分類カラムに展開した独自スキーマにするか（転送量が桁で変わる見込み。ただし「OSM タグをそのまま JEV で評価する」本プロジェクトの趣旨と要調整）
- Cache-Control の値（ファイルは不変なので長期キャッシュ + ETag で足りるはず）

## 結論
（議論後に記載）
