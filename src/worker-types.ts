/** main と worker で共有するメッセージ型。 */

export interface ViewportBbox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** 表示範囲とレベルの指定。viewport と count で同じものを使う。 */
export interface ViewportQuery {
  bbox: ViewportBbox;
  /** 画面の経度の度/px。レベルに落とす判断は worker 側に置く。 */
  degPerPx: number;
  /** 開発パネルの手動 ±1。 */
  levelOffset: number;
}

export type WorkerRequest =
  | { type: 'open'; url: string }
  | ({ type: 'viewport' } & ViewportQuery)
  | ({ type: 'count' } & ViewportQuery);

export interface ViewportResult {
  geojson: GeoJSON.FeatureCollection;
  count: number;
  /** 実際に読んだレベル（手動 ±1 を反映した後）。 */
  level: number;
  /** maxRows に当たって表示範囲の一部しか読めていない。 */
  truncated: boolean;
  elapsedMs: number;
}

export interface CountResult {
  /** 表示範囲・同レベルの実件数。 */
  total: number;
  /** 数える側の上限にも当たった（total は「以上」の意味になる）。 */
  capped: boolean;
  elapsedMs: number;
}

export interface WorkerEnvelope {
  id: number;
  payload: WorkerRequest;
}

export type WorkerResponse =
  | { id: number; ok: true; result: ViewportResult | CountResult | null }
  | { id: number; ok: false; error: string };
