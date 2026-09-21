# JEV プリミティブ（Noul / Score / Choice）の役割検証
labels: experiment, jev

## なぜ検討が必要か
現在の仮説は Noul = relevance、Score = strength、Choice = semantic category だが、
実際の JEV 出力を見ていない。プロンプト設計（criteria を「属性」ではなく「取るべき扱い」で書く等）で結果が大きく変わることも既知。

## 現在わかっていること
- JEV は生成せず、型付きの判断と確率分布だけを返す。1 リクエストに複数質問を並べると同じ `state` に対して独立に評価される。
- Vercel AI Gateway 経由と TypeSafe 直 API で、bool の型名・確率フィールド名が異なる（`boolean`/`probability` vs `noul`/`noul`）。
- 入力 100 万トークンあたり $0.042。出力課金なし。
- 評価対象の候補タグはプロファイリングで出ている（#2）。

## 未決事項
- 3 プリミティブを全部使うべきか。Score だけで relevance と strength を兼ねられる可能性。
- Choice の選択肢（semantic category）を Lens ごとに変えるか、固定するか。
- `state` にタグをどう表現するか（トークンのまま / 説明を添える / 実例名を添える）。
- 1 リクエストあたりの質問数の上限と、レイテンシ・コストの関係。
- 否定形 Lens（「観光客向けでない」）で criteria が壊れないか。

## 実験計画（案）
- 日本の都市部（例: 東京駅周辺 z14）のユニークタグ数百件を対象に、Lens 4 種 × 3 プリミティブで評価
- 生 JSON を保存し、分布（中央寄り・二極化）と直感との一致を記録

## 結論
（実験後に記載）
