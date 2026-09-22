# cogp-jev-lens

**Cloud Optimized GeoParquet（COGP）× JEV** で、「AI で検索する」のではなく
**「AI という Lens を通して同じ地図を見る」** ことを試す実験的 Web GIS。

> 実験プロジェクトです。設計は実装しながら改善します。
> 現在の段階は [「現在の実験段階」](#現在の実験段階) を参照。

## 目的

現在の地図表示範囲に必要な POI だけを COGP から取得し、その POI が持つ OSM タグを
JEV で意味的に評価して、地図の見え方を変える。

ユーザーは自然言語で **Lens** を指定する。

- 「子供が楽しめそう」
- 「観光客が興味を持ちそう」
- 「静かに過ごせそう」
- 「散歩で立ち寄りたくなる」

Lens を切り替えても、地図上の POI そのものは増えも減りもしない。
変わるのは **どの POI が浮かび、どの POI が沈み、どんな色で見えるか** だけである。
検索は「該当するものを取り出す」操作だが、Lens は「同じものを別の観点で眺める」操作で、
この差を UI と評価設計の両方で表現するのがこのプロジェクトの主題になる。

## COGP について

[Cloud Optimized GeoParquet](https://github.com/Kanahiro/cloud-optimized-geoparquet)（v1.0.0）は、
GeoParquet 1.1 の row group を **粗い順（coarse-to-fine）に並べ替え**、どこまでがどの詳細度（LOD）かを
ファイルのメタデータ `geo.lod.levels` に書いたプロファイル。

読む側は「この画面の解像度ならレベル N まででよい」と決め、先頭から N レベル分の row group を
bbox 統計で絞って **HTTP Range** で取る。タイル化の前処理も配信サーバーも要らず、
オブジェクトストレージに置いた 1 ファイルから表示範囲の地物を直接取れる。

本プロジェクトは公式サンプルの POI（OpenStreetMap 由来・約 3,005 万件・2.1 GiB）を題材にする。

- <https://cogp-demo.spatialty.io/v1.0.0/pois.cogp.parquet>
- スキーマ: `id` / `tags`（MAP<string,string>、OSM タグそのまま）/ `geometry`（WKB Point）/ `bbox`

## JEV について

[JEV](https://docs.typesafe.ai/)（TypeSafe AI の System One モデル）は文章を生成せず、
**型付きの判断と確率分布だけを返す** モデル。3 種類のプリミティブがある。

| プリミティブ | 返るもの | このプロジェクトでの仮の役割 |
| --- | --- | --- |
| **Noul**（bool） | 記述が真である確率 0〜1 | **このタグだけで扱いが決まるか**（確信度）→ POI 集約の重み |
| **Score** | 順序付きレベルの確率加重値 | この Lens で **どう扱うか**（0 沈める〜2 変化なし〜4 最も浮かせる） |
| **Choice** | N 択の選択と確率分布 | **どういう意味で** Lens に関わるか（主役 / 脇役 / 背景 / 妨げ / 無関係）→ 色 |

```text
Noul   = このタグだけで決まる？（確信度）
Score  = どう扱う？（沈める〜浮かせる）
Choice = どういう意味で？（主役 / 脇役 / 背景 / 妨げ / 無関係）
```

1 リクエストに複数の質問を並べると同じ `state` に対して独立・並列に評価されるため、
「1 タグ = 1 質問」で束ねて投げる構成に向く。

当初仮説（Noul = 関係あるか）は [実験 01](experiments/01-jev-tag-eval/README.md) で Score と重複すると分かり、
「このタグだけで決まるか」に読み替えた。上表は実験で確定した役割。

## AI Lens のコンセプト

```text
COGP（表示範囲の POI）
 ↓ tags 抽出 → 正規化 → 重複排除
ユニークタグ（key=value）
 ↓ JEV 評価（Lens ごと・タグ 1 つにつき 1 回、キャッシュ）
タグ評価（relevance / strength / category）
 ↓ 元の POI へ再配布 → POI 単位で集約
POI 評価
 ↓ MapLibre のスタイル式に反映
地図（サイズ / 透明度 / 色 / Popup）
```

要点は 3 つ。

1. **POI ではなくタグを評価する。** 多数の POI が `tourism=museum` を持っていても JEV の評価は 1 回で、
   結果を該当する全 POI で再利用する。
2. **取得と評価を分離する。** POI はまず通常表示し、JEV の結果が届いた時点で Lens の表現を重ねる。
3. **評価はキャッシュする。** `Lens + 正規化タグ + プリミティブ + 評価スキーマ版` をキーに
   IndexedDB へ保存し、同じ Lens・同じタグを二度評価しない。
   z14 の東京駅周辺で **147.9 秒 → 8 ms**（段階 9 の実測）。

## 現在の実験段階

| # | 段階 | 状態 |
| --- | --- | --- |
| 1 | GitHub リポジトリ作成・コンセプト整理 | ✅ |
| 2 | POI COGP のローカル取得 | ✅ |
| 3 | **全件タグプロファイリング** | ✅ → [`reports/tag-profile/REPORT.md`](reports/tag-profile/REPORT.md) |
| 4 | タグ方針（JEV 評価対象 / 条件付き / 除外）の決定 | ✅ → [`docs/tag-policy.md`](docs/tag-policy.md) |
| 5 | 小規模な JEV 評価実験、Noul / Score / Choice の役割再評価 | ✅ → [`experiments/01-jev-tag-eval/`](experiments/01-jev-tag-eval/README.md) |
| 6 | COGP + MapLibre による POI 表示 | ✅ |
| 7 | JEV BFF（`POST /api/evaluate-tags`） | ✅ |
| 8 | **AI Lens 可視化** | ✅ → [`docs/issues/08-maplibre-visualization.md`](docs/issues/08-maplibre-visualization.md) |
| 9 | **キャッシュ・性能改善** | ✅ → [`docs/issues/06-semantic-cache.md`](docs/issues/06-semantic-cache.md) / [`09-performance.md`](docs/issues/09-performance.md) / [実験 03](experiments/03-batch-boundary/README.md) / [実験 04](experiments/04-question-slimming/README.md) |

課題・未決事項・改善案は [GitHub Issues](../../issues) に「なぜ検討が必要か / 現在わかっていること / 未決事項」の形で記録する。

## セットアップ

### 必要なもの

- [uv](https://docs.astral.sh/uv/)（プロファイリングスクリプト用。DuckDB を含む依存はスクリプト冒頭のメタデータから自動解決）
- Node.js 20+（フロントエンド。段階 6 以降）

### POI データの取得

`data/` は git に含めない（2.1 GiB）。公式サンプルをそのまま置く。

```bash
mkdir -p data
curl -L -o data/pois.cogp.parquet https://cogp-demo.spatialty.io/v1.0.0/pois.cogp.parquet
```

### 全件タグプロファイリング

```bash
uv run scripts/profile_tags.py            # data/pois.cogp.parquet → reports/tag-profile/*.csv, summary.json
```

8 GB RAM の Mac で数分。2 パス構成で、キー単位の集計を先に取り、
値の展開はカーディナリティの低いキーに絞っている（理由はスクリプト冒頭のコメント）。

### フロントエンド（POI 表示）

```bash
npm install
npm run dev            # http://localhost:5173
```

`data/pois.cogp.parquet` を dev サーバーが HTTP Range で配信し、Web Worker 上の
COGP リーダーが表示範囲の POI を読む。初期表示は東京駅周辺 z14。

| できること | |
| --- | --- |
| POI 表示 | 全 POI を一律の小さな点。Lens はまだ載っていない |
| Popup | 点を押すと名前と OSM タグの一覧 |
| 背景地図 | 地理院地図 Vector 淡色（既定）と OpenFreeMap を切り替え |
| LOD | 自動で L = z − 1。開発用に手動 ±1 |
| タグ抽出 | 表示範囲の POI から正規化・許可リスト通過後のユニークタグを数える |
| AI Lens | Lens を入れると表示範囲のタグを JEV で評価し、点の大きさ・色・濃さに反映する（下記） |
| 評価キャッシュ | タグ評価を IndexedDB に保存。同じ Lens・同じ範囲なら JEV を呼ばない。手で消せる |
| 状態表示 | 件数 / ズーム / レベル / 読み取り時間 / 評価対象タグ数。上限 30,000 件に当たったら実件数と読めた割合を出す |
| 性能表示 | 集約（POI への配り直し + 描画）とキャッシュ復元の所要時間 |

COGP リーダーは npm 未公開のため `src/vendor/cogp/` にタグ固定で取り込んでいる。
更新は `scripts/vendor_cogp.sh v1.0.0` を叩き直す。

### AI Lens の見え方

Lens を入れると、表示範囲のユニークタグが BFF 経由で JEV に渡り、返ってきた評価を
POI へ配り直して点の見た目だけを変える。**POI は 1 件も増えず、1 件も減らない。**

| 表現 | 元 | 意味 |
| --- | --- | --- |
| 大きさ | Score | 3 px（= 素の点、Score 2 の「変化なし」）を基準に、浮く側は 6 px まで大きく、沈む側は 1.5 px まで小さく |
| 濃さ | Score | 沈む側だけ薄くする（下限 0.3）。浮く側は一律で不透明 |
| 色 | Choice の確率分布 | 主役 / 脇役 / 背景 / 妨げ / 無関係の 5 色を OKLab で加重混色。判断が割れた POI は灰に寄ってくすむ |
| （重み） | Noul（確信度） | 見え方には出さず、1 POI が複数タグを持つときの集約の重みに使う |

- **z13 未満では Lens を無効にする。** 低ズームで残る POI は空間間引きの結果で、
  意味的な代表性がない（[#10](docs/issues/10-low-zoom-lens.md)）
- 評価はバッチごとに届くので、地図は一度に塗り替わらず、**多くの POI に効くタグから順に**埋まる
- Popup には集約後の Score と、タグごとの Score / Choice / 確信度が出る

### JEV BFF（`POST /api/evaluate-tags`）

`.env` に `AI_GATEWAY_API_KEY` を置くと dev サーバーが受け付ける。
中身は Vite に依存しない `src/server/` に分けてあり、本番は **Cloudflare Workers の
無料プラン**に載せる想定（[#4](docs/issues/04-jev-bff.md)）。

```bash
curl -N -X POST localhost:5173/api/evaluate-tags \
  -H 'Content-Type: application/json' \
  -d '{"lens":"子供が楽しめそう","tags":["amenity=cafe","tourism=museum"]}'
```

応答は **NDJSON**（1 行 = 1 個の JSON）。タグをバッチに分け、終わったバッチから順に流す。
全部揃うのを待たせない。

バッチは問数ではなく **1 リクエストの本文の大きさ（34 KiB）で切る**。落ちる境界が
問数でもトークン量でもなく本文の大きさだと実測できたため
（[実験 03](experiments/03-batch-boundary/README.md)）。予算は実験で唯一 100% 通った
Choice 90 問の本文に合わせてあり、同じ重さのリクエストに Score なら 135 問、
Noul なら 190 問が載る。z14 の 623 タグは **21 本 → 16 本**になった。

並べる順は「先頭のタグを扱うバッチ」から。タグは出現数の多い順に送られるので、
**多くの POI に効くタグから順に「大きさも色も決まった状態」で届く**。

画面からは、上の `tags` 形ではなく**バッチを決めて送る**（`{"lens":…,"batches":[{"primitive":…,"tags":[…]}]}`）。
1 リクエストは最大 8 バッチで、z14 の冷えた Lens は 2 リクエストに分かれる。
BFF を Cloudflare Workers の無料プランに載せるためで、**1 回の呼び出しにつき外部 fetch 50 回**
の上限に対し、8 バッチ × 再試行 6 回 = 最悪 48 回で収まる。
タグの範囲で割ると切り口がバッチ境界と揃わず 16 → 19 本に増えるので、バッチまで作ってから
本数で区切っている（分割規則は `src/server/batches.ts` に集約）。

```
{"type":"start","lens":"子供が楽しめそう","tags":2,"batches":3,"schemaVersion":2}
{"type":"result","primitive":"noul","batch":0,"answers":{…},"model":"typesafe-ai/jev",…}
{"type":"error","primitive":"score","batch":1,"kind":"server","status":503,…}
{"type":"done","ok":8,"failed":1,"tally":{"server":1},"elapsedMs":4900}
```

JEV は公開直後でサービス側の一時障害が通常運用でも起こる。実測の失敗はほとんどが
`503`（`service_unavailable_error`）だが、21 バッチを通しで流すと `429` も混ざる
（`Retry-After` は 50 秒前後）。そのため
**失敗の原因を種別（`rate_limit` / `overloaded` / `server` / `timeout` / `network` /
`invalid` / `auth`）に分けて観測でき、一時障害だけを自動で再試行する**作りにしている。
再試行は指数バックオフ + ジッタで、`Retry-After` があればそちらを優先する。
入力不正と認証エラーは再試行しない。

それでも落ちるバッチは残る。Lens の画面は**評価が全部揃うことを前提にしていない**
（[#8](docs/issues/08-maplibre-visualization.md) の「JEV の障害を前提にした見せ方」）。

全リクエストの記録は `logs/jev.ndjson` に残る（git には入れない）。
Gateway の `generationId` も残すので、問い合わせるときの手がかりになる。

## ライセンスと出典

- POI データ: [COGP サンプル](https://github.com/Kanahiro/cloud-optimized-geoparquet#sample-data)（© OpenStreetMap contributors, ODbL）
- COGP リーダー `cogp-js`: MIT
- 本リポジトリのコード: MIT
