/// <reference types="vite/client" />

/**
 * 差し替えたい URL は 2 つだけ。既定はローカル（Vite の dev サーバーが両方を賄う）で、
 * 本番のビルド時にだけ渡す。`VITE_` 接頭辞の付いたものしかクライアントに露出しない。
 */
interface ImportMetaEnv {
  /** POI COGP の場所。本番は R2（別オリジン）。既定は dev サーバーの Range 配信。 */
  readonly VITE_COGP_URL?: string;
  /** JEV BFF の場所。本番は Cloudflare Workers（別オリジン）。既定は dev サーバー。 */
  readonly VITE_BFF_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
