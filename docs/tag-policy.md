# タグ方針 v1（2026-09-22 決定）

[全件プロファイリング](../reports/tag-profile/REPORT.md) の結果を踏まえ、議論の上で決めた JEV 評価対象の線引き。
**v1 の方針**であり、JEV 小規模実験の結果で見直す前提。

## 決定事項

| # | 論点 | 決定 | 理由 |
| --- | --- | --- | --- |
| 1 | yes/no フラグ（`wheelchair` 車椅子可 / `outdoor_seating` 屋外席 / `fee` 有料 …約 70 キー） | **v1 は除外** | 意味が付いている種別に依存する。JEV の出力を見てから単独評価 / 組評価を判断する |
| 2 | `brand`（ブランド名）/ `operator`（運営者名） | **`brand` は世界で 100 件以上のものだけ含める。`operator` は除外** | 日本域はブランド情報が濃く Lens の差が出る。運営者は施設側の情報で意味判断に効かない |
| 3 | `name`（固有名） | **v1 は除外。表示（Popup）のみ。第 2 段評価は Issue に残す** | 再利用率 30% でタグ評価の枠に乗らない。まずタグ評価だけで Lens が成り立つかを検証する |
| 4a | 種別不明値（`shop=yes` 種類不明の店 など） | **除外** | 分類情報がなく、Lens の判断に効かない |
| 4b | 数値値（`capacity` 収容数 / `level` 階 / `ele` 標高 / `start_date` 建立年 …） | **すべて除外** | 単独で意味判断に乗らない。`start_date` の区分化は第 2 弾候補 |
| 5 | ロングテール | **許可リスト方式。世界で 100 回以上出る `key=value` のみ評価** | タイポ・独自値の排除。正規化辞書・説明文・事前計算キャッシュの鍵を兼ねる |
| 6 | JEV に渡す表現 | **実験で「トークンのみ」と「日本語説明文付き」を比較**。実例名付きは含めない | 議論では決められない。実例名はキャッシュ設計と衝突する |
| — | JEV 接続経路 | **Vercel AI Gateway 経由**（$5 の無料枠を使う。将来の BFF も同じ経路） | 無料枠で実験できる。Gateway 側のログ・課金管理が使える |

## 評価対象キー

### 分類キー（「何であるか」）

値が yes / no のものは除外（4a）。

`amenity`（施設）/ `shop`（店）/ `tourism`（観光）/ `leisure`（レジャー）/ `historic`（史跡）/ `healthcare`（医療）/
`office`（事務所）/ `craft`（工房・職人）/ `man_made`（人工物）/ `natural`（自然地物）/ `public_transport`（公共交通）/
`railway`（鉄道）/ `aeroway`（空港設備）/ `emergency`（緊急設備）/ `attraction`（遊具・見どころ）/ `club`（クラブ・同好会）/
`place`（地名種別）/ `highway`（道路付帯物）/ `building`（建物種別）/ `landuse`（土地利用）

### 細分キー（分類をもう一段割る）

`;` 区切りの複数値は分解して 1 値 = 1 タグにする（順序は無視、小文字化・trim）。

| キー | 意味 | 備考 |
| --- | --- | --- |
| `cuisine` | 料理ジャンル | 複数値 16.5%。分解で 68k → 13k 種 |
| `religion` / `denomination` | 宗教 / 宗派 | |
| `information` | 案内の種類（道標・掲示板・地図板） | |
| `vending` | 自販機の中身 | 複数値あり |
| `sport` | スポーツ種目 | 複数値あり |
| `artwork_type` / `memorial` / `archaeological_site` / `historic:civilization` | アートの種類 / 記念物の種類 / 遺跡の種類 / 文明 | |
| `board_type` / `shelter_type` / `parking` / `bicycle_parking` / `recycling_type` | 掲示板の種類 / 屋根の種類 / 駐車場の形態 / 駐輪場の形態 / リサイクル拠点の形態 | |
| `social_facility` / `social_facility:for` / `healthcare:speciality` | 福祉施設の種類 / 対象者 / 診療科 | 複数値あり |
| `waste` / `clothes` / `swimming_pool` | ゴミの種類 / 衣料の種類 / プールの形態 | |

### ブランド

`brand` のうち世界で 100 件以上のもの（`brand:ja` / `brand:en` は `brand` の表記違いなので対象外）。

## 除外（v1）

- メタ情報: `addr:*`（住所）/ `contact:*`（連絡先）/ `website` / `phone` / `email` / `ref` / `ref:*` / `*:wikidata` / `*:wikipedia` / `wikidata` / `wikipedia` / `image` / `wikimedia_commons` / `source*` / `check_date*` / `survey:date` / `fixme` / `KSJ2:*`（国土数値情報）/ `gnis:*`
- 名前系: `name` / `name:*` / `alt_name` / `official_name` / `short_name` / `branch` / `operator` / `operator:*` / `brand:*`
- フラグ（1）: yes/no 値のキー全般（`payment:*` / `recycling:*` / `fuel:*` / `diet:*` / `toilets:*` / `socket:*` / `currency:*` を含む）
- 数値・日時（4b）: `capacity` / `seats` / `level` / `ele` / `start_date` / `direction` / `opening_hours` / `collection_times` / `service_times`
- 自由記述: `description` / `note` / `inscription`
- 外観: `material`（素材）/ `colour`（色）/ `surface`（表面）/ `support`（支柱）
- 種別不明値（4a）: 分類キーの `yes` / `no`

## 第 2 弾で見直す候補

- フラグの単独評価（`outdoor_seating=yes` 屋外席あり 等）。特に **`access=private`（私有・立入不可）** は Lens の種類を問わず POI を沈める根拠になり得るので優先度が高い
- `start_date` の区分化（〜1900 / 〜1945 / 戦後 / 2000〜）
- `name` の第 2 段評価（Issue 11）
- `material=wood`（木製）のような外観タグが「散歩」系 Lens に効くか
