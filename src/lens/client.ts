/**
 * Lens 評価のクライアント側。`POST /api/evaluate-tags`（#4）を呼び、NDJSON を
 * 届いた行から順にタグ評価ストアへ反映する。
 *
 * JEV は公開直後で上流の一時障害が通常運用でも起こる（実測の失敗はすべて 503）。
 * BFF が指数バックオフで 6 回まで粘った上でなお落ちるバッチがあるので、ここでは
 * 「全部揃うこと」を前提にしない作りにする。
 *
 * - 届いたタグから順に地図へ反映する（プリミティブが不揃いでも構わない）
 * - 落ちたタグは記録し、**自動では再送しない**。上流が不調なときの自動連打は
 *   実測で逆効果だった（並列度を上げても完了時間は縮まなかった）。再送は利用者の操作で行う
 * - 評価は Lens ごとにメモリへ溜め、地図を動かしても同じタグを二度評価しない
 * - メモリのぶんは IndexedDB にも書き、再読み込みしても評価を引き継ぐ（#6）
 */

import { type Batch, MAX_BATCHES_PER_REQUEST, chunkBatches, planBatches } from '../server/batches.js';
import type { Primitive } from '../server/questions.js';
import { CHOICE_OPTIONS, PRIMITIVES, normalizeLens } from '../server/questions.js';
import type { TagEval } from './aggregate.js';
import { EvalCache, type CacheStats } from './store.js';

/**
 * JEV BFF の場所。既定は dev サーバーのミドルウェア。
 * 本番は Cloudflare Workers を指す（`VITE_BFF_ENDPOINT`）。別オリジンになるので、
 * Worker 側に CORS（POST の preflight を含む）が要る。
 */
const ENDPOINT = import.meta.env.VITE_BFF_ENDPOINT ?? '/api/evaluate-tags';

export interface LensProgress {
  /** 正規化済みの Lens。空文字なら Lens なし。 */
  lens: string;
  running: boolean;
  batchesTotal: number;
  ok: number;
  failed: number;
  /** 失敗の種別ごとの回数（rate_limit / server / timeout …）。 */
  tally: Record<string, number>;
  /** 再送すれば埋まる見込みの「タグ × プリミティブ」数。 */
  retryable: number;
  /** 直近の実行にかかった時間。実行中は null。 */
  elapsedMs: number | null;
  /** リクエスト自体が成立しなかったときの理由（BFF に届かない・鍵がない等）。 */
  error: string | null;
}

type Listener = () => void;

export class LensEvaluator {
  /** Lens ごとのタグ評価。キーは正規化済み Lens。 */
  private readonly store = new Map<string, Map<string, TagEval>>();
  /** Lens ごとの失敗記録。再送するまで自動評価の対象から外す。 */
  private readonly failures = new Map<string, Map<string, Set<Primitive>>>();

  /** 保存側のキャッシュ（#6）。開けない環境では null のままキャッシュ無しで動く。 */
  private cache: EvalCache | null = null;
  /** キャッシュから読み込みを済ませた Lens。1 Lens につき 1 回だけ読む。 */
  private readonly hydrated = new Set<string>();
  private stats: (CacheStats & { total: number }) | null = null;

  private lens = '';
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  /** 実行中に表示範囲が変わったときの再チェック要求。 */
  private recheck: string[] | null = null;

  private progress: LensProgress = idleProgress('');

  constructor(
    /** タグ評価が増えたとき（地図を塗り直す合図）。 */
    private readonly onEvaluated: Listener,
    /** 進捗が動いたとき（パネルの表示更新）。 */
    private readonly onProgress: Listener,
  ) {}

  /** IndexedDB を開く。開けなくても Lens は動くので、失敗は握って進む。 */
  async init(): Promise<void> {
    this.cache = await EvalCache.open();
    if (this.cache) this.stats = { loaded: 0, elapsedMs: 0, total: await this.cache.count() };
    this.onProgress();
  }

  getLens(): string {
    return this.lens;
  }

  getCacheStats(): (CacheStats & { total: number }) | null {
    return this.stats;
  }

  /** 保存した評価を全部捨てる（問い方を変えた実験のとき、手で消せるようにしておく）。 */
  async clearCache(): Promise<void> {
    await this.cache?.clear();
    this.store.clear();
    this.failures.clear();
    this.hydrated.clear();
    if (this.cache) this.stats = { loaded: 0, elapsedMs: 0, total: 0 };
    this.onEvaluated();
    this.onProgress();
  }

  getProgress(): LensProgress {
    return this.progress;
  }

  /** 現在の Lens のタグ評価。地図の集約に渡す。 */
  evals(): Map<string, TagEval> {
    return this.store.get(this.lens) ?? new Map();
  }

  /** Lens を切り替える。進行中の評価は捨てる（別の Lens の結果はもう要らない）。 */
  setLens(raw: string): void {
    const lens = normalizeLens(raw);
    if (lens === this.lens) return;
    this.abort();
    this.lens = lens;
    this.progress = idleProgress(lens);
    this.onProgress();
    this.onEvaluated();
  }

  abort(): void {
    this.controller?.abort();
    this.controller = null;
    this.recheck = null;
  }

  /**
   * 表示範囲のタグのうち、まだ評価が無く失敗もしていないものを評価する。
   * 実行中に呼ばれた場合は、いまの実行が終わってからもう一度見直す。
   */
  async ensure(tags: string[]): Promise<void> {
    if (!this.lens) return;
    if (this.running) {
      this.recheck = tags;
      return;
    }
    const lens = this.lens;
    // 保存済みの評価を先に載せる。これを待たずに投げると、キャッシュにあるタグまで
    // JEV に問い直してしまう。
    await this.hydrate(lens);
    if (this.lens !== lens || this.running) return;

    const groups = this.plan(tags, false);
    if (groups.length === 0) return;
    void this.start(groups, tags);
  }

  /** その Lens の保存済み評価をメモリへ載せる。 */
  private async hydrate(lens: string): Promise<void> {
    if (!this.cache || this.hydrated.has(lens)) return;
    const { evals, stats } = await this.cache.load(lens);
    // 読んでいる間に Lens が変わっていたら、いま要る評価ではない。
    if (this.lens !== lens) return;
    this.hydrated.add(lens);

    const store = upsert(this.store, lens);
    for (const [tag, cached] of evals) {
      // メモリ側は保存側より新しいので、衝突したらメモリを残す。
      store.set(tag, { ...cached, ...store.get(tag) });
    }
    this.stats = { ...stats, total: await this.cache.count() };
    if (stats.loaded > 0) this.onEvaluated();
    this.onProgress();
  }

  /** 失敗して落ちたタグだけを送り直す。利用者が押したときだけ走る。 */
  retry(tags: string[]): void {
    // 再試行ボタンは評価を 1 度走らせた後にしか出ないので、hydrate は済んでいる。
    if (!this.lens || this.running) return;
    this.failures.get(this.lens)?.clear();
    const groups = this.plan(tags, true);
    if (groups.length === 0) return;
    void this.start(groups, tags);
  }

  /**
   * 未評価のタグをプリミティブごとに洗い出し、**タグ集合が同じプリミティブをまとめる**。
   * まとめるのは BFF 側の同時実行数（2）を超えて上流に当たらないため。
   *
   * まとめた上で、1 リクエストがバッチ MAX_BATCHES_PER_REQUEST 本に収まるよう割る。
   * BFF は 1 バッチにつき最大 6 回 JEV を叩くので、本数を抑えないと Workers 無料プランの
   * 外部 fetch 上限（50）に、上流が不調な日だけ当たる（`batches.ts`）。
   * z14 の冷えた Lens は 2 リクエストになる。
   */
  private plan(tags: string[], includeFailed: boolean): Batch[][] {
    const evals = this.store.get(this.lens);
    const failed = this.failures.get(this.lens);
    const byPrimitive = new Map<Primitive, string[]>();

    for (const primitive of PRIMITIVES) {
      const missing = tags.filter((tag) => {
        if (evals?.get(tag)?.[primitive] !== undefined) return false;
        if (!includeFailed && failed?.get(tag)?.has(primitive)) return false;
        return true;
      });
      if (missing.length > 0) byPrimitive.set(primitive, missing);
    }

    const groups = new Map<string, { primitives: Primitive[]; tags: string[] }>();
    for (const [primitive, list] of byPrimitive) {
      const key = list.join('\n');
      const group = groups.get(key);
      if (group) group.primitives.push(primitive);
      else groups.set(key, { primitives: [primitive], tags: list });
    }
    // バッチまで作ってから本数で区切る。タグの範囲で区切ると切り口がバッチ境界と
    // 揃わず、実測で z14 の 16 バッチが 19 本に増えた（`batches.ts`）。
    const batches = [...groups.values()].flatMap((group) =>
      planBatches(this.lens, group.tags, group.primitives),
    );
    return chunkBatches(batches, MAX_BATCHES_PER_REQUEST);
  }

  private async start(groups: Batch[][], viewportTags: string[]): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.progress = { ...idleProgress(this.lens), running: true };
    this.onProgress();

    const startedAt = performance.now();
    this.running = (async () => {
      // グループは逐次で投げる。BFF の中で同時実行を制御しているので、
      // ここで並べると上流への同時要求がその分だけ増える。
      for (const group of groups) {
        if (controller.signal.aborted) break;
        await this.request(group, controller.signal);
      }
    })();

    try {
      await this.running;
    } finally {
      this.running = null;
      if (this.controller === controller) this.controller = null;
      this.progress = {
        ...this.progress,
        running: false,
        elapsedMs: Math.round(performance.now() - startedAt),
        retryable: this.countRetryable(viewportTags),
      };
      this.onProgress();
    }

    const next = this.recheck;
    this.recheck = null;
    if (next && !controller.signal.aborted) void this.ensure(next);
  }

  private async request(batches: Batch[], signal: AbortSignal): Promise<void> {
    const lens = this.lens;
    // 届かなかったぶんを後で失敗として記録するため、送った組み合わせを控える。
    const outstanding = new Map<Primitive, Set<string>>();
    for (const batch of batches) {
      const left = outstanding.get(batch.primitive) ?? new Set<string>();
      for (const tag of batch.tags) left.add(tag);
      outstanding.set(batch.primitive, left);
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lens, batches }),
        signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`BFF が ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }

      for await (const event of ndjson(res.body, signal)) {
        this.handle(lens, event, outstanding);
      }
    } catch (err) {
      if (signal.aborted) return;
      // fetch の失敗は "Failed to fetch" だけで理由が分からないので、どこで切れたかを添える。
      this.progress = { ...this.progress, error: `BFF に届かない（${(err as Error).message}）` };
      this.onProgress();
    }

    if (signal.aborted) return;
    // 成功した行で消し込んだ残り = 届かなかったもの。自動再送はせず記録に留める。
    this.markFailed(lens, outstanding);
  }

  private handle(lens: string, event: Record<string, unknown>, outstanding: Map<Primitive, Set<string>>): void {
    switch (event['type']) {
      case 'start': {
        this.progress = {
          ...this.progress,
          batchesTotal: this.progress.batchesTotal + toNumber(event['batches'], 0),
        };
        this.onProgress();
        return;
      }
      case 'result': {
        const primitive = event['primitive'] as Primitive;
        const answers = event['answers'] as Record<string, unknown> | undefined;
        if (!answers || !PRIMITIVES.includes(primitive)) return;
        const evals = upsert(this.store, lens);
        const left = outstanding.get(primitive);
        const fresh: [string, number | number[]][] = [];
        for (const [tag, answer] of Object.entries(answers)) {
          const value = parseAnswer(primitive, answer);
          if (value === undefined) continue;
          const current = evals.get(tag) ?? {};
          evals.set(tag, { ...current, [primitive]: value });
          fresh.push([tag, value]);
          left?.delete(tag);
        }
        // 保存はバッチ 1 本ぶんを 1 トランザクションで。待たない（地図の更新を止めない）。
        const model = typeof event['model'] === 'string' ? event['model'] : null;
        void this.cache?.put(lens, primitive, fresh, model);
        this.progress = { ...this.progress, ok: this.progress.ok + 1 };
        this.onProgress();
        this.onEvaluated();
        return;
      }
      case 'error': {
        const kind = String(event['kind'] ?? 'unknown');
        this.progress = {
          ...this.progress,
          failed: this.progress.failed + 1,
          tally: { ...this.progress.tally, [kind]: (this.progress.tally[kind] ?? 0) + 1 },
        };
        this.onProgress();
        return;
      }
      case 'done':
        return;
    }
  }

  private markFailed(lens: string, outstanding: Map<Primitive, Set<string>>): void {
    const failed = upsert(this.failures, lens);
    for (const [primitive, tags] of outstanding) {
      for (const tag of tags) {
        const set = failed.get(tag) ?? new Set<Primitive>();
        set.add(primitive);
        failed.set(tag, set);
      }
    }
  }

  /** 表示範囲のタグのうち、失敗したまま残っている「タグ × プリミティブ」数。 */
  countRetryable(tags: string[]): number {
    const failed = this.failures.get(this.lens);
    if (!failed) return 0;
    let n = 0;
    for (const tag of tags) n += failed.get(tag)?.size ?? 0;
    return n;
  }
}

function idleProgress(lens: string): LensProgress {
  return { lens, running: false, batchesTotal: 0, ok: 0, failed: 0, tally: {}, retryable: 0, elapsedMs: null, error: null };
}

function upsert<V>(map: Map<string, Map<string, V>>, key: string): Map<string, V> {
  const found = map.get(key);
  if (found) return found;
  const created = new Map<string, V>();
  map.set(key, created);
  return created;
}

/** NDJSON を行に切って流す。1 チャンクに複数行・行の途中で切れる、のどちらもある。 */
async function* ndjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) return;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) yield JSON.parse(line) as Record<string, unknown>;
        index = buffer.indexOf('\n');
      }
    }
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as Record<string, unknown>;
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** JEV の回答 1 件を、集約で使う形に直す。想定と違う形なら捨てる。 */
function parseAnswer(primitive: Primitive, answer: unknown): TagEval[Primitive] | undefined {
  const a = answer as Record<string, unknown> | null;
  if (!a || typeof a !== 'object') return undefined;

  if (primitive === 'noul') {
    const p = a['probability'];
    return typeof p === 'number' ? p : undefined;
  }
  if (primitive === 'score') {
    const s = a['score'];
    return typeof s === 'number' ? s : undefined;
  }
  const probabilities = a['probabilities'] as Record<string, unknown> | undefined;
  if (!probabilities) return undefined;
  return CHOICE_OPTIONS.map((name) => toNumber(probabilities[name], 0));
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
