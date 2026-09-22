import {
  GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import type {
  ViewportResult,
  WorkerEnvelope,
  WorkerRequest,
  WorkerResponse,
} from './worker-types.js';

const COGP_URL = '/data/pois.cogp.parquet';
const SOURCE_ID = 'pois';
const LAYER_ID = 'poi-dots';

/** 東京駅周辺。実験 01 と同じ場所で件数と見え方を比べられるようにする。 */
const INITIAL_VIEW = { center: [139.7671, 35.6812] as [number, number], zoom: 14 };

const BASEMAPS = {
  gsi: 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/std.json',
  osm: 'https://tiles.openfreemap.org/styles/liberty',
} as const;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// ---- DOM ----

const statusEl = must<HTMLParagraphElement>('status');
const warningEl = must<HTMLParagraphElement>('warning');
const basemapEl = must<HTMLSelectElement>('basemap');
const lodValueEl = must<HTMLOutputElement>('lod-value');
const lodDownEl = must<HTMLButtonElement>('lod-down');
const lodUpEl = must<HTMLButtonElement>('lod-up');

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がない`);
  return el as T;
}

// ---- worker ----

const worker = new Worker(new URL('./cogp-worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
let nextId = 0;

worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
  const entry = pending.get(e.data.id);
  if (!entry) return;
  pending.delete(e.data.id);
  if (e.data.ok) entry.resolve(e.data.result as never);
  else entry.reject(new Error(e.data.error));
});

// worker 内の例外は message に乗らず error として出るので、待っている側へ回す。
worker.addEventListener('error', (e) => {
  const err = new Error(e.message || 'worker が落ちた');
  for (const [, entry] of pending) entry.reject(err);
  pending.clear();
});

function ask<T>(payload: WorkerRequest): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    worker.postMessage({ id, payload } satisfies WorkerEnvelope);
  });
}

// ---- map ----

const map = new MapLibreMap({
  container: 'map',
  style: BASEMAPS.gsi,
  center: INITIAL_VIEW.center,
  zoom: INITIAL_VIEW.zoom,
  hash: true,
});
map.addControl(new NavigationControl(), 'top-right');
map.addControl(new ScaleControl());

/**
 * Lens 適用前は全 POI を同じ小さな点で出す（docs/issues/13）。
 * 種別ごとに色を付けると Lens の色と意味が二重になるため、ここでは一律にする。
 */
function addPoiLayer(data: GeoJSON.FeatureCollection): void {
  map.addSource(SOURCE_ID, { type: 'geojson', data });
  map.addLayer({
    id: LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 3, 18, 5],
      'circle-color': '#333333',
      'circle-opacity': 0.75,
      'circle-stroke-width': 0.5,
      'circle-stroke-color': '#ffffff',
    },
  });
}

let lastData: GeoJSON.FeatureCollection = EMPTY;

basemapEl.addEventListener('change', () => {
  const key = basemapEl.value as keyof typeof BASEMAPS;
  map.setStyle(BASEMAPS[key]);
});

// 背景地図を切り替えると style ごと差し替わり、POI の層も消える。
// style.load は初回と切り替え後の両方で 1 回ずつ鳴るので、ここだけで入れ直す。
map.on('style.load', () => addPoiLayer(lastData));

// ---- LOD の手動調整 ----

let levelOffset = 0;
let currentLevel: number | null = null;
/** COGP を開き終わるまでは表示範囲の読み取りに進まない。 */
let opened = false;

function renderLod(): void {
  lodValueEl.textContent = currentLevel === null ? 'L–' : `L${currentLevel}`;
  lodValueEl.title = levelOffset === 0 ? '自動' : `自動から ${levelOffset > 0 ? '+' : ''}${levelOffset}`;
  lodDownEl.disabled = levelOffset <= -1;
  lodUpEl.disabled = levelOffset >= 1;
}

for (const [el, delta] of [
  [lodDownEl, -1],
  [lodUpEl, 1],
] as const) {
  el.addEventListener('click', () => {
    levelOffset = Math.max(-1, Math.min(1, levelOffset + delta));
    renderLod();
    void refresh();
  });
}

// ---- 表示範囲の読み取り ----

/** 経度の度/px。Web メルカトルではズームだけで決まるので緯度補正はしない。 */
function degPerPx(): number {
  const width = 100;
  const y = map.getContainer().clientHeight / 2;
  const left = map.unproject([0, y]);
  const right = map.unproject([width, y]);
  return Math.abs(right.lng - left.lng) / width;
}

/** 移動のたびに走るので、最後の要求だけを採用する。 */
let latestToken = 0;

async function refresh(): Promise<void> {
  if (!opened) return;
  const token = ++latestToken;
  const b = map.getBounds();

  try {
    const result = await ask<ViewportResult>({
      type: 'viewport',
      bbox: { xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth() },
      degPerPx: degPerPx(),
      levelOffset,
    });
    if (token !== latestToken) return;

    lastData = result.geojson;
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(result.geojson);

    currentLevel = result.level;
    renderLod();
    statusEl.textContent = `${result.count.toLocaleString()} 件 / z${map.getZoom().toFixed(1)} / L${result.level} / ${Math.round(result.elapsedMs)} ms`;
    setWarning(
      result.truncated
        ? '読み取り上限（20,000 件）に達しました。表示範囲の一部しか読めていません。'
        : '',
    );
  } catch (err) {
    if (token !== latestToken) return;
    statusEl.textContent = '読み取りに失敗しました';
    setWarning((err as Error).message);
  }
}

function setWarning(message: string): void {
  warningEl.textContent = message;
  warningEl.hidden = message === '';
}

// ---- Popup ----

map.on('click', LAYER_ID, (e: MapLayerMouseEvent) => {
  const feature = e.features?.[0];
  if (!feature) return;
  new Popup({ maxWidth: '320px' })
    .setLngLat((feature.geometry as GeoJSON.Point).coordinates as [number, number])
    .setDOMContent(popupContent(feature.properties ?? {}))
    .addTo(map);
});
map.on('mouseenter', LAYER_ID, () => (map.getCanvas().style.cursor = 'pointer'));
map.on('mouseleave', LAYER_ID, () => (map.getCanvas().style.cursor = ''));

/** OSM のタグは任意の文字列なので、HTML 文字列を組まずテキストノードで入れる。 */
function popupContent(props: Record<string, unknown>): HTMLElement {
  const root = document.createElement('div');
  root.className = 'popup';

  const heading = document.createElement('h2');
  heading.textContent = String(props['name'] || '(名前なし)');
  root.append(heading);

  const list = document.createElement('dl');
  for (const [key, value] of Object.entries(parseTags(props['tags']))) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd);
  }
  root.append(list);
  return root;
}

function parseTags(value: unknown): Record<string, string> {
  if (typeof value !== 'string') return {};
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return {};
  }
}

// ---- 起動 ----

async function boot(): Promise<void> {
  renderLod();
  try {
    await ask<null>({ type: 'open', url: COGP_URL });
    opened = true;
    map.on('moveend', () => void refresh());
    await refresh();
  } catch (err) {
    statusEl.textContent = 'COGP を開けませんでした';
    setWarning((err as Error).message);
  }
}

void boot();
