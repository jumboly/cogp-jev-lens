# 実験 01 結果: OSM タグ × Lens の JEV 評価

対象: 東京駅周辺 z14、744 ユニークタグ、Lens 5 種、Noul / Score / Choice × トークンのみ / 説明文付き

## リクエスト・トークン・レイテンシ

| Lens | 表現 | プリミティブ | req | 入力トークン | 出力トークン | レイテンシ中央値 ms |
| --- | --- | --- | --- | --- | --- | --- |
| kids | described | choice | 19 | 216,300 | 51,559 | 527 |
| kids | described | noul | 19 | 138,180 | 15,757 | 415 |
| kids | described | score | 19 | 156,036 | 13,525 | 561 |
| kids | token | choice | 19 | 204,175 | 51,575 | 548 |
| kids | token | choice-v2 | 19 | 204,919 | 46,935 | 555 |
| kids | token | choice-v3 | 19 | 261,463 | 46,941 | 601 |
| kids | token | noul | 19 | 126,055 | 15,757 | 520 |
| kids | token | noul-confidence | 19 | 121,591 | 15,757 | 519 |
| kids | token | noul-fit | 19 | 81,415 | 15,757 | 459 |
| kids | token | score | 19 | 143,911 | 13,525 | 590 |
| local-not-tourist | described | choice | 19 | 216,528 | 51,715 | 565 |
| local-not-tourist | described | noul | 19 | 138,408 | 15,757 | 510 |
| local-not-tourist | described | score | 19 | 156,264 | 13,525 | 615 |
| local-not-tourist | token | choice | 19 | 204,403 | 51,761 | 563 |
| local-not-tourist | token | choice-v2 | 19 | 205,147 | 46,754 | 538 |
| local-not-tourist | token | choice-v3 | 19 | 261,691 | 46,822 | 687 |
| local-not-tourist | token | noul | 19 | 126,283 | 15,757 | 502 |
| local-not-tourist | token | noul-confidence | 19 | 121,819 | 15,757 | 484 |
| local-not-tourist | token | noul-fit | 19 | 81,643 | 15,757 | 463 |
| local-not-tourist | token | score | 19 | 144,139 | 13,525 | 526 |
| quiet | described | choice | 19 | 216,300 | 51,538 | 556 |
| quiet | described | noul | 19 | 138,180 | 15,757 | 427 |
| quiet | described | score | 19 | 156,036 | 13,525 | 593 |
| quiet | token | choice | 19 | 204,175 | 51,534 | 573 |
| quiet | token | choice-v2 | 19 | 204,919 | 46,897 | 530 |
| quiet | token | choice-v3 | 19 | 261,463 | 46,908 | 587 |
| quiet | token | noul | 19 | 126,055 | 15,757 | 523 |
| quiet | token | noul-confidence | 19 | 121,591 | 15,757 | 480 |
| quiet | token | noul-fit | 19 | 81,415 | 15,757 | 366 |
| quiet | token | score | 19 | 143,911 | 13,525 | 563 |
| stroll | described | choice | 19 | 216,357 | 52,514 | 547 |
| stroll | described | noul | 19 | 138,237 | 15,757 | 529 |
| stroll | described | score | 19 | 156,093 | 13,525 | 549 |
| stroll | token | choice | 19 | 204,232 | 52,555 | 573 |
| stroll | token | choice-v2 | 19 | 204,976 | 46,858 | 511 |
| stroll | token | choice-v3 | 19 | 261,520 | 46,895 | 557 |
| stroll | token | noul | 19 | 126,112 | 15,757 | 532 |
| stroll | token | noul-confidence | 19 | 121,648 | 15,757 | 506 |
| stroll | token | noul-fit | 19 | 81,472 | 15,757 | 494 |
| stroll | token | score | 19 | 143,968 | 13,525 | 577 |
| tourist | described | choice | 19 | 216,357 | 52,086 | 526 |
| tourist | described | noul | 19 | 138,237 | 15,757 | 503 |
| tourist | described | score | 19 | 156,093 | 13,525 | 577 |
| tourist | token | choice | 19 | 204,232 | 52,149 | 554 |
| tourist | token | choice-v2 | 19 | 204,976 | 46,788 | 475 |
| tourist | token | choice-v3 | 19 | 261,520 | 46,887 | 577 |
| tourist | token | noul | 19 | 126,112 | 15,757 | 506 |
| tourist | token | noul-confidence | 19 | 121,648 | 15,757 | 531 |
| tourist | token | noul-fit | 19 | 81,472 | 15,757 | 453 |
| tourist | token | score | 19 | 143,968 | 13,525 | 583 |

合計: 入力 8,273,645 / 出力 1,438,061 トークン

## 1. 値の分布

Noul は 0〜1（関係あり確率）、Score は 0〜4（0 沈める / 2 変化なし / 4 最も浮かせる）。10 区間のヒストグラム。

```
kids               noul   token     n=744  mean=0.50 sd=0.15    0   4  71 124 193 163 104  55  26   4   ▁▁▃▆█▇▅▃▂▁
kids               noul   described n=744  mean=0.48 sd=0.17    0   5  95 153 154 152 100  50  28   7   ▁▁▅███▆▃▂▁
kids               noul-confidence token     n=744  mean=0.25 sd=0.11    0 283 300  87  40  20   8   4   2   0   ▁██▃▂▁▁▁▁▁
kids               noul-fit token     n=744  mean=0.28 sd=0.16   16 252 231 109  59  41  16  10   7   3   ▁██▄▂▂▁▁▁▁
kids               score  token     n=744  mean=1.82 sd=0.51    6  13  40 175 260 172  50  18   7   3   ▁▁▂▆█▆▂▁▁▁
kids               score  described n=744  mean=1.80 sd=0.52    8  12  60 176 246 168  45  20   7   2   ▁▁▂▆█▆▂▁▁▁
tourist            noul   token     n=744  mean=0.61 sd=0.15    0   0   2  69 124 170 135 154  82   8   ▁▁▁▄▆█▇█▄▁
tourist            noul   described n=744  mean=0.60 sd=0.16    0   0  12  73 149 160 113 122 101  14   ▁▁▁▄██▆▇▆▁
tourist            noul-confidence token     n=744  mean=0.32 sd=0.11    0 107 230 233 127  30  13   3   1   0   ▁▄██▅▂▁▁▁▁
tourist            noul-fit token     n=744  mean=0.45 sd=0.20    0  68 168 112  95  91  94  90  21   5   ▁▄█▆▅▅▅▅▁▁
tourist            score  token     n=744  mean=2.11 sd=0.62    0   0  15 193 150 127 125 110  20   4   ▁▁▁█▇▆▆▅▁▁
tourist            score  described n=744  mean=2.10 sd=0.64    0   0  23 203 144 128 106 107  25   8   ▁▁▁█▆▆▅▅▁▁
quiet              noul   token     n=744  mean=0.56 sd=0.15    0   0  16  95 126 196 161 106  42   2   ▁▁▁▄▆█▇▅▂▁
quiet              noul   described n=744  mean=0.55 sd=0.16    0   1  34 104 127 183 142 100  49   4   ▁▁▂▅▆█▇▅▃▁
quiet              noul-confidence token     n=744  mean=0.22 sd=0.08    2 326 330  63  15   4   3   1   0   0   ▁██▂▁▁▁▁▁▁
quiet              noul-fit token     n=744  mean=0.27 sd=0.13    6 180 363  94  38  29  20  10   4   0   ▁▄█▃▁▁▁▁▁▁
quiet              score  token     n=744  mean=1.36 sd=0.56   11  83 225 233  99  49  27  12   5   0   ▁▃██▄▂▁▁▁▁
quiet              score  described n=744  mean=1.37 sd=0.55   15  69 223 229 113  56  26   9   3   1   ▁▃██▄▂▁▁▁▁
stroll             noul   token     n=744  mean=0.62 sd=0.12    0   0   1  37  90 161 221 189  44   1   ▁▁▁▂▄▆█▇▂▁
stroll             noul   described n=744  mean=0.62 sd=0.13    0   0   5  40 117 167 179 173  60   3   ▁▁▁▂▆███▃▁
stroll             noul-confidence token     n=744  mean=0.26 sd=0.08    1 166 345 176  49   6   1   0   0   0   ▁▄█▅▂▁▁▁▁▁
stroll             noul-fit token     n=744  mean=0.43 sd=0.17    0  47 169 128 107 129 117  41   6   0   ▁▃█▇▆▇▆▂▁▁
stroll             score  token     n=744  mean=1.99 sd=0.58    0   3  51 160 179 135 149  55  11   1   ▁▁▃██▇▇▃▁▁
stroll             score  described n=744  mean=1.97 sd=0.60    0   3  61 174 165 135 139  56  10   1   ▁▁▃██▇▇▃▁▁
local-not-tourist  noul   token     n=744  mean=0.71 sd=0.11    0   1   0   6  24  82 177 300 141  13   ▁▁▁▁▁▃▅█▄▁
local-not-tourist  noul   described n=744  mean=0.70 sd=0.12    0   0   2   5  48  96 144 290 141  18   ▁▁▁▁▂▃▄█▄▁
local-not-tourist  noul-confidence token     n=744  mean=0.26 sd=0.10    0 197 338 145  40  15   8   1   0   0   ▁▅█▄▁▁▁▁▁▁
local-not-tourist  noul-fit token     n=744  mean=0.45 sd=0.19   12  75 112 101 134 118  99  80  13   0   ▁▅▇▇██▆▅▁▁
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

## 6. Noul の意味を変えた再実験（トークンのみ）

relevance = 判断材料として関係あるか（初回） / confidence = このタグだけで扱いが決まるか / fit = Lens に沿う側か。

| Lens | 変種 | n | 平均 ± SD | r(値, \|Score−2\|) | r(値, Score) | 値≥0.8 の割合 | 値≤0.2 の割合 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kids | relevance | 744 | 0.50 ± 0.15 | 0.44 | 0.30 | 4% | 1% |
| kids | confidence | 744 | 0.25 ± 0.11 | 0.78 | -0.28 | 0% | 45% |
| kids | fit | 744 | 0.28 ± 0.16 | 0.03 | 0.89 | 1% | 39% |
| tourist | relevance | 744 | 0.61 ± 0.15 | 0.47 | 0.88 | 12% | 0% |
| tourist | confidence | 744 | 0.32 ± 0.11 | 0.65 | 0.26 | 0% | 16% |
| tourist | fit | 744 | 0.45 ± 0.20 | 0.47 | 0.98 | 3% | 11% |
| quiet | relevance | 744 | 0.56 ± 0.15 | 0.50 | -0.17 | 6% | 0% |
| quiet | confidence | 744 | 0.22 ± 0.08 | 0.55 | -0.29 | 0% | 52% |
| quiet | fit | 744 | 0.27 ± 0.13 | -0.48 | 0.92 | 1% | 31% |
| stroll | relevance | 744 | 0.62 ± 0.12 | 0.29 | 0.66 | 6% | 0% |
| stroll | confidence | 744 | 0.26 ± 0.08 | 0.51 | -0.06 | 0% | 26% |
| stroll | fit | 744 | 0.43 ± 0.17 | 0.10 | 0.96 | 1% | 9% |
| local-not-tourist | relevance | 744 | 0.71 ± 0.11 | 0.50 | -0.24 | 21% | 0% |
| local-not-tourist | confidence | 744 | 0.26 ± 0.10 | 0.60 | -0.26 | 0% | 31% |
| local-not-tourist | fit | 744 | 0.45 ± 0.19 | -0.70 | 0.97 | 2% | 13% |

### confidence が高い / 低いタグの例（静か Lens）

| | タグ | confidence | Score |
| --- | --- | --- | --- |
| 高い | `amenity=nightclub` | 0.76 | 0.01 |
| 高い | `healthcare:speciality=emergency` | 0.64 | 0.15 |
| 高い | `leisure=amusement_arcade` | 0.63 | 0.19 |
| 高い | `amenity=gambling` | 0.60 | 0.19 |
| 高い | `amenity=karaoke_box` | 0.55 | 0.22 |
| 高い | `amenity=fire_station` | 0.54 | 0.40 |
| 高い | `leisure=karaoke` | 0.53 | 0.30 |
| 高い | `brand=カラオケ まねきねこ` | 0.51 | 0.19 |
| 高い | `shop=funeral_directors` | 0.47 | 1.65 |
| 高い | `amenity=fuel` | 0.45 | 0.48 |
| 高い | `amenity=police` | 0.44 | 0.74 |
| 高い | `leisure=adult_gaming_centre` | 0.44 | 0.75 |
| 低い | `brand=白洋舎` | 0.11 | 1.77 |
| 低い | `brand=BOC` | 0.11 | 1.51 |
| 低い | `brand=リカーマウンテン` | 0.11 | 1.68 |
| 低い | `brand=コスモ` | 0.11 | 1.15 |
| 低い | `brand=LUUP` | 0.11 | 1.66 |
| 低い | `brand=NTT` | 0.10 | 1.52 |
| 低い | `amenity=fixme` | 0.10 | 1.78 |
| 低い | `brand=Boss` | 0.10 | 1.42 |
| 低い | `brand=オーケー` | 0.10 | 1.44 |
| 低い | `brand=Panasonic` | 0.10 | 1.75 |
| 低い | `brand=サントリー` | 0.09 | 1.71 |
| 低い | `brand=サミット` | 0.09 | 1.76 |

## 7. Choice の選択肢を言い換えた再実験（v2: 主役 / 脇役 / 背景 / 妨げ / 無関係、トークンのみ）

| Lens | 主役 | 脇役 | 背景 | 妨げ | 無関係 | 平均確信度 |
| --- | --- | --- | --- | --- | --- | --- |
| kids | 51 | 158 | 0 | 40 | 495 | 0.60 |
| tourist | 194 | 390 | 2 | 7 | 151 | 0.58 |
| quiet | 27 | 51 | 31 | 481 | 154 | 0.63 |
| stroll | 76 | 435 | 26 | 40 | 167 | 0.52 |
| local-not-tourist | 232 | 68 | 0 | 421 | 23 | 0.61 |

### v1 → v2 の対応（全 Lens 合算）。行 = v1、列 = v2

| v1 \ v2 | 主役 | 脇役 | 背景 | 妨げ | 無関係 |
| --- | --- | --- | --- | --- | --- |
| 目的地 | 282 | 35 | 0 | 6 | 1 |
| 立ち寄り先 | 221 | 809 | 13 | 33 | 40 |
| 雰囲気 | 13 | 25 | 42 | 10 | 2 |
| 妨げ | 6 | 7 | 0 | 844 | 5 |
| 無関係 | 58 | 226 | 4 | 96 | 942 |

### v2 各カテゴリの Score 平均（全 Lens 合算）

| カテゴリ | n | Score 平均 | Score<1.5 の割合 |
| --- | --- | --- | --- |
| 主役 | 580 | 2.63 | 2% |
| 脇役 | 1102 | 2.12 | 6% |
| 背景 | 59 | 2.04 | 8% |
| 妨げ | 989 | 0.99 | 91% |
| 無関係 | 990 | 1.58 | 43% |

### v2 で各カテゴリに入ったタグの例（静か Lens、Score 併記）

- **主役** (27): `cuisine=teahouse` 3.5, `leisure=park` 3.4, `leisure=garden` 3.4, `sport=yoga` 3.3, `amenity=library` 3.4, `shelter_type=gazebo` 3.1, `shop=massage` 3.0, `amenity=place_of_worship` 3.1
- **脇役** (51): `amenity=drinking_water` 2.1, `amenity=shelter` 2.4, `amenity=bench` 3.1, `amenity=water_point` 2.1, `shop=books` 2.4, `amenity=toilets` 1.6, `social_facility:for=senior` 2.3, `amenity=library_dropoff` 1.8
- **背景** (31): `artwork_type=sculpture` 2.1, `artwork_type=statue` 2.0, `historic=citywalls` 2.2, `historic=building` 2.1, `historic=statue` 2.1, `historic=monument` 2.2, `artwork_type=bust` 2.0, `board_type=plants` 2.5
- **妨げ** (481): `amenity=fast_food` 0.6, `amenity=gambling` 0.2, `amenity=karaoke_box` 0.2, `amenity=nightclub` 0.0, `shop=mall` 0.3, `leisure=amusement_arcade` 0.2, `amenity=food_court` 0.6, `leisure=karaoke` 0.3
- **無関係** (154): `amenity=fixme` 1.8, `brand=Panasonic` 1.8, `brand=サミット` 1.8, `brand=オーケー` 1.4, `clothes=underwear` 1.5, `brand=Lacoste` 1.3, `brand=ポニー` 1.6, `brand=NTT` 1.5

## 7. Choice の選択肢を言い換えた再実験（v3: v2 の語で「脇役」を「実際に役立つ」に締め、「無関係」を広げる、トークンのみ）

| Lens | 主役 | 脇役 | 背景 | 妨げ | 無関係 | 平均確信度 |
| --- | --- | --- | --- | --- | --- | --- |
| kids | 45 | 60 | 0 | 25 | 614 | 0.71 |
| tourist | 99 | 427 | 0 | 4 | 214 | 0.64 |
| quiet | 12 | 13 | 33 | 397 | 289 | 0.67 |
| stroll | 33 | 390 | 29 | 25 | 267 | 0.61 |
| local-not-tourist | 164 | 48 | 0 | 419 | 113 | 0.59 |

### v1 → v3 の対応（全 Lens 合算）。行 = v1、列 = v3

| v1 \ v3 | 主役 | 脇役 | 背景 | 妨げ | 無関係 |
| --- | --- | --- | --- | --- | --- |
| 目的地 | 227 | 67 | 0 | 10 | 20 |
| 立ち寄り先 | 92 | 798 | 23 | 37 | 166 |
| 雰囲気 | 3 | 2 | 39 | 10 | 38 |
| 妨げ | 1 | 1 | 0 | 783 | 77 |
| 無関係 | 30 | 70 | 0 | 30 | 1196 |

### v2 → v3 の対応（全 Lens 合算）。行 = v2、列 = v3

| v2 \ v3 | 主役 | 脇役 | 背景 | 妨げ | 無関係 |
| --- | --- | --- | --- | --- | --- |
| 主役 | 332 | 169 | 13 | 24 | 42 |
| 脇役 | 19 | 745 | 20 | 6 | 312 |
| 背景 | 0 | 1 | 29 | 0 | 29 |
| 妨げ | 2 | 2 | 0 | 838 | 147 |
| 無関係 | 0 | 21 | 0 | 2 | 967 |

### v3 各カテゴリの Score 平均（全 Lens 合算）

| カテゴリ | n | Score 平均 | Score<1.5 の割合 |
| --- | --- | --- | --- |
| 主役 | 353 | 2.71 | 1% |
| 脇役 | 938 | 2.28 | 4% |
| 背景 | 62 | 2.45 | 0% |
| 妨げ | 870 | 0.96 | 93% |
| 無関係 | 1497 | 1.64 | 38% |

### v3 で各カテゴリに入ったタグの例（静か Lens、Score 併記）

- **主役** (12): `leisure=park` 3.4, `leisure=garden` 3.4, `cuisine=teahouse` 3.5, `sport=yoga` 3.3, `amenity=library` 3.4, `amenity=place_of_worship` 3.1, `shelter_type=gazebo` 3.1, `historic=wayside_shrine` 3.1
- **脇役** (13): `amenity=bench` 3.1, `amenity=shelter` 2.4, `cuisine=tea` 3.0, `shelter_type=picnic_shelter` 2.5, `amenity=drinking_water` 2.1, `shop=tea` 2.7, `brand=三省堂書店` 2.3, `brand=珈琲館` 2.3
- **背景** (33): `historic=citywalls` 2.2, `memorial=sculpture` 2.7, `historic=ruins` 2.6, `memorial=statue` 2.6, `memorial=plaque` 2.8, `memorial=bust` 2.6, `artwork_type=sculpture` 2.1, `board_type=plants` 2.5
- **妨げ** (397): `amenity=karaoke_box` 0.2, `amenity=nightclub` 0.0, `leisure=amusement_arcade` 0.2, `leisure=karaoke` 0.3, `brand=カラオケ館` 0.1, `amenity=fast_food` 0.6, `amenity=gambling` 0.2, `shop=mall` 0.3
- **無関係** (289): `brand=Panasonic` 1.8, `amenity=fixme` 1.8, `man_made=survey_point` 2.2, `shop=frame` 1.6, `brand=サミット` 1.8, `shop=carpet` 1.5, `cuisine=regional` 1.8, `brand=ポニー` 1.6

