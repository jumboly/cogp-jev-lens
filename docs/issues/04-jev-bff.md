# JEV BFF（`POST /api/evaluate-tags`）の選定
labels: design, infra, decision-needed

## なぜ検討が必要か
ブラウザから JEV API を直接呼ぶと API キーが露出する。TypeSafe 直 API は CORS がオリジン許可制でもある。
単なる Proxy ではなく、正規化・キャッシュ・スキーマ版管理を持つアプリ固有 API を置きたい。

## 現在わかっていること
- 候補: Cloudflare Workers / AWS Lambda / Vercel AI Gateway 直 / Cloudflare Workers + Vercel AI Gateway / JEV 直 Proxy
- 比較軸: 無料枠、個人実験コスト、実装量、運用の簡単さ、API キー管理、CORS、キャッシュ、将来の拡張性
- POI ホスティングを Cloudflare R2 にするなら（#5）、Workers が同一基盤でまとまる
- Cloudflare Workers 無料枠: 10 万リクエスト/日。KV / D1 / Cache API も無料枠あり
- Vercel AI Gateway は JEV への到達手段として動作確認済み（別プロジェクトの知見）。TypeSafe 直 API は Workers からなら CORS 非該当

## 未決事項
- JEV への到達経路: TypeSafe 直（Workers から）か Gateway 経由か。課金・キー管理・レイテンシで比較
- API 設計: リクエスト = `{ lens, tags[], schemaVersion }`、レスポンス = タグごとの評価 + キャッシュヒット情報、でよいか
- レート制限・悪用対策（公開デモにするなら必要）

## 結論（2026-09-22、一部）
- JEV への到達経路は **Vercel AI Gateway** に決定（$5 無料枠。実験と BFF で経路を揃える）。BFF の実行基盤（Workers か否か）は未決
