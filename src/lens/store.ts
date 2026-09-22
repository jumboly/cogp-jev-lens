/**
 * タグ評価のブラウザ内キャッシュ（#6）。
 *
 * なぜ保存するか: 冷えた Lens は z14 の東京駅周辺で 623 タグ × 3 プリミティブ = 21 リクエストになり、
 * 上流の状態次第で 1〜3 分かかる（#8 の実測）。メモリだけだと再読み込みで消えるので、
 * 地図を開き直すたび・Lens を戻すたびにこの時間を払うことになる。
 *
 * なぜ IndexedDB か: localStorage は同期 API で 5 MB 前後の上限があり、
 * 1 Lens あたり 1,869 レコードを積むには向かない。
 */

import { SCHEMA_VERSION, type Primitive } from '../server/questions.js';
import type { TagEval } from './aggregate.js';

const DB_NAME = 'cogp-jev-lens';
const STORE = 'tag-evals';

/**
 * DB のバージョンに評価スキーマ版をそのまま使う。問い方（state の注意書き・criteria・
 * Choice の選択肢）を変えたら SCHEMA_VERSION を上げる決まりなので、上げた時点で
 * `onupgradeneeded` が走り、古い問い方の評価を丸ごと捨てられる（#6 の「無効化」）。
 */
const DB_VERSION = SCHEMA_VERSION;

/** 鍵の区切り。Lens もタグも `\u0000` は含まない。 */
const SEP = '\u0000';

interface Record {
  /** Noul と Score は数値、Choice は CHOICE_OPTIONS 順の確率。 */
  value: number | number[];
  /**
   * 応答の `model`。実測では版を含まない固定文字列（`typesafe-ai/jev`）なので
   * 鍵には使わず記録として持つ（#6 の但し書き）。
   */
  model: string | null;
  at: number;
}

export interface CacheStats {
  /** 読み出した「タグ × プリミティブ」の数。 */
  loaded: number;
  elapsedMs: number;
}

export class EvalCache {
  private constructor(private readonly db: IDBDatabase) {}

  /**
   * 開けなければ null を返す。プライベートウィンドウや保存を禁じた設定では
   * IndexedDB が使えないが、その場合もキャッシュ無しで動く方がよい。
   */
  static async open(): Promise<EvalCache | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
      return new EvalCache(await openDb());
    } catch {
      return null;
    }
  }

  /** その Lens に保存してある評価をまとめて読む。 */
  async load(lens: string): Promise<{ evals: Map<string, TagEval>; stats: CacheStats }> {
    const startedAt = performance.now();
    const evals = new Map<string, TagEval>();
    let loaded = 0;

    const tx = this.db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    // Lens 単位でまとめて取る。1 件ずつ get すると 1,869 回の往復になる。
    const range = IDBKeyRange.bound(`${lens}${SEP}`, `${lens}${SEP}￿`);
    const keys = await promisify(store.getAllKeys(range));
    const values = await promisify(store.getAll(range));

    for (let i = 0; i < keys.length; i++) {
      const parts = String(keys[i]).split(SEP);
      const tag = parts[1];
      const primitive = parts[2] as Primitive | undefined;
      const record = values[i] as Record | undefined;
      if (!tag || !primitive || !record) continue;
      const current = evals.get(tag) ?? {};
      evals.set(tag, { ...current, [primitive]: record.value });
      loaded++;
    }

    return { evals, stats: { loaded, elapsedMs: performance.now() - startedAt } };
  }

  /**
   * 届いた評価を書く。バッチ 1 本ぶん（最大 90 件）を 1 トランザクションでまとめる。
   * 失敗しても評価自体はメモリにあるので、例外は投げずに無視する。
   */
  async put(
    lens: string,
    primitive: Primitive,
    values: Iterable<readonly [string, number | number[]]>,
    model: string | null,
  ): Promise<void> {
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const at = Date.now();
      for (const [tag, value] of values) {
        store.put({ value, model, at } satisfies Record, `${lens}${SEP}${tag}${SEP}${primitive}`);
      }
      await done(tx);
    } catch {
      // 保存できなくても Lens の表示は成立する。
    }
  }

  async count(): Promise<number> {
    const tx = this.db.transaction(STORE, 'readonly');
    return promisify(tx.objectStore(STORE).count());
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // 版が上がったら作り直す。移行はしない（問い方が変わった評価はもう使えない）。
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB を開けない'));
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB の要求が失敗した'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB の書き込みが失敗した'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB の書き込みが中断した'));
  });
}
