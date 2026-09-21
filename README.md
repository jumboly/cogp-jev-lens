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
| **Noul**（bool） | 記述が真である確率 0〜1 | そのタグが Lens の判断材料として **関係あるか**（relevance） |
| **Score** | 順序付きレベルの確率加重値 | そのタグが Lens を **どのくらい** 支持するか（strength） |
| **Choice** | N 択の選択と確率分布 | そのタグが **どういう意味で** Lens に関わるか（semantic category） |

```text
Noul   = 関係ある？
Score  = どのくらい？
Choice = どういう意味で？
```

1 リクエストに複数の質問を並べると同じ `state` に対して独立・並列に評価されるため、
「1 タグ = 1 質問」で束ねて投げる構成に向く。

**この役割分担は現時点では仮説**で、実データを JEV に投入して結果を見た上で見直す。

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
3. **評価はキャッシュする。** `Lens + 正規化タグ + JEV モデル版 + 評価スキーマ版` をキーにした
   Semantic Cache で、同じ Lens・同じタグを何度も評価させない。

## 現在の実験段階

| # | 段階 | 状態 |
| --- | --- | --- |
| 1 | GitHub リポジトリ作成・コンセプト整理 | ✅ |
| 2 | POI COGP のローカル取得 | ✅ |
| 3 | **全件タグプロファイリング** | ✅ → [`reports/tag-profile/REPORT.md`](reports/tag-profile/REPORT.md) |
| 4 | タグ方針（JEV 評価対象 / 条件付き / 除外）の決定 | ✅ → [`docs/tag-policy.md`](docs/tag-policy.md) |
| 5 | 小規模な JEV 評価実験、Noul / Score / Choice の役割再評価 | ✅ → [`experiments/01-jev-tag-eval/`](experiments/01-jev-tag-eval/README.md)、役割の再設計は 🔄 議論中 |
| 6 | COGP + MapLibre による POI 表示 | ⏳ |
| 7 | JEV BFF（`POST /api/evaluate-tags`） | ⏳ |
| 8 | AI Lens 可視化 | ⏳ |
| 9 | キャッシュ・性能改善 | ⏳ |

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

## ライセンスと出典

- POI データ: [COGP サンプル](https://github.com/Kanahiro/cloud-optimized-geoparquet#sample-data)（© OpenStreetMap contributors, ODbL）
- COGP リーダー `cogp-js`: MIT
- 本リポジトリのコード: MIT
