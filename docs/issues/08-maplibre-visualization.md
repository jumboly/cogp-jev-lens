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

## 決定（2026-09-22、着手前の構成）
- フロントエンド: **Vite + TypeScript（フレームワークなし）**。MapLibre と COGP リーダーが主役で UI は小さいため
- 背景地図: **地理院地図 Vector と OSM（OpenFreeMap）を UI で切り替え可能、既定は地理院地図 Vector**。日本域では地理院の品質を活かし、日本以外や OSM 由来 POI との突き合わせが要るときは OpenFreeMap に切り替える（2026-09-22 修正）
- JEV 呼び出し（当面）: **Vite dev サーバーに `POST /api/evaluate-tags` を仮実装**し、`.env` のキーで Vercel AI Gateway を呼ぶ。本番 BFF（#4）と同じ API 形にして後で移す
- 色は Choice v3 の確率分布を混ぜる（最頻値ではなく）。Score は 2 を「変化なし」のアンカーにし、|Score−2| を強さ、符号を浮沈に使う（#7）

## 結論
（実装しながら記載）
