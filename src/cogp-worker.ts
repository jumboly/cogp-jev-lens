/// <reference lib="webworker" />
import { CogpReader } from './vendor/cogp/index.js';
import type {
  ViewportBbox,
  ViewportResult,
  WorkerEnvelope,
  WorkerResponse,
} from './worker-types.js';

/**
 * 読み取り上限。z14 の都心（約 8,800 件）には余裕があり、z13 以下では上限に当たる。
 * 当たったことは truncated で main に返し、画面に出す（docs/issues/13）。
 */
const MAX_ROWS = 20_000;

/**
 * LOD 選択に持たせる余裕。COGP のレベル解像度は 360/(1024*2^L) のちょうど
 * 0.9999954 倍で、MapLibre の度/px（360/(512*2^z)）は L = z-1 の解像度を
 * 0.0005% だけ上回る。素で渡すと整数ズームで必ず 1 段粗い側に落ちるため、
 * 余裕を掛けて L = z-1 に乗せる（実測は docs/issues/13）。
 */
const RESOLUTION_MARGIN = 0.999;

let reader: CogpReader | null = null;

async function open(url: string): Promise<null> {
  reader = await CogpReader.open(url);
  return null;
}

async function readViewport(
  bbox: ViewportBbox,
  degPerPx: number,
  levelOffset: number,
): Promise<ViewportResult> {
  if (!reader) throw new Error('COGP が未オープン');
  const startedAt = performance.now();
  const geomColumn = reader.primaryGeometryColumn;
  const lastLevel = reader.geo.lod.levels.length - 1;
  const level = clamp(reader.selectLevel(degPerPx * RESOLUTION_MARGIN) + levelOffset, 0, lastLevel);
  const rows = await reader.readRows({
    bbox: [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax],
    maxLevel: level,
    maxRows: MAX_ROWS,
  });

  const features: GeoJSON.Feature[] = [];
  for (const row of rows) {
    const geometry = row[geomColumn] as GeoJSON.Geometry | null | undefined;
    if (!geometry) continue;
    const tags = toTagRecord(row['tags']);
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        id: toPlain(row['id']),
        name: tags['name'] ?? '',
        // なぜ文字列か: MapLibre は GeoJSON の properties を JSON.stringify で
        // worker に渡すため、入れ子のオブジェクトは扱いにくい。Popup で parse する。
        tags: JSON.stringify(tags),
      },
    });
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    count: features.length,
    level,
    truncated: rows.length >= MAX_ROWS,
    elapsedMs: performance.now() - startedAt,
  };
}

/** tags は MAP<string,string>。リーダーの戻りが Map でも素の object でも同じ形に均す。 */
function toTagRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const entries =
    value instanceof Map
      ? value.entries()
      : value && typeof value === 'object'
        ? Object.entries(value as Record<string, unknown>)
        : [];
  for (const [k, v] of entries) {
    if (v !== null && v !== undefined) out[String(k)] = String(v);
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** id は int64 で返るので、そのままでは JSON にできない。 */
function toPlain(value: unknown): string | number {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  return typeof value === 'number' ? value : String(value ?? '');
}

self.onmessage = async (e: MessageEvent<WorkerEnvelope>) => {
  const { id, payload } = e.data;
  try {
    const result =
      payload.type === 'open'
        ? await open(payload.url)
        : await readViewport(payload.bbox, payload.degPerPx, payload.levelOffset);
    self.postMessage({ id, ok: true, result } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message } satisfies WorkerResponse);
  }
};
