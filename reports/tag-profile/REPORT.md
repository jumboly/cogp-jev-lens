# POI COGP 全件タグプロファイリング レポート

対象: `pois.cogp.parquet`（COGP v1.0.0 公式サンプル、OpenStreetMap 由来）
実行: 2026-09-22、`scripts/profile_tags.py` + `scripts/profile_tags_extra.py`（DuckDB 1.5、全件スキャン、約 2.5 分）
生データ: 同ディレクトリの CSV（`keys.csv`、`top_values_per_key.csv`、`top_pairs_overall.csv` ほか）

> このレポートは **タグ方針（JEV 評価対象 / 条件付き / 除外）を議論するための材料** であり、方針そのものは未決。
> 末尾の「議論したい点」を参照。

---

## 1. データの全体像

| 項目 | 値 |
| --- | --- |
| 行数（POI） | 30,052,264 |
| タグペア総数 | 139,564,649 |
| 1 POI あたりタグ数 | 平均 4.6 / 中央値 3 / p95 13 / 最大 195 |
| タグ 2 個以下の POI | 38.7%（3 個以下で 52.5%） |
| ユニークなタグキー | **36,482** |
| `name` を持つ POI | 51.1%（日本域では 76.9%） |
| 日本 bbox（122–154E, 20–46N）内 | 1,411,768（4.7%） |
| LOD レベル | 17 段（L0: 8,103 行 … L12: 457 万行 … L16: 87 万行） |

- 全世界データ。ヨーロッパ（特にドイツ周辺）が最多で、10° グリッドの上位 6 マスはすべて欧州。日本は 130E/30N マスで 90.7 万件（世界 7 位）。
- **全 POI が「主要分類キー」（`amenity` / `shop` / `tourism` / `leisure` / `historic` …）を少なくとも 1 つ持つ**。2 つ以上持つのは 4.9%（最多の組は `amenity` + `healthcare` の 65 万件 = 薬局の二重タグ）。
- 半数近くの POI はタグが 1〜2 個しかない。「amenity=bench + backrest=yes」のような最小限のものが大量にある。

### LOD レベルと中身の関係（想定と違った点）

粗いレベル（L0〜L5）の POI の分類構成は全体とほぼ同じ（L0: `amenity` 48% / `tourism` 19% / `shop` 13%）。
つまり **COGP の coarse-to-fine は空間的な間引きであり、「重要な POI が先」ではない**。
低ズームで残る POI は意味的に代表的なものではなく、たまたま選ばれたもの。Lens の UX 上、低ズームで
「この地域は子供向けが多い」と読ませるのは危うい（→ Issue: 低ズーム時の表現）。

一方、最細レベル（L16）はベンチ・ゴミ箱に偏る（`backrest` 18.5%、`material` 14%、`name` はわずか 29%）。
高密度エリアで間引きの最後に残るのはストリートファニチャ。

---

## 2. キーの分布

### 36,482 キーのほとんどはノイズ

| 出現回数 | キー数 | ペア出現数 | 割合 |
| --- | --- | --- | --- |
| 1 回 | 13,708 | 13,708 | 0.01% |
| 2〜9 | 11,527 | 45,459 | 0.03% |
| 10〜99 | 6,847 | 222,635 | 0.16% |
| 100〜999 | 2,809 | 966,808 | 0.7% |
| 1k〜9.9k | 1,089 | 3,535,506 | 2.5% |
| 10k〜99k | 368 | 11,595,946 | 8.3% |
| 100k〜999k | 107 | 32,188,095 | 23.1% |
| 1M+ | **27** | 90,996,492 | **65.2%** |

上位 100 キーで全ペアの 85%、上位 500 キーで 96.6% を覆う。**方針を決めるべきキーは実質 200〜500 個**。

### 名前空間別（`prefix:*` で束ねた集計）

| キー群 | キー数 | ペア出現数 | 割合 | 性格 |
| --- | --- | --- | --- | --- |
| `addr:*` | 581 | 20.1M | **14.4%** | 住所。メタ情報 |
| `amenity` | 1 | 17.1M | 12.3% | 分類（最重要） |
| `name` | 1 | 15.3M | 11.0% | 固有名 |
| `shop` | 1 | 5.5M | 4.0% | 分類 |
| `brand:*` | 242 | 3.4M | 2.5% | ブランド（`brand:wikidata` 1.9M を含む） |
| `opening_hours` | 1 | 3.4M | 2.4% | 営業時間（構造化文字列） |
| `name:*` | 1,289 | 3.4M | 2.4% | 多言語名 |
| `tourism` | 1 | 3.2M | 2.3% | 分類 |
| `contact:*` | 552 | 3.1M | 2.2% | 連絡先。メタ情報 |
| `operator` | 1 | 2.6M | 1.9% | 運営者名 |
| `website` / `source` / `phone` | 各 1 | 各 2.3〜2.4M | 各 1.7% | メタ情報 |
| `brand` | 1 | 2.2M | 1.6% | ブランド名 |
| `backrest` | 1 | 2.1M | 1.5% | ベンチの背もたれ（yes/no） |
| `payment:*` | 2,508 | 1.9M | 1.4% | 決済手段（yes/no） |
| `check_date` | 1 | 1.9M | 1.3% | メタ情報 |
| `operator:*` | 326 | 1.8M | 1.3% | 運営者メタ |
| `material` / `leisure` / `historic` / `wheelchair` / `information` / `access` | 各 1 | 1.2〜1.6M | 各 0.9〜1.1% | |
| `recycling:*` | 694 | 1.1M | 0.8% | リサイクル対応品目（yes/no） |
| `cuisine` | 1 | 1.1M | 0.8% | 料理ジャンル（複数値多い） |
| `ref:*` + `ref` | 1,724 | 1.9M | 1.4% | 外部 ID |

**住所・名前・連絡先・ID・出典系だけで全ペアの 4 割前後**を占める。これらは JEV に渡しても意味評価の材料にならない。

---

## 3. キーの性格による分類（データから見た実態）

値の統計（ユニーク値数、重複率、yes/no 率、URL/電話/QID パターン一致率、トークンらしさ）から機械的に分けると、以下の 6 群に分かれる。

### 3.1 分類キー（低カーディナリティ・OSM トークン値）

「何であるか」を表す。値は `snake_case` の英単語で、重複率 99% 超。**JEV 評価の中核候補**。

| キー | POI 数 | 割合 | ユニーク値(近似) | 上位値 |
| --- | --- | --- | --- | --- |
| `amenity` | 17.09M | 56.9% | 6,075 | bench 3.14M / restaurant 1.26M / waste_basket 1.15M / bicycle_parking / place_of_worship / cafe / school / recycling / fast_food / parking |
| `shop` | 5.53M | 18.4% | 8,663 | convenience 622k / clothes / hairdresser / supermarket / bakery / car_repair / beauty / **yes 121k** |
| `tourism` | 3.17M | 10.5% | 943 | information 1.43M / artwork / hotel / viewpoint / attraction / guest_house / picnic_site / camp_site / museum 56k |
| `leisure` | 1.55M | 5.2% | 885 | picnic_table 458k / swimming_pool / playground 214k / pitch / fitness_centre / park 46k |
| `historic` | 1.48M | 4.9% | 2,690 | memorial 461k / wayside_cross / archaeological_site / wayside_shrine / boundary_stone / monument / ruins |
| `healthcare` | 0.80M | 2.7% | 940 | pharmacy / doctor / dentist / clinic / hospital |
| `office` | 1.01M | 3.4% | 4,347 | company / government / estate_agent / insurance / lawyer |
| `craft` | 0.29M | 1.0% | 2,440 | grinding_mill / electronics_repair / carpenter / photographer |
| `man_made` | 0.16M | 0.5% | 586 | water_tap / works / water_well / survey_point / tower |
| `natural` | 34k | 0.1% | 201 | tree / spring / peak / cave_entrance |
| `public_transport` | 51k | 0.2% | 60 | station 38.6k / platform / stop_position |
| `emergency` | — | — | — | yes/no が上位。defibrillator / fire_hydrant |
| `attraction` | — | — | — | animal 7.7k / amusement_ride / roller_coaster |
| `place` / `highway` / `building` | 小 | | | 主に他キーの付随 |

注意点:

- **`shop=yes` 12 万件、`historic=yes` 4.5 万件、`office=yes` 5 万件、`building=yes` 3 万件**。「種別不明」を表す値で、分類としては情報がない。
- ロングテールが長い。`amenity` は 6,075 種あるが、上位 25 値で大半を占め、**1 件しか現れないペアが全体で 191 万**（ほぼタイポ・独自値）。
- 大文字小文字ゆれは小さい（`amenity` 6,436 → `lower()` で 6,273）。正規化の効果は限定的で、むしろ頻度の閾値で切るほうが効く。

### 3.2 細分キー（分類キーの下位を分ける）

分類キーだけでは粗すぎる種別を割る。**Lens の意味判断にはむしろこちらが効く**可能性が高い（「静か」「子供」「観光客」はここに反応する）。

| キー | POI 数 | 生ユニーク | `;` 分解後ユニーク | 複数値率 | 上位値 |
| --- | --- | --- | --- | --- | --- |
| `cuisine` | 1.14M | 67,980 | **13,070** | **16.5%** | pizza 150k / coffee_shop 121k / burger / regional / sandwich / italian / chinese / chicken / kebab / japanese / sushi / breakfast 19k |
| `religion` | 0.72M | 917 | — | — | christian 472k / muslim / buddhist / hindu / shinto 25k |
| `denomination` | 0.30M | 2,456 | — | — | |
| `information` | 1.39M | 1,422 | — | — | guidepost 643k / board / map / route_marker / office |
| `vending` | 0.34M | 3,769 | 2,059 | 2.9% | parking_tickets 101k / excrement_bags / drinks 51k / cigarettes |
| `sport` | 0.22M | 7,142 | 3,154 | 4.9% | fitness / table_tennis / basketball / swimming / yoga |
| `artwork_type` | 0.27M | 931 | — | — | |
| `memorial` | 0.33M | 1,300 | — | — | |
| `board_type` / `shelter_type` / `parking` / `recycling_type` / `bicycle_parking` / `social_facility` / `healthcare:speciality` / `attraction` / `waste` / `clothes` | 各 5〜60 万 | | | | |

- `cuisine` は **`;` 区切りの複数値が 16.5%**（`coffee_shop;pancake;sandwich;cake`）。分解すると 68k → 13k 種に落ちる。
  **分解して 1 値 = 1 タグとして扱う**のが自然（順序保持は不要）。
- `diet` は単独キーとしては 50 件しかなく、実際は `diet:vegetarian` / `diet:vegan` の yes/no 形式（それぞれ 9.3 万 / 5.3 万）。

### 3.3 属性フラグ（yes/no 値が 80% 以上）

「どういう性質か」を表す。**3 万件以上のキーが約 70 個**。分類ではないが、Lens の判断材料としては強い（「静かに過ごせる」 ↔ `outdoor_seating` / `smoking=no`、「子供」 ↔ `changing_table` / `playground`、「散歩」 ↔ `bench` / `drinking_water` / `toilets`）。

| キー | POI 数 | 備考 |
| --- | --- | --- |
| `backrest` | 2.15M | ベンチ専用 |
| `wheelchair` | 1.43M | yes 816k / no 390k / limited 219k（3 値） |
| `covered` | 0.89M | 自転車置き場など |
| `fee` | 0.75M | no 511k / yes 233k |
| `hiking` | 0.37M | 道標に付く |
| `outdoor_seating` | 0.36M | |
| `takeaway` | 0.35M | |
| `payment:cash` / `payment:credit_cards` / `payment:debit_cards` / `payment:visa` … | 各 10〜31 万 | 決済手段。Lens には無関係な可能性大 |
| `armrest` / `indoor_seating` / `drive_through` / `indoor` / `atm` / `lit` / `dispensing` / `bench` | 各 12〜22 万 | |
| `internet_access` | 0.34M | wlan 239k が上位（yes/no でなく種別） |
| `smoking` | 0.15M | yes/no/outside/isolated など |
| `diet:vegetarian` / `diet:vegan` | 93k / 53k | |
| `changing_table` | 53k | 子供向け Lens の材料 |
| `recycling:*`（glass_bottles / paper / plastic …） | 各 3〜20 万 | リサイクル拠点専用 |
| `fuel:*` / `socket:*` / `authentication:*` / `currency:*` | 各 3〜7 万 | 給油所・充電器専用 |

**重要な設計上の含意:** フラグの意味は **付いている POI の種別に依存する**。`fee=no` は公園と駐車場で意味が違い、`covered=yes` は自転車置き場でしか出ない。
フラグを単独の `key=value` で JEV に投げるか、「種別 + フラグ」の組で投げるかが最初の設計判断になる（→ 議論点 1）。

### 3.4 固有名・ブランド

| キー | POI 数 | ユニーク | 重複率 | 性格 |
| --- | --- | --- | --- | --- |
| `name` | 15.34M | **10.7M** | 30% | 固有名。チェーンは繰り返す（Ozon 58k / 7-Eleven 20k / Subway / Starbucks / セブン-イレブン 10k / ファミリーマート 8k） |
| `brand` | 2.20M | 65k | 96.7% | ブランド名。**上位は再利用性が高く、意味も濃い**（Starbucks 13k / McDonald's 12k / Shell / 7-Eleven） |
| `operator` | 2.61M | 656k | 75% | 運営者（Royal Mail 61k / Deutsche Post / La Poste / 日本郵便 18k） |
| `brand:wikidata` / `operator:wikidata` | 1.9M / 0.75M | 20k / 14k | 99% | QID。人間可読でない |
| `name:en` / `name:ja` / `name:ru` … | 1,289 キー・3.4M | | | 多言語名。日本域では `name:ja` 14%、`name:en` 20% |
| `branch` / `alt_name` / `official_name` / `short_name` | 各 12〜26 万 | | | |

- `name` はタグ単位の評価には向かない（ほぼ POI 固有・再利用不可）。ただし Lens の判断材料としては最も情報量が多い部分でもある。
  **v1 では除外し、必要なら第 2 段（POI 単位・上限付き）として別に検討**が現実的。
- `brand` は中間。頻度で切れば（例: 世界で 100 件以上）数千ブランドに収まり、キャッシュも効く。

### 3.5 メタ情報（住所・連絡先・ID・出典・日付）

JEV 評価の材料にならないと判断できるもの。全ペアの約 40%。

| 群 | 代表キー | 判定根拠 |
| --- | --- | --- |
| 住所 | `addr:street` 4.7M / `addr:city` 3.8M / `addr:housenumber` 3.7M / `addr:postcode` 3.4M / `addr:country` 0.8M / `addr:full` … | 位置は geometry にある |
| 連絡先 | `website` 2.4M（URL 98.7%）/ `phone` 2.3M（電話 97%）/ `email` / `contact:*`（552 キー） / `contact:facebook` / `contact:instagram` | URL/電話パターン |
| 外部 ID | `ref` 0.97M / `ref:*`（1,723 キー） / `wikidata` / `*:wikidata` / `gnis:feature_id` / `ref:FR:SIRET` / `KSJ2:*`（日本の国土数値情報インポート） | ユニーク率 ≒ 100% |
| 出典・保守 | `source` 2.3M / `source:*` / `check_date` 1.9M / `check_date:*` / `survey:date` / `fixme` 0.15M | 日付パターン 99% |
| 画像 | `image` / `wikimedia_commons` / `wikipedia` / `brand:wikipedia` | URL |
| 時刻 | `opening_hours` 3.4M（74.6 万種、`;` 39%）/ `collection_times` / `service_times` | 構造化文字列。将来「夜遅くまで開いている」等の派生特徴には使える |

### 3.6 自由記述・数値

| キー | POI 数 | 平均長 | 備考 |
| --- | --- | --- | --- |
| `description` | 0.77M | 50 字 | 多言語の自由文（非 ASCII 43%） |
| `note` | 0.40M | 49 字 | 編集者向けメモ |
| `inscription` | 0.22M | 69 字 | 碑文。記念碑には情報価値あり |
| `capacity` / `seats` / `level` / `ele` / `start_date` / `direction` | 各 20〜100 万 | | 数値・年。単独では意味判断に乗りにくい |
| `material` 1.59M / `colour` 0.54M | | | wood 941k / metal / brown。主にベンチ・アート |

---

## 4. `key=value` ペアの再利用性

値展開対象（近似ユニーク値数 ≤ 20,000 の 36,396 キー、全ペアの 55%）での集計。

| ペアの出現回数 | ペア数 | 出現数 |
| --- | --- | --- |
| 1 回 | 1,912,304 | 1.9M |
| 2〜9 | 260,505 | 0.9M |
| 10〜99 | 74,786 | 2.2M |
| 100〜999 | 18,085 | 5.3M |
| 1k〜9.9k | 3,275 | 8.7M |
| 10k〜99k | 575 | 17.7M |
| 100k〜999k | 121 | 32.0M |
| 1M+ | 5 | 8.7M |

上位 N ペアのカバー率:

| 上位 N | 10 | 50 | 100 | 500 | 1,000 | 5,000 | 10,000 | 20,000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| カバー率 | 16% | 37% | 49% | 72% | 78% | 88% | **91%** | 93% |

- **上位 1 万ペアで 91%**。全世界の全ペアの評価をあらかじめ済ませておく（事前計算・静的配布）ことすら現実的な規模。
- 逆に 191 万ペアは 1 回しか出ない。ビューポート内で見つけたペアを無条件に JEV に送ると、この長い尾に無駄なリクエストが出る。
  **「世界での出現回数 ≥ N」を許可リスト（かつ正規化辞書）として静的に持つ**案が浮上する（→ 議論点 5）。

上位ペア（全体、`amenity=bench` 3.14M / `backrest=yes` 1.73M / `tourism=information` 1.43M / `amenity=restaurant` 1.26M / `amenity=waste_basket` 1.15M …）は、
**「Lens とほぼ無関係なストリートファニチャ」がかなりの割合を占める**。評価対象に入れても JEV が低 relevance を返すだけだが、
数が多いので地図上の表現（沈める側）を左右する。

---

## 5. 日本域の特徴（利用者の主な表示範囲になる想定）

| キー | 日本域での割合 | 全世界 |
| --- | --- | --- |
| `name` | 76.9% | 51.1% |
| `amenity` | 59.4% | 56.9% |
| `shop` | 21.2% | 18.4% |
| `name:en` | 20.2% | 4.1% |
| `name:ja` | 14.3% | 0.7% |
| `brand` | 11.2% | 7.3% |
| `brand:ja` / `brand:en` | 8.4% / 8.2% | |
| `cuisine` | 6.9% | 3.8% |
| `KSJ2:*` | 3.4〜3.7% | — |
| `vending` | 3.1% | 1.1% |
| `religion` | 3.8% | 2.4% |

- 日本は **名前・ブランド・多言語名が濃い**。`name:ja` が別キーで来る（`name` が日本語のことも多い）。
- `vending` が世界平均の 3 倍。自販機大国。
- `KSJ2:*`（国土数値情報のインポート痕跡）は除外対象。

---

## 6. 想定と違った点（まとめ）

1. **LOD の粗いレベルは「重要な POI」ではない。** 空間間引きなので、低ズームの POI 集合は意味的に代表性を持たない。
2. **タグの 4 割はメタ情報**（住所・連絡先・ID・出典）。JEV に渡す前に落とすだけで規模が半分になる。
3. **半数の POI はタグ 1〜3 個**。多くは「分類 1 つ + フラグ 1 つ」で、意味評価に使える情報が薄い。
4. **フラグ（yes/no）キーが多く、Lens の材料として有望**だが、意味が種別に依存する。単独評価か組評価かの設計判断が要る。
5. **`cuisine` の複数値**は分解しないと 5 倍のユニーク数になる。
6. **`name` の再利用性は 30%**、チェーン店以外はほぼ一意。タグ単位の枠に乗らない。
7. **上位 1 万ペアで 91%**。Semantic Cache どころか事前計算が視野に入る規模。

---

## 7. 議論したい点（タグ方針を決める前に）

### 議論点 1: フラグ（yes/no）の評価単位

- **案 A: 単独 `key=value`** で評価（`outdoor_seating=yes`）。実装単純・キャッシュ最大。種別依存の意味（`fee=no`）は取りこぼす。
- **案 B: 「代表種別 + フラグ」の組**で評価（`amenity=cafe ∧ outdoor_seating=yes`）。意味は正確。組の数が増えキャッシュ効率が落ちる（ただし実際の組み合わせは限定的で、集計可能）。
- **案 C: v1 ではフラグを除外**し、分類キー + 細分キーのみで始める。まず JEV の出力を見る。
- おすすめ: **C で JEV 実験を始め、A を第 2 弾で試す**。A/B の差は JEV 出力を見ないと判断できない。

### 議論点 2: `brand` / `operator` を評価対象に含めるか

- 上位数千ブランドは再利用性が高く、Lens への寄与も大きい（「観光客が興味」に「Starbucks」より「地元チェーン」が効く等）。
- ただし JEV がブランド名から意味を引けるかは未検証。
- おすすめ: **条件付き（世界で ≥100 件のブランドのみ）**として小規模 JEV 実験の題材に含める。

### 議論点 3: `name` の扱い

- タグ単位の枠に乗らないので **v1 は除外**。第 2 段（POI 単位・上限付き）は Issue として残す。

### 議論点 4: 「種別不明」値と数値値

- `shop=yes` / `historic=yes` / `building=yes` などは分類情報がない。**キーだけの情報（"何かの店"）として扱うか、除外か**。
- `capacity` / `seats` / `level` / `ele` は **除外**（数値のまま JEV に渡す意味が薄い）。

### 議論点 5: ロングテールの切り方と正規化辞書

- ビューポート内の全ユニークペアを評価するか、**世界頻度 ≥ N の許可リスト**に絞るか。
- 許可リストを静的 JSON として持てば、(a) タイポの排除、(b) `;` 分解・小文字化の正規化、(c) 表示用の説明文（OSM wiki 由来）の付与、(d) 事前計算キャッシュの鍵、を兼ねられる。
- おすすめ: **上位 1〜2 万ペア（91〜93%）の許可リストを生成する**。閾値は JEV 実験のコストを見て決める。

### 議論点 6: JEV に渡す `state` の表現

- OSM の値は英語トークン（`amenity=place_of_worship`）で、Lens は日本語。トークンをそのまま渡すか、辞書で「礼拝所（教会・寺・神社など）」のような説明を添えるかで JEV の精度が変わる可能性。
- **これは JEV 小規模実験（次段階）で確かめる**のが適切。

---

## 付録: 出力ファイル一覧

| ファイル | 内容 |
| --- | --- |
| `summary.json` | 全体サマリ、LOD レベル境界 |
| `keys.csv` | 全 36,482 キーの統計（出現数、近似ユニーク値数、重複率、パターン一致率、LOD 最小/中央レベル） |
| `key_groups.csv` | `prefix:*` で束ねたキー群の集計 |
| `top_values_per_key.csv` | キーごとの上位 50 値（値展開対象キー） |
| `top_pairs_overall.csv` | `key=value` 上位 2,000 |
| `pair_reuse_buckets.csv` / `pair_coverage_curve.csv` | ペア再利用性 |
| `multi_value_keys.csv` | `;` 複数値を持つキー |
| `case_variants.csv` | 大文字小文字・空白ゆれ |
| `primary_key_count_per_row.csv` / `primary_key_cooccurrence.csv` | 主要分類キーの共起 |
| `lod_levels.csv` / `lod_top_keys.csv` | LOD レベル別の行数・頻出キー |
| `geo_grid10.csv` | 10° グリッドの分布 |
| `keys_japan.csv` | 日本 bbox 内の頻出キー |
| `high_cardinality_samples.csv` | 値展開しなかった高カーディナリティキーのサンプル値 |
| `extra_*.csv` | `cuisine` / `brand` / `sport` などの `;` 分解結果、主要キーの上位値 |
