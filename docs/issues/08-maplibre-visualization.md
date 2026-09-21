# MapLibre での AI Lens 可視化
labels: design, frontend

## なぜ検討が必要か
「検索」ではなく「Lens」であることを、表示の変化で伝えたい。POI の集合は変えず、見え方だけを変える。

## 現在わかっていること
- 仮案: サイズ → Score、透明度 → relevance、色 → Choice、Popup → JEV 詳細
- 取得と評価を分離し、POI をまず通常表示、JEV 結果が届いたら Lens 表現を重ねる非同期 UI
- MapLibre のデータ駆動スタイル（`feature-state` または属性更新）で実現できる
- 表示範囲の POI は数千件規模（東京駅周辺 z14 で約 4,000〜5,000 件）

## 未決事項
- `feature-state` で更新するか、GeoJSON ソースを差し替えるか（数千件なら差し替えでも足りる）
- 「沈める」表現（透明度 / サイズ / 彩度）のどれが Lens らしく見えるか
- Choice のカテゴリ数と配色
- Lens 切り替え時のトランジション

## 結論
（実装しながら記載）
