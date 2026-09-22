/// <reference lib="webworker" />
import { CogpReader } from './vendor/cogp/index.js';
import type {
  CountResult,
  ViewportQuery,
  ViewportResult,
  WorkerEnvelope,
  WorkerResponse,
} from './worker-types.js';

/**
 * 読み取り上限。
 * なぜ 30,000 か: 上限に当たるのは z9〜z11 の 3 段だけで、実測の最大は z10 の 26,404 件だった。
 * 20,000 のままだと切り口が最細レベルの空間順に沿うため、画面の一部だけが穴になる
 * （z10 では西 1/3 が 47〜65% 欠けた）。実件数が収まる水準まで上げて穴をなくす。
 * それでも当たったことは truncated で main に返し、画面に出す（docs/issues/13）。
 */
const MAX_ROWS = 30_000;

/**
 * LOD 選択に持たせる余裕。COGP のレベル解像度は 360/(1024*2^L) のちょうど
 * 0.9999954 倍で、MapLibre の度/px（360/(512*2^z)）は L = z-1 の解像度を
 * 0.0005% だけ上回る。素で渡すと整数ズームで必ず 1 段粗い側に落ちるため、
 * 余裕を掛けて L = z-1 に乗せる（実測は docs/issues/13）。
 */
const RESOLUTION_MARGIN = 0.999;

/**
 * 実件数を数えるときの上限。数える読み取りは bbox 列しか触らないが、
 * 低ズームでは候補が数百万行になるため青天井にはしない。
 */
const MAX_COUNT_ROWS = 2_000_000;

let reader: CogpReader | null = null;

async function open(url: string): Promise<null> {
  reader = await CogpReader.open(url);
  return null;
}

/** 画面の解像度と手動 ±1 から、読むレベルを決める。 */
function resolveLevel(r: CogpReader, degPerPx: number, levelOffset: number): number {
  const lastLevel = r.geo.lod.levels.length - 1;
  return clamp(r.selectLevel(degPerPx * RESOLUTION_MARGIN) + levelOffset, 0, lastLevel);
}

async function readViewport(q: ViewportQuery): Promise<ViewportResult> {
  if (!reader) throw new Error('COGP が未オープン');
  const startedAt = performance.now();
  const geomColumn = reader.primaryGeometryColumn;
  const level = resolveLevel(reader, q.degPerPx, q.levelOffset);
  const rows = await reader.readRows({
    bbox: [q.bbox.xmin, q.bbox.ymin, q.bbox.xmax, q.bbox.ymax],
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

/**
 * 表示範囲の実件数を数える。
 * なぜ別の読み取りか: 転送量の 9 割は `tags` なので、bbox 列だけを指定して
 * 読み直せば「上限で切った件数」ではなく実数を出せる。リーダーは bbox 絞り込みに
 * この列を使うため、列指定を最小にするとほぼ絞り込みの分だけで済む。
 */
async function countViewport(q: ViewportQuery): Promise<CountResult> {
  if (!reader) throw new Error('COGP が未オープン');
  const startedAt = performance.now();
  const bboxColumn = reader.geo.columns[reader.primaryGeometryColumn]?.covering?.bbox?.xmin?.[0];
  const rows = await reader.readRows({
    bbox: [q.bbox.xmin, q.bbox.ymin, q.bbox.xmax, q.bbox.ymax],
    maxLevel: resolveLevel(reader, q.degPerPx, q.levelOffset),
    columns: bboxColumn ? [bboxColumn] : undefined,
    maxRows: MAX_COUNT_ROWS,
  });
  return {
    total: rows.length,
    capped: rows.length >= MAX_COUNT_ROWS,
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
        : payload.type === 'count'
          ? await countViewport(payload)
          : await readViewport(payload);
    self.postMessage({ id, ok: true, result } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message } satisfies WorkerResponse);
  }
};
