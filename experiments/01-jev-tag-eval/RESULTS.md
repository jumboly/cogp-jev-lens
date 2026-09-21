# 実験 01 結果: OSM タグ × Lens の JEV 評価

対象: 東京駅周辺 z14、744 ユニークタグ、Lens 5 種、Noul / Score / Choice × トークンのみ / 説明文付き

## リクエスト・トークン・レイテンシ

| Lens | 表現 | プリミティブ | req | 入力トークン | 出力トークン | レイテンシ中央値 ms |
| --- | --- | --- | --- | --- | --- | --- |
| kids | described | choice | 19 | 216,300 | 51,559 | 527 |
| kids | described | noul | 19 | 138,180 | 15,757 | 415 |
| kids | described | score | 19 | 156,036 | 13,525 | 561 |
| kids | token | choice | 19 | 204,175 | 51,575 | 548 |
| kids | token | noul | 19 | 126,055 | 15,757 | 520 |
| kids | token | score | 19 | 143,911 | 13,525 | 590 |
| local-not-tourist | described | choice | 19 | 216,528 | 51,715 | 565 |
| local-not-tourist | described | noul | 19 | 138,408 | 15,757 | 510 |
| local-not-tourist | described | score | 19 | 156,264 | 13,525 | 615 |
| local-not-tourist | token | choice | 19 | 204,403 | 51,761 | 563 |
| local-not-tourist | token | noul | 19 | 126,283 | 15,757 | 502 |
| local-not-tourist | token | score | 19 | 144,139 | 13,525 | 526 |
| quiet | described | choice | 19 | 216,300 | 51,538 | 556 |
| quiet | described | noul | 19 | 138,180 | 15,757 | 427 |
| quiet | described | score | 19 | 156,036 | 13,525 | 593 |
| quiet | token | choice | 19 | 204,175 | 51,534 | 573 |
| quiet | token | noul | 19 | 126,055 | 15,757 | 523 |
| quiet | token | score | 19 | 143,911 | 13,525 | 563 |
| stroll | described | choice | 19 | 216,357 | 52,514 | 547 |
| stroll | described | noul | 19 | 138,237 | 15,757 | 529 |
| stroll | described | score | 19 | 156,093 | 13,525 | 549 |
| stroll | token | choice | 19 | 204,232 | 52,555 | 573 |
| stroll | token | noul | 19 | 126,112 | 15,757 | 532 |
| stroll | token | score | 19 | 143,968 | 13,525 | 577 |
| tourist | described | choice | 19 | 216,357 | 52,086 | 526 |
| tourist | described | noul | 19 | 138,237 | 15,757 | 503 |
| tourist | described | score | 19 | 156,093 | 13,525 | 577 |
| tourist | token | choice | 19 | 204,232 | 52,149 | 554 |
| tourist | token | noul | 19 | 126,112 | 15,757 | 506 |
| tourist | token | score | 19 | 143,968 | 13,525 | 583 |

合計: 入力 4,925,337 / 出力 811,806 トークン

## 1. 値の分布

Noul は 0〜1（関係あり確率）、Score は 0〜4（0 沈める / 2 変化なし / 4 最も浮かせる）。10 区間のヒストグラム。

```
kids               noul   token     n=744  mean=0.50 sd=0.15    0   4  71 124 193 163 104  55  26   4   ▁▁▃▆█▇▅▃▂▁
kids               noul   described n=744  mean=0.48 sd=0.17    0   5  95 153 154 152 100  50  28   7   ▁▁▅███▆▃▂▁
kids               score  token     n=744  mean=1.82 sd=0.51    6  13  40 175 260 172  50  18   7   3   ▁▁▂▆█▆▂▁▁▁
kids               score  described n=744  mean=1.80 sd=0.52    8  12  60 176 246 168  45  20   7   2   ▁▁▂▆█▆▂▁▁▁
tourist            noul   token     n=744  mean=0.61 sd=0.15    0   0   2  69 124 170 135 154  82   8   ▁▁▁▄▆█▇█▄▁
tourist            noul   described n=744  mean=0.60 sd=0.16    0   0  12  73 149 160 113 122 101  14   ▁▁▁▄██▆▇▆▁
tourist            score  token     n=744  mean=2.11 sd=0.62    0   0  15 193 150 127 125 110  20   4   ▁▁▁█▇▆▆▅▁▁
tourist            score  described n=744  mean=2.10 sd=0.64    0   0  23 203 144 128 106 107  25   8   ▁▁▁█▆▆▅▅▁▁
quiet              noul   token     n=744  mean=0.56 sd=0.15    0   0  16  95 126 196 161 106  42   2   ▁▁▁▄▆█▇▅▂▁
quiet              noul   described n=744  mean=0.55 sd=0.16    0   1  34 104 127 183 142 100  49   4   ▁▁▂▅▆█▇▅▃▁
quiet              score  token     n=744  mean=1.36 sd=0.56   11  83 225 233  99  49  27  12   5   0   ▁▃██▄▂▁▁▁▁
quiet              score  described n=744  mean=1.37 sd=0.55   15  69 223 229 113  56  26   9   3   1   ▁▃██▄▂▁▁▁▁
stroll             noul   token     n=744  mean=0.62 sd=0.12    0   0   1  37  90 161 221 189  44   1   ▁▁▁▂▄▆█▇▂▁
stroll             noul   described n=744  mean=0.62 sd=0.13    0   0   5  40 117 167 179 173  60   3   ▁▁▁▂▆███▃▁
stroll             score  token     n=744  mean=1.99 sd=0.58    0   3  51 160 179 135 149  55  11   1   ▁▁▃██▇▇▃▁▁
stroll             score  described n=744  mean=1.97 sd=0.60    0   3  61 174 165 135 139  56  10   1   ▁▁▃██▇▇▃▁▁
local-not-tourist  noul   token     n=744  mean=0.71 sd=0.11    0   1   0   6  24  82 177 300 141  13   ▁▁▁▁▁▃▅█▄▁
local-not-tourist  noul   described n=744  mean=0.70 sd=0.12    0   0   2   5  48  96 144 290 141  18   ▁▁▁▁▂▃▄█▄▁
local-not-tourist  score  token     n=744  mean=1.50 sd=0.81   62 106 121 139  97  90  82  39   8   0   ▄▇▇█▆▆▅▃▁▁
local-not-tourist  score  described n=744  mean=1.58 sd=0.84   55  89 128 133 113  78  70  60  17   1   ▄▆██▇▅▅▄▂▁
```

## 2. Choice（Lens との関係の種類）の分布

| Lens | 表現 | 目的地 | 立ち寄り先 | 雰囲気 | 妨げ | 無関係 | 平均確信度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kids | token | 65 | 61 | 3 | 35 | 580 | 0.68 |
| kids | described | 62 | 53 | 3 | 38 | 588 | 0.69 |
| tourist | token | 140 | 348 | 3 | 5 | 248 | 0.64 |
| tourist | described | 159 | 314 | 8 | 2 | 261 | 0.64 |
| quiet | token | 20 | 16 | 52 | 449 | 207 | 0.65 |
| quiet | described | 18 | 17 | 54 | 441 | 214 | 0.66 |
| stroll | token | 0 | 544 | 17 | 24 | 159 | 0.71 |
| stroll | described | 0 | 525 | 14 | 31 | 174 | 0.70 |
| local-not-tourist | token | 99 | 147 | 17 | 349 | 132 | 0.52 |
| local-not-tourist | described | 108 | 127 | 11 | 351 | 147 | 0.53 |

## 3. Lens ごとの上位・下位タグ（Score、説明文付き）

タグの後の括弧は東京駅周辺での POI 件数。Choice の結果と Noul を併記。

### 子供が楽しめそう

| | タグ | 件数 | Score | Noul | Choice |
| --- | --- | --- | --- | --- | --- |
| 浮かせる | `leisure=playground` | 16 | 3.99 | 0.97 | 目的地 |
| 浮かせる | `shop=toys` | 26 | 3.84 | 0.95 | 目的地 |
| 浮かせる | `amenity=ice_cream` | 5 | 3.55 | 0.91 | 目的地 |
| 浮かせる | `cuisine=ice_cream` | 1 | 3.50 | 0.87 | 目的地 |
| 浮かせる | `leisure=park` | 3 | 3.49 | 0.92 | 目的地 |
| 浮かせる | `amenity=kindergarten` | 36 | 3.47 | 0.87 | 目的地 |
| 浮かせる | `amenity=planetarium` | 1 | 3.41 | 0.89 | 目的地 |
| 浮かせる | `amenity=childcare` | 5 | 3.28 | 0.84 | 目的地 |
| 浮かせる | `leisure=amusement_arcade` | 5 | 3.27 | 0.90 | 目的地 |
| 浮かせる | `amenity=fountain` | 10 | 3.16 | 0.87 | 目的地 |
| 浮かせる | `cuisine=dessert` | 1 | 3.14 | 0.79 | 目的地 |
| 浮かせる | `shop=confectionery` | 46 | 3.13 | 0.85 | 目的地 |
| 浮かせる | `shop=games` | 1 | 3.12 | 0.86 | 目的地 |
| 浮かせる | `craft=confectionery` | 13 | 3.07 | 0.82 | 目的地 |
| 浮かせる | `leisure=swimming_pool` | 1 | 3.06 | 0.85 | 目的地 |
| 沈める | `amenity=courthouse` | 6 | 0.66 | 0.64 | 妨げ |
| 沈める | `historic=tomb` | 1 | 0.59 | 0.64 | 妨げ |
| 沈める | `amenity=pub` | 342 | 0.58 | 0.77 | 妨げ |
| 沈める | `shop=tobacco` | 3 | 0.52 | 0.74 | 妨げ |
| 沈める | `shop=alcohol` | 24 | 0.46 | 0.80 | 妨げ |
| 沈める | `shop=e-cigarette` | 1 | 0.46 | 0.72 | 妨げ |
| 沈める | `amenity=nursing_home` | 1 | 0.46 | 0.70 | 妨げ |
| 沈める | `vending=cigarettes` | 8 | 0.35 | 0.80 | 妨げ |
| 沈める | `amenity=nightclub` | 9 | 0.33 | 0.88 | 妨げ |
| 沈める | `amenity=gambling` | 9 | 0.30 | 0.83 | 妨げ |
| 沈める | `shop=bookmaker` | 1 | 0.28 | 0.76 | 妨げ |
| 沈める | `amenity=bar` | 130 | 0.23 | 0.88 | 妨げ |
| 沈める | `shop=funeral_directors` | 1 | 0.18 | 0.75 | 妨げ |
| 沈める | `shop=erotic` | 4 | 0.05 | 0.91 | 妨げ |
| 沈める | `leisure=adult_gaming_centre` | 4 | 0.04 | 0.93 | 妨げ |

### 観光客が興味を持ちそう

| | タグ | 件数 | Score | Noul | Choice |
| --- | --- | --- | --- | --- | --- |
| 浮かせる | `tourism=viewpoint` | 20 | 3.96 | 0.96 | 目的地 |
| 浮かせる | `tourism=attraction` | 32 | 3.94 | 0.95 | 目的地 |
| 浮かせる | `tourism=information` | 478 | 3.90 | 0.95 | 立ち寄り先 |
| 浮かせる | `tourism=museum` | 49 | 3.78 | 0.94 | 目的地 |
| 浮かせる | `tourism=gallery` | 24 | 3.67 | 0.93 | 目的地 |
| 浮かせる | `tourism=artwork` | 95 | 3.64 | 0.93 | 目的地 |
| 浮かせる | `historic=monument` | 15 | 3.64 | 0.92 | 目的地 |
| 浮かせる | `information=office` | 9 | 3.60 | 0.89 | 立ち寄り先 |
| 浮かせる | `shop=gift` | 54 | 3.57 | 0.91 | 立ち寄り先 |
| 浮かせる | `amenity=theatre` | 22 | 3.52 | 0.89 | 目的地 |
| 浮かせる | `historic=archaeological_site` | 3 | 3.44 | 0.90 | 目的地 |
| 浮かせる | `man_made=ceremonial_gate` | 1 | 3.43 | 0.90 | 目的地 |
| 浮かせる | `amenity=planetarium` | 1 | 3.42 | 0.90 | 目的地 |
| 浮かせる | `amenity=cinema` | 8 | 3.40 | 0.89 | 目的地 |
| 浮かせる | `amenity=arts_centre` | 3 | 3.40 | 0.89 | 目的地 |
| 沈める | `shop=car_repair` | 3 | 1.14 | 0.48 | 無関係 |
| 沈める | `office=research` | 3 | 1.14 | 0.57 | 無関係 |
| 沈める | `waste=plastic` | 1 | 1.14 | 0.37 | 無関係 |
| 沈める | `shop=storage_rental` | 2 | 1.12 | 0.43 | 無関係 |
| 沈める | `brand=Amazon Hub ロッカー` | 1 | 1.10 | 0.34 | 無関係 |
| 沈める | `amenity=vacant` | 3 | 1.04 | 0.44 | 無関係 |
| 沈める | `waste=paper` | 2 | 1.03 | 0.32 | 無関係 |
| 沈める | `amenity=nursing_home` | 1 | 1.03 | 0.59 | 無関係 |
| 沈める | `leisure=adult_gaming_centre` | 4 | 1.02 | 0.75 | 妨げ |
| 沈める | `social_facility=nursing_home` | 1 | 1.02 | 0.53 | 無関係 |
| 沈める | `shop=wholesale` | 5 | 0.98 | 0.62 | 無関係 |
| 沈める | `shop=bookmaker` | 1 | 0.97 | 0.60 | 無関係 |
| 沈める | `shop=vacant` | 2 | 0.93 | 0.55 | 無関係 |
| 沈める | `shop=erotic` | 4 | 0.86 | 0.62 | 妨げ |
| 沈める | `shop=funeral_directors` | 1 | 0.86 | 0.47 | 無関係 |

### 静かに過ごせそう

| | タグ | 件数 | Score | Noul | Choice |
| --- | --- | --- | --- | --- | --- |
| 浮かせる | `cuisine=teahouse` | 2 | 3.76 | 0.91 | 目的地 |
| 浮かせる | `sport=yoga` | 1 | 3.58 | 0.85 | 目的地 |
| 浮かせる | `amenity=library` | 7 | 3.45 | 0.87 | 目的地 |
| 浮かせる | `leisure=garden` | 3 | 3.39 | 0.88 | 目的地 |
| 浮かせる | `shelter_type=gazebo` | 1 | 3.08 | 0.81 | 目的地 |
| 浮かせる | `historic=wayside_shrine` | 28 | 3.03 | 0.72 | 雰囲気 |
| 浮かせる | `leisure=park` | 3 | 3.02 | 0.87 | 目的地 |
| 浮かせる | `memorial=stone` | 7 | 2.97 | 0.67 | 雰囲気 |
| 浮かせる | `religion=buddhist` | 17 | 2.96 | 0.76 | 雰囲気 |
| 浮かせる | `amenity=bench` | 196 | 2.92 | 0.80 | 立ち寄り先 |
| 浮かせる | `religion=shinto` | 56 | 2.89 | 0.69 | 雰囲気 |
| 浮かせる | `historic=tomb` | 1 | 2.88 | 0.73 | 雰囲気 |
| 浮かせる | `tourism=chalet` | 1 | 2.80 | 0.77 | 目的地 |
| 浮かせる | `historic=memorial` | 141 | 2.77 | 0.72 | 雰囲気 |
| 浮かせる | `memorial=stele` | 23 | 2.75 | 0.63 | 雰囲気 |
| 沈める | `amenity=fuel` | 13 | 0.35 | 0.82 | 妨げ |
| 沈める | `amenity=taxi` | 30 | 0.34 | 0.88 | 妨げ |
| 沈める | `amenity=events_venue` | 3 | 0.31 | 0.86 | 妨げ |
| 沈める | `brand=ドン・キホーテ` | 2 | 0.31 | 0.67 | 妨げ |
| 沈める | `amenity=theatre` | 22 | 0.30 | 0.86 | 妨げ |
| 沈める | `shop=mall` | 8 | 0.28 | 0.88 | 妨げ |
| 沈める | `amenity=bus_station` | 5 | 0.25 | 0.89 | 妨げ |
| 沈める | `leisure=adult_gaming_centre` | 4 | 0.20 | 0.87 | 妨げ |
| 沈める | `brand=カラオケ まねきねこ` | 1 | 0.19 | 0.77 | 妨げ |
| 沈める | `leisure=amusement_arcade` | 5 | 0.17 | 0.89 | 妨げ |
| 沈める | `leisure=karaoke` | 4 | 0.15 | 0.91 | 妨げ |
| 沈める | `brand=カラオケ館` | 2 | 0.14 | 0.63 | 妨げ |
| 沈める | `healthcare:speciality=emergency` | 1 | 0.11 | 0.87 | 妨げ |
| 沈める | `amenity=bar` | 130 | 0.02 | 0.95 | 妨げ |
| 沈める | `amenity=nightclub` | 9 | 0.01 | 0.94 | 妨げ |

### 散歩で立ち寄りたくなる

| | タグ | 件数 | Score | Noul | Choice |
| --- | --- | --- | --- | --- | --- |
| 浮かせる | `leisure=park` | 3 | 3.68 | 0.92 | 立ち寄り先 |
| 浮かせる | `amenity=cafe` | 510 | 3.55 | 0.92 | 立ち寄り先 |
| 浮かせる | `cuisine=teahouse` | 2 | 3.47 | 0.88 | 立ち寄り先 |
| 浮かせる | `leisure=garden` | 3 | 3.46 | 0.90 | 立ち寄り先 |
| 浮かせる | `tourism=viewpoint` | 20 | 3.38 | 0.87 | 立ち寄り先 |
| 浮かせる | `shop=coffee` | 8 | 3.36 | 0.89 | 立ち寄り先 |
| 浮かせる | `shelter_type=gazebo` | 1 | 3.31 | 0.85 | 立ち寄り先 |
| 浮かせる | `amenity=biergarten` | 3 | 3.30 | 0.87 | 立ち寄り先 |
| 浮かせる | `amenity=fountain` | 10 | 3.22 | 0.88 | 立ち寄り先 |
| 浮かせる | `amenity=bench` | 196 | 3.21 | 0.83 | 立ち寄り先 |
| 浮かせる | `cuisine=coffee_shop` | 295 | 3.20 | 0.87 | 立ち寄り先 |
| 浮かせる | `shop=bakery` | 47 | 3.16 | 0.87 | 立ち寄り先 |
| 浮かせる | `amenity=ice_cream` | 5 | 3.16 | 0.87 | 立ち寄り先 |
| 浮かせる | `place=square` | 1 | 3.16 | 0.82 | 立ち寄り先 |
| 浮かせる | `leisure=picnic_table` | 15 | 3.15 | 0.83 | 立ち寄り先 |
| 沈める | `amenity=police` | 54 | 0.94 | 0.67 | 妨げ |
| 沈める | `parking=multi-storey` | 19 | 0.94 | 0.56 | 妨げ |
| 沈める | `amenity=hospital` | 17 | 0.93 | 0.69 | 妨げ |
| 沈める | `shop=car` | 10 | 0.92 | 0.66 | 無関係 |
| 沈める | `amenity=nursing_home` | 1 | 0.92 | 0.71 | 妨げ |
| 沈める | `amenity=gambling` | 9 | 0.90 | 0.75 | 妨げ |
| 沈める | `social_facility=nursing_home` | 1 | 0.90 | 0.67 | 妨げ |
| 沈める | `waste=trash` | 4 | 0.85 | 0.45 | 妨げ |
| 沈める | `waste=plastic` | 1 | 0.85 | 0.55 | 妨げ |
| 沈める | `waste=paper` | 2 | 0.84 | 0.55 | 妨げ |
| 沈める | `shop=erotic` | 4 | 0.80 | 0.73 | 妨げ |
| 沈める | `leisure=adult_gaming_centre` | 4 | 0.80 | 0.80 | 妨げ |
| 沈める | `amenity=vacant` | 3 | 0.70 | 0.61 | 妨げ |
| 沈める | `shop=vacant` | 2 | 0.64 | 0.73 | 妨げ |
| 沈める | `shop=funeral_directors` | 1 | 0.62 | 0.65 | 妨げ |

### 観光客向けではない、地元の人の日常の場所（否定形）

| | タグ | 件数 | Score | Noul | Choice |
| --- | --- | --- | --- | --- | --- |
| 浮かせる | `shop=laundry` | 9 | 3.62 | 0.87 | 目的地 |
| 浮かせる | `amenity=bicycle_repair_station` | 2 | 3.46 | 0.86 | 目的地 |
| 浮かせる | `shop=repair` | 2 | 3.43 | 0.84 | 目的地 |
| 浮かせる | `amenity=community_centre` | 18 | 3.41 | 0.86 | 目的地 |
| 浮かせる | `office=union` | 1 | 3.39 | 0.81 | 目的地 |
| 浮かせる | `shop=grocery` | 1 | 3.34 | 0.86 | 目的地 |
| 浮かせる | `shop=general` | 4 | 3.33 | 0.86 | 目的地 |
| 浮かせる | `shop=car_repair` | 3 | 3.33 | 0.84 | 目的地 |
| 浮かせる | `shop=dry_cleaning` | 27 | 3.32 | 0.83 | 目的地 |
| 浮かせる | `craft=blacksmith` | 1 | 3.32 | 0.84 | 目的地 |
| 浮かせる | `shop=greengrocer` | 15 | 3.30 | 0.83 | 目的地 |
| 浮かせる | `social_facility=nursing_home` | 1 | 3.30 | 0.80 | 無関係 |
| 浮かせる | `amenity=social_facility` | 22 | 3.27 | 0.79 | 目的地 |
| 浮かせる | `amenity=recycling` | 7 | 3.27 | 0.80 | 立ち寄り先 |
| 浮かせる | `craft=electrician` | 2 | 3.26 | 0.74 | 立ち寄り先 |
| 沈める | `tourism=hostel` | 5 | 0.13 | 0.91 | 妨げ |
| 沈める | `cuisine=fine_dining` | 1 | 0.13 | 0.90 | 妨げ |
| 沈める | `brand=TOHOシネマズ` | 3 | 0.12 | 0.81 | 妨げ |
| 沈める | `tourism=chalet` | 1 | 0.11 | 0.92 | 妨げ |
| 沈める | `shop=travel_agency` | 10 | 0.10 | 0.90 | 妨げ |
| 沈める | `brand=Tiffany & Company` | 2 | 0.10 | 0.81 | 妨げ |
| 沈める | `building=hotel` | 1 | 0.08 | 0.92 | 妨げ |
| 沈める | `tourism=apartment` | 6 | 0.06 | 0.92 | 妨げ |
| 沈める | `brand=Louis Vuitton` | 2 | 0.06 | 0.85 | 妨げ |
| 沈める | `tourism=museum` | 49 | 0.05 | 0.93 | 妨げ |
| 沈める | `tourism=hotel` | 111 | 0.03 | 0.92 | 妨げ |
| 沈める | `tourism=motel` | 1 | 0.03 | 0.93 | 妨げ |
| 沈める | `tourism=viewpoint` | 20 | 0.02 | 0.93 | 妨げ |
| 沈める | `tourism=information` | 478 | 0.01 | 0.94 | 妨げ |
| 沈める | `tourism=attraction` | 32 | 0.00 | 0.93 | 妨げ |

## 4. トークンのみ vs 説明文付き

同じ Lens・同じタグで Score がどれだけ動いたか（説明文が取れたタグのみ。ブランドは除外）。

| Lens | n | 平均 \|Δ\| | Δ≥0.5 の割合 | 最も動いたタグ（token → described） |
| --- | --- | --- | --- | --- |
| kids | 417 | 0.12 | 1% | `amenity=prep_school` 2.0→1.2; `amenity=events_venue` 2.4→1.6; `board_type=board` 2.2→1.6; `shop=stationery` 2.4→1.8 |
| tourist | 417 | 0.14 | 3% | `tourism=apartment` 2.0→2.9; `amenity=events_venue` 3.2→2.3; `shop=bbq` 2.4→1.6; `leisure=adult_gaming_centre` 1.8→1.0 |
| quiet | 417 | 0.14 | 4% | `amenity=studio` 2.2→0.8; `shop=beauty` 1.3→2.3; `man_made=ceremonial_gate` 1.4→2.2; `shop=games` 1.1→1.8 |
| stroll | 417 | 0.13 | 3% | `amenity=bar` 2.7→1.5; `information=office` 1.4→2.3; `tourism=chalet` 2.4→1.5; `shop=bbq` 2.3→1.4 |
| local-not-tourist | 417 | 0.22 | 9% | `shop=bed` 1.4→2.7; `craft=caterer` 1.3→2.5; `shop=deli` 2.2→1.1; `shop=garden_centre` 1.6→2.5 |

## 5. Noul（関係あり）と Score（扱い）の関係

Noul が「関係あり」を返すタグは Score が中央（2）から離れているはず。Score の中央からの距離 |Score−2| と Noul の相関を見る。

| Lens | 表現 | n | 相関 r(Noul, \|Score−2\|) | Noul<0.4 の Score 平均 | Noul≥0.7 の \|Score−2\| 平均 |
| --- | --- | --- | --- | --- | --- |
| kids | token | 744 | 0.44 | 1.68 (n=199) | 0.84 (n=85) |
| kids | described | 744 | 0.43 | 1.71 (n=253) | 0.86 (n=85) |
| tourist | token | 744 | 0.47 | 1.44 (n=71) | 0.81 (n=244) |
| tourist | described | 744 | 0.51 | 1.44 (n=85) | 0.86 (n=237) |
| quiet | token | 744 | 0.50 | 1.51 (n=111) | 1.05 (n=150) |
| quiet | described | 744 | 0.50 | 1.52 (n=139) | 1.05 (n=153) |
| stroll | token | 744 | 0.29 | 1.51 (n=38) | 0.64 (n=234) |
| stroll | described | 744 | 0.31 | 1.45 (n=45) | 0.64 (n=236) |
| local-not-tourist | token | 744 | 0.50 | 1.95 (n=7) | 0.96 (n=454) |
| local-not-tourist | described | 744 | 0.42 | 1.83 (n=7) | 0.92 (n=449) |

