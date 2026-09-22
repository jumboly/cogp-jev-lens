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

import { CHOICE_OPTIONS } from './server/questions.js';
import {
  UNEVALUATED_STYLE,
  aggregate,
  type PoiStyle,
  type TagEval,
} from './lens/aggregate.js';
import { LensEvaluator } from './lens/client.js';
import type {
  CountResult,
  ViewportQuery,
  ViewportResult,
  WorkerEnvelope,
  WorkerRequest,
  WorkerResponse,
} from './worker-types.js';

/**
 * POI COGP の場所。既定は dev サーバーが `data/` を Range 配信する経路。
 * 本番は R2 を指す（`VITE_COGP_URL`）。別オリジンになるので、R2 側で
 * **HEAD と GET、`Range` リクエストヘッダ**を許可する CORS が要る
 * （リーダーはまず HEAD でファイル長を取る）。
 */
const COGP_URL = import.meta.env.VITE_COGP_URL ?? '/data/pois.cogp.parquet';
const SOURCE_ID = 'pois';
const LAYER_ID = 'poi-dots';

/** 東京駅周辺。実験 01 と同じ場所で件数と見え方を比べられるようにする。 */
const INITIAL_VIEW = { center: [139.7671, 35.6812] as [number, number], zoom: 14 };

const BASEMAPS = {
  // 淡色にするのは、この上に載る POI の点と Lens の色を主役にするため。
  // 標準 (std.json) は建物と道路が濃く、点が沈む。
  gsi: 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/pale.json',
  osm: 'https://tiles.openfreemap.org/styles/liberty',
} as const;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** worker の読み取り上限と揃える（docs/issues/13）。 */
const MAX_ROWS = 30_000;

/**
 * Lens を有効にする最小ズーム（docs/issues/10）。
 * COGP の粗いレベルは「重要な POI が先」ではなく空間間引きなので、低ズームで
 * 残る POI 集合に意味的な代表性がない。「この辺りは子供向けが少ない」と読ませてしまう。
 */
const LENS_MIN_ZOOM = 13;

/**
 * 評価が届いてから塗り直すまでの間。NDJSON はバッチ単位で次々届き、
 * そのたびに数千件を再集約して setData すると描画が詰まる。
 */
const REPAINT_DEBOUNCE_MS = 150;

// ---- DOM ----

const statusEl = must<HTMLParagraphElement>('status');
const tagsEl = must<HTMLParagraphElement>('tags');
const warningEl = must<HTMLParagraphElement>('warning');
const basemapEl = must<HTMLSelectElement>('basemap');
const lodValueEl = must<HTMLOutputElement>('lod-value');
const lodDownEl = must<HTMLButtonElement>('lod-down');
const lodUpEl = must<HTMLButtonElement>('lod-up');
const lensFormEl = must<HTMLFormElement>('lens-form');
const lensInputEl = must<HTMLInputElement>('lens-input');
const lensStatusEl = must<HTMLParagraphElement>('lens-status');
const lensAppliedEl = must<HTMLParagraphElement>('lens-applied');
const lensRetryEl = must<HTMLButtonElement>('lens-retry');
const lensStopEl = must<HTMLButtonElement>('lens-stop');
const legendEl = must<HTMLDetailsElement>('legend');
const perfEl = must<HTMLParagraphElement>('perf');
const cacheClearEl = must<HTMLButtonElement>('cache-clear');

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
 * POI の層。塗りはすべて feature の properties を読む式にしてある。
 * Lens 適用前・低ズーム・未評価では素の点（一律の小さな黒点、#13）と同じ値が入るので、
 * 層を差し替えずに Lens の有無を切り替えられる。
 */
function addPoiLayer(data: GeoJSON.FeatureCollection): void {
  map.addSource(SOURCE_ID, { type: 'geojson', data });
  map.addLayer({
    id: LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      // 半径は「z14 での px」を properties に持たせ、ズームでの拡縮だけを式で掛ける。
      // 混色と同じくらい細かい浮沈の差を式で組むより、集約側で決めた方が見通しがよい。
      // zoom はトップレベルの interpolate の入力にしか置けないので、掛け算は各ストップの中に入れる。
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['*', 0.533, ['get', 'lensRadius']],
        14,
        ['get', 'lensRadius'],
        18,
        ['*', 1.667, ['get', 'lensRadius']],
      ],
      'circle-color': ['get', 'lensColor'],
      'circle-opacity': ['get', 'lensOpacity'],
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

// ---- Lens ----

const lens = new LensEvaluator(scheduleRepaint, () => {
  renderLensStatus();
  renderPerf();
});

/** 表示範囲の評価対象タグ（出現数の多い順）。評価の依頼と再試行の範囲になる。 */
let viewportTags: string[] = [];

function lensActive(): boolean {
  return lens.getLens() !== '' && map.getZoom() >= LENS_MIN_ZOOM;
}

lensFormEl.addEventListener('submit', (e) => {
  e.preventDefault();
  applyLensInput(lensInputEl.value);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('.presets button')) {
  button.addEventListener('click', () => {
    lensInputEl.value = button.dataset['lens'] ?? '';
    applyLensInput(lensInputEl.value);
  });
}

function applyLensInput(value: string): void {
  lens.setLens(value);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.presets button')) {
    // 「解除」は data-lens が空なので、Lens なしの状態で押下表示にならないよう除く。
    const preset = button.dataset['lens'] ?? '';
    button.setAttribute('aria-pressed', String(preset !== '' && preset === lens.getLens()));
  }
  legendEl.hidden = lens.getLens() === '';
  requestEvaluation();
}

lensRetryEl.addEventListener('click', () => lens.retry(viewportTags));
cacheClearEl.addEventListener('click', () => {
  // 消したら表示範囲のタグを評価し直す（Lens が入っていれば自動で走る）。
  void lens.clearCache().then(requestEvaluation);
});
lensStopEl.addEventListener('click', () => {
  lens.abort();
  renderLensStatus();
});

/** 表示範囲のタグのうち未評価のものを評価に出す。失敗済みのタグは含まれない（再試行は手動）。 */
function requestEvaluation(): void {
  if (!lensActive()) {
    lens.abort();
    renderLensStatus();
    scheduleRepaint();
    return;
  }
  void lens.ensure(viewportTags);
  renderLensStatus();
  scheduleRepaint();
}

function renderLensStatus(): void {
  const p = lens.getProgress();
  const retryable = p.running ? p.retryable : lens.countRetryable(viewportTags);

  lensStopEl.hidden = !p.running;
  lensRetryEl.hidden = p.running || retryable === 0;
  lensRetryEl.textContent = `失敗した ${retryable.toLocaleString()} 件を再試行`;

  if (lens.getLens() === '') {
    lensStatusEl.textContent = '';
    return;
  }
  if (map.getZoom() < LENS_MIN_ZOOM) {
    // 低ズームの POI 集合は空間間引きで代表性がないため、Lens は掛けない（#10）。
    lensStatusEl.textContent = `z${LENS_MIN_ZOOM} までズームすると Lens が有効になります`;
    return;
  }

  const parts: string[] = [];
  if (p.running) parts.push(`評価中 ${p.ok + p.failed}/${p.batchesTotal} バッチ`);
  else if (p.batchesTotal > 0) parts.push(`評価 ${p.batchesTotal} バッチ / ${((p.elapsedMs ?? 0) / 1000).toFixed(1)} 秒`);
  // バッチが 1 つも始まっていない。評価が要らなかった場合と、BFF に届かなかった場合がある。
  else if (p.error) parts.push('評価できていません');
  else parts.push('評価済み');

  if (p.failed > 0) {
    const tally = Object.entries(p.tally)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(' / ');
    parts.push(`失敗 ${p.failed}（${tally}）`);
  }
  if (p.error) parts.push(p.error);
  lensStatusEl.textContent = parts.join('・');
}

/**
 * 性能の内訳（#9）。COGP の読み取りは `#status` に出ているので、ここには
 * 「評価が届いてから地図が変わるまで」に効く 2 つ（集約と保存キャッシュ）を出す。
 */
function renderPerf(): void {
  const c = lens.getCacheStats();
  const parts = [`集約 ${Math.round(lastRepaintMs)} ms`];
  if (!c) parts.push('キャッシュ 使えない');
  else if (c.loaded > 0) parts.push(`キャッシュ ${c.total.toLocaleString()} 件（${c.loaded.toLocaleString()} 件を ${Math.round(c.elapsedMs)} ms で復元）`);
  else parts.push(`キャッシュ ${c.total.toLocaleString()} 件`);
  perfEl.textContent = parts.join(' / ');
  cacheClearEl.disabled = !c || c.total === 0;
}

// ---- Lens を地図に載せる ----

let repaintTimer: number | null = null;

function scheduleRepaint(): void {
  if (repaintTimer !== null) return;
  repaintTimer = window.setTimeout(() => {
    repaintTimer = null;
    repaint();
  }, REPAINT_DEBOUNCE_MS);
}

/**
 * タグ評価を POI へ配り直し、見え方を properties に書いて地図へ流す。
 *
 * 数千件なので GeoJSON をまるごと差し替える（#8 の未決事項。feature-state を使うと
 * 更新経路が 2 本になり、背景地図の切り替えで層を入れ直すたびに張り直す必要が出る）。
 */
/** 直近の repaint（集約 + setData）がメインスレッドを占めた時間。 */
let lastRepaintMs = 0;

function repaint(): void {
  const startedAt = performance.now();
  const active = lensActive();
  const evals: Map<string, TagEval> = active ? lens.evals() : new Map();
  // 同じタグ構成の POI は同じ見え方になる。半数以上が 1 タグなので効きが大きい。
  const cache = new Map<string, PoiStyle>();
  let applied = 0;
  let partial = 0;
  let colorless = 0;

  for (const feature of lastData.features) {
    const props = feature.properties ?? (feature.properties = {});
    let style = UNEVALUATED_STYLE;
    if (active) {
      const key = String(props['tagIds'] ?? '[]');
      const found = cache.get(key);
      style = found ?? aggregate(JSON.parse(key) as string[], evals);
      if (!found) cache.set(key, style);
    }
    if (style.state !== 'none') {
      applied++;
      if (style.state === 'partial') partial++;
      // Choice のバッチだけ落ちた POI。大きさは Lens に従うが色は未評価のまま（#8）。
      if (style.choice === null) colorless++;
    }
    props['lensRadius'] = style.radius;
    props['lensOpacity'] = style.opacity;
    props['lensColor'] = style.color;
    props['lensState'] = style.state;
  }

  (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(lastData);
  // setData の後でタイルを作り直すのは worker 側なので、ここに出るのは
  // メインスレッドを占めた時間だけ。描画の詰まりに直結するのはこちら。
  lastRepaintMs = performance.now() - startedAt;
  renderPerf();

  if (!active) {
    lensAppliedEl.textContent = '';
    return;
  }
  const total = lastData.features.length;
  // 何がどれだけ欠けているかを出す。「評価が届いていない」と「無関係と判断された」は
  // 別物で、混ぜると欠測を Lens の答えとして読まれてしまう（#13 の「穴」と同じ考え方）。
  const notes: string[] = [];
  if (partial > 0) notes.push(`一部のタグのみ ${partial.toLocaleString()} 件`);
  if (colorless > 0) notes.push(`色が未達 ${colorless.toLocaleString()} 件`);
  lensAppliedEl.textContent =
    `Lens 適用 ${applied.toLocaleString()} 件` +
    (notes.length > 0 ? `（${notes.join(' / ')}）` : '') +
    ` / 未評価 ${(total - applied).toLocaleString()} 件`;
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
  const query: ViewportQuery = {
    bbox: { xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth() },
    degPerPx: degPerPx(),
    levelOffset,
  };

  try {
    const result = await ask<ViewportResult>({ type: 'viewport', ...query });
    if (token !== latestToken) return;

    lastData = result.geojson;
    viewportTags = result.tags.map((t) => t.id);
    // 読み取り直後に 1 度塗る。Lens が無ければ素の点、あれば既知の評価がすぐ載る。
    repaint();
    requestEvaluation();

    currentLevel = result.level;
    renderLod();
    statusEl.textContent = `${result.count.toLocaleString()} 件 / z${map.getZoom().toFixed(1)} / L${result.level} / ${Math.round(result.elapsedMs)} ms`;
    tagsEl.textContent = `評価対象タグ ${result.tags.length.toLocaleString()} 種 / 対象外 ${result.droppedTagKinds.toLocaleString()} 種`;

    if (!result.truncated) {
      setWarning('');
      return;
    }
    // 地図はもう描けているので、実件数は待たせず後追いで出す。
    setWarning(`上限 ${MAX_ROWS.toLocaleString()} 件で打ち切りました。実件数を数えています…`);
    const counted = await ask<CountResult>({ type: 'count', ...query });
    if (token !== latestToken) return;
    // 数える側も上限に当たったときは実数が確定しないので、割合は出さない。
    const ratio = Math.round((result.count / counted.total) * 100);
    setWarning(
      counted.capped
        ? `表示範囲には ${counted.total.toLocaleString()} 件以上あり、上限の ${MAX_ROWS.toLocaleString()} 件だけ読んでいます。`
        : `表示範囲には ${counted.total.toLocaleString()} 件あり、上限の ${MAX_ROWS.toLocaleString()} 件（約 ${ratio}%）だけ読んでいます。`,
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
  new Popup({ maxWidth: '360px' })
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

  const detail = lensDetail(props);
  if (detail) root.append(detail);
  return root;
}

/** なぜこの見え方になったかを開いて確かめられるようにする（#8）。 */
function lensDetail(props: Record<string, unknown>): HTMLElement | null {
  if (!lensActive()) return null;
  const tagIds = JSON.parse(String(props['tagIds'] ?? '[]')) as string[];
  if (tagIds.length === 0) return null;

  const evals = lens.evals();
  const style = aggregate(tagIds, evals);

  const box = document.createElement('section');
  box.className = 'lens-detail';

  const heading = document.createElement('h3');
  heading.textContent =
    style.state === 'none'
      ? `Lens「${lens.getLens()}」: まだ評価が届いていない`
      : `Lens「${lens.getLens()}」: Score ${style.score?.toFixed(2) ?? '—'} / ${style.evaluated} of ${style.total} タグ`;
  box.append(heading);

  const table = document.createElement('table');
  table.append(row('th', ['タグ', 'Score', '判断', '確信度']));
  for (const id of tagIds) {
    const e = evals.get(id);
    table.append(
      row('td', [
        id,
        e?.score?.toFixed(2) ?? '—',
        e?.choice ? topChoice(e.choice) : '—',
        e?.noul?.toFixed(2) ?? '—',
      ]),
    );
  }
  box.append(table);
  return box;
}

function row(cell: 'th' | 'td', values: string[]): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const [i, value] of values.entries()) {
    const el = document.createElement(cell);
    el.textContent = value;
    // タグ名以外は数値・短い語なので右寄せの等幅にする。
    if (cell === 'td' && i > 0) el.className = 'num';
    tr.append(el);
  }
  return tr;
}

function topChoice(probabilities: number[]): string {
  let best = 0;
  for (let i = 1; i < probabilities.length; i++) {
    if ((probabilities[i] ?? 0) > (probabilities[best] ?? 0)) best = i;
  }
  return `${CHOICE_OPTIONS[best]} ${Math.round((probabilities[best] ?? 0) * 100)}%`;
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
  renderLensStatus();
  // 保存キャッシュを先に開ける。開く前に評価を投げると、保存済みのタグまで問い直す。
  await lens.init();
  renderPerf();
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
