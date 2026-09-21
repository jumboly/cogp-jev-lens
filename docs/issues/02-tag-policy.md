# JEV 評価対象タグの選定（評価対象 / 条件付き / 除外）
labels: design, decision-needed

## なぜ検討が必要か
タグ評価は Lens ごとに「ユニークタグ × 1 回」の JEV 呼び出しになる。対象を広げすぎるとコストとノイズが増え、
狭めすぎると Lens の判断材料が薄くなる。プロファイリング結果を踏まえて線を引く。

## 現在わかっていること（プロファイリングより）
- **分類キー**（`amenity` / `shop` / `tourism` / `leisure` / `historic` / `healthcare` / `office` / `craft` …）は値が OSM トークンで重複率 99% 超。中核候補。
- **細分キー**（`cuisine` / `religion` / `information` / `vending` / `sport` / `artwork_type` / `memorial` …）は Lens の意味判断に効く可能性が高い。`cuisine` は `;` 分解が必須（68k → 13k 種）。
- **フラグ（yes/no）** が約 70 キー（`wheelchair` / `outdoor_seating` / `takeaway` / `fee` / `changing_table` / `diet:*` …）。意味が付いている種別に依存する。
- **`name`** は再利用率 30%。タグ単位の枠に乗らない。**`brand`** は上位数千で再利用性が高い。
- **メタ情報**（`addr:*` / `contact:*` / `ref*` / `*:wikidata` / `source*` / `check_date*` / `website` / `phone` / `email` / `image` / `KSJ2:*`）は評価材料にならない。
- `shop=yes` / `historic=yes` 等の「種別不明」値が数万〜十数万件ある。
- 1 回しか出ないペアが 191 万。

## 未決事項（REPORT.md「議論したい点」）
1. フラグの評価単位: 単独 / 種別との組 / v1 は除外
2. `brand` / `operator` を含めるか（条件付き案: 世界で ≥100 件）
3. `name` の扱い（v1 除外、第 2 段は #11）
4. 「種別不明」値・数値値の扱い
5. ロングテールの切り方と許可リスト（#12）
6. JEV に渡す `state` の表現（英語トークンのまま / 説明文を添える）→ #3 の実験で確認

## 結論（2026-09-22）
議論の結果を [`docs/tag-policy.md`](../tag-policy.md) にまとめた。要点:

1. フラグ（yes/no）は v1 除外。JEV 出力を見てから単独 / 組評価を判断
2. `brand` は世界 100 件以上のみ含める。`operator` は除外
3. `name` は v1 除外、第 2 段は #11
4. 種別不明値（`shop=yes`）と数値値はすべて除外
5. 許可リスト方式、閾値は世界で 100 回以上（#12）
6. JEV に渡す表現は実験（#3）で「トークンのみ」と「説明文付き」を比較

接続経路は Vercel AI Gateway（$5 無料枠）。
