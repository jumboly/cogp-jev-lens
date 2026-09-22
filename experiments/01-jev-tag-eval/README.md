# 実験 01: OSM タグ × Lens を JEV で評価する

**目的**: Noul / Score / Choice の役割分担、およびタグの表現（トークンのみ / 説明文付き）を、実出力の分布で判断する。
**条件**: 東京駅周辺 z14（L13 まで）の POI 8,782 件 → 許可リスト通過のユニークタグ 744 種。Lens 5 種（否定形 1 つを含む）。
**規模**: 30 ラン・570 リクエスト・入力 478 万 / 出力 74 万トークン。断念 0。レイテンシ中央値 約 550 ms / 40 問。

集計: [`RESULTS.md`](RESULTS.md)（`uv run experiments/01-jev-tag-eval/analyze.py` で再生成）
生データ: `results/*.jsonl`（git 管理外。送受信の生 JSON）

## 分かったこと

### 1. Score の上位・下位は直感と合い、否定形 Lens でも壊れない

| Lens | 最も浮く | 最も沈む |
| --- | --- | --- |
| 子供が楽しめそう | `leisure=playground`（遊び場）3.99 / `shop=toys`（玩具店）3.84 / `amenity=ice_cream` 3.55 | `leisure=adult_gaming_centre`（パチンコ等）0.04 / `shop=erotic` 0.05 / `amenity=bar` 0.23 / `amenity=pub` 0.58 |
| 観光客が興味を持ちそう | `tourism=viewpoint`（展望地）3.96 / `tourism=attraction` 3.94 / `tourism=information`（案内）3.90 / `tourism=museum` 3.78 | `shop=funeral_directors`（葬儀社）0.86 / `shop=vacant`（空き店舗）0.93。強く沈むものはほぼ無い |
| 静かに過ごせそう | `cuisine=teahouse`（茶房）3.76 / `amenity=library` 3.45 / `leisure=garden` 3.39 / `historic=wayside_shrine`（路傍の祠）3.03 / `amenity=bench` 2.92 | `amenity=nightclub` 0.01 / `amenity=bar` 0.02 / `leisure=karaoke` 0.15 / `amenity=bus_station` 0.25 |
| 散歩で立ち寄りたくなる | `leisure=park` 3.68 / `amenity=cafe` 3.55 / `shop=coffee` 3.36 / `amenity=fountain`（噴水）3.22 / `amenity=bench` 3.21 / `shop=bakery` 3.16 | `shop=funeral_directors` 0.62 / `shop=vacant` 0.64 / `amenity=police` 0.94 |
| **否定形**: 観光客向けではない、地元の日常の場所 | `shop=laundry`（コインランドリー）3.62 / `amenity=community_centre` 3.41 / `shop=dry_cleaning` 3.32 / `shop=greengrocer`（八百屋）3.30 | `tourism=attraction` **0.00** / `tourism=information` 0.01 / `tourism=viewpoint` 0.02 / `tourism=hotel` 0.03 / `brand=Louis Vuitton` 0.06 |

否定形 Lens で「観光」系タグが 0 付近に沈み、生活系が浮く。state に置いた「除外を述べている場合、除外された性質は反する側」の先回りが効いている。

### 2. 説明文（OSM wiki）を添えても判定はほぼ動かない

説明文が取れた 417 タグで、Score の平均変化量は 0.12〜0.22（0〜4 スケール）。0.5 以上動いたのは 1〜9%。
JEV は OSM のトークンをそのまま読めている。**説明文の付与と Taginfo からの取得・保守は不要**と判断できる。

### 3. Noul は中央に寄り、Score と重複する

| Lens | Noul 平均 ± SD | r(Noul, \|Score−2\|) |
| --- | --- | --- |
| 子供 | 0.50 ± 0.15 | 0.44 |
| 観光客 | 0.61 ± 0.15 | 0.47 |
| 静か | 0.56 ± 0.15 | 0.50 |
| 散歩 | 0.62 ± 0.12 | 0.29 |
| 否定形 | 0.71 ± 0.11 | 0.50 |

- 値域が狭く（ほぼ 0.3〜0.8）、Lens ごとに全体が平行移動する。重み（relevance）として使うには判別力が弱い
- 「関係あり」は設計どおり **反する側も含む**（`amenity=bar` は子供 Lens で Noul 0.88・Score 0.23）
- Score は「2 = 無関係・変化なし」を内蔵しているので、|Score−2| が relevance を、符号が方向を、それぞれ表せる。Noul が Score に付け加える情報は小さい
- **Noul を落とせば JEV コストが 1/3 減る**

### 4. Choice は Lens ごとに構成がはっきり分かれる

| Lens | 目的地 | 立ち寄り先 | 雰囲気 | 妨げ | 無関係 |
| --- | --- | --- | --- | --- | --- |
| 子供 | 65 | 61 | 3 | 35 | **580** |
| 観光客 | 140 | **348** | 3 | 5 | 248 |
| 静か | 20 | 16 | 52 | **449** | 207 |
| 散歩 | 0 | **544** | 17 | 24 | 159 |
| 否定形 | 99 | 147 | 17 | **349** | 132 |

- 都心のタグの 8 割は子供 Lens と無関係、という結果は直感どおり
- 「静か」では 6 割が **妨げ**。都心の POI の大半は静けさを損なう側、という Lens の意味そのもの
- 「散歩で立ち寄りたくなる」では目的地が 0。Lens の文言に「立ち寄り」が入っているため選択肢がそちらに吸われた。**Choice の選択肢は Lens の文言と干渉する**
- 「雰囲気」は静か Lens でのみ機能（祠・墓・記念碑・神社）。他の Lens ではほぼ選ばれない
- 平均確信度 0.64〜0.71。否定形は 0.52 と低く、Choice の判断が揺れている

### 5. Score の全体分布は Lens で大きく変わる

| Lens | Score 平均 | SD | 形 |
| --- | --- | --- | --- |
| 子供 | 1.82 | 0.51 | 2 に集中（大半が無関係） |
| 観光客 | 2.11 | 0.62 | 2 と 3 に二山 |
| 静か | 1.36 | 0.56 | 1 付近に集中（大半がやや沈む） |
| 散歩 | 1.99 | 0.58 | 2〜3 に幅広 |
| 否定形 | 1.50 | 0.81 | **最も広い**（0〜3.5 に分散） |

可視化で「2 = 変化なし」を固定アンカーにすると、静か Lens では地図の大半が沈む。これは Lens の意味として正しいが、見え方の設計（Issue 8）で考慮が要る。

### 6. 気になった判定

- `tourism=information`（案内板・道標、478 件）が観光客 Lens で 3.90。実態は `information=board`（掲示板）が大半で、観光の目的地ではない。細分タグ `information=board` 側は別に評価されているので、POI 集約（Issue 7）で細分タグの評価を優先すれば補正できる
- `social_facility=nursing_home`（介護施設）が否定形 Lens で Score 3.30 なのに Choice は無関係。Score と Choice が食い違う例
- `brand=Amazon Hub ロッカー`、`brand=ドン・キホーテ`、`brand=Louis Vuitton` など、ブランド名は説明なしで適切に読まれている

## 追加実験: Noul の意味を変える（2026-09-22）

初回の Noul（判断材料として関係あるか）が Score と重複したため、意味を変えた 2 通りを追加で回した（トークンのみ、5 Lens）。

| 意味 | 問い | 平均 ± SD | r(値, \|Score−2\|) | r(値, Score) | 判定 |
| --- | --- | --- | --- | --- | --- |
| relevance（初回） | 判断材料として関係があるか | 0.50〜0.71 ± 0.11〜0.15 | 0.29〜0.50 | — | Score と重複 |
| **confidence** | このタグだけで扱いが迷いなく決まるか | 0.22〜0.32 ± 0.08〜0.11 | **0.51〜0.78** | — | 独立した情報。採用 |
| fit | Lens に沿う側の場所か | 0.27〜0.45 ± 0.13〜0.20 | — | **0.89〜0.98** | Score の符号と同じ |

confidence の中身（静か Lens）: 高いのは `amenity=nightclub` 0.76 / `amenity=gambling` 0.60 / `leisure=karaoke` 0.53（沈める側で決定的）、
低いのは `brand=サントリー` 0.09 / `brand=Panasonic` 0.10 / `brand=NTT` 0.10（ブランド名だけでは決まらない）。
補助的なタグ（ブランド・細分）を自然に弱める重みとして筋が通る。値は全体に低い（最大 0.76、0.8 以上は 0%）ので相対値で使う。

Score 自身の確率分布の尖り（最大確率）は confidence と r=0.25〜0.64 で、部分的な代用にしかならない（子供 Lens では r≒0）。

## 結論（2026-09-22 決定）

1. **Noul は「確信度」（このタグだけで扱いが決まるか）の意味で採用し、POI 集約の重みに使う。** 相対値（正規化）で扱う
2. **説明文は付与しない。** トークンのまま渡す（決定）
3. **Choice は semantic role（色）として使う。選択肢は v2（主役 / 脇役 / 背景 / 妨げ / 無関係）で再実験**（下記）
4. POI 集約は「分類タグより細分タグを優先」が候補（`tourism=information` 問題）

## 再現

```bash
uv run scripts/extract_viewport_tags.py 139.74 35.66 139.79 35.70 13 experiments/01-jev-tag-eval/tags-tokyo-z14.json
uv run scripts/fetch_tag_descriptions.py experiments/01-jev-tag-eval/tags-tokyo-z14.json experiments/01-jev-tag-eval/descriptions.json
node --env-file=.env experiments/01-jev-tag-eval/run.ts            # 全 30 ラン
node --env-file=.env experiments/01-jev-tag-eval/run.ts --primitive noul --repr token --noul-variant confidence
node --env-file=.env experiments/01-jev-tag-eval/run.ts --primitive noul --repr token --noul-variant fit
node --env-file=.env experiments/01-jev-tag-eval/run.ts --primitive choice --repr token --choice-variant v2
uv run experiments/01-jev-tag-eval/analyze.py > experiments/01-jev-tag-eval/RESULTS.md
```
